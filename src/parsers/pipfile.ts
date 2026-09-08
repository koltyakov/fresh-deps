import type { DependencyRef } from '../types';
import { normalizePythonSpec } from '../versions';
import { scanToml, versionOf } from './toml';

const SECTIONS = ['packages', 'dev-packages'];

/**
 * Reads `[packages]` and `[dev-packages]` from a Pipfile. Entries pointing at a
 * VCS or a path carry no `version`, so they fall away on their own.
 */
export function parsePipfile(text: string): DependencyRef[] {
  const deps: DependencyRef[] = [];

  for (const entry of scanToml(text)) {
    const [section, name] = entry.path;
    if (entry.path.length !== 2 || !SECTIONS.includes(section)) {
      continue;
    }

    const declared = versionOf(entry.value);
    const normalized = declared && normalizePythonSpec(name, declared.text);
    if (declared && normalized) {
      deps.push({ name: normalized.name, spec: normalized.spec, line: declared.line, section });
    }
  }

  return deps;
}
