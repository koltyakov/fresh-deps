import * as semver from 'semver';
import type { VersionScheme } from './schemes';

export function ansibleRange(spec: string): string | undefined {
  if (!spec.split(',').some((part) => /^\s*(?:>=?|==?)?\s*\d/.test(part))) return undefined;
  let groups = [''];
  for (const part of spec.split(',')) {
    const match = /^\s*(>=|<=|!=|==|>|<|=)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\s*$/.exec(part);
    if (!match || !semver.valid(match[2])) return undefined;
    const alternatives = match[1] === '!=' ? [`<${match[2]}`, `>${match[2]}`] : [`${match[1] === '==' ? '=' : match[1] ?? '='}${match[2]}`];
    groups = groups.flatMap((group) => alternatives.map((bound) => `${group} ${bound}`.trim()));
    if (groups.length > 64) return undefined;
  }
  return groups.join(' || ');
}

export function makeAnsibleScheme(base: VersionScheme): VersionScheme {
  return {
    ...base,
    baseline: (spec) => { const range = ansibleRange(spec); return range ? base.baseline(range) : undefined; },
    isPinned: (spec) => /^(?:==|=)?\s*\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(spec.trim()),
    isRange: (spec) => !!ansibleRange(spec),
    satisfies: (version, spec, opts) => { const range = ansibleRange(spec); return !!range && base.satisfies(version, range, opts); },
    maxSatisfying: (versions, spec, opts) => { const range = ansibleRange(spec); return range ? base.maxSatisfying(versions, range, opts) : undefined; },
  };
}
