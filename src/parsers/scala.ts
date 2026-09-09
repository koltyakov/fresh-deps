import { mavenScheme } from '../schemes';
import type { DependencyRef } from '../types';
import { codeTokens, groupEnd } from './codeTokens';

export function parseSbt(text: string, options: { scalaBinaryVersion?: string; sbtBinaryVersion?: string; platformSuffix?: string } = {}): DependencyRef[] {
  const tokens = codeTokens(text);
  const deps: DependencyRef[] = [];
  const inferred = new Set<string>();
  const crossVersions = new Set<string>();
  const binaryOf = (version: string) => { const match = /^(\d+)\.(\d+)\.\d+$/.exec(version); return match ? match[1] === '3' ? '3' : `${match[1]}.${match[2]}` : undefined; };
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'word' || tokens[i + 1]?.value !== ':' || tokens[i + 2]?.value !== '=') continue;
    if (tokens[i].value === 'scalaVersion' && tokens[i + 3]?.kind === 'string') {
      const value = binaryOf(tokens[i + 3].value); if (value) inferred.add(value);
    }
    if (tokens[i].value === 'crossScalaVersions' && ['Seq', 'List'].includes(tokens[i + 3]?.value) && tokens[i + 4]?.value === '(') {
      const end = groupEnd(tokens, i + 4);
      const items = end >= 0 ? tokens.slice(i + 5, end) : [];
      if (items.every((item) => item.value === ',' || item.kind === 'string' && binaryOf(item.value))) {
        for (const item of items) if (item.kind === 'string') crossVersions.add(binaryOf(item.value)!);
      }
    }
  }
  const binary = options.scalaBinaryVersion || (inferred.size === 1 ? [...inferred][0] : undefined);
  for (let i = 0; i + 4 < tokens.length; i++) {
    let count = 0;
    while (tokens[i + 1 + count]?.value === '%') count++;
    const cross = count === 2 || count === 3;
    if (count !== 1 && !cross) continue;
    const width = count + 4;
    const [group, first] = tokens.slice(i, i + 2);
    const [artifact, second, version] = tokens.slice(i + count + 1, i + width);
    if (!artifact || !second || !version) continue;
    if (group.kind !== 'string' || artifact.kind !== 'string' || version.kind !== 'string'
      || first.value !== '%' || second.value !== '%') continue;
    if (!/^[\w.-]+$/.test(group.value) || !/^[\w.-]+$/.test(artifact.value) || !mavenScheme.isPinned(version.value)) continue;
    if (/[+$]/.test(version.value) || /^latest\./i.test(version.value)) continue;
    // Interpolated strings, concatenation and cross-version modifiers need evaluation.
    if (tokens[i - 1]?.kind === 'word' && tokens[i - 1].end === group.start) continue;
    const next = tokens[i + width];
    if (next && (['+', '.', 'cross'].includes(next.value) || next.start === version.end && next.kind === 'word')) continue;
    const plugin = tokens[i - 2]?.value === 'addSbtPlugin' && tokens[i - 1]?.value === '(';
    let artifactId = artifact.value;
    let variants: string[] | undefined;
    if (cross) {
      const binaries = !options.scalaBinaryVersion && crossVersions.size ? [...crossVersions] : binary ? [binary] : [];
      if (!binaries.length || binaries.some((value) => !/^\d+(?:\.\d+)?$/.test(value))) continue;
      if (count === 3 && !/^(?:sjs\d+|native\d+(?:\.\d+)?)$/.test(options.platformSuffix ?? '')) continue;
      const suffix = count === 3 ? `${options.platformSuffix}_` : '';
      variants = binaries.map((value) => `${group.value}:${artifact.value}_${suffix}${value}`);
      artifactId += `_${suffix}${binaries[0]}`;
    }
    if (plugin) {
      if (!/^\d+(?:\.\d+)?$/.test(options.scalaBinaryVersion ?? '') || !/^\d+\.\d+$/.test(options.sbtBinaryVersion ?? '')) continue;
      artifactId += `_${options.scalaBinaryVersion}_${options.sbtBinaryVersion}`;
    }
    deps.push({ name: `${group.value}:${artifactId}`, spec: version.value, line: version.line, section: plugin ? 'plugins' : 'libraryDependencies', ...(variants && variants.length > 1 ? { variants } : {}) });
    i += width - 1;
  }
  return deps;
}
