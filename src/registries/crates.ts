import * as semver from 'semver';
import { fetchJson, fetchText } from '../http';
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
  rust_version?: string | null;
}

export interface CratesResponse {
  crate?: CrateSummary;
  versions?: CrateVersion[];
}

export class CratesClient {
  constructor(private readonly timeoutMs: number) {}

  async fetchVersions(name: string, source?: string): Promise<RegistryVersions> {
    if (source) {
      if (!source.startsWith('sparse+https://')) return { error: 'Only HTTPS sparse Cargo registries are supported' };
      const lower = name.toLowerCase();
      const suffix = lower.length <= 2 ? `${lower.length}/${lower}` : lower.length === 3 ? `3/${lower[0]}/${lower}` : `${lower.slice(0, 2)}/${lower.slice(2, 4)}/${lower}`;
      const text = await fetchText(`${source.slice(7).replace(/\/$/, '')}/${suffix}`, { timeoutMs: this.timeoutMs, headers: { accept: 'text/plain' } });
      if (!text) return { error: 'not found' };
      const versions = text.trim().split('\n').map((line) => { const item = JSON.parse(line); return { ...item, num: item.vers }; });
      return versionsOf({ versions });
    }
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
  if (release?.rust_version) meta.runtimeRequirement = `Rust >=${release.rust_version}`;
  return { latest, all, meta, requirements: Object.fromEntries(releases.map((item) => [item.num, [item.rust_version ?? '']])) };
}
