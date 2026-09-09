import type { VersionScheme } from './schemes';

// Bzlmod permits any number of alphanumeric release components.
const valid = (value: string) => /^[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
  && parts(value).flatMap((part) => part ?? []).every((part) => !/^\d+$/.test(part) || BigInt(part) <= 18446744073709551615n);
function parts(value: string): [string[], string[] | undefined] {
  const match = /^([^+-]+)(?:-([^+]+))?/.exec(value)!;
  return [match[1].split('.'), match[2]?.split('.')];
}
function identifiers(a: string[], b: string[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined || b[i] === undefined) return a[i] === undefined ? -1 : 1;
    const x = a[i], y = b[i], xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    const lexical = x > y ? 1 : x < y ? -1 : 0;
    const order = xn && yn ? (BigInt(x) > BigInt(y) ? 1 : BigInt(x) < BigInt(y) ? -1 : lexical)
      : xn !== yn ? (xn ? -1 : 1) : x > y ? 1 : x < y ? -1 : 0;
    if (order) return order;
  }
  return 0;
}
function compare(a: string, b: string): number {
  const [ar, ap] = parts(a), [br, bp] = parts(b);
  return identifiers(ar, br) || (!ap || !bp ? (ap ? -1 : bp ? 1 : 0) : identifiers(ap, bp));
}
export const bazelScheme: VersionScheme = {
  isVersion: valid, compare, isPrerelease: (value) => !!parts(value)[1],
  baseline: (spec) => valid(spec) ? spec.split('+')[0] : undefined,
  isPinned: valid, isRange: valid,
  satisfies: (version, spec) => valid(version) && valid(spec) && compare(version, spec) === 0,
  maxSatisfying: (versions, spec, opts) => bazelScheme.max(versions.filter((version) => valid(version) && compare(version, spec) === 0), opts),
  max: (versions, opts) => versions.filter((version) => valid(version) && (opts.includePrerelease || !parts(version)[1])).sort(compare).at(-1),
  classify: (a, b) => {
    const [ar] = parts(a), [br] = parts(b);
    if (ar[0] !== br[0]) return 'major';
    if (ar[1] !== br[1]) return 'minor';
    return identifiers(ar, br) ? 'patch' : 'prerelease';
  },
};
