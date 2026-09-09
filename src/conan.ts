import type { VersionScheme } from './schemes';

const valid = (version: string) => /^[A-Za-z0-9]+(?:[._+-][A-Za-z0-9]+)*$/.test(version);
const items = (value: string): (string | bigint)[] => {
  const result = value.split('.').map((item) => /^\d+(?:_\d+)*$/.test(item) ? BigInt(item.replace(/_/g, '')) : item);
  while (result.at(-1) === 0n) result.pop();
  return result;
};
function compareItems(a: string, b: string): number {
  const x = items(a), y = items(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const left = x[i], right = y[i];
    if (left === right) continue;
    if (typeof left === 'bigint' && typeof right === 'bigint') return left > right ? 1 : -1;
    return String(left) > String(right) ? 1 : -1;
  }
  return Math.sign(x.length - y.length);
}
function parts(version: string): { main: string; pre?: string; build?: string } {
  const plus = version.lastIndexOf('+');
  const build = plus >= 0 ? version.slice(plus + 1) : undefined;
  const rest = plus >= 0 ? version.slice(0, plus) : version;
  const dash = rest.indexOf('-');
  return { main: dash >= 0 ? rest.slice(0, dash) : rest, pre: dash >= 0 ? rest.slice(dash + 1) : undefined, build };
}
export function compareConan(a: string, b: string): number {
  const x = parts(a), y = parts(b);
  const main = compareItems(x.main, y.main);
  if (main) return main;
  if (x.pre !== undefined || y.pre !== undefined) {
    if (x.pre === undefined) return 1;
    if (y.pre === undefined) return -1;
    const pre = compareItems(x.pre, y.pre); if (pre) return pre;
  }
  if (x.build === undefined) return y.build === undefined ? 0 : -1;
  return y.build === undefined ? 1 : compareItems(x.build, y.build);
}
function bounds(spec: string): { op: string; version: string }[][] | undefined {
  const groups = spec.trim().split(/\s*\|\|\s*/).map((group) => group.split(/\s+/).map((part) => {
    const match = /^(>=|<=|!=|==|>|<|=)?(.+)$/.exec(part);
    return match && valid(match[2]) ? { op: match[1] ?? '==', version: match[2] } : undefined;
  }));
  return groups.every((group) => group.length && group.every(Boolean)) ? groups as { op: string; version: string }[][] : undefined;
}
const satisfies: VersionScheme['satisfies'] = (version, spec, opts) => valid(version)
  && (opts.includePrerelease || !parts(version).pre || !!parts(spec).pre)
  && !!bounds(spec)?.some((group) => group.every(({ op, version: bound }) => {
    const order = compareConan(version, bound);
    return op === '>=' ? order >= 0 : op === '<=' ? order <= 0 : op === '>' ? order > 0 : op === '<' ? order < 0 : op === '!=' ? order !== 0 : order === 0;
  }));
export const conanScheme: VersionScheme = {
  isVersion: valid, compare: compareConan, isPrerelease: (version) => parts(version).pre !== undefined,
  baseline: (spec) => {
    const groups = bounds(spec); if (!groups) return undefined;
    const floors = groups.map((group) => group.filter(({ op }) => ['==', '=', '>=', '>'].includes(op)).map(({ version }) => version).sort(compareConan).at(-1));
    return floors.every(Boolean) ? (floors as string[]).sort(compareConan)[0] : undefined;
  },
  isPinned: (spec) => valid(spec) || /^(?:==|=)/.test(spec) && valid(spec.replace(/^==?/, '')),
  isRange: (spec) => !!bounds(spec), satisfies,
  maxSatisfying: (versions, spec, opts) => conanScheme.max(versions.filter((version) => satisfies(version, spec, opts)), opts),
  max: (versions, opts) => versions.filter((version) => valid(version) && (opts.includePrerelease || !parts(version).pre)).sort(compareConan).at(-1),
  classify: (a, b) => parts(b).pre ? 'prerelease' : parts(a).main.split('.')[0] !== parts(b).main.split('.')[0] ? 'major'
    : parts(a).main.split('.')[1] !== parts(b).main.split('.')[1] ? 'minor' : 'patch',
};
