import type { DependencyRef } from '../types';
import { scanToml, type TomlValue } from './toml';

export function tomlField(value: TomlValue, name: string): TomlValue | undefined {
  return value.kind === 'table' ? value.entries.find((entry) => entry.path.join('.') === name)?.value : undefined;
}

export function tomlString(value: TomlValue | undefined): string | undefined {
  return value?.kind === 'string' ? value.text : undefined;
}

function indexUrl(value: string | undefined): string | undefined {
  if (!value || /\$|\s/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href.replace(/\/$/, '') : undefined;
  } catch { return undefined; }
}

/** Read array-table instances separately so names and URLs cannot bleed between indexes. */
function indexes(text: string, table: string): Map<string, string | undefined> {
  const result = new Map<string, string | undefined>();
  const escaped = table.replace(/\./g, '\\.');
  const pattern = new RegExp(`^\\s*\\[\\[${escaped}\\]\\]([^]*?)(?=^\\s*\\[|$(?![^]))`, 'gm');
  for (const match of text.matchAll(pattern)) {
    const fields = new Map(scanToml(match[1]).map((entry) => [entry.path.join('.'), entry.value]));
    const name = tomlString(fields.get('name'));
    if (name) result.set(name, indexUrl(tomlString(fields.get('url'))));
  }
  return result;
}

/** Keep source identity even when the source is unsupported, for the check summary. */
export function pythonSources(text: string, deps: DependencyRef[], kind: 'pyproject' | 'pipfile'): DependencyRef[] {
  const entries = scanToml(text);
  const uv = indexes(text, 'tool.uv.index');
  const poetry = indexes(text, 'tool.poetry.source');
  const pip = indexes(text, 'source');
  const normalize = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');
  return deps.map((dep) => {
    const name = normalize(dep.name);
    const sourceEntry = entries.find((entry) => entry.path.slice(0, 3).join('.') === 'tool.uv.sources'
      && normalize(entry.path[3] ?? '') === name);
    const inline = entries.find((entry) => normalize(entry.path.at(-1) ?? '') === name
      && entry.path.slice(0, -1).join('.') === dep.section)?.value;
    let source: string | undefined;
    let reason: string | undefined;
    if (kind === 'pyproject' && sourceEntry) {
      const value = sourceEntry.value;
      const index = tomlString(tomlField(value, 'index'));
      if (value.kind !== 'table' || tomlField(value, 'marker') || tomlField(value, 'extra') || sourceEntry.path.length !== 4) {
        reason = 'Conditional or computed uv source';
      } else if (index) {
        source = uv.get(index);
        if (!source) reason = `Unresolved uv index: ${index}`;
      } else reason = 'uv dependency uses a workspace, path, Git, or URL source';
    } else if (inline?.kind === 'table' && ['git', 'path', 'url', 'file'].some((key) => tomlField(inline, key))) {
      reason = 'Dependency uses a path, Git, or URL source';
    } else {
      const selected = inline && tomlString(tomlField(inline, kind === 'pipfile' ? 'index' : 'source'));
      const configured = kind === 'pipfile' ? pip : dep.section.startsWith('tool.poetry') ? poetry : uv;
      if (selected) {
        source = configured.get(selected);
        if (!source) reason = `Unresolved package index: ${selected}`;
      } else if (configured.size === 1) {
        // Explicit-only uv/Poetry repositories must not change the default source.
        const explicit = kind === 'pyproject' && (dep.section.startsWith('tool.poetry')
          ? /priority\s*=\s*["']explicit["']/.test(text) : /explicit\s*=\s*true/.test(text));
        const supplemental = kind === 'pyproject' && dep.section.startsWith('tool.poetry') && /priority\s*=\s*["']supplemental["']/.test(text);
        if (supplemental) reason = 'Poetry supplemental index requires package source resolution';
        else if (!explicit) {
          source = [...configured.values()][0];
          if (!source) reason = 'Unsupported package index URL';
        }
      } else if (configured.size > 1) reason = 'Multiple package indexes require an explicit source';
    }
    return { ...dep, ...(source ? { source } : {}), ...(reason ? { skipReason: reason } : {}) };
  });
}

export function requirementsSource(text: string, deps: DependencyRef[]): DependencyRef[] {
  const indexes = [...text.matchAll(/^\s*(?:--index-url|-i)(?:\s+|=)(\S+)/gm)];
  const unsupported = /^\s*(?:--extra-index-url|--find-links|-f|--no-index)\b/m.test(text);
  const source = indexUrl(indexes.at(-1)?.[1]);
  const reason = unsupported ? 'Requirements use additional indexes or local package links'
    : indexes.length && !source ? 'Unsupported requirements index URL' : undefined;
  return deps.map((dep) => ({ ...dep, ...(source ? { source } : {}), ...(reason ? { skipReason: reason } : {}) }));
}
