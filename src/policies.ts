import { minimatch } from 'minimatch';
import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'path';
import type { Settings } from './settings';
import type { VersionScheme } from './schemes';
import type { DependencyRef, Ecosystem } from './types';

export type PrereleasePolicy = 'inherit' | 'never' | 'if-current-prerelease' | 'always';
export interface PackageRule {
  ecosystem?: Ecosystem;
  name: string;
  ignoreUpdates?: boolean;
  prereleasePolicy?: PrereleasePolicy;
}

const globOptions = { dot: true, nonegate: true, nocomment: true };
export const normalizedPath = (value: string): string => value.replace(/\\/g, '/');

/** Patterns are workspace-relative. Without a workspace use the manifest directory. */
export function exclusionFor(fsPath: string, patterns: string[] = [], root?: string, directory = false): string | undefined {
  const filename = normalizedPath(fsPath);
  const base = normalizedPath(root ?? dirname(filename));
  const target = normalizedPath(/^[A-Za-z]:\//.test(filename) ? win32.relative(base, filename) : relative(base, filename));
  if (target.startsWith('../')) return undefined;
  const parts = target.split('/');
  return patterns.find((pattern) => {
    if (typeof pattern !== 'string' || !pattern) return false;
    const normalized = normalizedPath(pattern);
    for (let length = parts.length; length > 0; length--) {
      const candidate = parts.slice(0, length).join('/');
      if (minimatch(candidate, normalized, globOptions)
        || (directory || length < parts.length) && minimatch(`${candidate}/`, normalized, globOptions)) return true;
    }
    return false;
  });
}

export function packagePolicy(dep: DependencyRef, ecosystem: Ecosystem, settings: Settings): { ignoreUpdates: boolean; prereleasePolicy: PrereleasePolicy } {
  const policy = { ignoreUpdates: false, prereleasePolicy: settings.prereleasePolicy ?? 'inherit' };
  let effective = dep.ecosystem ?? ecosystem;
  let registryName = dep.name;
  if (effective === 'deno' && registryName.startsWith('npm:')) { effective = 'npm'; registryName = registryName.slice(4); }
  else if (effective === 'deno' && registryName.startsWith('jsr:')) registryName = registryName.slice(4);
  const canonical = (name: string) => effective === 'python' ? name.toLowerCase().replace(/[-_.]+/g, '-')
    : effective === 'rust' ? name.toLowerCase().replace(/_/g, '-') : effective === 'dotnet' ? name.toLowerCase() : name;
  const name = canonical(registryName);
  for (const rule of settings.packageRules ?? []) {
    if (!rule || typeof rule.name !== 'string' || rule.ecosystem && rule.ecosystem !== effective) continue;
    const pattern = canonical(rule.name);
    if (!minimatch(name, pattern, globOptions)) continue;
    if (typeof rule.ignoreUpdates === 'boolean') policy.ignoreUpdates = rule.ignoreUpdates;
    if (['inherit', 'never', 'if-current-prerelease', 'always'].includes(rule.prereleasePolicy ?? '')) policy.prereleasePolicy = rule.prereleasePolicy!;
  }
  return policy;
}

export function allowsPrerelease(dep: DependencyRef, scheme: VersionScheme, policy: PrereleasePolicy, legacy: boolean): boolean {
  const baseline = dep.resolvedVersion ?? scheme.baseline(dep.spec);
  const permitted = policy === 'always' || policy === 'inherit' && (legacy || !!dep.minimumStability && dep.minimumStability !== 'stable')
    || policy === 'if-current-prerelease' && !!baseline && scheme.isVersion(baseline) && scheme.isPrerelease(baseline);
  return permitted && dep.allowPrerelease !== false;
}

export function isWithin(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
