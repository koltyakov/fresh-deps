import { cargoRange } from '../schemes';
import type { DependencyRef } from '../types';
import { scanToml, type TomlEntry, type TomlValue } from './toml';

const DEPENDENCY_TABLES = new Set(['dependencies', 'dev-dependencies', 'build-dependencies']);

interface DependencyLocation {
  prefixLength: number;
  section: string;
}

/** Extracts registry-backed dependencies from Cargo's standard dependency tables. */
export function parseCargoToml(text: string): DependencyRef[] {
  const entries = scanToml(text);
  const deps: DependencyRef[] = [];

  for (const entry of entries) {
    const location = dependencyLocation(entry.path);
    if (!location) {
      continue;
    }

    const tail = entry.path.slice(location.prefixLength);
    if (tail.length === 1) {
      const dep = dependencyOf(tail[0], entry.value, entry.line, location.section);
      if (dep) {
        deps.push(dep);
      }
      continue;
    }

    // Cargo also accepts the expanded `[dependencies.name]` table form.
    if (tail.length === 2 && tail[1] === 'version' && entry.value.kind === 'string') {
      const siblings = entries.filter(
        (candidate) =>
          candidate.path.length === entry.path.length &&
          candidate.path.slice(0, -1).every((part, index) => part === entry.path[index]),
      );
      const value: TomlValue = { kind: 'table', entries: siblings.map(stripFieldPrefix), line: entry.line };
      const dep = dependencyOf(tail[0], value, entry.line, location.section);
      if (dep) {
        deps.push(dep);
      }
    }
  }

  return deps;
}

function dependencyLocation(path: string[]): DependencyLocation | undefined {
  if (DEPENDENCY_TABLES.has(path[0])) {
    return { prefixLength: 1, section: path[0] };
  }
  if (path[0] === 'workspace' && path[1] === 'dependencies') {
    return { prefixLength: 2, section: 'workspace.dependencies' };
  }
  if (path[0] === 'target' && DEPENDENCY_TABLES.has(path[2])) {
    return { prefixLength: 3, section: path.slice(0, 3).join('.') };
  }
  return undefined;
}

function stripFieldPrefix(entry: TomlEntry): TomlEntry {
  return { ...entry, path: [entry.path[entry.path.length - 1]] };
}

function dependencyOf(key: string, value: TomlValue, line: number, section: string): DependencyRef | undefined {
  let name = key;
  let version: string | undefined;

  if (value.kind === 'string') {
    version = value.text;
  } else if (value.kind === 'table') {
    const fields = new Map(value.entries.filter((entry) => entry.path.length === 1).map((entry) => [entry.path[0], entry.value]));
    // These sources do not resolve through crates.io. `workspace = true` has no
    // local requirement to measure, and therefore naturally has no version field.
    if (fields.has('path') || fields.has('git') || fields.has('registry')) {
      return undefined;
    }
    const versionValue = fields.get('version');
    if (versionValue?.kind !== 'string') {
      return undefined;
    }
    version = versionValue.text;
    const packageValue = fields.get('package');
    if (packageValue?.kind === 'string') {
      name = packageValue.text;
    }
  }

  const spec = version?.trim();
  if (!spec || !cargoRange(spec) || !/^[A-Za-z0-9_-]+$/.test(name)) {
    return undefined;
  }
  return {
    name,
    spec,
    line,
    section,
    ...(name !== key ? { alias: key } : {}),
  };
}
