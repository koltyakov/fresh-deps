import { dockerScheme, dockerTag } from '../docker';
import { fetchJson, HttpError } from '../http';
import type { RegistryVersions } from '../types';
import { OciClient, basicAuth } from './oci';

export function dockerVersions(tags: string[], spec: string): RegistryVersions {
  const style = dockerTag(spec)?.style;
  const all = tags.filter((tag) => style && dockerTag(tag)?.style === style);
  return all.length ? { all, latest: dockerScheme.max(all, { includePrerelease: false }) } : { error: 'no comparable image tags found' };
}

export class DockerClient {
  private readonly pending = new Map<string, Promise<string[] | undefined>>();
  constructor(private readonly timeoutMs: number) {}

  async fetchVersions(name: string, spec: string, host?: string, revision?: string): Promise<RegistryVersions> {
    const key = `${host ?? 'docker.io'}/${name}`;
    let pending = this.pending.get(key);
    if (!pending) { pending = host ? new OciClient(this.timeoutMs).tags(host, name) : this.tags(name); this.pending.set(key, pending); }
    const tags = await pending;
    const versions = tags ? dockerVersions(tags, spec) : { error: 'not found' };
    if (revision && versions.latest) {
      const response = await new OciClient(this.timeoutMs).response(`https://${host ?? 'registry-1.docker.io'}/v2/${name}/manifests/${encodeURIComponent(versions.latest)}`,
        'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json');
      const digest = response?.headers.get('docker-content-digest');
      if (digest && /^sha256:[a-f\d]{64}$/.test(digest)) return { ...versions, revision: digest, latestRaw: `${versions.latest}@${digest}` };
    }
    return versions;
  }

  private async tags(name: string): Promise<string[] | undefined> {
    // The Hub UI API embeds every image manifest per tag. Distribution lists only names.
    const credentials = basicAuth('registry-1.docker.io');
    const auth = await fetchJson<{ token?: string; access_token?: string }>(
      `https://auth.docker.io/token?service=registry.docker.io&scope=${encodeURIComponent(`repository:${name}:pull`)}`,
      { timeoutMs: this.timeoutMs, headers: credentials ? { authorization: credentials } : undefined });
    const token = auth?.token ?? auth?.access_token;
    if (!token) throw new Error('Docker Hub did not return an anonymous registry token');
    const tags: string[] = [];
    const base = `https://registry-1.docker.io/v2/${name}/tags/list`;
    let url = `${base}?n=10000`;
    for (let page = 0; page < 100; page++) {
      const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': 'vscode-fresh-deps' },
        signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new HttpError(response.status, `${response.status} ${response.statusText}`);
      const doc = await response.json() as { tags?: string[] | null };
      if (doc.tags === null) return tags;
      if (!Array.isArray(doc.tags) || doc.tags.some((tag) => typeof tag !== 'string')) throw new Error('invalid Docker Hub tags response');
      tags.push(...doc.tags);
      const link = response.headers.get('link');
      if (!link) return tags;
      const href = /<([^>]+)>\s*;\s*rel="?next"?/.exec(link)?.[1];
      if (!href) throw new Error('invalid Docker Hub pagination link');
      const next = new URL(href, url);
      if (next.origin !== 'https://registry-1.docker.io' || next.pathname !== new URL(base).pathname || next.username || next.password) {
        throw new Error('unexpected Docker Hub pagination URL');
      }
      url = next.href;
    }
    throw new Error('Docker Hub tag pagination limit reached');
  }
}
