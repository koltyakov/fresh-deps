import { isMap } from 'yaml';
import { fetchText } from '../http';
import { conanScheme } from '../numericVersion';
import { yamlDocument, yamlString } from '../parsers/yaml';
import type { RegistryVersions } from '../types';

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
  constructor(private readonly timeoutMs: number) {}
  async fetchVersions(name: string): Promise<RegistryVersions> {
    const text = await fetchText(`https://raw.githubusercontent.com/conan-io/conan-center-index/master/recipes/${encodeURIComponent(name)}/config.yml`,
      { timeoutMs: this.timeoutMs, headers: { accept: 'text/plain' } });
    return text ? conanVersions(text) : { error: 'not found' };
  }
}
