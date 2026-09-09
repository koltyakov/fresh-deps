import { isMap, isScalar, isSeq } from 'yaml';
import * as semver from 'semver';
import { numericScheme } from '../numericVersion';
import type { DependencyRef } from '../types';
import { vcpkgVersion } from '../vcpkg';
import { yamlDocument, yamlString } from './yaml';
const conanScheme = numericScheme(false);

export function parseVcpkg(text: string, options?: { allowConfiguration: boolean; baseline: string }): DependencyRef[] {
  try { JSON.parse(text); } catch { return []; }
  const doc = yamlDocument(text);
  if (!doc || doc.root.has('vcpkg-configuration') && !options?.allowConfiguration) return [];
  const source = options?.baseline ?? yamlString(doc.root.get('builtin-baseline', true));
  if (!source || !/^[a-f0-9]{40}$/.test(source)) return [];
  const deps: DependencyRef[] = [];
  const overrides = new Set<string>();
  for (const section of ['overrides', 'dependencies', 'features']) {
    const node = doc.root.get(section, true);
    const lists = section === 'features' && isMap(node)
      ? node.items.flatMap((pair) => isMap(pair.value) ? [pair.value.get('dependencies', true)] : []) : [node];
    for (const entries of lists) {
      if (!isSeq(entries)) continue;
      for (const entry of entries.items) {
        const bare = yamlString(entry);
        if (bare && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bare) && !overrides.has(bare)) {
          deps.push({ name: bare, spec: '@baseline', source, line: doc.line(entry), section });
          continue;
        }
        if (!isMap(entry)) continue;
        const name = yamlString(entry.get('name', true));
        if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) continue;
        if (section === 'overrides') overrides.add(name);
        else if (overrides.has(name)) continue;
        const keys = section === 'overrides' ? ['version', 'version-semver', 'version-date', 'version-string'].filter((key) => entry.has(key)) : ['version>='];
        if (keys.length !== 1 || keys[0] === 'version-string') continue;
        const versionNode = entry.get(keys[0], true);
        let version = yamlString(versionNode);
        if (!version) {
          if (section !== 'overrides') deps.push({ name, spec: '@baseline', source, line: doc.line(entry), section });
          continue;
        }
        if (section === 'overrides' && entry.has('port-version')) {
          const revision = entry.get('port-version', true);
          if (!isScalar(revision) || !Number.isSafeInteger(revision.value) || Number(revision.value) < 0 || version.includes('#')) continue;
          if (revision.value !== 0) version += `#${revision.value}`;
        }
        const parsed = vcpkgVersion(version);
        if (!parsed) continue;
        const field = section === 'overrides' ? keys[0] as DependencyRef['vcpkgVersionField'] : undefined;
        if (field === 'version' && !conanScheme.isVersion(parsed.version)) continue;
        if (field === 'version-semver' && !semver.valid(parsed.version)) continue;
        if (field === 'version-date' && parsed.kind !== 'date') continue;
        deps.push({ name, spec: section === 'overrides' ? version : `>=${version}`, specRaw: version,
          source, section, ...(field ? { vcpkgVersionField: field } : {}), line: doc.line(versionNode) });
      }
    }
  }
  return deps;
}
