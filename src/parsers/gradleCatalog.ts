import type { DependencyRef } from '../types';
import { scanToml, type TomlValue } from './toml';
import { mavenScheme } from '../schemes';
import { gradleConstraint } from '../gradle';

function field(value: TomlValue, key: string): TomlValue | undefined {
  return value.kind === 'table' ? value.entries.find((entry) => entry.path.join('.') === key)?.value : undefined;
}

function string(value: TomlValue | undefined): string | undefined {
  return value?.kind === 'string' ? value.text : undefined;
}

export function parseGradleCatalog(text: string): DependencyRef[] {
  const entries = scanToml(text);
  const versions = new Map(entries.filter((entry) => entry.path.length === 2 && entry.path[0] === 'versions')
    .map((entry) => [entry.path[1], entry.value]));
  const deps: DependencyRef[] = [];
  for (const entry of entries) {
    const [section, alias] = entry.path;
    if (entry.path.length !== 2 || !['libraries', 'plugins'].includes(section)) continue;
    let name: string | undefined;
    let version: TomlValue | undefined;
    if (entry.value.kind === 'string' && section === 'libraries') {
      const parts = entry.value.text.split(':');
      if (parts.length !== 3) continue;
      name = parts.slice(0, 2).join(':');
      version = { kind: 'string', text: parts[2], line: entry.value.line };
    } else if (entry.value.kind === 'table') {
      if (section === 'plugins') {
        const id = string(field(entry.value, 'id'));
        if (id) name = `${id}:${id}.gradle.plugin`;
      } else {
        const group = string(field(entry.value, 'group'));
        const artifact = string(field(entry.value, 'name'));
        name = string(field(entry.value, 'module')) ?? (group && artifact ? `${group}:${artifact}` : undefined);
      }
      version = field(entry.value, 'version');
      const ref = string(field(entry.value, 'version.ref')) ?? (version ? string(field(version, 'ref')) : undefined);
      if (ref) version = versions.get(ref);
    }
    let spec = string(version);
    let versionScheme: DependencyRef['versionScheme'];
    if (version?.kind === 'table') {
      if (field(version, 'rejectAll')) continue;
      const required = string(field(version, 'require'));
      const strictly = string(field(version, 'strictly'));
      const prefer = string(field(version, 'prefer'));
      const rejected = field(version, 'reject');
      const rejects = rejected?.kind === 'array' ? rejected.items.flatMap((item) => item.kind === 'string' ? [item.text] : []) : [];
      if ([required, strictly, prefer, ...rejects].some((value) => value && (/[+$*]/.test(value) || /^latest\./.test(value)))) continue;
      if (![required, strictly, prefer].some(Boolean)) continue;
      spec = strictly ?? required ?? prefer;
      versionScheme = gradleConstraint(required, strictly, prefer, rejects);
      if (!versionScheme.baseline(spec!)) continue;
    }
    // Rich and dynamic Gradle constraints need Gradle-specific resolution, not Maven interval matching.
    if (!name || !/^[\w.-]+:[\w.-]+$/.test(name) || !spec || (!versionScheme && (!/^\d[\w.-]*$/.test(spec) || !mavenScheme.baseline(spec)))) continue;
    deps.push({ name, spec, alias, line: entry.line, section, ...(versionScheme ? { versionScheme } : {}) });
  }
  return deps;
}
