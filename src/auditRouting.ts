import { proxyExclusion } from './registries/go';
import { osvAudit } from './registries/osv';
import type { Lookup } from './lookups/types';
import type { Settings } from './settings';
import type { AuditResponse, DependencyRef, Ecosystem } from './types';

/** Shared eligibility for baseline and explicit candidate audits. Never route private sources to OSV. */
export function auditFetcher(dep: DependencyRef, ecosystem: Ecosystem, lookup: Lookup, settings: Settings): ((dep: DependencyRef, version: string) => Promise<AuditResponse>) | undefined {
  if (dep.githubRepository || dep.runtime || dep.skipReason || ecosystem === 'dotnet' && dep.section === 'sdk') return undefined;
  if (settings.auditProvider !== 'osv') return lookup.fetchAudit;
  const key = lookup.key(dep);
  const sources = key.match(/https?:\/\/[^|]+/g) ?? [];
  const publicSource = sources.length > 0 ? sources.every((source) => {
    try {
      const url = new URL(source);
      return url.protocol === 'https:' && !url.username && !url.password && ['registry.npmjs.org', 'pypi.org', 'api.nuget.org', 'repo.maven.apache.org', 'repo1.maven.org', 'dl.google.com', 'plugins.gradle.org', 'repo.clojars.org', 'proxy.golang.org'].includes(url.hostname);
    } catch { return false; }
  }) : /^(?:rust\|crates\.io|php\|packagist\.org|ruby\|rubygems\.org|dart\|pub\.dev|elixir\|hex\.pm)\|/.test(key);
  if (!publicSource || dep.source && dep.source !== 'https://pub.dev' || ecosystem === 'go' && proxyExclusion(dep.name)) return undefined;
  return (dependency, version) => osvAudit(dependency.ecosystem ?? ecosystem, dependency.name, version, settings.requestTimeoutMs);
}
