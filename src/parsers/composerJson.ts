import { composerScheme } from '../schemes';
import { parseJsonDependencies } from './packageJson';
import type { DependencyRef } from '../types';

export function parseComposerJson(text: string): DependencyRef[] {
  // Custom repositories may shadow public names; do not report Packagist releases for them.
  try {
    const doc = JSON.parse(text);
    if (doc.repositories && Object.keys(doc.repositories).length > 0) return [];
  } catch {
    return [];
  }
  return parseJsonDependencies(text, ['require', 'require-dev'], (name, spec) => {
    if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(name) || !composerScheme.baseline(spec)) return undefined;
    return { name: name.toLowerCase(), spec };
  });
}
