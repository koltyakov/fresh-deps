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
  for (const line of text.split(/\r?\n/)) {
    const source = /^\s*source\b\s*(?:\(?\s*)?(?:(["'])(.*?)\1)?/.exec(line);
    if (source && (!source[2] || !/^https:\/\/rubygems\.org\/?$/i.test(source[2]))) return [];
  }
  return parseRubyDependencies(text, new Set(['gem']));
}

export function parseGemspec(text: string): DependencyRef[] {
  return parseRubyDependencies(text, new Set(['add_dependency', 'add_runtime_dependency', 'add_development_dependency']));
}

function parseRubyDependencies(text: string, calls: Set<string>): DependencyRef[] {
  const stream = tokens(text);
  const deps: DependencyRef[] = [];
  for (let i = 0; i < stream.length; i++) {
    if (stream[i].kind !== 'word' || !calls.has(stream[i].value)) continue;
    const call = stream[i].value;
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
      if (token.kind === 'word' && stream[j + 1]?.value === ':') option = true;
      if (token.kind === 'string' && !option) values.push(token);
    }
    i = Math.max(i, j - 1);
    if (unsafe || values.length < 2) continue;
    const name = values[0].value;
    const requirements = values.slice(1).map((token) => token.value);
    const spec = requirements.join(', ');
    if (/^[A-Za-z0-9_.-]+$/.test(name) && requirements.every((value) => /^(?:~>|>=|<=|!=|=|>|<)?\s*\d/.test(value))) {
      const section = call === 'add_development_dependency' ? 'development_dependencies' : 'gems';
      deps.push({ name, spec, line: values[1].line, section });
    }
  }
  return deps;
}
