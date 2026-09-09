import { fetchJson } from '../http';
import { rubyScheme } from '../ruby';
import type { RegistryVersions } from '../types';

export interface RubyGemsVersion {
  number?: string;
  prerelease?: boolean;
  created_at?: string;
  summary?: string;
  licenses?: string[];
}

export class RubyGemsClient {
  constructor(private readonly timeoutMs: number) {}

  async fetchVersions(name: string, source = 'https://rubygems.org'): Promise<RegistryVersions> {
    const doc = await fetchJson<RubyGemsVersion[]>(`${source}/api/v1/versions/${encodeURIComponent(name)}.json`, { timeoutMs: this.timeoutMs });
    return doc ? rubyGemsVersions(doc) : { error: 'not found' };
  }
}

export function rubyGemsVersions(doc: RubyGemsVersion[]): RegistryVersions {
  const releases = doc.filter((release) => !!release.number && rubyScheme.isVersion(release.number));
  const all = releases.map((release) => release.number!);
  const latest = rubyScheme.max(all, { includePrerelease: false });
  const release = releases.find((item) => item.number === latest);
  return all.length ? { latest, all, meta: release ? {
    description: release.summary,
    license: release.licenses?.join(' OR '),
    latestPublishedAt: release.created_at,
  } : undefined } : { error: 'no comparable versions found' };
}
