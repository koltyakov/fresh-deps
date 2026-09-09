import { isMap, isSeq } from 'yaml';
import { semverScheme } from '../schemes';
import type { DependencyRef } from '../types';
import { yamlDocument, yamlString } from './yaml';

export function repositoryUrl(value: string): string | undefined {
  if (/[\s${}<>]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return undefined;
    return url.href.replace(/\/$/, '');
  } catch { return undefined; }
}

export function parseHelm(text: string): DependencyRef[] {
  const doc = yamlDocument(text);
  const entries = doc?.root.get('dependencies', true);
  if (!doc || !isSeq(entries)) return [];
  return entries.items.flatMap((entry) => {
    if (!isMap(entry)) return [];
    const name = yamlString(entry.get('name', true));
    const node = entry.get('version', true);
    const spec = yamlString(node);
    const source = repositoryUrl(yamlString(entry.get('repository', true)) ?? '');
    const alias = yamlString(entry.get('alias', true));
    return name && /^[\w.-]+$/.test(name) && spec && semverScheme.baseline(spec) && source
      ? [{ name, spec, source, line: doc.line(node), section: 'dependencies', ...(alias ? { alias } : {}) }] : [];
  });
}
