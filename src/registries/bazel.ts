import { bazelScheme } from '../bazel';
import { fetchJson, fetchText } from '../http';
import type { RegistryVersions } from '../types';

export function bazelVersions(data: { versions?: unknown; yanked_versions?: unknown; homepage?: unknown }): RegistryVersions {
  if (!Array.isArray(data.versions) || (data.yanked_versions !== undefined
    && (!data.yanked_versions || typeof data.yanked_versions !== 'object' || Array.isArray(data.yanked_versions)))) return { error: 'invalid BCR metadata' };
  const yanked = data.yanked_versions ?? {};
  const all = data.versions.filter((version): version is string => typeof version === 'string'
    && bazelScheme.isVersion(version) && !Object.hasOwn(yanked, version));
  return all.length ? { all, latest: bazelScheme.max(all, { includePrerelease: false }),
    ...(typeof data.homepage === 'string' ? { meta: { homepage: data.homepage } } : {}) } : { error: 'no comparable BCR versions found' };
}

export class BazelClient {
  constructor(private readonly timeoutMs: number) {}
  async compatibility(name: string, version: string, source = 'https://bcr.bazel.build'): Promise<number | undefined> {
    for (const registry of source.split('|')) {
      const text = await fetchText(`${registry}/modules/${encodeURIComponent(name)}/${encodeURIComponent(version)}/MODULE.bazel`, { timeoutMs: this.timeoutMs, headers: { accept: 'text/plain' } });
      if (text) return Number(text.match(/\bcompatibility_level\s*=\s*(\d+)/)?.[1] ?? 0);
    }
    return undefined;
  }
  async fetchVersions(name: string, sources = 'https://bcr.bazel.build'): Promise<RegistryVersions> {
    if (!/^[a-z][a-z0-9._-]*$/.test(name)) return { error: 'invalid Bazel module name' };
    for (const source of sources.split('|')) {
      const data = await fetchJson<Parameters<typeof bazelVersions>[0]>(`${source}/modules/${encodeURIComponent(name)}/metadata.json`, { timeoutMs: this.timeoutMs });
      if (data) return bazelVersions(data);
    }
    return { error: 'not found' };
  }
}
