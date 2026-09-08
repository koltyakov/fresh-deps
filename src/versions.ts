import * as semver from 'semver';
import * as pep440 from './pep440';
import type { DependencyRef, DependencyUpdate, RegistryVersions, ResolveOptions } from './types';

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

/**
 * Resolves what should be queried for a Python requirement. A specifier that
 * states no floor — an unconstrained `requests`, or one that only rules
 * versions out — has nothing to compare against, so it is dropped before it
 * costs a request.
 */
export function normalizePythonSpec(name: string, rawSpec: string): NormalizedSpec | undefined {
  const spec = rawSpec.trim();
  if (spec === '' || spec === '*') {
    return undefined;
  }
  return pep440.baselineOf(spec) ? { name, spec } : undefined;
}

/**
 * Full metadata is needed to discover prereleases or the newest in-range version.
 */
export function needsFullVersionList(spec: string, latest: string, opts: ResolveOptions): boolean {
  const { scheme } = opts;
  if (opts.includePrerelease) {
    return true;
  }
  if (!opts.showSatisfyingUpdates || scheme.isPinned(spec) || !scheme.isRange(spec)) {
    return false;
  }
  return !scheme.satisfies(latest, spec, { includePrerelease: true });
}

/** Compares a declaration against what the registry offers. Returns undefined when up to date. */
export function computeUpdate(
  dep: DependencyRef,
  versions: RegistryVersions,
  opts: ResolveOptions,
): DependencyUpdate | undefined {
  const { scheme } = opts;

  const current = scheme.baseline(dep.spec);
  if (!current) {
    return undefined;
  }

  const latest = pickLatest(versions, opts);
  if (!latest || scheme.compare(latest, current) <= 0) {
    return undefined;
  }

  // A prerelease is only an update for someone already on a prerelease.
  if (scheme.isPrerelease(latest) && !opts.includePrerelease && !scheme.isPrerelease(current)) {
    return undefined;
  }

  const inRange = scheme.isRange(dep.spec)
    ? scheme.satisfies(latest, dep.spec, { includePrerelease: true })
    : scheme.compare(latest, current) === 0;

  const update: DependencyUpdate = {
    dep,
    current,
    latest,
    kind: scheme.classify(current, latest),
    inRange,
  };

  if (versions.latestRaw) {
    update.latestRaw = versions.latestRaw;
  }

  if (versions.meta) {
    update.meta = versions.meta;
  }

  if (versions.path && versions.path !== dep.name) {
    update.alternatePath = versions.path;
  }

  if (!inRange && opts.showSatisfyingUpdates && versions.all?.length && !scheme.isPinned(dep.spec)) {
    const best = scheme.maxSatisfying(versions.all, dep.spec, { includePrerelease: opts.includePrerelease });
    if (best && scheme.compare(best, current) > 0) {
      update.satisfying = best;
    }
  }

  return update;
}

function pickLatest(versions: RegistryVersions, opts: ResolveOptions): string | undefined {
  const { scheme } = opts;
  if (opts.includePrerelease && versions.all?.length) {
    const max = scheme.max(versions.all, { includePrerelease: true });
    if (max) {
      return max;
    }
  }
  return versions.latest && scheme.isVersion(versions.latest) ? versions.latest : undefined;
}
