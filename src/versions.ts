import * as semver from 'semver';
import * as pep440 from './pep440';
import { actionVersion, githubActionsScheme } from './githubActions';
import { actionRuntimeVersions } from './registries/githubActions';
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
 * states no floor - an unconstrained `requests`, or one that only rules
 * versions out - has nothing to compare against, so it is dropped before it
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
 * Full metadata is needed for prereleases, same-major, and in-range updates.
 */
export function needsFullVersionList(spec: string, latest: string, opts: ResolveOptions): boolean {
  const { scheme } = opts;
  if (opts.includePrerelease) {
    return true;
  }
  if (!opts.showSatisfyingUpdates) {
    return false;
  }
  const current = scheme.baseline(spec);
  if (current && scheme.isVersion(latest) && scheme.classify(current, latest) === 'major') return true;
  if (scheme.isPinned(spec) || !scheme.isRange(spec)) return false;
  return !scheme.satisfies(latest, spec, { includePrerelease: true });
}

/** Compares a declaration against what the registry offers. Returns undefined when up to date. */
export function computeUpdate(
  dep: DependencyRef,
  versions: RegistryVersions,
  opts: ResolveOptions,
): DependencyUpdate | undefined {
  if (dep.matrixVersions) return computeMatrixUpdate(dep, versions, opts);
  const { scheme } = opts;

  const current = versions.baseline && scheme.isVersion(versions.baseline) ? versions.baseline : dep.resolvedVersion && scheme.isVersion(dep.resolvedVersion)
    && scheme.satisfies(dep.resolvedVersion, dep.spec, { includePrerelease: true }) ? dep.resolvedVersion : scheme.baseline(dep.spec);
  if (!current) {
    return undefined;
  }

  const latest = pickLatest(versions, opts);
  const revisionChanged = !!dep.revision && !!versions.revision && dep.revision !== versions.revision;
  if (!latest || scheme.compare(latest, current) < 0 || (scheme.compare(latest, current) === 0 && !revisionChanged)) {
    return undefined;
  }

  // A prerelease is only an update for someone already on a prerelease.
  if (scheme.isPrerelease(latest) && !opts.includePrerelease && !scheme.isPrerelease(current)) {
    return undefined;
  }

  const inRange = dep.spec === '@baseline' && !!versions.baseline ? true : scheme.isRange(dep.spec)
    ? scheme.satisfies(latest, dep.spec, { includePrerelease: true })
    : scheme.compare(latest, current) === 0;

  const update: DependencyUpdate = {
    dep,
    current,
    latest,
    kind: revisionChanged && scheme.compare(current, latest) === 0 ? 'patch' : scheme.classify(current, latest),
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

  if (opts.showSatisfyingUpdates && versions.all?.length && update.kind === 'major') {
    const best = scheme.max(versions.all.filter((version) => scheme.isVersion(version)
      && scheme.classify(current, version) !== 'major'), opts);
    if (best && scheme.compare(best, current) > 0 && scheme.compare(best, latest) < 0) {
      update.sameMajor = best;
    }
  }

  if (dep.actionRuntime && opts.showSatisfyingUpdates && versions.all?.length) {
    const prefix = actionVersion(current)!.split('.')[0] + '.';
    const best = scheme.max(versions.all.filter((version) => actionVersion(version)?.startsWith(prefix)), opts);
    if (best && scheme.compare(best, current) > 0 && scheme.compare(best, latest) < 0) {
      update.satisfying = best;
    }
  } else if (!inRange && opts.showSatisfyingUpdates && versions.all?.length && !scheme.isPinned(dep.spec)) {
    const best = scheme.maxSatisfying(versions.all, dep.spec, { includePrerelease: opts.includePrerelease });
    if (best && scheme.compare(best, current) > 0) {
      update.satisfying = best;
    }
  }

  return update;
}

function computeMatrixUpdate(dep: DependencyRef, versions: RegistryVersions, opts: ResolveOptions): DependencyUpdate | undefined {
  const selectors = dep.matrixVersions!;
  const scheme = githubActionsScheme;
  const releases = (versions.all ?? []).filter((version) => actionVersion(version)
    && (opts.includePrerelease || !scheme.isPrerelease(version)));
  const updated = selectors.map((spec) => {
    // Advance within the declared major while retaining the selector's precision.
    const prefix = actionVersion(spec)!.split('.')[0] + '.';
    const candidates = releases.filter((version) => actionVersion(version)!.startsWith(prefix));
    const best = scheme.max(actionRuntimeVersions(candidates, spec).all ?? [], opts);
    return best && scheme.compare(best, spec) > 0 ? best : spec;
  });
  const latest = scheme.max(actionRuntimeVersions(releases, dep.spec).all ?? [], opts);
  const current = dep.spec;
  const releaseLine = (version: string) => actionVersion(version)!.split('.')[0];
  const newer = latest && scheme.compare(latest, current) > 0 && releaseLine(latest) !== releaseLine(current) ? latest : undefined;
  const changes = updated.flatMap((version, i) => version !== selectors[i] ? [{ current: selectors[i], latest: version }] : []);
  if (!newer && !changes.length) return undefined;
  const comparison = newer ? { current, latest: newer } : changes.reduce((a, b) =>
    scheme.classify(b.current, b.latest) === 'minor' ? b : a);
  return { dep, ...comparison, kind: scheme.classify(comparison.current, comparison.latest), inRange: false,
    ...(versions.meta ? { meta: versions.meta } : {}), matrixUpdate: { versions: updated, newer } };
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
