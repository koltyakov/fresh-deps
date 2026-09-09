import { isMap } from 'yaml';
import { fetchText, fetchJson } from '../http';
import { conanScheme } from '../numericVersion';
import { yamlDocument, yamlString } from '../parsers/yaml';
import type { RegistryVersions } from '../types';
import { readProjectFile } from '../projectFiles';
import { join } from 'path';
import { homedir } from 'os';

export function conanVersions(text: string): RegistryVersions {
  const versions = yamlDocument(text)?.root.get('versions', true);
  if (!isMap(versions)) return { error: 'invalid Conan Center recipe index' };
  const all = versions.items.flatMap((pair) => {
    const version = yamlString(pair.key);
    return version && conanScheme.isVersion(version) ? [version] : [];
  });
  return all.length ? { all, latest: conanScheme.max(all, { includePrerelease: false }) } : { error: 'no comparable recipe versions found' };
}

export class ConanClient {
  readonly remotes: { name: string; url: string }[] = [];
  constructor(private readonly timeoutMs: number) {
    const text = readProjectFile(join(process.env.CONAN_HOME || join(homedir(), '.conan2'), 'remotes.json'));
    if (text) {
      const config = JSON.parse(text) as { remotes?: { name: string; url: string; disabled?: boolean }[] };
      this.remotes = (config.remotes ?? []).filter((remote) => !remote.disabled && /^https:\/\/[^\s]+$/.test(remote.url));
    }
  }
  async fetchVersions(name: string, revision?: string): Promise<RegistryVersions> {
    const [recipe, scope] = name.split('@');
    if (scope && !this.remotes.length) return { error: 'User/channel recipes require a configured Conan remote' };
    if (this.remotes.length || scope || revision) {
      const remotes = this.remotes.length ? this.remotes : [{ name: 'conancenter', url: 'https://center2.conan.io' }];
      for (const remote of remotes) {
        const token = process.env[`FRESH_DEPS_CONAN_TOKEN_${remote.name.toUpperCase().replace(/\W/g, '_')}`];
        const options = { timeoutMs: this.timeoutMs, headers: token ? { authorization: `Bearer ${token}` } : undefined };
        const base = remote.url.replace(/\/$/, '');
        const doc = await fetchJson<{ results?: string[] }>(`${base}/v2/conans/search?q=${encodeURIComponent(`${recipe}/*${scope ? `@${scope}` : ''}`)}`, options);
        if (!doc) continue;
        if (!Array.isArray(doc.results)) return { error: 'Invalid Conan search response' };
        const all = doc.results.flatMap((ref) => {
          const match = /^([^/]+)\/([^@#]+)(?:@([^#]+))?/.exec(ref);
          return match && match[1] === recipe && (match[3] === scope || !scope && (!match[3] || match[3] === '_/_')) && conanScheme.isVersion(match[2]) ? [match[2]] : [];
        });
        const latest = conanScheme.max(all, { includePrerelease: false });
        if (!latest) continue;
        if (revision) {
          const [user, channel] = scope?.split('/') ?? ['_', '_'];
          const latestRef = await fetchJson<{ revision?: string }>(`${base}/v2/conans/${encodeURIComponent(recipe)}/${encodeURIComponent(latest)}/${encodeURIComponent(user)}/${encodeURIComponent(channel)}/latest`, options);
          if (latestRef?.revision && /^[a-f\d]{32}$/.test(latestRef.revision)) return { all, latest, revision: latestRef.revision, latestRaw: `${latest}#${latestRef.revision}` };
        }
        return { all, latest };
      }
      return { error: 'not found' };
    }
    const text = await fetchText(`https://raw.githubusercontent.com/conan-io/conan-center-index/master/recipes/${encodeURIComponent(name)}/config.yml`,
      { timeoutMs: this.timeoutMs, headers: { accept: 'text/plain' } });
    return text ? conanVersions(text) : { error: 'not found' };
  }
}
