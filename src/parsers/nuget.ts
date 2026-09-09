import type { DependencyRef } from '../types';
import { parseNugetVersion } from '../nuget';

/** Reads PackageReference, central PackageVersion, and legacy packages.config entries. */
export function parseNugetManifest(text: string): DependencyRef[] {
  const source = text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
  const deps: DependencyRef[] = [];
  const properties = new Map<string, string>();
  const conditional = new Set<string>();
  for (const group of source.matchAll(/<PropertyGroup\b([^>]*)>([\s\S]*?)<\/PropertyGroup\s*>/gi)) {
    for (const property of group[2].matchAll(/<([\w.-]+)\b([^>]*)>([^<]*)<\/\1\s*>/g)) {
      const name = property[1].toLowerCase();
      if (/\bCondition\s*=/i.test(group[1] + property[2])) conditional.add(name);
      else properties.set(name, property[3].trim());
    }
  }
  for (const name of conditional) properties.delete(name);
  const resolve = (raw: string | undefined): string | undefined => {
    if (!raw) return raw;
    for (let i = 0; i < 10 && raw.includes('$('); i++) raw = raw.replace(/\$\(([^)]+)\)/g, (whole, key: string) => properties.get(key.toLowerCase()) ?? whole);
    return raw;
  };
  const msbuild = /<(PackageReference|PackageVersion)\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/\1\s*>)/gi;

  for (const match of source.matchAll(msbuild)) {
    const attrs = attributes(match[2]);
    const name = attrs.get('include') ?? attrs.get('update');
    const nestedVersion = match[3]?.match(/<Version\b[^>]*>([^<]+)<\/Version\s*>/i)?.[1];
    const spec = resolve(attrs.get('versionoverride') ?? attrs.get('version') ?? nestedVersion);
    add(deps, source, match.index, name, spec, match[1]);
  }

  if (/<packages\b/i.test(source)) {
    const legacy = /<package\b([^>]*?)(?:\/\s*>|>)/gi;
    for (const match of source.matchAll(legacy)) {
      const attrs = attributes(match[1]);
      add(deps, source, match.index, attrs.get('id'), attrs.get('version'), 'packages');
    }
  }
  return deps;
}

function add(
  deps: DependencyRef[],
  text: string,
  offset: number,
  rawName: string | undefined,
  rawSpec: string | undefined,
  section: string,
): void {
  const name = rawName ? decodeXml(rawName).trim() : '';
  const spec = rawSpec ? decodeXml(rawSpec).trim() : '';
  if (!name || !spec || /\$\(|%\(|^\*$/.test(spec)) {
    return;
  }
  // packages.config records an installed version, not PackageReference's minimum.
  const installed = section === 'packages' && parseNugetVersion(spec);
  deps.push({
    name, spec: installed ? `[${spec}]` : spec,
    ...(installed ? { specRaw: spec } : {}),
    section, line: text.slice(0, offset).split('\n').length - 1,
  });
}

function attributes(source: string): Map<string, string> {
  const values = new Map<string, string>();
  const pattern = /([\w:.-]+)\s*=\s*(["'])(.*?)\2/gs;
  for (const match of source.matchAll(pattern)) {
    values.set(match[1].toLowerCase(), match[3]);
  }
  return values;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}
