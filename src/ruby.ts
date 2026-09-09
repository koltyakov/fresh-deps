import type { VersionScheme } from './schemes';
import type { UpdateKind } from './types';

type Segment = number | string;

function segments(version: string): Segment[] | undefined {
  const value = version.trim();
  if (!/^\d+(?:[.\-]?[0-9A-Za-z]+)*$/.test(value)) return undefined;
  const parts = value.replace(/-/g, '.pre.').match(/[0-9]+|[A-Za-z]+/g);
  if (!parts) return undefined;
  const result: Segment[] = parts.map((part) => /^\d+$/.test(part) ? Number(part) : part.toLowerCase());
  while (result.length > 1 && result[result.length - 1] === 0) result.pop();
  return result;
}

export function isRubyVersion(version: string): boolean {
  return segments(version) !== undefined;
}

export function compareRubyVersions(a: string, b: string): number {
  const left = segments(a);
  const right = segments(b);
  if (!left || !right) return a.localeCompare(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'string') return 1;
    if (typeof x === 'string' && typeof y === 'number') return -1;
    return x < y ? -1 : 1;
  }
  return 0;
}

interface Requirement { op: string; version: string }

function requirements(spec: string): Requirement[] | undefined {
  const parts = spec.split(',').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return undefined;
  const result: Requirement[] = [];
  for (const part of parts) {
    const match = part.match(/^(~>|>=|<=|!=|=|>|<)?\s*([0-9][0-9A-Za-z.\-]*)$/);
    if (!match || !isRubyVersion(match[2])) return undefined;
    result.push({ op: match[1] ?? '=', version: match[2] });
  }
  return result;
}

function pessimisticUpper(version: string): string {
  const numeric = version.split(/[.\-]/).filter((part) => /^\d+$/.test(part)).map(Number);
  const index = Math.max(0, numeric.length - 2);
  const upper = numeric.slice(0, index + 1);
  upper[index]++;
  return upper.join('.');
}

function matches(version: string, requirement: Requirement): boolean {
  const compared = compareRubyVersions(version, requirement.version);
  switch (requirement.op) {
    case '=': return compared === 0;
    case '!=': return compared !== 0;
    case '>': return compared > 0;
    case '>=': return compared >= 0;
    case '<': return compared < 0;
    case '<=': return compared <= 0;
    case '~>': return compared >= 0 && compareRubyVersions(version, pessimisticUpper(requirement.version)) < 0;
    default: return false;
  }
}

function baseline(spec: string): string | undefined {
  const parsed = requirements(spec);
  if (!parsed) return undefined;
  const floors = parsed.filter((item) => item.op === '=' || item.op === '>=' || item.op === '~>').map((item) => item.version);
  return floors.reduce<string | undefined>((best, item) => !best || compareRubyVersions(item, best) > 0 ? item : best, undefined);
}

function classify(current: string, latest: string): UpdateKind {
  const a = current.match(/^\d+(?:\.\d+)?(?:\.\d+)?/)?.[0].split('.').map(Number) ?? [];
  const b = latest.match(/^\d+(?:\.\d+)?(?:\.\d+)?/)?.[0].split('.').map(Number) ?? [];
  if ((a[0] ?? 0) !== (b[0] ?? 0)) return 'major';
  if ((a[1] ?? 0) !== (b[1] ?? 0)) return 'minor';
  if ((a[2] ?? 0) !== (b[2] ?? 0)) return 'patch';
  return /[A-Za-z]/.test(latest) ? 'prerelease' : 'patch';
}

export const rubyScheme: VersionScheme = {
  isVersion: isRubyVersion,
  compare: compareRubyVersions,
  isPrerelease: (version) => /[A-Za-z]/.test(version),
  baseline,
  isPinned: (spec) => {
    const parsed = requirements(spec);
    return parsed?.length === 1 && parsed[0].op === '=';
  },
  isRange: (spec) => requirements(spec) !== undefined,
  satisfies: (version, spec, opts) => {
    const parsed = requirements(spec);
    return !!parsed && (opts.includePrerelease || !/[A-Za-z]/.test(version) || /[A-Za-z]/.test(spec))
      && parsed.every((item) => matches(version, item));
  },
  maxSatisfying: (versions, spec, opts) => versions.filter((version) => rubyScheme.isVersion(version)
    && rubyScheme.satisfies(version, spec, opts)).sort(compareRubyVersions).at(-1),
  max: (versions, opts) => versions.filter((version) => rubyScheme.isVersion(version)
    && (opts.includePrerelease || !rubyScheme.isPrerelease(version))).sort(compareRubyVersions).at(-1),
  classify,
};
