import { fetchJson } from '../http';
import { dartScheme } from '../schemes';
import type { RegistryVersions } from '../types';

export interface PubResponse {
  versions?: {
    version?: string;
    retracted?: boolean;
    published?: string;
    pubspec?: { description?: string; homepage?: string; repository?: string; environment?: { sdk?: string } };
  }[];
}

export class PubClient {
  constructor(private readonly timeoutMs: number) {}

  async fetchVersions(name: string, source = 'https://pub.dev'): Promise<RegistryVersions> {
    const doc = await fetchJson<PubResponse>(`${source}/api/packages/${encodeURIComponent(name)}`, { timeoutMs: this.timeoutMs });
    return doc ? pubVersions(doc) : { error: 'not found' };
  }
}

export function pubVersions(doc: PubResponse): RegistryVersions {
  if (!Array.isArray(doc.versions)) return { error: 'no comparable versions found' };
  const evidence = { published: doc.versions.flatMap((release) => release.version && dartScheme.isVersion(release.version) ? [release.version] : []),
    allComplete: doc.versions.every((release) => typeof release.version === 'string') };
  const releases = (doc.versions ?? []).filter((release) => !release.retracted && !!release.version && dartScheme.isVersion(release.version));
  const all = releases.map((release) => release.version!);
  const latest = dartScheme.max(all, { includePrerelease: false });
  const release = releases.find((item) => item.version === latest);
  return all.length ? { latest, all, ...evidence, requirements: Object.fromEntries(releases.map((item) => [item.version!, [item.pubspec?.environment?.sdk ?? '']])), meta: release ? {
    description: release.pubspec?.description, homepage: release.pubspec?.homepage,
    repository: release.pubspec?.repository, latestPublishedAt: release.published,
    runtimeRequirement: release.pubspec?.environment?.sdk,
  } : undefined } : { all, ...evidence };
}
