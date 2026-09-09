import * as semver from 'semver';
import { fetchJson } from '../http';
import { numericScheme } from '../numericVersion';
import type { DependencyRef, RegistryVersions } from '../types';
import { vcpkgScheme, vcpkgVersion } from '../vcpkg';
import { readProjectFile } from '../projectFiles';
import { join } from 'path';
const conanScheme = numericScheme(false);

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
  private readonly baselines = new Map<string, Promise<Record<string, { baseline: string; 'port-version'?: number }> | undefined>>();
  constructor(private readonly timeoutMs: number) {}
  async fetchVersions(name: string, spec: string, field?: DependencyRef['vcpkgVersionField'], commit?: string): Promise<RegistryVersions> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return { error: 'invalid vcpkg port name' };
    const [baselineRef, registry] = (commit ?? '').split('|');
    const dataFile = `${name[0]}-/${name}.json`;
    if (registry?.startsWith('file:') || registry?.startsWith('github:')) {
      const get = async (file: string, baseline = false): Promise<unknown> => {
        if (registry.startsWith('file:')) {
          const text = readProjectFile(join(registry.slice(5), 'versions', file));
          return text ? JSON.parse(text) : undefined;
        }
        return fetchJson(`https://raw.githubusercontent.com/${registry.slice(7)}/${baseline ? baselineRef : 'HEAD'}/versions/${file}`, { timeoutMs: this.timeoutMs });
      };
      let baseline: string | undefined;
      if (spec === '@baseline') {
        const doc = await get('baseline.json', true) as Record<string, Record<string, { baseline: string; 'port-version'?: number }>> | undefined;
        const entry = (doc?.[registry.startsWith('file:') ? baselineRef : 'default'])?.[name];
        if (!entry || typeof entry.baseline !== 'string') return { error: 'Port is absent from the selected registry baseline' };
        baseline = entry.baseline + (entry['port-version'] ? `#${entry['port-version']}` : '');
        spec = `>=${baseline}`;
      }
      const data = await get(dataFile) as { versions?: unknown } | undefined;
      return data ? { ...vcpkgVersions(data, spec, field), ...(baseline ? { baseline } : {}) } : { error: 'not found' };
    }
    let baseline: string | undefined;
    if (spec === '@baseline') {
      if (!commit || !/^[a-f\d]{40}$/.test(commit)) return { error: 'Missing vcpkg baseline commit' };
      let pending = this.baselines.get(commit);
      if (!pending) {
        pending = fetchJson<{ default?: Record<string, { baseline: string; 'port-version'?: number }> }>(`https://raw.githubusercontent.com/microsoft/vcpkg/${commit}/versions/baseline.json`, { timeoutMs: this.timeoutMs }).then((doc) => doc?.default);
        this.baselines.set(commit, pending);
      }
      const entry = (await pending)?.[name];
      if (!entry || typeof entry.baseline !== 'string') return { error: 'Port is absent from the selected baseline' };
      baseline = entry.baseline + (entry['port-version'] ? `#${entry['port-version']}` : '');
      spec = `>=${baseline}`;
    }
    const data = await fetchJson<{ versions?: unknown }>(`https://raw.githubusercontent.com/microsoft/vcpkg/master/versions/${name[0]}-/${name}.json`, { timeoutMs: this.timeoutMs });
    return data ? { ...vcpkgVersions(data, spec, field), ...(baseline ? { baseline } : {}) } : { error: 'not found' };
  }
}
