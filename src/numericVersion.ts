import type { VersionScheme } from './schemes';

/** A conservative subset shared by Conda and Conan: dotted numeric releases only. */
const valid = (value: string) => /^\d+(?:\.\d+)*$/.test(value);
const compare = (a: string, b: string) => {
  const x = a.split('.').map(BigInt), y = b.split('.').map(BigInt);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const delta = (x[i] ?? 0n) - (y[i] ?? 0n);
    if (delta) return delta > 0n ? 1 : -1;
  }
  return 0;
};

interface Bound { op: string; version: string }
function bounds(spec: string, conda: boolean): Bound[][] | undefined {
  if (!spec.trim()) return undefined;
  const groups: Bound[][] = [];
  for (const group of spec.split('|')) {
    const parsed: Bound[] = [];
    for (const part of group.trim().split(conda ? /\s*,\s*/ : /\s+/)) {
      const match = /^(>=|<=|==|!=|>|<|=)?(\d+(?:\.\d+)*)(\.\*)?$/.exec(part.trim());
      if (!match) return undefined;
      const op = match[3] || (conda && match[1] === '=') ? 'prefix' : match[1] ?? '==';
      if (match[3] && match[1] && !['=', '=='].includes(match[1])) return undefined;
      parsed.push({ op, version: match[2] });
    }
    groups.push(parsed);
  }
  return groups;
}

export function numericScheme(conda: boolean): VersionScheme {
  const satisfies: VersionScheme['satisfies'] = (version, spec) => valid(version) && !!bounds(spec, conda)?.some((group) =>
    group.every(({ op, version: bound }) => {
      const order = compare(version, bound);
      switch (op) {
        case 'prefix': return version === bound || version.startsWith(`${bound}.`);
        case '>': return order > 0;
        case '>=': return order >= 0;
        case '<': return order < 0;
        case '<=': return order <= 0;
        case '!=': return order !== 0;
        default: return order === 0;
      }
    }));
  return {
    isVersion: valid, compare, isPrerelease: () => false,
    baseline: (spec) => {
      const groups = bounds(spec, conda);
      if (!groups) return undefined;
      const floors = groups.map((group) => group.filter((bound) => ['==', '=', '>=', '>', 'prefix'].includes(bound.op))
        .map((bound) => bound.version).sort(compare).at(-1));
      return floors.every((floor) => floor !== undefined) ? (floors as string[]).sort(compare)[0] : undefined;
    },
    isPinned: (spec) => {
      const parsed = bounds(spec, conda);
      return parsed?.length === 1 && parsed[0].length === 1 && ['==', '='].includes(parsed[0][0].op);
    },
    isRange: (spec) => !!bounds(spec, conda), satisfies,
    maxSatisfying: (versions, spec, opts) => versions.filter((version) => satisfies(version, spec, opts)).sort(compare).at(-1),
    max: (versions) => versions.filter(valid).sort(compare).at(-1),
    classify: (a, b) => {
      const x = a.split('.'), y = b.split('.');
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if (BigInt(x[i] ?? 0) !== BigInt(y[i] ?? 0)) return i === 0 ? 'major' : i === 1 ? 'minor' : 'patch';
      }
      return 'patch';
    },
  };
}
export const condaScheme = numericScheme(true);
export { conanScheme } from './conan';
