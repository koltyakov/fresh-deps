import * as semver from 'semver';
import type { DependencyRef } from '../types';
import { codeTokens, groupEnd } from './codeTokens';

export function parseSwift(text: string): DependencyRef[] {
  const tokens = codeTokens(text);
  const deps: DependencyRef[] = [];
  for (let i = 0; i < tokens.length - 3; i++) {
    if (tokens[i].value !== '.' || tokens[i + 1].value !== 'package' || tokens[i + 2].value !== '(') continue;
    const end = groupEnd(tokens, i + 2);
    if (end < 0) continue;
    const args = tokens.slice(i + 3, end);
    i = end;
    const urlAt = args.findIndex((token) => token.value === 'url');
    if (urlAt < 0 || args[urlAt + 1]?.value !== ':' || args[urlAt + 2]?.kind !== 'string' || args[urlAt + 3]?.value !== ',') continue;
    const repo = /^https:\/\/github\.com\/([\w-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(args[urlAt + 2].value);
    if (!repo) continue;
    const requirement = args.slice(urlAt + 4);
    if (requirement.at(-1)?.value === ',') requirement.pop();
    let spec: string | undefined;
    let raw: string | undefined;
    let line = requirement[0]?.line ?? 0;
    const version = requirement[2]?.kind === 'string' ? semver.valid(requirement[2].value) : null;
    if (requirement.length === 3 && requirement[1].value === ':' && version) {
      raw = requirement[2].value;
      line = requirement[2].line;
      if (requirement[0].value === 'exact') spec = version;
      // Swift's from: always allows up to the next major, even below 1.0.
      if (requirement[0].value === 'from') spec = `>=${version} <${semver.major(version) + 1}.0.0`;
    } else if (requirement[0]?.value === '.' && ['upToNextMajor', 'upToNextMinor', 'exact'].includes(requirement[1]?.value)
      && requirement[2]?.value === '(' && requirement.at(-1)?.value === ')') {
      const literal = requirement.find((token) => token.kind === 'string');
      if (literal && semver.valid(literal.value) && requirement.filter((token) => token.kind === 'string').length === 1
        && (requirement.length === 5 || (requirement.length === 7 && requirement[3].value === 'from' && requirement[4].value === ':'))) {
        raw = literal.value; line = literal.line;
        spec = requirement[1].value === 'exact' ? raw : `>=${raw} <${requirement[1].value === 'upToNextMajor'
          ? `${semver.major(raw) + 1}.0.0` : `${semver.major(raw)}.${semver.minor(raw) + 1}.0`}`;
      }
    } else if (requirement[0]?.kind === 'string' && requirement.at(-1)?.kind === 'string') {
      const from = requirement[0], to = requirement.at(-1)!;
      const op = requirement.slice(1, -1).map((token) => token.value).join('');
      if (semver.valid(from.value) && semver.valid(to.value) && ['..<', '...'].includes(op)) {
        spec = `>=${from.value} ${op === '..<' ? '<' : '<='}${to.value}`;
        raw = `${from.value}${op}${to.value}`; line = from.line;
      }
    }
    if (spec) deps.push({ name: repo[1], spec, specRaw: raw, line, section: 'dependencies' });
  }
  return deps;
}
