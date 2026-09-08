import type { UpdateKind } from './types';

type Part = bigint | string | Part[];

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

const ALIASES = new Map([['cr', 'rc'], ['ga', ''], ['final', ''], ['release', '']]);
const SHORT_QUALIFIERS = new Map([['a', 'alpha'], ['b', 'beta'], ['m', 'milestone']]);

export function isValid(version: string): boolean {
  const value = version.trim();
  return value !== '' && !/[\s,[\](){}]/.test(value) && !value.includes('${') && !/^(latest|release)$/i.test(value);
}

function partsOf(version: string): Part[] {
  const root: Part[] = [];
  const lists = [root];
  let list = root;
  const value = version.toLowerCase();
  let start = 0;
  let digit = false;
  const nest = () => {
    const child: Part[] = [];
    list.push(child);
    lists.push(child);
    list = child;
  };
  const item = (text: string): Part => digit ? BigInt(text) : (ALIASES.get(text) ?? text);

  // Hyphens and digit/qualifier transitions introduce less significant lists.
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '.' || char === '-') {
      list.push(i === start ? 0n : item(value.slice(start, i)));
      start = i + 1;
      if (char === '-') nest();
    } else if (char >= '0' && char <= '9') {
      if (!digit && i > start) {
        if (list.length) nest();
        const qualifier = value.slice(start, i);
        list.push(SHORT_QUALIFIERS.get(qualifier) ?? ALIASES.get(qualifier) ?? qualifier);
        start = i;
        nest();
      }
      digit = true;
    } else {
      if (digit && i > start) {
        list.push(item(value.slice(start, i)));
        start = i;
        nest();
      }
      digit = false;
    }
  }
  if (start < value.length) {
    if (!digit && list.length) nest();
    list.push(item(value.slice(start)));
  }
  // Normalize children first, including zeroes immediately before qualifier lists.
  for (const parts of lists.reverse()) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (part === 0n || part === '' || (Array.isArray(part) && !part.length)) parts.splice(i, 1);
      else if (!Array.isArray(part)) break;
    }
  }
  return root;
}

function qualifierRank(value: string): [number, string] {
  const known = QUALIFIERS.get(value);
  return known === undefined ? [2, value] : [known, ''];
}

function compareQualifier(a: string, b: string): number {
  const [aRank, aName] = qualifierRank(a);
  const [bRank, bName] = qualifierRank(b);
  return aRank - bRank || (aName < bName ? -1 : aName > bName ? 1 : 0);
}

function comparePart(left: Part | undefined, right: Part | undefined): number {
  if (left === undefined) return right === undefined ? 0 : -comparePart(right, undefined);
  if (right === undefined) {
    if (typeof left === 'bigint') return left === 0n ? 0 : 1;
    if (typeof left === 'string') return compareQualifier(left, '');
    for (const part of left) {
      const result = comparePart(part, undefined);
      if (result !== 0) return result;
    }
    return 0;
  }
  if (Array.isArray(left)) {
    if (!Array.isArray(right)) return typeof right === 'bigint' ? -1 : 1;
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const result = comparePart(left[i], right[i]);
      if (result !== 0) return result;
    }
    return 0;
  }
  if (Array.isArray(right)) return typeof left === 'bigint' ? 1 : -1;
  if (typeof left === 'bigint') return typeof right === 'string' ? 1 : left < right ? -1 : left > right ? 1 : 0;
  return typeof right === 'bigint' ? -1 : compareQualifier(left, right);
}

/** Orders versions using Maven ComparableVersion's separator and nested-list rules. */
export function compare(a: string, b: string): number {
  return comparePart(partsOf(a), partsOf(b));
}

export function isPrerelease(version: string): boolean {
  const containsPrerelease = (part: Part): boolean => Array.isArray(part)
    ? part.some(containsPrerelease)
    : typeof part === 'string' && (QUALIFIERS.get(part) ?? 0) < 0;
  return containsPrerelease(partsOf(version));
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
