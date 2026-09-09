import type { DependencyRef } from '../types';

interface Token { kind: 'word' | 'string' | 'punct' | 'newline'; value: string; line: number }

function tokens(text: string): Token[] {
  const result: Token[] = [];
  let i = 0;
  let line = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '\n') { result.push({ kind: 'newline', value: char, line }); line++; i++; continue; }
    if (/\s/.test(char)) { i++; continue; }
    if (char === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (char === '"' || char === "'") {
      const quote = char;
      const start = line;
      let value = '';
      let dynamic = false;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\' && i + 1 < text.length) { value += text[i + 1]; i += 2; continue; }
        if (quote === '"' && text[i] === '#' && text[i + 1] === '{') dynamic = true;
        if (text[i] === '\n') line++;
        value += text[i++];
      }
      if (text[i] === quote) i++;
      if (!dynamic) result.push({ kind: 'string', value, line: start });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = i++;
      while (i < text.length && /[A-Za-z0-9_!?]/.test(text[i])) i++;
      result.push({ kind: 'word', value: text.slice(start, i), line });
      continue;
    }
    result.push({ kind: 'punct', value: char, line });
    i++;
  }
  return result;
}

export function parseGemfile(text: string): DependencyRef[] {
  const customGitSources = new Set([...text.matchAll(/\bgit_source\s*\(\s*:([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]));
  for (const line of text.split(/\r?\n/)) {
    const source = /^\s*source\b\s*(?:\(?\s*)?(?:(["'])(.*?)\1)?/.exec(line);
    if (source && (!source[2] || !/^https:\/\/rubygems\.org\/?$/i.test(source[2]))) return [];
    if (/^\s*(?:git|path)\b.*\bdo\s*(?:#.*)?$/.test(line)) return [];
  }
  return parseRubyDependencies(text, new Set(['gem']), customGitSources);
}

function parseRubyDependencies(text: string, calls: Set<string>, customGitSources: Set<string>): DependencyRef[] {
  const stream = tokens(text);
  const deps: DependencyRef[] = [];
  for (let i = 0; i < stream.length; i++) {
    if (stream[i].kind !== 'word' || !calls.has(stream[i].value)) continue;
    const values: Token[] = [];
    let depth = 0;
    let unsafe = false;
    let option = false;
    let j = i + 1;
    for (; j < stream.length; j++) {
      const token = stream[j];
      if (token.value === '(' || token.value === '[' || token.value === '{') depth++;
      if (token.value === ')' || token.value === ']' || token.value === '}') {
        depth--;
        if (depth < 0) break;
      }
      if (token.kind === 'newline' && depth <= 0) break;
      if (token.kind === 'word' && ['git', 'github', 'path', 'source'].includes(token.value)
        && stream[j + 1]?.value === ':') unsafe = true;
      if (token.kind === 'word' && stream[j + 1]?.value === ':'
        && !['require', 'group', 'groups', 'platform', 'platforms', 'install_if', 'force_ruby_platform'].includes(token.value)) unsafe = true;
      if (token.kind === 'word' && customGitSources.has(token.value) && stream[j + 1]?.value === ':') unsafe = true;
      if (token.value === '*' && stream[j + 1]?.value === '*') unsafe = true;
      if (token.kind === 'word' && stream[j + 1]?.value === ':') option = true;
      if (token.kind === 'string' && !option) values.push(token);
    }
    i = Math.max(i, j - 1);
    if (unsafe || values.length < 2) continue;
    const name = values[0].value;
    const requirements = values.slice(1).map((token) => token.value);
    const spec = requirements.join(', ');
    if (/^[A-Za-z0-9_.-]+$/.test(name) && requirements.every((value) => /^(?:~>|>=|<=|!=|=|>|<)?\s*\d/.test(value))) {
      deps.push({ name, spec, line: values[1].line, section: 'gems' });
    }
  }
  return deps;
}
