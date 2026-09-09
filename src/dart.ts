import * as semver from 'semver';
import type { VersionScheme } from './schemes';

interface Bound { operator: string; version: string }

function bounds(spec: string): Bound[] | undefined {
  const value = spec.trim();
  if (value.startsWith('^')) {
    const raw = value.slice(1);
    const version = semver.parse(raw);
    if (!version || !/^\d/.test(raw)) return undefined;
    return [
      { operator: '>=', version: raw },
      { operator: '<', version: version.major > 0 ? `${version.major + 1}.0.0` : `0.${version.minor + 1}.0` },
    ];
  }
  if (!/^(?:(?:>=|<=|>|<)?\s*\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\s*)+$/.test(value)) return undefined;
  const result = [...value.matchAll(/(>=|<=|>|<)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/g)]
    .map((match) => ({ operator: match[1] ?? '=', version: match[2] }));
  return result.length && result.every((bound) => semver.valid(bound.version)) ? result : undefined;
}

function satisfies(version: string, spec: string, opts: { includePrerelease: boolean }): boolean {
  const range = bounds(spec);
  if (!range || !semver.valid(version) || (!opts.includePrerelease && semver.prerelease(version))) return false;
  return range.every((bound) => {
    const comparison = semver.compareBuild(version, bound.version);
    switch (bound.operator) {
      case '=': return comparison === 0;
      case '>=': return comparison >= 0;
      case '>': return comparison > 0;
      case '<=': return comparison <= 0;
      case '<':
        // Pub excludes prereleases of an exclusive stable upper bound, too.
        if (!semver.prerelease(bound.version) && !semver.parse(bound.version)!.build.length &&
            semver.prerelease(version) && sameRelease(version, bound.version) &&
            !range.some((lower) => ['>', '>=', '='].includes(lower.operator) && semver.prerelease(lower.version) && sameRelease(lower.version, bound.version))) return false;
        return comparison < 0;
      default: return false;
    }
  });
}

function sameRelease(a: string, b: string): boolean {
  return semver.major(a) === semver.major(b) && semver.minor(a) === semver.minor(b) && semver.patch(a) === semver.patch(b);
}

function max(versions: string[], opts: { includePrerelease: boolean }): string | undefined {
  return versions.filter((version) => !!semver.valid(version) && (opts.includePrerelease || !semver.prerelease(version)))
    .sort(semver.compareBuild).at(-1);
}

export const dartScheme: VersionScheme = {
  isVersion: (version) => /^\d/.test(version) && !!semver.valid(version),
  compare: semver.compareBuild,
  isPrerelease: (version) => !!semver.prerelease(version),
  baseline: (spec) => {
    const range = bounds(spec);
    const floors = range?.filter((bound) => ['=', '>=', '>'].includes(bound.operator));
    const floor = floors?.map((bound) => bound.version).sort(semver.compareBuild).at(-1);
    if (!floor || !range) return undefined;
    // An exclusive floor is still the declared baseline, as with other non-npm schemes.
    return range.some((bound) => bound.operator === '>') || satisfies(floor, spec, { includePrerelease: true }) ? floor : undefined;
  },
  isPinned: (spec) => bounds(spec)?.length === 1 && bounds(spec)![0].operator === '=',
  isRange: (spec) => bounds(spec) !== undefined,
  satisfies,
  maxSatisfying: (versions, spec, opts) => max(versions.filter((version) => satisfies(version, spec, opts)), opts),
  max,
  classify: (current, latest) => semver.major(current) !== semver.major(latest) ? 'major'
    : semver.minor(current) !== semver.minor(latest) ? 'minor'
    : semver.patch(current) !== semver.patch(latest) ? 'patch'
    : semver.prerelease(latest) ? 'prerelease' : 'patch',
};
