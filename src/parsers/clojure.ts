import { mavenScheme } from '../schemes';
import type { DependencyRef } from '../types';
import { codeTokens, groupEnd, type CodeToken } from './codeTokens';

interface Edn { atom?: CodeToken; kind?: string; items?: Edn[] }
function edn(tokens: CodeToken[], start: number): [Edn, number] | undefined {
  const token = tokens[start];
  if (!token) return undefined;
  if (['{', '[', '('].includes(token.value) && token.kind !== 'string') {
    const end = groupEnd(tokens, start);
    if (end < 0) return undefined;
    const items: Edn[] = [];
    let i = start + 1;
    while (i < end) {
      if (tokens[i].value === ',') { i++; continue; }
      const child = edn(tokens, i);
      if (!child) return undefined;
      items.push(child[0]); i = child[1];
    }
    return [{ kind: token.value, items }, end + 1];
  }
  if (token.kind === 'string') return [{ atom: token }, start + 1];
  let end = start + 1;
  let value = token.value;
  while (end < tokens.length && tokens[end - 1].end === tokens[end].start && !['{', '}', '[', ']', '(', ')', ','].includes(tokens[end].value)) {
    value += tokens[end++].value;
  }
  return [{ atom: { ...token, value } }, end];
}
const pairs = (node: Edn): [Edn, Edn][] => node.kind === '{' && node.items && node.items.length % 2 === 0
  ? Array.from({ length: node.items.length / 2 }, (_, i) => [node.items![i * 2], node.items![i * 2 + 1]]) : [];

export function parseClojure(text: string): DependencyRef[] {
  const tokens = codeTokens(text, 'clojure');
  // Reader macros can discard or conditionally select forms; do not guess their meaning.
  if (tokens.some((token) => token.kind !== 'string' && ['#', "'", '`', '~', '^', '@'].includes(token.value))) return [];
  const parsed = edn(tokens, 0);
  if (!parsed || parsed[1] !== tokens.length || parsed[0].kind !== '{') return [];
  const deps: DependencyRef[] = [];
  const walk = (node: Edn) => {
    for (const [key, value] of pairs(node)) {
      if (key.atom?.value === ':mvn/repos') return false;
      if ([':deps', ':extra-deps', ':override-deps', ':replace-deps'].includes(key.atom?.value ?? '')) {
        for (const [lib, coordinate] of pairs(value)) {
          const name = lib.atom?.value;
          if (!name || lib.atom?.kind === 'string' || !/^[\w.-]+(?:\/[\w.-]+)?$/.test(name)) continue;
          const entries = pairs(coordinate);
          const version = entries.find(([k]) => k.atom?.value === ':mvn/version')?.[1].atom;
          if (!version || version.kind !== 'string' || entries.some(([k]) => k.atom?.value !== ':mvn/version' && k.atom?.value !== ':exclusions')) continue;
          if (mavenScheme.baseline(version.value)) deps.push({ name: name.includes('/') ? name.replace('/', ':') : `${name}:${name}`,
            spec: version.value, line: version.line, section: key.atom!.value.slice(1) });
        }
      } else if (value.kind === '{' && !walk(value)) return false;
    }
    return true;
  };
  return walk(parsed[0]) ? deps : [];
}
