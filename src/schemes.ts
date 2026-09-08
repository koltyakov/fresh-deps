import * as semver from 'semver';
import * as pep440 from './pep440';
import type { Ecosystem, UpdateKind } from './types';

const LOOSE = { loose: true } as const;

/**
 * The version arithmetic an ecosystem needs, so that comparing a declaration
 * against a registry is written once. npm and Go both speak semver; Python
 * speaks PEP 440, which orders versions by different rules entirely.
 */
export interface VersionScheme {
  /** True when the string is a version this scheme can order. */
  isVersion(version: string): boolean;
  compare(a: string, b: string): number;
  /** True for versions hidden from users who did not ask for them. */
  isPrerelease(version: string): boolean;
  /** The lowest version the declared range allows — what an update is measured from. */
  baseline(spec: string): string | undefined;
  /** True when the spec admits exactly one version. */
  isPinned(spec: string): boolean;
  /** True when the spec is a range this scheme understands. */
  isRange(spec: string): boolean;
  satisfies(version: string, spec: string, opts: { includePrerelease: boolean }): boolean;
  /** Newest of `versions` that the spec allows. */
  maxSatisfying(versions: string[], spec: string, opts: { includePrerelease: boolean }): string | undefined;
  /** Newest of `versions` outright. */
  max(versions: string[], opts: { includePrerelease: boolean }): string | undefined;
  classify(current: string, latest: string): UpdateKind;
}

/** The lowest version a semver range allows. */
export function baselineOf(spec: string): string | undefined {
  const range = semver.validRange(spec, LOOSE);
  if (!range || range === '*') {
    return undefined;
  }
  try {
    return semver.minVersion(range, LOOSE)?.version;
  } catch {
    return undefined;
  }
}

/** True when the spec pins one exact version, as Go modules always do. */
export function isPinned(spec: string): boolean {
  return semver.valid(spec.trim().replace(/^v/, ''), LOOSE) !== null;
}

export function classifyUpdate(current: string, latest: string): UpdateKind {
  const diff = semver.diff(current, latest);
  switch (diff) {
    case 'major':
    case 'premajor':
      return 'major';
    case 'minor':
    case 'preminor':
      return 'minor';
    case 'patch':
    case 'prepatch':
      return 'patch';
    default:
      return 'prerelease';
  }
}

export const semverScheme: VersionScheme = {
  isVersion: (version) => semver.valid(version, LOOSE) !== null,
  compare: (a, b) => semver.compare(a, b, LOOSE),
  isPrerelease: (version) => (semver.prerelease(version, LOOSE)?.length ?? 0) > 0,
  baseline: baselineOf,
  isPinned,
  isRange: (spec) => semver.validRange(spec, LOOSE) !== null,
  satisfies: (version, spec, opts) =>
    semver.satisfies(version, semver.validRange(spec, LOOSE) ?? spec, { ...LOOSE, includePrerelease: opts.includePrerelease }),
  maxSatisfying: (versions, spec, opts) =>
    semver.maxSatisfying(versions, semver.validRange(spec, LOOSE) ?? spec, {
      ...LOOSE,
      includePrerelease: opts.includePrerelease,
    }) ?? undefined,
  max: (versions, opts) =>
    semver.maxSatisfying(versions, '*', { ...LOOSE, includePrerelease: opts.includePrerelease }) ?? undefined,
  classify: classifyUpdate,
};

/**
 * Python has no `major.minor.patch` contract, so the step is read off the
 * release tuple: a change in the first component is a major move, the second a
 * minor one, anything deeper a patch. A bump that leaves the release untouched
 * is either a new prerelease or a post-release of what is already declared.
 */
export function classifyPep440(current: string, latest: string): UpdateKind {
  const from = pep440.parseVersion(current);
  const to = pep440.parseVersion(latest);
  if (!from || !to) {
    return 'prerelease';
  }
  if (from.epoch !== to.epoch) {
    return 'major';
  }
  for (let i = 0; i < Math.max(from.release.length, to.release.length); i++) {
    if ((from.release[i] ?? 0) !== (to.release[i] ?? 0)) {
      return i === 0 ? 'major' : i === 1 ? 'minor' : 'patch';
    }
  }
  return pep440.isPrerelease(latest) ? 'prerelease' : 'patch';
}

export const pep440Scheme: VersionScheme = {
  isVersion: pep440.isValid,
  compare: pep440.compare,
  isPrerelease: pep440.isPrerelease,
  baseline: pep440.baselineOf,
  isPinned: pep440.isPinned,
  isRange: pep440.isSpecifierSet,
  satisfies: pep440.satisfies,
  maxSatisfying: pep440.maxSatisfying,
  max: pep440.max,
  classify: classifyPep440,
};

export function schemeFor(ecosystem: Ecosystem): VersionScheme {
  return ecosystem === 'python' ? pep440Scheme : semverScheme;
}
