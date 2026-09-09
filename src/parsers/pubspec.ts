import { isMap } from 'yaml';
import { dartScheme } from '../schemes';
import type { DependencyRef } from '../types';
import { yamlDocument, yamlString } from './yaml';
import { repositoryUrl } from './helm';

export function parsePubspec(text: string, defaultHost = 'https://pub.dev'): DependencyRef[] {
  const doc = yamlDocument(text);
  if (!doc) return [];
  const deps: DependencyRef[] = [];
  const overrides = doc.root.get('dependency_overrides', true);
  const overridden = new Set(isMap(overrides) ? overrides.items.map((pair) => yamlString(pair.key)) : []);
  for (const section of ['dependencies', 'dev_dependencies', 'dependency_overrides']) {
    const entries = doc.root.get(section, true);
    if (!isMap(entries)) continue;
    for (const pair of entries.items) {
      const name = yamlString(pair.key);
      if (section !== 'dependency_overrides' && overridden.has(name)) continue;
      let value = pair.value;
      let host = defaultHost;
      if (isMap(value)) {
        if (value.has('git') || value.has('path') || value.has('sdk')) continue;
        const hosted = value.get('hosted', true);
        if (hosted !== undefined) {
          const url = isMap(hosted) ? yamlString(hosted.get('url', true)) : yamlString(hosted);
          const hostedName = isMap(hosted) ? yamlString(hosted.get('name', true)) : undefined;
          if (!url || !repositoryUrl(url) || (hostedName && hostedName !== name)) continue;
          host = url;
        }
        value = value.get('version', true);
      }
      const spec = yamlString(value);
      if (!repositoryUrl(host) || !name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) || !spec || !dartScheme.baseline(spec)) continue;
      deps.push({ name, spec, line: doc.line(value), section, ...(host.replace(/\/+$/, '') !== 'https://pub.dev' ? { source: repositoryUrl(host) } : {}) });
    }
  }
  return deps;
}
