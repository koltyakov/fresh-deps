import { bazelScheme } from '../bazel';
import { fetchJson } from '../http';
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
  async fetchVersions(name: string): Promise<RegistryVersions> {
    if (!/^[a-z][a-z0-9._-]*$/.test(name)) return { error: 'invalid Bazel module name' };
    const data = await fetchJson<Parameters<typeof bazelVersions>[0]>(`https://bcr.bazel.build/modules/${encodeURIComponent(name)}/metadata.json`, { timeoutMs: this.timeoutMs });
    return data ? bazelVersions(data) : { error: 'not found' };
  }
}
