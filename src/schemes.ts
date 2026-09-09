import * as semver from 'semver';
import * as pep440 from './pep440';
import { nugetScheme } from './nuget';
import * as mavenVersion from './mavenVersion';
import { composerRange } from './composer';
import { dartScheme } from './dart';
import { rubyScheme } from './ruby';
import { pessimisticRange } from './pessimistic';
import type { Ecosystem, UpdateKind } from './types';

export { dartScheme } from './dart';

const LOOSE = { loose: true } as const;

/**
 * The version arithmetic an ecosystem needs, so that comparing a declaration
 * against a registry is written once. npm, Go and Rust speak semver (with
 * different requirement syntax for Cargo); Python uses PEP 440.
 */
export interface VersionScheme {
  /** True when the string is a version this scheme can order. */
  isVersion(version: string): boolean;
  compare(a: string, b: string): number;
  /** True for versions hidden from users who did not ask for them. */
  isPrerelease(version: string): boolean;
  /** The lowest version the declared range allows - what an update is measured from. */
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

/** Translates Cargo's comma-separated, implicit-caret requirements to node-semver. */
export function cargoRange(spec: string): string | undefined {
  const trimmed = spec.trim();
  if (!trimmed || trimmed === '*' || trimmed.includes('||')) {
    return undefined;
  }
  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }
  const translated = parts.map((part) => {
    const compact = part.replace(/^(>=|<=|>|<|=|\^|~)\s+/, '$1');
    if (compact.startsWith('=')) {
      return compact.slice(1);
    }
    return /^(>=|<=|>|<|\^|~)/.test(compact) || /[xX*]/.test(compact) ? compact : `^${compact}`;
  }).join(' ');
  return semver.validRange(translated, LOOSE) ? translated : undefined;
}

export const cargoScheme: VersionScheme = {
  ...semverScheme,
  baseline: (spec) => {
    const range = cargoRange(spec);
    return range ? baselineOf(range) : undefined;
  },
  isPinned: (spec) => /^=\s*v?\d+(?:\.\d+){2}(?:[-+][0-9A-Za-z.-]+)?$/.test(spec.trim()),
  isRange: (spec) => cargoRange(spec) !== undefined,
  satisfies: (version, spec, opts) => {
    const range = cargoRange(spec);
    return !!range && semver.satisfies(version, range, { ...LOOSE, includePrerelease: opts.includePrerelease });
  },
  maxSatisfying: (versions, spec, opts) => {
    const range = cargoRange(spec);
    return range
      ? semver.maxSatisfying(versions, range, { ...LOOSE, includePrerelease: opts.includePrerelease }) ?? undefined
      : undefined;
  },
};

export const composerScheme: VersionScheme = {
  ...semverScheme,
  baseline: (spec) => {
    const range = composerRange(spec);
    return range ? baselineOf(range) : undefined;
  },
  isPinned: (spec) => {
    const range = composerRange(spec);
    return !!range && semver.valid(range.replace(/^=/, '')) !== null;
  },
  isRange: (spec) => composerRange(spec) !== undefined,
  satisfies: (version, spec, opts) => {
    const range = composerRange(spec);
    return !!range && semverScheme.satisfies(version, range, opts);
  },
  maxSatisfying: (versions, spec, opts) => {
    const range = composerRange(spec);
    return range ? semverScheme.maxSatisfying(versions, range, opts) : undefined;
  },
};

function pessimisticScheme(dialect: 'terraform' | 'hex'): VersionScheme {
  const rangeOf = (spec: string) => pessimisticRange(spec, dialect);
  const satisfies: VersionScheme['satisfies'] = (version, spec, opts) => {
    const range = rangeOf(spec);
    const prerelease = semver.prerelease(version, LOOSE);
    if (dialect === 'terraform' && prerelease?.length) {
      return /-/.test(spec) && /^(?:=\s*)?v?\d+(?:\.\d+){0,2}-[0-9A-Za-z.-]+(?:\+[0-9A-Za-z.-]+)?$/.test(spec.trim())
        && !!range && semver.satisfies(version, range, { ...LOOSE, includePrerelease: true });
    }
    const includePrerelease = opts.includePrerelease || (dialect === 'hex' && /\d-[0-9A-Za-z]/.test(spec));
    return !!range && semver.satisfies(version, range, { ...LOOSE, includePrerelease });
  };
  return {
    ...semverScheme,
    baseline: (spec) => { const range = rangeOf(spec); return range ? baselineOf(range) : undefined; },
    isPinned: (spec) => /^(?:==?|=)?\s*v?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(spec.trim()),
    isRange: (spec) => rangeOf(spec) !== undefined,
    satisfies,
    maxSatisfying: (versions, spec, opts) => versions.filter((version) => semverScheme.isVersion(version)
      && satisfies(version, spec, opts)).sort((a, b) => semver.compare(a, b, LOOSE)).at(-1),
  };
}

export const terraformScheme = pessimisticScheme('terraform');
export const hexScheme = pessimisticScheme('hex');

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

export const mavenScheme: VersionScheme = {
  isVersion: mavenVersion.isValid,
  compare: mavenVersion.compare,
  isPrerelease: mavenVersion.isPrerelease,
  baseline: mavenVersion.baselineOf,
  isPinned: mavenVersion.isPinned,
  isRange: mavenVersion.isRange,
  satisfies: mavenVersion.satisfies,
  maxSatisfying: mavenVersion.maxSatisfying,
  max: mavenVersion.max,
  classify: mavenVersion.classify,
};

export function schemeFor(ecosystem: Ecosystem): VersionScheme {
  if (ecosystem === 'python') return pep440Scheme;
  if (ecosystem === 'rust') return cargoScheme;
  if (ecosystem === 'java' || ecosystem === 'gradle') return mavenScheme;
  if (ecosystem === 'php') return composerScheme;
  if (ecosystem === 'dart') return dartScheme;
  if (ecosystem === 'ruby') return rubyScheme;
  if (ecosystem === 'terraform') return terraformScheme;
  if (ecosystem === 'elixir') return hexScheme;
  return ecosystem === 'dotnet' ? nugetScheme : semverScheme;
}
