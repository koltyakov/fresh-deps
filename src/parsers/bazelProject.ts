import { dirname, resolve, sep } from 'path';
import { parseBazel } from './bazel';
import { readProjectFile } from '../projectFiles';
import type { DependencyRef } from '../types';

export function parseBazelProject(text: string, fsPath: string): DependencyRef[] {
  const root = dirname(resolve(fsPath));
  const active = new Set<string>();
  const lines: string[] = [];
  const anchors: number[] = [];
  const expand = (body: string, filename: string, anchor?: number): boolean => {
    if (active.has(filename) || active.size >= 20) return false;
    active.add(filename);
    for (const [line, value] of body.split(/\r?\n/).entries()) {
      const include = /^\s*include\(\s*["']\/\/([^"']*)["']\s*\)\s*(?:#.*)?$/.exec(value);
      if (include) {
        const path = resolve(root, include[1].replace(/^:/, '').replace(':', '/'));
        if (!path.startsWith(root + sep)) return false;
        const content = readProjectFile(path);
        if (content === undefined || !expand(content, path, anchor ?? line)) return false;
      } else { lines.push(value); anchors.push(anchor ?? line); }
    }
    active.delete(filename);
    return true;
  };
  return expand(text, resolve(fsPath)) ? parseBazel(lines.join('\n')).map((dep) => ({ ...dep, line: anchors[dep.line] })) : [];
}
