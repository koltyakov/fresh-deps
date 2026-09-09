import { isMap, isSeq, LineCounter, parseDocument } from 'yaml';
import { ansibleScheme, semverScheme } from '../schemes';
import type { DependencyRef } from '../types';
import { yamlString } from './yaml';

export function parseAnsible(text: string): DependencyRef[] {
  const counter = new LineCounter();
  const doc = parseDocument(text, { lineCounter: counter, uniqueKeys: true });
  if (doc.errors.length) return [];
  const root = doc.contents;
  const sections = isSeq(root) ? [['roles', root] as const] : isMap(root)
    ? [['collections', root.get('collections', true)], ['roles', root.get('roles', true)]] as const : [];
  const deps: DependencyRef[] = [];
  for (const [section, entries] of sections) {
    if (!isSeq(entries)) continue;
    for (const entry of entries.items) {
      if (!isMap(entry) || entry.has('scm') || entry.has('include') || entry.has('<<')) continue;
      const name = yamlString(entry.get(section === 'roles' && entry.has('src') ? 'src' : 'name', true));
      const node = entry.get('version', true);
      const spec = yamlString(node);
      if (!name || !/^[A-Za-z0-9_][A-Za-z0-9_-]*\.[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(name) || !spec) continue;
      if (section === 'collections') {
        const source = entry.get('source', true);
        if (source !== undefined && !/^https:\/\/galaxy\.ansible\.com\/?$/.test(yamlString(source) ?? '')) continue;
        const type = entry.get('type', true);
        if (type !== undefined && yamlString(type) !== 'galaxy') continue;
        if (!ansibleScheme.baseline(spec)) continue;
      } else if (!semverScheme.isVersion(spec) || entry.has('source')) continue;
      deps.push({ name, spec, section, ...(section === 'roles' ? { semver: true } : {}),
        line: counter.linePos((node as { range: number[] }).range[0]).line - 1 });
    }
  }
  return deps;
}
