import type { DependencyRef } from '../types';

interface Token { kind: 'word' | 'atom' | 'string' | 'punct' | 'newline'; value: string; line: number }

function tokens(text: string): Token[] {
  const result: Token[] = [];
  let i = 0;
  let line = 0;
  const advance = () => { if (text[i] === '\n') line++; i++; };
  while (i < text.length) {
    const char = text[i];
    if (char === '\n') { result.push({ kind: 'newline', value: char, line }); advance(); continue; }
    if (/\s/.test(char)) { advance(); continue; }
    if (char === '#') { while (i < text.length && text[i] !== '\n') advance(); continue; }
    if (text.startsWith('"""', i)) {
      i += 3;
      while (i < text.length && !text.startsWith('"""', i)) advance();
      i = Math.min(text.length, i + 3);
      continue;
    }
    if (char === '~' && /[A-Za-z]/.test(text[i + 1] ?? '')) {
      i += 2;
      if (text.startsWith('"""', i)) {
        i += 3;
        while (i < text.length && !text.startsWith('"""', i)) advance();
        i = Math.min(text.length, i + 3);
      } else {
        const open = text[i];
        const close = ({ '(': ')', '[': ']', '{': '}', '<': '>' } as Record<string, string>)[open] ?? open;
        advance();
        while (i < text.length && text[i] !== close) {
          if (text[i] === '\\' && i + 1 < text.length) advance();
          advance();
        }
        if (i < text.length) advance();
      }
      while (/[A-Za-z]/.test(text[i] ?? '')) advance();
      continue;
    }
    if (char === '"') {
      const startLine = line;
      let value = '';
      let dynamic = false;
      advance();
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) { advance(); value += text[i]; advance(); continue; }
        if (text[i] === '#' && text[i + 1] === '{') dynamic = true;
        value += text[i];
        advance();
      }
      if (i < text.length) advance();
      if (!dynamic) result.push({ kind: 'string', value, line: startLine });
      continue;
    }
    if (char === "'") {
      advance();
      while (i < text.length && text[i] !== "'") {
        if (text[i] === '\\' && i + 1 < text.length) advance();
        advance();
      }
      if (i < text.length) advance();
      continue;
    }
    if (char === ':' && /[a-z_]/i.test(text[i + 1] ?? '')) {
      advance();
      const start = i;
      while (/[A-Za-z0-9_!?]/.test(text[i] ?? '')) advance();
      result.push({ kind: 'atom', value: text.slice(start, i), line });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = i;
      while (/[A-Za-z0-9_!?]/.test(text[i] ?? '')) advance();
      result.push({ kind: 'word', value: text.slice(start, i), line });
      continue;
    }
    result.push({ kind: 'punct', value: char, line });
    advance();
  }
  return result;
}

function dependencyTuples(stream: Token[], start: number, end: number): DependencyRef[] {
  const deps: DependencyRef[] = [];
  for (let i = start; i < end; i++) {
    if (stream[i].value !== '{' || stream[i + 1]?.kind !== 'atom' || stream[i + 2]?.value !== ',' || stream[i + 3]?.kind !== 'string') continue;
    const local = stream[i + 1].value;
    const spec = stream[i + 3].value.trim();
    let depth = 1;
    let close = i + 4;
    for (; close < end && depth > 0; close++) {
      if (stream[close].value === '{') depth++;
      if (stream[close].value === '}') depth--;
    }
    const options = stream.slice(i + 4, close - 1);
    const option = (name: string) => options.some((token, index) => token.kind === 'word' && token.value === name && options[index + 1]?.value === ':');
    if (['git', 'github', 'path', 'in_umbrella', 'organization', 'repo'].some(option) || !spec || !/\d/.test(spec)) {
      i = close - 1;
      continue;
    }
    let name = local;
    const hexAt = options.findIndex((token, index) => token.kind === 'word' && token.value === 'hex' && options[index + 1]?.value === ':');
    if (hexAt >= 0 && options[hexAt + 2]?.kind === 'atom') name = options[hexAt + 2].value;
    deps.push({ name, spec, line: stream[i + 3].line, section: 'deps', ...(name !== local ? { alias: local } : {}) });
    i = close - 1;
  }
  return deps;
}

export function parseMixExs(text: string): DependencyRef[] {
  const stream = tokens(text);
  for (let i = 0; i < stream.length; i++) {
    if (!['def', 'defp'].includes(stream[i].value) || stream[i + 1]?.value !== 'deps') continue;
    let cursor = i + 2;
    if (stream[cursor]?.value === '(' && stream[cursor + 1]?.value === ')') cursor += 2;
    while (stream[cursor]?.kind === 'newline') cursor++;
    if (stream[cursor]?.value === ',') cursor++;
    while (stream[cursor]?.kind === 'newline') cursor++;
    if (stream[cursor]?.value !== 'do') continue;
    if (stream[cursor + 1]?.value === ':') {
      let list = cursor + 2;
      while (stream[list]?.kind === 'newline') list++;
      if (stream[list]?.value !== '[') return [];
      let depth = 1;
      let end = list + 1;
      while (end < stream.length && depth > 0) {
        if (stream[end].value === '[') depth++;
        if (stream[end].value === ']') depth--;
        end++;
      }
      return dependencyTuples(stream, list + 1, end - 1);
    }
    let depth = 1;
    let end = cursor + 1;
    for (; end < stream.length && depth > 0; end++) {
      const token = stream[end];
      if ((token.value === 'do' && stream[end + 1]?.value !== ':') || token.value === 'fn') depth++;
      if (token.value === 'end') depth--;
    }
    let list = cursor + 1;
    while (stream[list]?.kind === 'newline') list++;
    if (stream[list]?.value !== '[') return [];
    let listDepth = 1;
    let listEnd = list + 1;
    while (listEnd < end - 1 && listDepth > 0) {
      if (stream[listEnd].value === '[') listDepth++;
      if (stream[listEnd].value === ']') listDepth--;
      listEnd++;
    }
    if (listDepth !== 0 || stream.slice(listEnd, end - 1).some((token) => token.kind !== 'newline')) return [];
    return dependencyTuples(stream, list + 1, listEnd - 1);
  }
  return [];
}
