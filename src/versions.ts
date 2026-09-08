import * as semver from 'semver';
import type { DependencyRef, DependencyUpdate, RegistryVersions, ResolveOptions, UpdateKind } from './types';

const LOOSE = { loose: true } as const;

/** Specs that never point at a registry version we can compare against. */
const NON_REGISTRY_NPM_PREFIXES = [
  'file:', 'link:', 'portal:', 'workspace:', 'catalog:', 'patch:',
  'git:', 'git+', 'github:', 'bitbucket:', 'gitlab:',
  'http:', 'https:',
];

/** Dist-tags and wildcards carry no floor to compare against. */
const UNPINNED_NPM_SPECS = ['', '*', 'x', 'latest', 'next', 'canary', 'beta', 'alpha'];

export interface NormalizedSpec {
  /** Name to query the registry with (differs from the manifest key for aliases). */
  name: string;
  /** Version range to compare against. */
  spec: string;
  alias?: string;
}

/**
 * Resolves what should actually be queried for an npm entry, unwrapping
 * `npm:` aliases and rejecting specs that do not resolve to a registry version.
 */
export function normalizeNpmSpec(name: string, rawSpec: string): NormalizedSpec | undefined {
  const spec = rawSpec.trim();

  if (spec.startsWith('npm:')) {
    const target = spec.slice('npm:'.length);
    const at = target.lastIndexOf('@');
    // A leading @ belongs to the scope, not to the version separator.
    if (at > 0) {
      const aliased = normalizeNpmSpec(target.slice(0, at), target.slice(at + 1));
      return aliased ? { ...aliased, alias: name } : undefined;
    }
    return undefined;
  }

  if (NON_REGISTRY_NPM_PREFIXES.some((p) => spec.startsWith(p))) {
    return undefined;
  }
  if (UNPINNED_NPM_SPECS.includes(spec.toLowerCase())) {
    return undefined;
  }
  if (!semver.validRange(spec, LOOSE)) {
    return undefined;
  }
  return { name, spec };
}

/** Strips the Go `v` prefix and the `+incompatible` build tag. */
export function normalizeGoVersion(version: string): string {
  return version.trim().replace(/^v/, '').replace(/\+incompatible$/, '');
}

/** The lowest version the declared range allows — what an update is measured from. */
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

/**
 * True when knowing only the latest version is not enough: the latest is outside
 * the declared range, so the newest in-range version is worth a second lookup.
 */
export function needsFullVersionList(spec: string, latest: string, opts: ResolveOptions): boolean {
  if (!opts.showSatisfyingUpdates || isPinned(spec)) {
    return false;
  }
  const range = semver.validRange(spec, LOOSE);
  if (!range) {
    return false;
  }
  return !semver.satisfies(latest, range, { includePrerelease: true });
}

/** Compares a declaration against what the registry offers. Returns undefined when up to date. */
export function computeUpdate(
  dep: DependencyRef,
  versions: RegistryVersions,
  opts: ResolveOptions,
): DependencyUpdate | undefined {
  const current = baselineOf(dep.spec);
  if (!current) {
    return undefined;
  }

  const latest = pickLatest(versions, opts);
  if (!latest || !semver.gt(latest, current, LOOSE)) {
    return undefined;
  }

  // A prerelease is only an update for someone already on a prerelease.
  if (semver.prerelease(latest) && !opts.includePrerelease && !semver.prerelease(current)) {
    return undefined;
  }

  const range = semver.validRange(dep.spec, LOOSE) ?? current;
  const inRange = semver.satisfies(latest, range, { includePrerelease: true });

  const update: DependencyUpdate = {
    dep,
    current,
    latest,
    kind: classifyUpdate(current, latest),
    inRange,
  };

  if (versions.latestRaw) {
    update.latestRaw = versions.latestRaw;
  }

  if (versions.path && versions.path !== dep.name) {
    update.alternatePath = versions.path;
  }

  if (!inRange && opts.showSatisfyingUpdates && versions.all?.length && !isPinned(dep.spec)) {
    const best = semver.maxSatisfying(versions.all, range, { includePrerelease: opts.includePrerelease });
    if (best && semver.gt(best, current, LOOSE)) {
      update.satisfying = best;
    }
  }

  return update;
}

function pickLatest(versions: RegistryVersions, opts: ResolveOptions): string | undefined {
  if (opts.includePrerelease && versions.all?.length) {
    const max = semver.maxSatisfying(versions.all, '*', { includePrerelease: true });
    if (max) {
      return max;
    }
  }
  return versions.latest && semver.valid(versions.latest, LOOSE) ? versions.latest : undefined;
}
