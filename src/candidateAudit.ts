import { AuditCache } from './audit';
import { auditFetcher } from './auditRouting';
import { lookupFor } from './lookups';
import { schemeFor, semverScheme } from './schemes';
import type { Settings } from './settings';
import type { DependencyAudit, DependencyUpdate, Ecosystem } from './types';

export function candidateVersions(update: DependencyUpdate): string[] {
  return [...new Set([update.sameMajor, update.satisfying, update.compatible, update.latest].filter((value): value is string => !!value))];
}

/** Explicit action only. Eligibility and cache keys are identical to baseline auditing. */
export async function auditCandidate(fsPath: string, ecosystem: Ecosystem, update: DependencyUpdate, version: string, settings: Settings, cache: AuditCache, signal?: AbortSignal): Promise<DependencyAudit> {
  signal?.throwIfAborted();
  if (!settings.auditEnabled) throw new Error('Enable freshDeps.audit.enabled before auditing an update version.');
  const dep = update.dep;
  const effective = dep.ecosystem ?? ecosystem;
  const scheme = dep.versionScheme ?? (dep.semver ? semverScheme : schemeFor(effective));
  if (!candidateVersions(update).includes(version) || !scheme.isVersion(version)) throw new Error('Select a version from the current update results.');
  const lookup = lookupFor(effective, fsPath, settings);
  // Go major-path candidates have a different package identity in OSV.
  const candidateDep = update.alternatePath && version === update.latest ? { ...dep, name: update.alternatePath } : dep;
  const fetch = lookup && auditFetcher(candidateDep, effective, lookup, settings);
  const key = lookup && `${lookup.key(candidateDep)}|audit|${version}|${settings.auditProvider}`;
  const cached = key && cache.get(key, settings.cacheDurationMinutes * 60_000);
  const result = fetch && key ? cached || await cache.resolve(key, () => fetch(candidateDep, version), signal) : { status: 'unsupported' as const };
  signal?.throwIfAborted();
  return { dep: candidateDep, version, baseline: false, target: 'candidate', provider: settings.auditProvider, result };
}
