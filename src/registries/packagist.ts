import { fetchJson } from '../http';
import { composerVersion } from '../composer';
import { composerScheme } from '../schemes';
import type { RegistryVersions } from '../types';

export interface PackagistResponse {
  packages?: Record<string, { version?: string; description?: string; license?: string[]; time?: string; homepage?: string }[]>;
}

export class PackagistClient {
  constructor(private readonly timeoutMs: number) {}

  async fetchVersions(name: string): Promise<RegistryVersions> {
    const doc = await fetchJson<PackagistResponse>(`https://repo.packagist.org/p2/${name.split('/').map(encodeURIComponent).join('/')}.json`, { timeoutMs: this.timeoutMs });
    return doc ? packagistVersions(doc, name) : { error: 'not found' };
  }
}

export function packagistVersions(doc: PackagistResponse, name: string): RegistryVersions {
  const releases = (doc.packages?.[name] ?? []).map((release) => ({ release, version: release.version ? composerVersion(release.version) : undefined }));
  const all = releases.flatMap(({ version }) => version ? [version] : []);
  const latest = composerScheme.max(all, { includePrerelease: false });
  // P2 metadata may be minified by inheriting fields from the preceding release.
  // Only use explicit metadata rather than guessing those inherited values.
  const release = releases.find((item) => item.version === latest)?.release;
  return all.length ? { all, latest, meta: release ? {
    description: release.description, license: Array.isArray(release.license) ? release.license.join(' OR ') : undefined,
    homepage: release.homepage, latestPublishedAt: release.time,
  } : undefined } : { error: 'no comparable versions found' };
}
