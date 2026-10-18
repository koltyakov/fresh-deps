import type { DependencyUpdate, Ecosystem, PackageMeta } from './types';
import { safeUrl } from './sanitize';

export interface PackageLink { label: string; url: string }

export function githubRepository(value: string | undefined): string | undefined {
  const safe = safeUrl(value?.replace(/^git\+/, '').replace(/\.git\/?$/, ''));
  if (!safe) return undefined;
  const url = new URL(safe);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.search || url.hash) return undefined;
  return /^\/([\w.-]+\/[\w.-]+)\/?$/.exec(url.pathname)?.[1];
}

/** Only root GitHub Go modules have a known version-to-tag mapping here. */
export function goRepository(update: DependencyUpdate): string | undefined {
  const rootOf = (name: string) => /^github\.com\/([\w.-]+\/[\w.-]+)(?:\/v(?:[2-9]|[1-9]\d+))?$/.exec(name)?.[1];
  const match = rootOf(update.dep.name);
  if (!match || update.dep.skipReason) return undefined;
  if (update.alternatePath && rootOf(update.alternatePath) !== match) return undefined;
  if (update.meta?.repository && githubRepository(update.meta.repository)?.toLowerCase() !== match.toLowerCase()) return undefined;
  return match;
}

/** Pure construction. No release history or arbitrary changelog content is fetched. */
export function packageLinks(update: DependencyUpdate, ecosystem: Ecosystem, meta: PackageMeta): PackageLink[] {
  if (update.dep.runtime) return [];
  const links: PackageLink[] = [];
  const repository = githubRepository(meta.repository) ?? (ecosystem === 'go' ? goRepository(update) : undefined);
  if (repository) links.push({ label: 'Releases', url: `https://github.com/${repository}/releases` });
  const documentation = safeUrl(meta.documentation);
  const changelog = safeUrl(meta.changelog);
  if (documentation) links.push({ label: 'Documentation', url: documentation });
  else if (ecosystem === 'rust' && (!update.dep.source || /^sparse\+https:\/\/index\.crates\.io\/?$/.test(update.dep.source))
    && (!update.source || update.source === 'crates.io' || /^(?:sparse\+)?https:\/\/index\.crates\.io\/?$/.test(update.source))) {
    links.push({ label: 'Documentation', url: `https://docs.rs/${encodeURIComponent(update.dep.name)}/${encodeURIComponent(update.latest)}` });
  }
  if (changelog) links.push({ label: 'Changelog', url: changelog });
  return links;
}
