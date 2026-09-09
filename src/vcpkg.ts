import * as semver from 'semver';
import { conanScheme } from './numericVersion';
import type { VersionScheme } from './schemes';

export function vcpkgVersion(value: string): { version: string; revision: bigint; kind: 'numeric' | 'date' | 'semver' } | undefined {
  const match = /^([^#]+)(?:#(0|[1-9]\d*))?$/.exec(value);
  if (!match) return undefined;
  const version = match[1];
  const kind = conanScheme.isVersion(version) ? 'numeric' : /^\d{4}-\d{2}-\d{2}(?:\.\d+)*$/.test(version) ? 'date'
    : semver.valid(version) ? 'semver' : undefined;
  return kind ? { version, revision: BigInt(match[2] ?? 0), kind } : undefined;
}
function compare(a: string, b: string): number {
  const x = vcpkgVersion(a)!, y = vcpkgVersion(b)!;
  const order = x.kind === 'date' && y.kind === 'date' ? conanScheme.compare(x.version.replace(/-/g, '.'), y.version.replace(/-/g, '.'))
    : semver.valid(x.version) && semver.valid(y.version) ? semver.compare(x.version, y.version)
    : conanScheme.compare(x.version, y.version);
  return order || (x.revision > y.revision ? 1 : x.revision < y.revision ? -1 : 0);
}
const baseline = (spec: string) => { const value = spec.replace(/^>=/, ''); return vcpkgVersion(value) ? value : undefined; };
export const vcpkgScheme: VersionScheme = {
  isVersion: (value) => !!vcpkgVersion(value), compare,
  isPrerelease: (value) => { const parsed = vcpkgVersion(value); return parsed?.kind === 'semver' && !!semver.prerelease(parsed.version)?.length; },
  baseline, isPinned: (spec) => !!vcpkgVersion(spec), isRange: (spec) => !!baseline(spec),
  satisfies: (version, spec) => !!baseline(spec) && !!vcpkgVersion(version) && (spec.startsWith('>=') ? compare(version, baseline(spec)!) >= 0 : compare(version, spec) === 0),
  maxSatisfying: (versions, spec, opts) => vcpkgScheme.max(versions.filter((version) => vcpkgScheme.satisfies(version, spec, opts)), opts),
  max: (versions, opts) => versions.filter((version) => vcpkgScheme.isVersion(version) && (opts.includePrerelease || !vcpkgScheme.isPrerelease(version))).sort(compare).at(-1),
  classify: (a, b) => {
    const x = vcpkgVersion(a)!, y = vcpkgVersion(b)!;
    if (x.version === y.version || x.kind === 'date') return 'patch';
    if (semver.valid(x.version) && semver.valid(y.version)) {
      const diff = semver.diff(x.version, y.version);
      return diff === 'major' || diff === 'premajor' ? 'major' : diff === 'minor' || diff === 'preminor' ? 'minor' : 'patch';
    }
    return conanScheme.classify(x.version, y.version);
  },
};
