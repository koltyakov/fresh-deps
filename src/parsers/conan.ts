import { conanScheme } from '../numericVersion';
import type { DependencyRef } from '../types';
import { codeTokens, groupEnd } from './codeTokens';

function requirement(value: string, line: number, section: string): DependencyRef[] {
  const match = /^([a-z0-9_][a-z0-9_+.-]*)\/(\[[^\]]+\]|[A-Za-z0-9]+(?:[._+-][A-Za-z0-9]+)*)(?:@([\w.-]+\/[\w.-]+))?(?:#([a-f\d]{32}))?$/.exec(value);
  if (!match) return [];
  const spec = match[2].replace(/^\[|\]$/g, '');
  return conanScheme.baseline(spec) ? [{ name: match[1] + (match[3] ? `@${match[3]}` : ''), spec, specRaw: match[2] + (match[4] ? `#${match[4]}` : ''),
    ...(match[4] ? { revision: match[4] } : {}), line, section }] : [];
}

export function parseConan(text: string, python: boolean): DependencyRef[] {
  const deps: DependencyRef[] = [];
  if (!python) {
    let section = '';
    text.split(/\r?\n/).forEach((raw, line) => {
      const value = raw.replace(/(?:^\s*#|\s+#).*$/, '').trim();
      const header = /^\[([^\]]+)\]$/.exec(value);
      if (header) section = header[1];
      else if (['requires', 'tool_requires', 'build_requires', 'test_requires'].includes(section)) deps.push(...requirement(value, line, section));
    });
    return deps;
  }
  const tokens = codeTokens(text, 'python');
  const sections = ['requires', 'tool_requires', 'build_requires', 'test_requires'];
  for (let i = 0; i < tokens.length; i++) {
    if (!sections.includes(tokens[i].value) || tokens[i].kind !== 'word') continue;
    const section = tokens[i].value;
    if (tokens[i + 1]?.value === '(' && tokens[i - 1]?.value === '.' && tokens[i - 2]?.value === 'self') {
      const end = groupEnd(tokens, i + 1);
      if (end < 0) continue;
      if (tokens[i + 2]?.kind === 'string' && [',', ')'].includes(tokens[i + 3]?.value)) {
        deps.push(...requirement(tokens[i + 2].value, tokens[i + 2].line, section));
      }
      i = end;
    } else if (tokens[i + 1]?.value === '=' && (i === 0 || tokens[i - 1].line < tokens[i].line)) {
      const start = i + 2;
      let end = start;
      let values = [tokens[start]];
      if (['(', '['].includes(tokens[start]?.value)) {
        end = groupEnd(tokens, start);
        if (end < 0) continue;
        values = tokens.slice(start + 1, end);
      } else {
        while (tokens[end + 1]?.line === tokens[start]?.line) end++;
        values = tokens.slice(start, end + 1);
      }
      if (values.every((token) => token.kind === 'string' || token.value === ',')
        && (!tokens[end + 1] || tokens[end + 1].line > tokens[end].line)) {
        for (const token of values) if (token.kind === 'string') deps.push(...requirement(token.value, token.line, section));
      }
      i = end;
    }
  }
  return deps;
}
