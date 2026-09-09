import { fetchJson } from '../http';
import { composerVersion } from '../composer';
import { composerScheme } from '../schemes';
import type { RegistryVersions } from '../types';

export interface PackagistResponse {
  packages?: Record<string, { version?: string; description?: string; license?: string[]; time?: string; homepage?: string }[]>;
}

export class PackagistClient {
  constructor(private readonly timeoutMs: number) {}

  async fetchVersions(name: string, sources?: string): Promise<RegistryVersions> {
    if (sources) {
      for (const source of sources.split('|')) {
        const index = await fetchJson<{ 'metadata-url'?: string; packages?: Record<string, Record<string, { version: string }>> }>(`${source}/packages.json`, { timeoutMs: this.timeoutMs });
        if (!index) continue;
        if (index.packages?.[name]) return packagistVersions({ packages: { [name]: Object.values(index.packages[name]) } }, name);
        if (!index['metadata-url']) return { error: 'Composer repository does not expose package metadata' };
        const url = new URL(index['metadata-url'].replace('%package%', name), `${source}/`);
        if (url.protocol !== 'https:' || url.username || url.password) return { error: 'Invalid Composer metadata URL' };
        const doc = await fetchJson<PackagistResponse>(url.href, { timeoutMs: this.timeoutMs });
        if (doc?.packages?.[name]?.length) return packagistVersions(doc, name);
      }
      return { error: 'not found' };
    }
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
