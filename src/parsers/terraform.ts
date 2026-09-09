import type { DependencyRef } from '../types';

function closingBrace(text: string, open: number): number {
  let depth = 0;
  let quote = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (!quote && (char === '#' || (char === '/' && next === '/'))) { lineComment = true; if (char === '/') i++; continue; }
    if (!quote && char === '/' && next === '*') { blockComment = true; i++; continue; }
    if (char === '"' && text[i - 1] !== '\\') { quote = !quote; continue; }
    if (quote) continue;
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) return i;
  }
  return -1;
}

function blocks(text: string, name: string, offset = 0): { body: string; start: number }[] {
  const result: { body: string; start: number }[] = [];
  const pattern = new RegExp(`\\b${name}\\s*\\{`, 'g');
  for (const match of text.matchAll(pattern)) {
    const open = (match.index ?? 0) + match[0].lastIndexOf('{');
    const close = closingBrace(text, open);
    if (close > open) result.push({ body: text.slice(open + 1, close), start: offset + open + 1 });
  }
  return result;
}

function maskComments(text: string): string {
  let quote = false;
  let lineComment = false;
  let blockComment = false;
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (lineComment) {
      if (char === '\n') { lineComment = false; result += char; } else result += ' ';
    } else if (blockComment) {
      if (char === '*' && next === '/') { result += '  '; blockComment = false; i++; }
      else result += char === '\n' ? '\n' : ' ';
    } else if (!quote && (char === '#' || (char === '/' && next === '/'))) {
      lineComment = true;
      result += char === '/' ? '  ' : ' ';
      if (char === '/') i++;
    } else if (!quote && char === '/' && next === '*') {
      blockComment = true;
      result += '  ';
      i++;
    } else {
      result += char;
      if (char === '"' && text[i - 1] !== '\\') quote = !quote;
    }
  }
  return result;
}

export function parseTerraform(text: string): DependencyRef[] {
  const clean = maskComments(text);
  const deps: DependencyRef[] = [];
  for (const terraform of blocks(clean, 'terraform')) {
    for (const providers of blocks(terraform.body, 'required_providers', terraform.start)) {
      const entry = /\b([A-Za-z][\w-]*)\s*=\s*/g;
      let match: RegExpExecArray | null;
      while ((match = entry.exec(providers.body))) {
        const local = match[1];
        const valueAt = match.index + match[0].length;
        let source = `hashicorp/${local}`;
        let spec: string | undefined;
        let versionAt = valueAt;
        if (providers.body[valueAt] === '{') {
          const close = closingBrace(providers.body, valueAt);
          if (close < 0) continue;
          entry.lastIndex = close + 1;
          const object = providers.body.slice(valueAt + 1, close);
          const sourceMatch = /\bsource\s*=\s*"([^"${}]+)"/.exec(object);
          const versionMatch = /\bversion\s*=\s*"([^"${}]+)"/.exec(object);
          if (!versionMatch) continue;
          source = sourceMatch?.[1].trim() ?? source;
          spec = versionMatch[1].trim();
          versionAt = valueAt + 1 + (versionMatch.index ?? 0);
        } else {
          const legacy = /^"([^"${}]+)"/.exec(providers.body.slice(valueAt));
          if (!legacy) continue;
          spec = legacy[1].trim();
        }
        const parts = source.toLowerCase().split('/');
        if (parts.length === 3 && parts[0] === 'registry.terraform.io') parts.shift();
        if (parts.length !== 2 || !spec) continue;
        const name = parts.join('/');
        const absolute = providers.start + versionAt;
        deps.push({ name, spec, line: text.slice(0, absolute).split('\n').length - 1, section: 'required_providers',
          ...(local !== parts[1] ? { alias: local } : {}) });
      }
    }
  }
  return deps;
}
