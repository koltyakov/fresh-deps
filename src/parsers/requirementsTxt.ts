import type { DependencyRef } from '../types';
import { normalizePythonSpec } from '../versions';
import { parseRequirement } from './pep508';
import { requirementsSource } from './pythonSources';

interface LogicalLine {
  text: string;
  /** Start offset within `text` of each physical line it was joined from. */
  starts: { at: number; line: number }[];
}

/** Joins backslash continuations so a requirement split across lines parses as one. */
function logicalLines(lines: string[]): LogicalLine[] {
  const out: LogicalLine[] = [];

  for (let i = 0; i < lines.length; ) {
    const starts: { at: number; line: number }[] = [];
    let text = '';

    for (;;) {
      const raw = lines[i];
      starts.push({ at: text.length, line: i });
      const continues = /\\\s*$/.test(raw);
      text += continues ? raw.replace(/\\\s*$/, '') : raw;
      i++;
      if (!continues || i >= lines.length) {
        break;
      }
    }

    out.push({ text, starts });
  }

  return out;
}

/** A `#` starts a comment at the start of a line or after whitespace, as pip reads it. */
function stripComment(text: string): string {
  const at = text.search(/(^|\s)#/);
  return at === -1 ? text : text.slice(0, at);
}

function lineAt(logical: LogicalLine, offset: number): number {
  let line = logical.starts[0].line;
  for (const start of logical.starts) {
    if (start.at <= offset) {
      line = start.line;
    }
  }
  return line;
}

/**
 * Extracts pinned requirements from a pip requirements file. Options (`-r`,
 * `-e`, `--index-url`) and unconstrained requirements are skipped - neither
 * gives a version to measure an update from.
 */
export function parseRequirementsTxt(text: string): DependencyRef[] {
  const deps: DependencyRef[] = [];

  for (const logical of logicalLines(text.split(/\r?\n/))) {
    // Hash options belong to pip, not to the PEP 508 version specifier.
    const code = stripComment(logical.text).replace(/\s+--hash(?:=|\s+)\S+/g, (option) => ' '.repeat(option.length));
    if (code.trim() === '' || code.trim().startsWith('-')) {
      continue;
    }

    const requirement = parseRequirement(code);
    if (!requirement) {
      continue;
    }

    const normalized = normalizePythonSpec(requirement.name, requirement.spec);
    if (normalized) {
      deps.push({
        name: normalized.name,
        spec: normalized.spec,
        line: lineAt(logical, requirement.specOffset),
        section: 'requirements',
      });
    }
  }

  return requirementsSource(text, deps);
}
