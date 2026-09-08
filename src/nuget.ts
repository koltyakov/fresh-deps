import type { VersionScheme } from './schemes';
import type { UpdateKind } from './types';

interface NugetVersion {
  release: number[];
  prerelease: (number | string)[];
}

export function parseNugetVersion(raw: string): NugetVersion | undefined {
  const match = raw.trim().match(/^[vV]?(\d+(?:\.\d+){0,3})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return undefined;
  const release = match[1].split('.').map(Number);
  while (release.length < 4) release.push(0);
  const prerelease = match[2]
    ? match[2].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()))
    : [];
  return { release, prerelease };
}

export function compareNuget(a: string, b: string): number {
  const left = parseNugetVersion(a);
  const right = parseNugetVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 4; i++) {
    if (left.release[i] !== right.release[i]) return left.release[i] < right.release[i] ? -1 : 1;
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
    const l = left.prerelease[i];
    const r = right.prerelease[i];
    if (l === undefined || r === undefined) return l === undefined ? -1 : 1;
    if (l === r) continue;
    if (typeof l === 'number' && typeof r === 'string') return -1;
    if (typeof l === 'string' && typeof r === 'number') return 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

interface NugetRange {
  min?: string;
  max?: string;
  minInclusive: boolean;
  maxInclusive: boolean;
  exact: boolean;
  floating?: string[];
}

function parseRange(raw: string): NugetRange | undefined {
  const spec = raw.trim();
  if (parseNugetVersion(spec)) {
    return { min: spec, max: spec, minInclusive: true, maxInclusive: true, exact: true };
  }
  const floating = spec.match(/^(\d+(?:\.\d+)*)\.\*$/);
  if (floating) {
    return { minInclusive: true, maxInclusive: false, exact: false, floating: floating[1].split('.') };
  }
  const interval = spec.match(/^([[(])\s*([^,\]]*)\s*(?:,\s*([^\])]*)\s*)?([\])])$/);
  if (!interval) return undefined;
  const min = interval[2] || undefined;
  const hasComma = interval[3] !== undefined;
  const max = hasComma ? interval[3] || undefined : min;
  if ((min && !parseNugetVersion(min)) || (max && !parseNugetVersion(max))) return undefined;
  return {
    min,
    max,
    minInclusive: interval[1] === '[',
    maxInclusive: interval[4] === ']',
    exact: !hasComma && !!min,
  };
}

function baseline(spec: string): string | undefined {
  const range = parseRange(spec);
  if (!range) return undefined;
  if (range.floating) return `${range.floating.join('.')}.0`;
  return range.min;
}

function satisfies(version: string, spec: string): boolean {
  const range = parseRange(spec);
  if (!range || !parseNugetVersion(version)) return false;
  if (range.floating) {
    const parsed = parseNugetVersion(version);
    return !!parsed && range.floating.every((part, i) => parsed.release[i] === Number(part));
  }
  if (range.min) {
    const compared = compareNuget(version, range.min);
    if (compared < 0 || (compared === 0 && !range.minInclusive)) return false;
  }
  if (range.max) {
    const compared = compareNuget(version, range.max);
    if (compared > 0 || (compared === 0 && !range.maxInclusive)) return false;
  }
  return true;
}

function classify(current: string, latest: string): UpdateKind {
  const from = parseNugetVersion(current);
  const to = parseNugetVersion(latest);
  if (!from || !to) return 'prerelease';
  if (from.release[0] !== to.release[0]) return 'major';
  if (from.release[1] !== to.release[1]) return 'minor';
  if (from.release.slice(2).some((part, i) => part !== to.release[i + 2])) return 'patch';
  return 'prerelease';
}

function max(versions: string[], includePrerelease: boolean, spec?: string): string | undefined {
  return versions
    .filter((version) => parseNugetVersion(version))
    .filter((version) => includePrerelease || !parseNugetVersion(version)?.prerelease.length)
    .filter((version) => !spec || satisfies(version, spec))
    .sort(compareNuget)
    .at(-1);
}

export const nugetScheme: VersionScheme = {
  isVersion: (version) => !!parseNugetVersion(version),
  compare: compareNuget,
  isPrerelease: (version) => (parseNugetVersion(version)?.prerelease.length ?? 0) > 0,
  baseline,
  isPinned: (spec) => parseRange(spec)?.exact ?? false,
  isRange: (spec) => !!parseRange(spec),
  satisfies: (version, spec) => satisfies(version, spec),
  maxSatisfying: (versions, spec, opts) => max(versions, opts.includePrerelease, spec),
  max: (versions, opts) => max(versions, opts.includePrerelease),
  classify,
};
