import type { DependencyRef } from '../types';
import { mavenScheme } from '../schemes';

interface Token { value: string; line: number; string?: boolean }

/** Keep strings opaque so comments and interpolated code cannot become declarations. */
function tokensOf(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|[A-Za-z_][\w]*|\s+|./g;
  let line = 0;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    if (!/^\s|^\/\*|^\/\//.test(raw)) {
      const quoted = /^["']/.test(raw);
      const literal = quoted && raw.length > 1 && raw.at(-1) === raw[0]
        && !/^(?:"""|''')/.test(raw) && !/[\\$\n\r]/.test(raw);
      tokens.push({ value: quoted ? (literal ? raw.slice(1, -1) : '') : raw, line, string: quoted });
    }
    line += (raw.match(/\n/g) ?? []).length;
  }
  return tokens;
}

export function parseGradleBuild(text: string): DependencyRef[] {
  const tokens = tokensOf(text);
  const blocks: string[] = [];
  const deps: DependencyRef[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.string) continue;
    if (token.value === '{') { blocks.push(tokens[i - 1]?.value ?? ''); continue; }
    if (token.value === '}') { blocks.pop(); continue; }
    const block = blocks.at(-1);
    if (token.value === 'from' && blocks.includes('versionCatalogs')) {
      const offset = tokens[i + 1]?.value === '(' ? 2 : 1;
      const literal = tokens[i + offset];
      const match = literal?.string && /^([\w.-]+:[\w.-]+):(\d[\w.-]*)$/.exec(literal.value);
      if (match && mavenScheme.isPinned(match[2])) deps.push({ name: match[1], spec: match[2], line: literal.line, section: 'versionCatalogs' });
    }
    if (block !== 'dependencies' && block !== 'plugins') continue;
    const previous = tokens[i - 1];
    if (previous && previous.line === token.line && !['{', ';'].includes(previous.value)) continue;
    if (!/^[A-Za-z_]\w*$/.test(token.value)) continue;
    let cursor = i + 1;
    let closing = 0;
    if (tokens[cursor]?.value === '(') { cursor++; closing++; }
    if (block === 'dependencies' && ['platform', 'enforcedPlatform', 'testFixtures'].includes(tokens[cursor]?.value)) {
      cursor++;
      if (tokens[cursor++]?.value !== '(') continue;
      closing++;
    }
    const literal = tokens[cursor++];
    if (!literal?.string || !literal.value) continue;
    while (closing > 0 && tokens[cursor]?.value === ')') { closing--; cursor++; }
    if (closing) continue;
    let name: string;
    let spec: string;
    let anchor = literal;
    let alias: string | undefined;
    if (block === 'plugins') {
      if (!['id', 'kotlin'].includes(token.value) || tokens[cursor++]?.value !== 'version') continue;
      const paren = tokens[cursor]?.value === '(';
      if (paren) cursor++;
      anchor = tokens[cursor++];
      if (!anchor?.string) continue;
      if (paren && tokens[cursor++]?.value !== ')') continue;
      alias = literal.value;
      const id = token.value === 'kotlin' ? `org.jetbrains.kotlin.${literal.value}` : literal.value;
      name = `${id}:${id}.gradle.plugin`;
      spec = anchor.value;
    } else {
      const parts = literal.value.split(':');
      if (parts.length !== 3) continue;
      name = parts.slice(0, 2).join(':');
      spec = parts[2];
    }
    const next = tokens[cursor];
    if (next && ![';', '}', '{', 'apply'].includes(next.value) && next.line <= anchor.line) continue;
    if (next && ['+', '.', '?', '?:'].includes(next.value)) continue;
    if (!/^[\w.-]+:[\w.-]+$/.test(name) || !/^\d[\w.-]*$/.test(spec) || !mavenScheme.baseline(spec)) continue;
    deps.push({ name, spec, line: literal.line, section: block === 'plugins' ? 'plugins' : token.value,
      ...(alias ? { alias } : {}) });
    i = cursor - 1;
  }
  return deps;
}
