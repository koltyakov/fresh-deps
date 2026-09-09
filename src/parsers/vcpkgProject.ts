import { dirname, resolve } from 'path';
import { readProjectFile } from '../projectFiles';
import { parseVcpkg } from './vcpkg';
import type { DependencyRef } from '../types';

interface Registry { kind?: string; baseline?: string; repository?: string; path?: string; packages?: string[] }

/** Resolve registries without evaluating ports or invoking Git. */
export function parseVcpkgProject(text: string, fsPath: string): DependencyRef[] {
  try {
    const manifest = JSON.parse(text);
    const external = readProjectFile(resolve(dirname(fsPath), 'vcpkg-configuration.json'));
    const config = manifest['vcpkg-configuration'] ?? (external ? JSON.parse(external) : undefined);
    if (!config) return parseVcpkg(text);
    if (config['overlay-ports']?.length || !config['default-registry'] && !config.registries?.length) return [];
    const configDefault = config['default-registry'] as Registry | null | undefined;
    const parsed = parseVcpkg(text, { allowConfiguration: true, baseline: manifest['builtin-baseline'] ?? '0'.repeat(40) });
    return parsed.map((dep) => {
      const registries = (config.registries ?? []) as Registry[];
      const candidates = registries.flatMap((registry) => (registry.packages ?? []).filter((pattern) => pattern.endsWith('*')
        ? dep.name.startsWith(pattern.slice(0, -1)) : dep.name === pattern).map((pattern) => ({ registry, rank: pattern.endsWith('*') ? pattern.length : Number.MAX_SAFE_INTEGER })));
      const registry = candidates.sort((a, b) => b.rank - a.rank)[0]?.registry ?? configDefault;
      let source: string | undefined;
      if (registry?.kind === 'filesystem' && registry.path) source = `${registry.baseline ?? 'default'}|file:${resolve(dirname(fsPath), registry.path)}`;
      else if (registry?.kind === 'git' && registry.repository && /^[a-f\d]{40}$/.test(registry.baseline ?? '')) {
        const repo = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(registry.repository)?.[1];
        if (repo) source = `${registry.baseline}|github:${repo}`;
      } else if ((registry?.kind === 'builtin' || registry === undefined) && /^[a-f\d]{40}$/.test(registry?.baseline ?? manifest['builtin-baseline'] ?? '')) source = registry?.baseline ?? manifest['builtin-baseline'];
      return { ...dep, ...(source ? { source } : { skipReason: 'No supported vcpkg registry matches this port' }) };
    });
  } catch { return []; }
}
