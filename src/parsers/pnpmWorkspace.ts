import { isMap } from 'yaml';
import type { DependencyRef } from '../types';
import { normalizeNpmSpec } from '../versions';
import { yamlDocument, yamlString } from './yaml';

export function parsePnpmWorkspace(text: string): DependencyRef[] {
  const doc = yamlDocument(text);
  if (!doc) return [];
  const deps: DependencyRef[] = [];
  const read = (entries: unknown, section: string) => {
    if (!isMap(entries)) return;
    for (const pair of entries.items) {
      const name = yamlString(pair.key);
      const spec = yamlString(pair.value);
      const normalized = name && spec ? normalizeNpmSpec(name, spec) : undefined;
      if (normalized) deps.push({ ...normalized, line: doc.line(pair.value), section });
    }
  };
  read(doc.root.get('catalog', true), 'catalog');
  const catalogs = doc.root.get('catalogs', true);
  if (isMap(catalogs)) {
    for (const pair of catalogs.items) {
      const name = yamlString(pair.key);
      if (name) read(pair.value, `catalogs.${name}`);
    }
  }
  return deps;
}
