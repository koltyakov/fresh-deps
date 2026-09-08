import * as semver from 'semver';
import { fetchJson } from '../http';
import type { PackageMeta, RegistryVersions } from '../types';

const API = 'https://crates.io/api/v1/crates';
const LOOSE = { loose: true } as const;

interface CrateSummary {
  description?: string | null;
  homepage?: string | null;
  repository?: string | null;
}

interface CrateVersion {
  num?: string;
  yanked?: boolean;
  created_at?: string;
  license?: string | null;
}

export interface CratesResponse {
  crate?: CrateSummary;
  versions?: CrateVersion[];
}

export class CratesClient {
  constructor(private readonly timeoutMs: number) {}

  async fetchVersions(name: string): Promise<RegistryVersions> {
    const doc = await fetchJson<CratesResponse>(`${API}/${encodeURIComponent(name)}`, { timeoutMs: this.timeoutMs });
    return doc ? versionsOf(doc) : { error: 'not found' };
  }
}

/** Converts one crates.io response into the common version and metadata shape. */
export function versionsOf(doc: CratesResponse): RegistryVersions {
  const releases = (doc.versions ?? []).filter(
    (version): version is CrateVersion & { num: string } => !version.yanked && !!version.num && semver.valid(version.num, LOOSE) !== null,
  );
  const all = releases.map((version) => version.num);
  const latest = semver.maxSatisfying(all, '*', LOOSE) ?? undefined;
  if (!latest) {
    return { all };
  }

  const release = releases.find((version) => version.num === latest);
  const meta: PackageMeta = {};
  if (doc.crate?.description) meta.description = doc.crate.description;
  if (doc.crate?.homepage) meta.homepage = doc.crate.homepage;
  if (doc.crate?.repository) meta.repository = doc.crate.repository;
  if (release?.license) meta.license = release.license;
  if (release?.created_at) meta.latestPublishedAt = release.created_at;
  return { latest, all, meta };
}
