import { composerScheme } from '../schemes';
import { parseJsonDependencies } from './packageJson';
import type { DependencyRef } from '../types';
import { repositoryUrl } from './helm';

export function parseComposerJson(text: string): DependencyRef[] {
  let source: string | undefined;
  let skipReason: string | undefined;
  let minimumStability: DependencyRef['minimumStability'];
  let preferStable = false;
  const policies = new Map<string, DependencyRef['minimumStability']>();
  try {
    const doc = JSON.parse(text);
    if (typeof doc['minimum-stability'] === 'string' && ['dev', 'alpha', 'beta', 'rc', 'stable'].includes(doc['minimum-stability'].toLowerCase())) minimumStability = doc['minimum-stability'].toLowerCase() as DependencyRef['minimumStability'];
    preferStable = doc['prefer-stable'] === true;
    if (doc.repositories && Object.keys(doc.repositories).length > 0) {
      const repositories = Array.isArray(doc.repositories) ? doc.repositories
        : Object.entries(doc.repositories).map(([key, value]) => value === false ? { [key]: false } : value);
      const urls: string[] = [];
      let packagistEnabled = true;
      for (const item of repositories) {
        if (item && typeof item === 'object' && 'packagist.org' in item && item['packagist.org'] === false) { packagistEnabled = false; continue; }
        const repo = item as { type?: string; url?: string; canonical?: boolean; only?: unknown; exclude?: unknown };
        const url = typeof repo?.url === 'string' && repositoryUrl(repo.url);
        if (repo?.type !== 'composer' || !url || repo.only || repo.exclude || repo.canonical === false) { skipReason = 'Composer repository type or filtering is not supported'; break; }
        urls.push(url);
      }
      if (!skipReason && packagistEnabled) urls.push('https://repo.packagist.org');
      if (!skipReason && urls.length) source = urls.join('|');
      else if (!skipReason) skipReason = 'Packagist is disabled and no Composer repository is configured';
    }
  } catch {
    return [];
  }
  return parseJsonDependencies(text, ['require', 'require-dev'], (name, rawSpec) => {
    const flag = /@(dev|alpha|beta|RC|stable)\b/i.exec(rawSpec)?.[1].toLowerCase() as DependencyRef['minimumStability'];
    if (flag) policies.set(name.toLowerCase(), flag);
    const spec = rawSpec.replace(/@(dev|alpha|beta|RC|stable)\b/gi, '').trim();
    if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(name) || !composerScheme.baseline(spec)) return undefined;
    return { name: name.toLowerCase(), spec };
  }).map((dep) => ({ ...dep, ...(source ? { source } : {}), ...(skipReason ? { skipReason } : {}),
    ...(policies.get(dep.name) || minimumStability ? { minimumStability: policies.get(dep.name) ?? minimumStability } : {}),
    ...(preferStable ? { preferStable } : {}) }));
}
