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
  const repositories = new Map([['central', 'https://repo.maven.apache.org/maven2'], ['clojars', 'https://repo.clojars.org']]);
  let hasRepositories = false;
  const readRepositories = (node: Edn) => {
    if (node.kind !== '{') return false;
    hasRepositories = true;
    for (const [name, config] of pairs(node)) {
      const url = pairs(config).find(([key]) => key.atom?.value === ':url')?.[1].atom;
      if (name.atom?.kind !== 'string' || !url || url.kind !== 'string' || !/^https:\/\/[^\s${}]+$/.test(url.value)) return false;
      try { const parsed = new URL(url.value); if (parsed.username || parsed.password) return false; } catch { return false; }
      repositories.set(name.atom.value, url.value.replace(/\/$/, ''));
    }
    return true;
  };
  const walk = (node: Edn) => {
    for (const [key, value] of pairs(node)) {
      if (key.atom?.value === ':mvn/repos') { if (!readRepositories(value)) return false; continue; }
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
  return walk(parsed[0]) ? deps.map((dep) => hasRepositories ? { ...dep, source: [...repositories.values()].join('|') } : dep) : [];
}

export function parseLeiningen(text: string): DependencyRef[] {
  const tokens = codeTokens(text, 'clojure');
  const deps: DependencyRef[] = [];
  for (let i = 0; i < tokens.length - 2; i++) {
    if (tokens[i].value !== ':' || !['dependencies', 'managed-dependencies', 'plugins'].includes(tokens[i + 1].value) || tokens[i + 2].value !== '[') continue;
    const parsed = edn(tokens, i + 2);
    if (!parsed) continue;
    for (const dependency of parsed[0].items ?? []) {
      const [name, version] = dependency.items ?? [];
      if (dependency.kind !== '[' || !name?.atom || version?.atom?.kind !== 'string' || !mavenScheme.isPinned(version.atom.value)) continue;
      const coordinate = name.atom.value;
      if (/^[\w.-]+(?:\/[\w.-]+)?$/.test(coordinate)) deps.push({ name: coordinate.includes('/') ? coordinate.replace('/', ':') : `${coordinate}:${coordinate}`,
        spec: version.atom.value, line: version.atom.line, section: tokens[i + 1].value });
    }
    i = parsed[1] - 1;
  }
  // Leiningen repository forms may contain credentials and dynamic expressions.
  return /:repositories\b/.test(text) ? deps.map((dep) => ({ ...dep, skipReason: 'Leiningen repository configuration requires an explicit source' })) : deps;
}
