import { normalizeNpmSpec, type NormalizedSpec } from '../versions';
import type { DependencyRef } from '../types';

interface Token {
  type: 'string' | 'punct';
  value: string;
  line: number;
}

/**
 * Tolerant JSON(C) tokenizer: only strings and structural punctuation are kept,
 * which is all that is needed to locate dependency declarations and their positions.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let line = 0;
  let i = 0;

  const advance = (count = 1) => {
    for (let n = 0; n < count; n++) {
      if (text[i] === '\n') {
        line++;
      }
      i++;
    }
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === '"') {
      const startLine = line;
      const start = i;
      let value = '';
      advance();
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') {
          const escaped = text[i + 1];
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped ?? '';
          advance(2);
        } else {
          value += text[i];
          advance();
        }
      }
      advance(); // closing quote
      try { value = JSON.parse(text.slice(start, i)); } catch { /* Keep partially typed strings usable. */ }
      tokens.push({ type: 'string', value, line: startLine });
      continue;
    }

    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        advance();
      }
      continue;
    }

    if (ch === '/' && text[i + 1] === '*') {
      advance(2);
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        advance();
      }
      advance(2);
      continue;
    }

    if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ':' || ch === ',') {
      advance();
      tokens.push({ type: 'punct', value: ch, line });
      continue;
    }

    advance();
  }

  return tokens;
}

/** Extracts dependency declarations from the requested top-level sections of a package.json. */
export function parsePackageJson(text: string, sections: string[]): DependencyRef[] {
  return parseJsonDependencies(text, sections, normalizeNpmSpec);
}

export function parseJsonDependencies(
  text: string, sections: string[], normalize: (name: string, spec: string) => NormalizedSpec | undefined,
): DependencyRef[] {
  const tokens = tokenize(text);
  const deps: DependencyRef[] = [];

  let depth = 0;
  let section: string | undefined;
  let sectionDepth = -1;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type === 'punct') {
      if (token.value === '{' || token.value === '[') {
        depth++;
      } else if (token.value === '}' || token.value === ']') {
        depth--;
        if (section !== undefined && depth < sectionDepth) {
          section = undefined;
        }
      }
      continue;
    }

    const colon = tokens[i + 1];
    const value = tokens[i + 2];
    if (colon?.type !== 'punct' || colon.value !== ':' || !value) {
      continue;
    }

    if (depth === 1 && sections.includes(token.value) && value.type === 'punct' && value.value === '{') {
      section = token.value;
      sectionDepth = depth + 1;
      continue;
    }

    if (section !== undefined && depth === sectionDepth && value.type === 'string') {
      // Volta's other fields, such as extends, are not package declarations.
      if (section === 'volta' && !['node', 'npm', 'yarn', 'pnpm'].includes(token.value)) {
        continue;
      }
      const normalized = normalize(token.value, value.value);
      if (normalized) {
        deps.push({
          name: normalized.name,
          spec: normalized.spec,
          line: value.line,
          section,
          ...(normalized.alias ? { alias: normalized.alias } : {}),
        });
      }
    }
  }

  return deps;
}
