import { mavenScheme } from '../schemes';
import type { DependencyRef } from '../types';
import { codeTokens } from './codeTokens';

export function parseSbt(text: string, options: { scalaBinaryVersion?: string; sbtBinaryVersion?: string } = {}): DependencyRef[] {
  const tokens = codeTokens(text);
  const deps: DependencyRef[] = [];
  for (let i = 0; i + 4 < tokens.length; i++) {
    const [group, first, artifact, second, version] = tokens.slice(i, i + 5);
    if (group.kind !== 'string' || artifact.kind !== 'string' || version.kind !== 'string'
      || first.value !== '%' || second.value !== '%') continue;
    if (!/^[\w.-]+$/.test(group.value) || !/^[\w.-]+$/.test(artifact.value) || !mavenScheme.isPinned(version.value)) continue;
    if (/[+$]/.test(version.value) || /^latest\./i.test(version.value)) continue;
    // Interpolated strings, concatenation and cross-version modifiers need evaluation.
    if (tokens[i - 1]?.kind === 'word' && tokens[i - 1].end === group.start) continue;
    const next = tokens[i + 5];
    if (next && (['+', '.', 'cross'].includes(next.value) || next.start === version.end && next.kind === 'word')) continue;
    const plugin = tokens[i - 2]?.value === 'addSbtPlugin' && tokens[i - 1]?.value === '(';
    let artifactId = artifact.value;
    if (plugin) {
      if (!/^\d+(?:\.\d+)?$/.test(options.scalaBinaryVersion ?? '') || !/^\d+\.\d+$/.test(options.sbtBinaryVersion ?? '')) continue;
      artifactId += `_${options.scalaBinaryVersion}_${options.sbtBinaryVersion}`;
    }
    deps.push({ name: `${group.value}:${artifactId}`, spec: version.value, line: version.line, section: plugin ? 'plugins' : 'libraryDependencies' });
    i += 4;
  }
  return deps;
}
