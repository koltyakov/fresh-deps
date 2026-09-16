import type { DependencyRef, DependencyStatus, RegistryVersions, ResolveOptions } from './types';
import { actionRuntimeVersions } from './registries/githubActions';

export function checkAvailability(dep: DependencyRef, versions: RegistryVersions, opts: ResolveOptions): DependencyStatus {
  const latest = versions.availabilityLatest ?? versions.latest;
  const base = { dep, source: versions.source, latest };
  if (versions.packageMissing) return { ...base, status: 'package-missing', message: 'The configured registry did not return this package. Private registries may also hide packages you cannot access.' };
  if (versions.error) return { ...base, status: 'failed', message: versions.error };
  if (dep.githubRepository) return versions.published?.includes(dep.spec)
    ? { ...base, status: 'available', message: 'The pinned commit exists in the repository. Updates require it to be in the default branch history.' }
    : { ...base, status: 'unknown', message: 'Save or refresh to check this GitHub commit pin.' };
  const { scheme } = opts;
  if (dep.matrixVersions) {
    const entries = dep.matrixVersions.map((spec) => checkAvailability({ ...dep, spec, matrixVersions: undefined },
      { ...actionRuntimeVersions(versions.published ?? versions.all ?? [], spec), allComplete: versions.allComplete }, opts));
    const missing = entries.filter(isVersionIssue);
    if (missing.length) return { ...base, status: 'version-missing', message: `No release matches these matrix selectors in the selected source: ${missing.map((entry) => entry.dep.spec).join(', ')}.` };
    if (entries.every((entry) => entry.status === 'available' || entry.status === 'ahead')) return { ...base, status: 'available', message: 'All matrix selectors match published releases.' };
    return { ...base, status: 'unknown', message: 'Registry metadata cannot establish availability for every matrix selector.' };
  }
  const spec = versions.availabilitySpec ?? (dep.spec === '@baseline' && versions.baseline ? `>=${versions.baseline}` : dep.spec);
  if (!scheme.isRange(spec) && !scheme.isPinned(spec)) return { ...base, status: 'unknown', message: 'This requirement cannot be validated with the available version metadata.' };
  const matches = (version: string) => scheme.isVersion(version) && scheme.satisfies(version, spec, { includePrerelease: true });
  const published = versions.published ?? versions.all;
  const available = published?.some(matches) || versions.published === undefined && !versions.allComplete && !!latest && matches(latest);
  if (!available) {
    if (versions.allComplete && published) return { ...base,
      status: scheme.isPinned(spec) ? 'version-missing' : 'range-missing',
      message: scheme.isPinned(spec) ? 'The declared version is not listed in the selected source.' : 'No listed version in the selected source satisfies the declared requirement.' };
    return { ...base, status: 'unknown', message: 'Available registry metadata cannot establish whether this requirement exists. Save or refresh to check.' };
  }
  const current = dep.resolvedVersion ?? scheme.baseline(spec);
  const currentPublished = current && (published?.some((v) => scheme.isVersion(v) && scheme.compare(v, current) === 0) || latest === current);
  // A latest tag can point to an older stable release; that does not make a
  // newer published stable version noteworthy.
  if (currentPublished && scheme.isPrerelease(current!) && latest && scheme.isVersion(latest) && scheme.compare(current!, latest) > 0) {
    return { ...base, status: 'ahead', message: 'This published version is ahead of the selected latest release. It may be a prerelease or belong to another release channel.' };
  }
  return { ...base, status: 'available', message: 'A published version satisfies this declaration.' };
}

export function statusLabel(status: DependencyStatus): string {
  return { available: '', ahead: 'Ahead of latest', 'version-missing': 'Version not found',
    'range-missing': 'No matching version', 'package-missing': 'Package not found', unknown: '', failed: 'Unable to check' }[status.status];
}

export function isVersionIssue(status: DependencyStatus): boolean {
  return ['version-missing', 'range-missing', 'package-missing'].includes(status.status);
}
