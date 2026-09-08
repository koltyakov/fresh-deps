import type { DependencyRef } from '../types';

const BLOCK_DIRECTIVES = ['require', 'replace', 'exclude', 'retract'];

interface ParsedLine {
  /** Line with the trailing `//` comment removed. */
  code: string;
  comment: string;
}

function splitComment(line: string): ParsedLine {
  const at = line.indexOf('//');
  return at === -1
    ? { code: line, comment: '' }
    : { code: line.slice(0, at), comment: line.slice(at + 2).trim() };
}

/**
 * Extracts required modules from a go.mod, honouring both the single-line and the
 * parenthesised block form. Modules handled by a `replace` directive are skipped,
 * since their version no longer comes from the proxy.
 */
export function parseGoMod(text: string, options: { includeIndirect: boolean }): DependencyRef[] {
  const lines = text.split(/\r?\n/);
  const deps: DependencyRef[] = [];
  const replaced = new Set<string>();

  let block: string | undefined;

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const { code, comment } = splitComment(lines[lineNo]);
    const trimmed = code.trim();
    if (trimmed === '') {
      continue;
    }

    if (block !== undefined) {
      if (trimmed.startsWith(')')) {
        block = undefined;
        continue;
      }
      collect(block, trimmed, lineNo, comment);
      continue;
    }

    const directive = BLOCK_DIRECTIVES.find(
      (d) => trimmed === d || trimmed.startsWith(`${d} `) || trimmed.startsWith(`${d}(`),
    );
    if (!directive) {
      continue;
    }

    const rest = trimmed.slice(directive.length).trim();
    if (rest.startsWith('(')) {
      block = directive;
      continue;
    }
    collect(directive, rest, lineNo, comment);
  }

  function collect(directive: string, statement: string, lineNo: number, comment: string) {
    if (directive === 'replace') {
      const left = statement.split('=>')[0]?.trim().split(/\s+/)[0];
      if (left) {
        replaced.add(left);
      }
      return;
    }
    if (directive !== 'require') {
      return;
    }

    const [name, version] = statement.split(/\s+/);
    if (!name || !version || !version.startsWith('v')) {
      return;
    }

    const indirect = /(^|\s)indirect(\s|$)/.test(comment);
    if (indirect && !options.includeIndirect) {
      return;
    }

    deps.push({
      name,
      spec: version,
      line: lineNo,
      section: 'require',
      ...(indirect ? { indirect: true } : {}),
    });
  }

  return deps.filter((dep) => !replaced.has(dep.name));
}
