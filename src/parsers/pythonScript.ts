import type { DependencyRef } from '../types';
import { parsePyProject } from './pyproject';

/** PEP 723 metadata is declarative TOML; Python code is never evaluated. */
export function parsePythonScript(text: string): DependencyRef[] {
  const blocks = [...text.matchAll(/^# \/\/\/ script\r?\n((?:#(?: [^\r\n]*)?\r?\n)+?)# \/\/\/(?:\r?$)/gm)];
  if (blocks.length !== 1) return [];
  const block = blocks[0];
  const startLine = text.slice(0, block.index).split('\n').length - 1;
  const body = block[1].replace(/^# ?/gm, '');
  return parsePyProject(`[project]\n${body}`, { includeBuildRequires: false }).map((dep) => ({
    ...dep, line: dep.line + startLine, section: 'script.dependencies',
  }));
}
