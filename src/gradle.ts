import { mavenScheme, type VersionScheme } from './schemes';

const normalize = (spec: string) => spec.replace(/^\]/, '(').replace(/\[$/, ')');

/** Rich constraints retain preferred baselines, strict bounds, and rejected versions. */
export function gradleConstraint(require: string | undefined, strictly: string | undefined, prefer: string | undefined, reject: string[]): VersionScheme {
  const constraint = strictly ?? require;
  const allowed = (version: string): boolean => {
    const matches = (spec: string) => mavenScheme.isPinned(spec) ? mavenScheme.compare(version, spec) === 0
      : mavenScheme.satisfies(version, normalize(spec), { includePrerelease: true });
    if (reject.some(matches)) return false;
    if (!constraint) return true;
    if (!strictly && mavenScheme.isPinned(constraint)) return mavenScheme.compare(version, constraint) >= 0;
    return matches(constraint);
  };
  return {
    ...mavenScheme,
    baseline: () => prefer && mavenScheme.isVersion(prefer) && allowed(prefer) ? prefer : constraint ? mavenScheme.baseline(normalize(constraint)) : undefined,
    isPinned: () => !!strictly && mavenScheme.isPinned(strictly),
    isRange: () => true,
    satisfies: (version) => allowed(version),
    maxSatisfying: (versions, _spec, opts) => mavenScheme.max(versions.filter(allowed), opts),
  };
}
