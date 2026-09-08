import type { UpdateKind } from './types';

type Part = number | string;

interface Interval {
  lower?: string;
  upper?: string;
  includeLower: boolean;
  includeUpper: boolean;
}

const QUALIFIERS = new Map([
  ['alpha', -5],
  ['beta', -4],
  ['milestone', -3],
  ['rc', -2],
  ['snapshot', -1],
  ['', 0],
  ['sp', 1],
]);

const ALIASES: Record<string, string> = {
  a: 'alpha',
  b: 'beta',
  m: 'milestone',
  cr: 'rc',
  ga: '',
  final: '',
  release: '',
};

export function isValid(version: string): boolean {
  const value = version.trim();
  return value !== '' && !/[\s,[\](){}]/.test(value) && !value.includes('${') && !/^(latest|release)$/i.test(value);
}

function partsOf(version: string): Part[] {
  const parts: Part[] = [];
  for (const match of version.toLowerCase().matchAll(/\d+|[a-z]+/g)) {
    parts.push(/^\d+$/.test(match[0]) ? Number(match[0]) : (ALIASES[match[0]] ?? match[0]));
  }
  while (parts.at(-1) === 0 || parts.at(-1) === '') parts.pop();
  return parts;
}

function qualifierRank(value: string): [number, string] {
  const known = QUALIFIERS.get(value);
  return known === undefined ? [2, value] : [known, ''];
}

function compareQualifier(a: string, b: string): number {
  const [aRank, aName] = qualifierRank(a);
  const [bRank, bName] = qualifierRank(b);
  return aRank - bRank || aName.localeCompare(bName);
}

function compareMissing(part: Part): number {
  return typeof part === 'number' ? (part === 0 ? 0 : -1) : compareQualifier('', part);
}

/** Orders numeric components and Maven's well-known qualifiers. */
export function compare(a: string, b: string): number {
  const left = partsOf(a);
  const right = partsOf(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i];
    const y = right[i];
    if (x === undefined && y !== undefined) {
      const result = compareMissing(y);
      if (result !== 0) return result;
      continue;
    }
    if (y === undefined && x !== undefined) {
      const result = -compareMissing(x);
      if (result !== 0) return result;
      continue;
    }
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    if (typeof x === 'number') return 1;
    if (typeof y === 'number') return -1;
    const result = compareQualifier(x, y);
    if (result !== 0) return result;
  }
  return 0;
}

export function isPrerelease(version: string): boolean {
  return partsOf(version).some((part) => typeof part === 'string' && (QUALIFIERS.get(part) ?? 0) < 0);
}

function parseRange(spec: string): Interval[] | undefined {
  const value = spec.trim();
  if (!value.startsWith('[') && !value.startsWith('(')) return undefined;
  const exact = value.match(/^\[\s*([^,\]]+)\s*\]$/);
  if (exact && isValid(exact[1].trim())) {
    const version = exact[1].trim();
    return [{ lower: version, upper: version, includeLower: true, includeUpper: true }];
  }
  const intervals: Interval[] = [];
  const pattern = /([[(])\s*([^,\])]*?)\s*,\s*([^\])]*?)\s*([\])])/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const separator = value.slice(cursor, match.index).trim();
    if (separator !== (intervals.length === 0 ? '' : ',')) return undefined;
    cursor = match.index + match[0].length;
    const lower = match[2].trim() || undefined;
    const upper = match[3].trim() || undefined;
    if ((lower && !isValid(lower)) || (upper && !isValid(upper))) return undefined;
    intervals.push({ lower, upper, includeLower: match[1] === '[', includeUpper: match[4] === ']' });
  }
  return intervals.length > 0 && value.slice(cursor).trim() === '' ? intervals : undefined;
}

export function baselineOf(spec: string): string | undefined {
  if (isValid(spec)) return spec.trim();
  const lowers = parseRange(spec)?.flatMap((range) => (range.lower ? [range.lower] : []));
  return lowers?.sort(compare)[0];
}

export function isPinned(spec: string): boolean {
  return isValid(spec);
}

export function isRange(spec: string): boolean {
  return parseRange(spec) !== undefined;
}

export function satisfies(version: string, spec: string, opts: { includePrerelease: boolean }): boolean {
  if (!isValid(version) || (!opts.includePrerelease && isPrerelease(version))) return false;
  if (isPinned(spec)) return compare(version, spec.trim()) === 0;
  return parseRange(spec)?.some((range) => {
    const lowerComparison = range.lower ? compare(version, range.lower) : 1;
    const upperComparison = range.upper ? compare(version, range.upper) : -1;
    return (lowerComparison > 0 || (range.includeLower && lowerComparison === 0))
      && (upperComparison < 0 || (range.includeUpper && upperComparison === 0));
  }) ?? false;
}

export function max(versions: string[], opts: { includePrerelease: boolean }): string | undefined {
  return versions
    .filter((version) => isValid(version) && (opts.includePrerelease || !isPrerelease(version)))
    .sort(compare)
    .at(-1);
}

export function maxSatisfying(
  versions: string[],
  spec: string,
  opts: { includePrerelease: boolean },
): string | undefined {
  return max(versions.filter((version) => satisfies(version, spec, opts)), opts);
}

export function classify(current: string, latest: string): UpdateKind {
  const from = current.match(/\d+/g)?.map(Number) ?? [];
  const to = latest.match(/\d+/g)?.map(Number) ?? [];
  for (let i = 0; i < Math.max(from.length, to.length); i++) {
    if ((from[i] ?? 0) !== (to[i] ?? 0)) return i === 0 ? 'major' : i === 1 ? 'minor' : 'patch';
  }
  return isPrerelease(latest) ? 'prerelease' : 'patch';
}
