import { bazelScheme } from '../bazel';
import type { DependencyRef } from '../types';
import { codeTokens, groupEnd, type CodeToken } from './codeTokens';

export function parseBazel(text: string): DependencyRef[] {
  const tokens = codeTokens(text, 'python');
  const deps: DependencyRef[] = [];
  const overrides = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const call = tokens[i];
    if (call.kind !== 'word' || tokens[i + 1]?.value !== '(' || tokens[i - 1]?.value === '.') continue;
    const end = groupEnd(tokens, i + 1);
    if (end < 0) return [];
    const args = new Map<string, CodeToken[]>();
    let valid = true;
    for (let j = i + 2; j < end;) {
      const key = tokens[j];
      if (key.kind !== 'word' || tokens[j + 1]?.value !== '=' || args.has(key.value)) { valid = false; break; }
      const start = j + 2;
      j = start;
      while (j < end && tokens[j].value !== ',') {
        if (['(', '[', '{'].includes(tokens[j].value) && tokens[j].kind !== 'string') {
          j = groupEnd(tokens, j);
          if (j < 0) return [];
        }
        j++;
      }
      args.set(key.value, tokens.slice(start, j));
      j++;
    }
    const literal = (key: string) => { const value = args.get(key); return value?.length === 1 && value[0].kind === 'string' ? value[0] : undefined; };
    if (call.value.endsWith('_override')) {
      const name = literal('module_name');
      if (!valid || !name) return [];
      overrides.add(name.value);
    } else if (call.value === 'bazel_dep' && valid) {
      const name = literal('name'), version = literal('version');
      if (name && /^[a-z][a-z0-9._-]*$/.test(name.value) && version && bazelScheme.isVersion(version.value)) {
        deps.push({ name: name.value, spec: version.value, line: version.line, section: 'bazel_dep' });
      }
    } else if (call.value === 'include') return [];
    i = end;
  }
  return deps.filter((dep) => !overrides.has(dep.name));
}
