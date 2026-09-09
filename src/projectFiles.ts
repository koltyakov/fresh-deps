import { readFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';

/** Bounded reads for declarative project files. Missing or malformed files are optional. */
export function readProjectFile(filename: string): string | undefined {
  try {
    if (statSync(filename).size > 4 * 1024 * 1024) return undefined;
    return readFileSync(filename, 'utf8');
  } catch { return undefined; }
}

export function parentFiles(filename: string, name: string): string[] {
  const files: string[] = [];
  let dir = dirname(resolve(filename));
  for (let depth = 0; depth < 20; depth++) {
    files.push(join(dir, name));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return files;
}

export function jsonc(text: string): unknown {
  const clean = text.replace(/"(?:\\[\s\S]|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (match) => match.startsWith('"') ? match : match.replace(/[^\n]/g, ' '));
  return JSON.parse(clean.replace(/"(?:\\[\s\S]|[^"\\])*"|,\s*(?=[}\]])/g, (match) => match.startsWith('"') ? match : ''));
}

const importMapCache = new Map<string, { expires: number; result: boolean }>();

export function clearManifestCache(): void {
  importMapCache.clear();
}

export function isReferencedImportMap(filename: string): boolean {
  const key = resolve(filename);
  const cached = importMapCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  const result = referencedImportMap(key);
  if (importMapCache.size >= 256) importMapCache.delete(importMapCache.keys().next().value!);
  importMapCache.set(key, { result, expires: Date.now() + 5000 });
  return result;
}

function referencedImportMap(filename: string): boolean {
  for (const file of parentFiles(filename, 'deno.json').flatMap((file) => [file, `${file}c`])) {
    try {
      const text = readProjectFile(file);
      if (!text) continue;
      const config = jsonc(text) as { importMap?: unknown };
      if (typeof config.importMap === 'string' && !/^\w+:/.test(config.importMap) && resolve(dirname(file), config.importMap) === resolve(filename)) return true;
    } catch { /* An incomplete Deno config does not select an import map. */ }
  }
  return false;
}
