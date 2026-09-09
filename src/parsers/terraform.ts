import type { DependencyRef } from '../types';
import { codeTokens, groupEnd, type CodeToken } from './codeTokens';

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
  let quote = false;
  let escaped = false;
  const structure = text.split('').map((char) => {
    if (quote) {
      if (!escaped && char === '"') quote = false;
      escaped = !escaped && char === '\\';
      return char === '\n' ? char : ' ';
    }
    if (char === '"') { quote = true; return ' '; }
    return char;
  }).join('');
  for (const match of structure.matchAll(pattern)) {
    const open = (match.index ?? 0) + match[0].lastIndexOf('{');
    const close = closingBrace(text, open);
    if (close > open) result.push({ body: text.slice(open + 1, close), start: offset + open + 1 });
  }
  return result;
}

function maskComments(text: string): string {
  const heredocMasked = text.split('');
  const heredoc = /<<-?\s*([A-Za-z_][A-Za-z0-9_]*)[^\n]*\n/g;
  for (const match of text.matchAll(heredoc)) {
    const endPattern = new RegExp(`^[ \\t]*${match[1]}[ \\t]*(?:\\r?\\n|$)`, 'gm');
    endPattern.lastIndex = (match.index ?? 0) + match[0].length;
    const end = endPattern.exec(text);
    const stop = end ? end.index + end[0].length : text.length;
    for (let i = match.index ?? 0; i < stop; i++) if (heredocMasked[i] !== '\n' && heredocMasked[i] !== '\r') heredocMasked[i] = ' ';
  }
  text = heredocMasked.join('');
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

export function parseTflint(text: string): DependencyRef[] {
  const tokens = codeTokens(maskComments(text));
  const deps: DependencyRef[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const plugin = tokens[i].kind === 'word' && tokens[i].value === 'plugin'
      && tokens[i + 1]?.kind === 'string' && tokens[i + 2]?.value === '{';
    if (plugin) {
      const end = groupEnd(tokens, i + 2);
      if (end < 0) break;
      const fields = new Map<string, CodeToken>();
      for (let j = i + 3; j < end; j++) {
        const token = tokens[j];
        if (['{', '[', '('].includes(token.value) && token.kind === 'punct') {
          const close = groupEnd(tokens, j);
          if (close >= 0) j = close;
          continue;
        }
        const value = tokens[j + 2];
        const next = tokens[j + 3];
        if (token.kind === 'word' && tokens[j + 1]?.value === '=' && value
          && (j + 3 === end || next.line > value.line)
          && (value.kind === 'string' || (value.kind === 'word' && /^(true|false)$/.test(value.value)))) {
          fields.set(token.value, value);
          j += 2;
        }
      }
      const source = fields.get('source');
      const version = fields.get('version');
      const enabled = fields.get('enabled');
      const match = source?.kind === 'string' && /^github\.com\/([\w-]+\/[\w.-]+)$/.exec(source.value);
      if (match && version?.kind === 'string' && /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version.value)
        && !(enabled?.kind === 'word' && enabled.value === 'false')) {
        deps.push({ name: `tflint:${match[1]}`, spec: version.value, alias: tokens[i + 1].value,
          line: version.line, section: 'plugins', semver: true });
      }
      i = end;
    } else if (tokens[i].kind === 'punct' && tokens[i].value === '{') {
      const end = groupEnd(tokens, i);
      if (end >= 0) i = end;
    }
  }
  return deps;
}

export function parseTerraform(text: string, defaultRegistry = 'registry.terraform.io'): DependencyRef[] {
  const clean = maskComments(text);
  const deps: DependencyRef[] = [];
  for (const terraform of blocks(clean, 'terraform')) {
    for (const providers of blocks(terraform.body, 'required_providers', terraform.start)) {
      const entry = /\b([A-Za-z][\w-]*)\s*=\s*/g;
      let match: RegExpExecArray | null;
      while ((match = entry.exec(providers.body))) {
        const local = match[1];
        const valueAt = match.index + match[0].length;
        let source = `${defaultRegistry}/hashicorp/${local}`;
        let spec: string | undefined;
        let versionAt = valueAt;
        if (providers.body[valueAt] === '{') {
          const close = closingBrace(providers.body, valueAt);
          if (close < 0) continue;
          entry.lastIndex = close + 1;
          const object = providers.body.slice(valueAt + 1, close);
          const sourceMatch = /\bsource\s*=\s*"([^"${}]+)"/.exec(object);
          const versionMatch = /\bversion\s*=\s*"([^"${}]+)"/.exec(object);
          if (!versionMatch || (/\bsource\s*=/.test(object) && !sourceMatch)) continue;
          source = sourceMatch?.[1].trim() ?? source;
          spec = versionMatch[1].trim();
          versionAt = valueAt + 1 + (versionMatch.index ?? 0);
        } else {
          const legacy = /^"([^"${}]+)"/.exec(providers.body.slice(valueAt));
          if (!legacy) continue;
          spec = legacy[1].trim();
        }
        const parts = source.toLowerCase().split('/');
        const host = parts.length === 3 ? parts.shift() : undefined;
        if ((host && !['registry.terraform.io', 'registry.opentofu.org'].includes(host)) || parts.length !== 2 || !spec) continue;
        const registry = host ?? defaultRegistry;
        const name = registry === 'registry.opentofu.org' ? `${registry}/${parts.join('/')}` : parts.join('/');
        const absolute = providers.start + versionAt;
        deps.push({ name, spec, line: text.slice(0, absolute).split('\n').length - 1, section: 'required_providers',
          ...(local !== parts[1] ? { alias: local } : {}) });
      }
    }
  }
  const tokens = codeTokens(clean);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].value === 'module' && tokens[i + 1]?.kind === 'string' && tokens[i + 2]?.value === '{') {
      const end = groupEnd(tokens, i + 2);
      if (end < 0) continue;
      const body = tokens.slice(i + 3, end);
      const literal = (key: string) => {
        const at = body.findIndex((token) => token.kind === 'word' && token.value === key);
        const value = body[at + 2];
        return at >= 0 && body[at + 1]?.value === '=' && value?.kind === 'string'
          && (!body[at + 3] || body[at + 3].line > value.line || body[at + 3].value === ',') ? value : undefined;
      };
      const source = literal('source');
      const version = literal('version');
      const match = source && /^(?:(registry\.terraform\.io|registry\.opentofu\.org)\/)?([\w-]+\/[\w-]+\/[\w-]+)$/.exec(source.value);
      if (match && version && !/[$%{}]/.test(version.value)) deps.push({
        name: `module:${match[1] ?? defaultRegistry}/${match[2]}`, spec: version.value,
        alias: tokens[i + 1].value, line: version.line, section: 'modules',
      });
      i = end;
    } else if (tokens[i].value === '{') {
      const end = groupEnd(tokens, i);
      if (end >= 0) i = end;
    }
  }
  return deps;
}
