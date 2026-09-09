import { schemeFor, semverScheme } from './schemes';
import * as pep440 from './pep440';
import type { DependencyUpdate, Ecosystem, RegistryVersions } from './types';

export function addCompatibility(update: DependencyUpdate, versions: RegistryVersions, ecosystem: Ecosystem, runtime: string): void {
  if (!runtime || !versions.requirements || !versions.all) return;
  const runtimeScheme = ecosystem === 'python' || ecosystem === 'ansible' ? schemeFor('python') : ecosystem === 'dart' ? schemeFor('dart') : semverScheme;
  if (!runtimeScheme.isVersion(runtime)) return;
  const matches = (requirement: string) => requirement && (ecosystem === 'python' || ecosystem === 'ansible'
    ? pep440.satisfies(runtime, requirement, { includePrerelease: true })
    : runtimeScheme.satisfies(runtime, ecosystem === 'rust' ? `>=${requirement.split('.').length === 2 ? requirement + '.0' : requirement}` : requirement, { includePrerelease: true }));
  const candidates = versions.all.filter((version) => versions.requirements?.[version]?.some(matches));
  const compatible = schemeFor(ecosystem).max(candidates, { includePrerelease: false });
  if (compatible) update.compatible = compatible;
  const latest = versions.requirements[update.latest]?.filter(Boolean);
  if (latest?.length) update.meta = { ...update.meta, runtimeRequirement: [...new Set(latest)].join(' or ') };
}
