import type { DependencyRef } from '../types';

function maskComments(text: string): string {
  let quote = '';
  let escaped = false;
  return text.split('').map((char) => {
    if (char === '\n') { escaped = false; return char; }
    if (quote) {
      if (!escaped && char === quote) quote = '';
      escaped = !escaped && char === '\\';
      return char;
    }
    if (char === '"' || char === "'") { quote = char; return char; }
    return char;
  }).join('').replace(/#(?=(?:[^"']|"[^"]*"|'[^']*')*$).*/gm, (comment) => ' '.repeat(comment.length));
}

export function parseMixExs(text: string): DependencyRef[] {
  const clean = maskComments(text);
  const start = /\bdefp?\s+deps\s+do\b/.exec(clean);
  if (!start) return [];
  const tail = clean.slice(start.index + start[0].length);
  const end = /^\s*end\b/m.exec(tail);
  const bodyStart = start.index + start[0].length;
  const body = tail.slice(0, end?.index ?? tail.length);
  const deps: DependencyRef[] = [];
  const pattern = /\{\s*:([a-z][a-z0-9_]*)\s*,\s*"([^"#{}]+)"([^}]*)\}/gms;
  for (const match of body.matchAll(pattern)) {
    const options = match[3];
    if (/\b(?:git|github|path|in_umbrella|organization|repo)\s*:/.test(options)) continue;
    const alias = /\bhex\s*:\s*:([a-z][a-z0-9_]*)/.exec(options)?.[1];
    const name = alias ?? match[1];
    const spec = match[2].trim();
    if (!spec || !/\d/.test(spec)) continue;
    const versionOffset = bodyStart + (match.index ?? 0) + match[0].indexOf(`"${match[2]}"`);
    deps.push({ name, spec, line: text.slice(0, versionOffset).split('\n').length - 1, section: 'deps',
      ...(alias && alias !== match[1] ? { alias: match[1] } : {}) });
  }
  return deps;
}
