import { dirname, join } from 'path';
import { homedir } from 'os';
import { parentFiles, readProjectFile } from './projectFiles';
import { parseCargoToml } from './parsers/cargoToml';
import { scanToml } from './parsers/toml';
import { tomlField } from './parsers/pythonSources';
import type { DependencyRef } from './types';
import { isMap } from 'yaml';
import { yamlDocument, yamlString } from './parsers/yaml';

export function dartProject(fsPath: string, deps: DependencyRef[]): DependencyRef[] {
  if (!fsPath.endsWith('/pubspec.yaml') && !fsPath.endsWith('\\pubspec.yaml')) return deps;
  const text = readProjectFile(join(dirname(fsPath), 'pubspec_overrides.yaml'));
  if (text === undefined) return deps;
  const doc = yamlDocument(text);
  const overrides = doc?.root.get('dependency_overrides', true);
  if (!doc) return deps.map((dep) => ({ ...dep, skipReason: 'Invalid pubspec_overrides.yaml' }));
  const names = new Set(isMap(overrides) ? overrides.items.map((entry) => yamlString(entry.key)) : []);
  return deps.map((dep) => names.has(dep.name) ? { ...dep, skipReason: 'Dependency is overridden in pubspec_overrides.yaml' } : dep);
}

export function cargoProject(fsPath: string, text: string, deps: DependencyRef[]): DependencyRef[] {
  const config = new Map<string, string>();
  const files = [join(process.env.CARGO_HOME || join(homedir(), '.cargo'), 'config.toml'),
    ...parentFiles(fsPath, '.cargo/config.toml').reverse()];
  for (const file of files) for (const entry of scanToml(readProjectFile(file.replace(/\.toml$/, '')) ?? readProjectFile(file) ?? '')) {
    if (entry.value.kind === 'string') config.set(entry.path.join('.'), entry.value.text);
  }
  const workspace = parentFiles(fsPath, 'Cargo.toml').find((file) => file !== fsPath && /\[workspace(?:\]|\.)/.test(readProjectFile(file) ?? ''));
  const rootDeps = workspace ? parseCargoToml(readProjectFile(workspace) ?? '').filter((dep) => dep.section === 'workspace.dependencies') : [];
  for (const entry of scanToml(text)) {
    const at = entry.path.findIndex((part) => ['dependencies', 'dev-dependencies', 'build-dependencies'].includes(part));
    if (at < 0 || entry.path[0] === 'workspace') continue;
    const name = entry.path[at + 1];
    const inline = entry.path.length === at + 2 && tomlField(entry.value, 'workspace');
    const expanded = entry.path.length === at + 3 && entry.path[at + 2] === 'workspace';
    if (!name || !inline && !expanded) continue;
    const inherited = rootDeps.find((dep) => (dep.alias ?? dep.name) === name);
    if (inherited) deps.push({ ...inherited, line: entry.line, section: `${entry.path[0]} (workspace)` });
    else deps.push({ name, spec: '', line: entry.line, section: entry.path[at], skipReason: 'Workspace dependency could not be resolved' });
  }
  return deps.map((dep) => {
    const registry = dep.source?.startsWith('cargo:') ? dep.source.slice(6) : undefined;
    let name = registry ?? 'crates-io';
    const visited = new Set<string>();
    while (config.has(`source.${name}.replace-with`) && !visited.has(name)) { visited.add(name); name = config.get(`source.${name}.replace-with`)!; }
    const env = registry && process.env[`CARGO_REGISTRIES_${registry.toUpperCase().replace(/-/g, '_')}_INDEX`];
    const source = env || config.get(`registries.${name}.index`) || config.get(`source.${name}.registry`);
    if (source?.startsWith('sparse+https://')) return { ...dep, source };
    if (registry || name !== 'crates-io' || source) return { ...dep, skipReason: 'Cargo source is not a configured HTTPS sparse registry' };
    return dep;
  });
}

function xmlAttributes(text: string): Map<string, string> {
  return new Map([...text.matchAll(/([\w.-]+)\s*=\s*["']([^"']*)["']/g)].map((match) => [match[1].toLowerCase(), match[2].replace(/&amp;/g, '&')]));
}

export function nugetProject(fsPath: string, deps: DependencyRef[]): DependencyRef[] {
  const files = parentFiles(fsPath, 'NuGet.Config').flatMap((file) => [file, join(dirname(file), 'nuget.config')]).reverse();
  const sources = new Map<string, string>();
  const mappings = new Map<string, string[]>();
  const disabled = new Map<string, boolean>();
  let configuredSources = false;
  for (const file of files) {
    const text = readProjectFile(file)?.replace(/<!--[\s\S]*?-->/g, '');
    if (!text) continue;
    const section = /<packageSources>([\s\S]*?)<\/packageSources>/i.exec(text)?.[1];
    if (section !== undefined) configuredSources = true;
    if (section) for (const match of section.matchAll(/<(clear|add|remove)\b([^>]*)\/>/gi)) {
      const attrs = xmlAttributes(match[2]);
      if (match[1].toLowerCase() === 'clear') sources.clear();
      else if (attrs.has('key')) {
        if (match[1].toLowerCase() === 'remove') sources.delete(attrs.get('key')!);
        else if (attrs.has('value')) sources.set(attrs.get('key')!, attrs.get('value')!);
      }
    }
    const mapping = /<packageSourceMapping>([\s\S]*?)<\/packageSourceMapping>/i.exec(text)?.[1];
    const disabledSection = /<disabledPackageSources>([\s\S]*?)<\/disabledPackageSources>/i.exec(text)?.[1];
    if (disabledSection) {
      if (/<clear\s*\/>/i.test(disabledSection)) disabled.clear();
      for (const match of disabledSection.matchAll(/<add\b([^>]*)\/>/gi)) {
        const attrs = xmlAttributes(match[1]); if (attrs.has('key')) disabled.set(attrs.get('key')!, attrs.get('value')?.toLowerCase() === 'true');
      }
    }
    if (mapping && /<clear\s*\/>/i.test(mapping)) mappings.clear();
    if (mapping) for (const match of mapping.matchAll(/<packageSource\b([^>]*)>([\s\S]*?)<\/packageSource>/gi)) {
      const key = xmlAttributes(match[1]).get('key');
      if (key) mappings.set(key, [...match[2].matchAll(/<package\b([^>]*)\/>/gi)].flatMap((entry) => xmlAttributes(entry[1]).get('pattern') ?? []));
    }
  }
  if (!configuredSources && !mappings.size) return deps;
  return deps.map((dep) => {
    if (dep.section === 'sdk') return dep;
    let selected = [...sources].filter(([name]) => !disabled.get(name));
    if (mappings.size) {
      const matches = [...mappings].flatMap(([key, patterns]) => patterns.filter((pattern) => pattern.endsWith('*')
        ? dep.name.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase()) : dep.name.toLowerCase() === pattern.toLowerCase())
        .map((pattern) => ({ key, rank: pattern.endsWith('*') ? pattern.length : Number.MAX_SAFE_INTEGER })));
      const rank = Math.max(...matches.map((match) => match.rank));
      selected = selected.filter(([key]) => matches.some((match) => match.key === key && match.rank === rank));
    }
    if (!selected.length || selected.some(([, url]) => {
      if (!/^https:\/\/[^\s$]+\/.*index\.json(?:\?.*)?$/.test(url)) return true;
      try { const parsed = new URL(url); return !!parsed.username || !!parsed.password; } catch { return true; }
    })) return { ...dep, skipReason: 'No supported NuGet V3 source matches this package' };
    return { ...dep, source: selected.map(([, url]) => url).join('|') };
  });
}
