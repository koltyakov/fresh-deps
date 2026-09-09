import { semverScheme } from '../schemes';
import type { DependencyRef } from '../types';
import { tokenize } from './packageJson';

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function jsonc(text: string): unknown {
  // Protect quoted strings while removing comments and trailing commas.
  const withoutComments = text.replace(/"(?:\\[\s\S]|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
    (part) => part.startsWith('"') ? part : part.replace(/[^\r\n]/g, ' '));
  return JSON.parse(withoutComments.replace(/"(?:\\[\s\S]|[^"\\])*"|,\s*([}\]])/g,
    (part, closing: string | undefined) => closing ?? part));
}

/** Imports and scoped imports share the same npm:/jsr: specifier syntax. */
export function parseDeno(text: string): DependencyRef[] {
  let document: unknown;
  try { document = jsonc(text); } catch { return []; }
  if (!object(document)) return [];
  const tokens = tokenize(text);
  const stack: string[] = [];
  const deps: DependencyRef[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'punct') {
      if (token.value === '{' || token.value === '[') {
        stack.push(tokens[i - 1]?.value === ':' && tokens[i - 2]?.type === 'string' ? tokens[i - 2].value : '');
      } else if (token.value === '}' || token.value === ']') stack.pop();
      continue;
    }
    if (tokens[i + 1]?.value !== ':' || tokens[i + 2]?.type !== 'string') continue;
    if (!(stack.length === 2 && stack[1] === 'imports') && !(stack.length === 3 && stack[1] === 'scopes')) continue;
    const raw = tokens[i + 2].value;
    const container = stack.length === 2 ? document.imports
      : object(document.scopes) ? document.scopes[stack[2]] : undefined;
    if (!object(container) || container[token.value] !== raw) continue;
    const match = /^(npm|jsr):(@[a-z0-9_.-]+\/[a-z0-9_.-]+|[a-z0-9_.-]+)@([^/]+)(?:\/.*)?$/.exec(raw);
    if (!match || match[2].split('/').some((part) => /^@?\.+$/.test(part))
      || (match[1] === 'jsr' && !/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(match[2])) || !semverScheme.baseline(match[3])) continue;
    deps.push({ name: `${match[1]}:${match[2]}`, spec: match[3], alias: token.value,
      line: tokens[i + 2].line, section: stack.slice(1).join('.') });
  }
  return deps;
}
