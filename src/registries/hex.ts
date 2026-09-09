import { fetchJson } from '../http';
import { hexScheme } from '../schemes';
import type { RegistryVersions } from '../types';

export interface HexPackage {
  name?: string;
  html_url?: string;
  latest_stable_version?: string;
  releases?: { version?: string; inserted_at?: string }[];
  meta?: { description?: string; licenses?: string[]; links?: Record<string, string> };
}

export class HexClient {
  constructor(private readonly timeoutMs: number) {}

  async fetchVersions(name: string, source = 'https://hex.pm/api'): Promise<RegistryVersions> {
    if (source.startsWith('hexrepo:')) {
      const configured = process.env[`FRESH_DEPS_HEX_REPO_${source.slice(8).toUpperCase().replace(/\W/g, '_')}`];
      if (!configured || !/^https:\/\/[^\s]+$/.test(configured)) return { error: 'Custom Hex repository requires an API URL in FRESH_DEPS_HEX_REPO_<NAME>' };
      source = configured.replace(/\/$/, '');
    }
    const headers = source.startsWith('https://hex.pm/') && process.env.HEX_API_KEY ? { authorization: process.env.HEX_API_KEY } : undefined;
    const doc = await fetchJson<HexPackage>(`${source}/packages/${encodeURIComponent(name.toLowerCase())}`, { timeoutMs: this.timeoutMs, headers });
    return doc ? hexVersions(doc) : { error: 'not found' };
  }
}

export function hexVersions(doc: HexPackage): RegistryVersions {
  const releases = (doc.releases ?? []).filter((release) => !!release.version && hexScheme.isVersion(release.version));
  const all = releases.map((release) => release.version!);
  const latest = doc.latest_stable_version && hexScheme.isVersion(doc.latest_stable_version)
    ? doc.latest_stable_version : hexScheme.max(all, { includePrerelease: false });
  const release = releases.find((item) => item.version === latest);
  const links = doc.meta?.links ?? {};
  const repository = Object.values(links).find((value) => /^https?:\/\/(?:github|gitlab|bitbucket)\./i.test(value));
  return all.length ? { latest, all, meta: {
    description: doc.meta?.description,
    license: doc.meta?.licenses?.join(' OR '),
    repository,
    latestPublishedAt: release?.inserted_at,
  } } : { error: 'no comparable versions found' };
}
