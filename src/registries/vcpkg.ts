import * as semver from 'semver';
import { fetchJson } from '../http';
import { conanScheme } from '../numericVersion';
import type { DependencyRef, RegistryVersions } from '../types';
import { vcpkgScheme, vcpkgVersion } from '../vcpkg';

interface PortVersion { [key: string]: unknown }
function entryVersion(entry: PortVersion): { field: string; value: string } | undefined {
  const fields = ['version', 'version-semver', 'version-date', 'version-string'].filter((field) => Object.hasOwn(entry, field));
  if (fields.length !== 1 || fields[0] === 'version-string') return undefined;
  const field = fields[0], version = entry[field], revision = entry['port-version'] ?? 0;
  if (typeof version !== 'string' || version.includes('#') || !Number.isSafeInteger(revision) || Number(revision) < 0) return undefined;
  if (field === 'version' && !conanScheme.isVersion(version)) return undefined;
  if (field === 'version-semver' && !semver.valid(version)) return undefined;
  if (field === 'version-date' && vcpkgVersion(version)?.kind !== 'date') return undefined;
  return { field, value: `${version}${revision ? `#${revision}` : ''}` };
}

export function vcpkgVersions(data: { versions?: unknown }, spec: string, field?: DependencyRef['vcpkgVersionField']): RegistryVersions {
  if (!Array.isArray(data.versions)) return { error: 'invalid vcpkg version database' };
  const entries = data.versions.flatMap((entry) => {
    const parsed = entry && typeof entry === 'object' ? entryVersion(entry) : undefined;
    return parsed ? [parsed] : [];
  });
  const baseline = vcpkgScheme.baseline(spec);
  // The registry identifies the versioning scheme. Never order version-string
  // ports or compare a package across a change of scheme.
  const current = baseline && entries.find((entry) => (!field || entry.field === field) && (entry.value === baseline
    || (baseline.endsWith('#0') && entry.value === baseline.slice(0, -2))));
  if (!current) return { error: 'declared version has no comparable vcpkg registry entry' };
  const all = entries.filter((entry) => entry.field === current.field).map((entry) => entry.value);
  return { all, latest: vcpkgScheme.max(all, { includePrerelease: false }) };
}

export class VcpkgClient {
  constructor(private readonly timeoutMs: number) {}
  async fetchVersions(name: string, spec: string, field?: DependencyRef['vcpkgVersionField']): Promise<RegistryVersions> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return { error: 'invalid vcpkg port name' };
    const data = await fetchJson<{ versions?: unknown }>(`https://raw.githubusercontent.com/microsoft/vcpkg/master/versions/${name[0]}-/${name}.json`, { timeoutMs: this.timeoutMs });
    return data ? vcpkgVersions(data, spec, field) : { error: 'not found' };
  }
}
