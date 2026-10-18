import { dirname, join } from 'path';
import { parseDocument } from 'yaml';
import { readProjectFile } from './projectFiles';
import { scanToml } from './parsers/toml';
import { tomlField, tomlString } from './parsers/pythonSources';
import type { DependencyRef, Ecosystem } from './types';
import { applyNpmLockfile } from './lockfiles/npm';

const defaultSources: Partial<Record<Ecosystem, string>> = {
  npm: 'https://registry.npmjs.org', python: 'https://pypi.org/simple',
  rust: 'sparse+https://index.crates.io', dart: 'https://pub.dev',
  php: 'https://packagist.org', elixir: 'https://hex.pm/api', swift: 'https://github.com',
};

function sourceIdentity(source: string | undefined): string | undefined {
  if (!source) return undefined;
  if (source === 'registry+https://github.com/rust-lang/crates.io-index') return 'https://index.crates.io';
  try {
    const url = new URL(source.replace(/^(?:sparse|registry)\+/, ''));
    if (!['https:', 'http:'].includes(url.protocol)) return undefined;
    url.username = ''; url.password = '';
    return url.href.replace(/\/+$/, '');
  } catch { return undefined; }
}

/** Use only unambiguous selections from the declaration's effective source. */
export function applyLockfile(
  fsPath: string, ecosystem: Ecosystem, deps: DependencyRef[],
  sourceFor: (dep: DependencyRef) => string | undefined = (dep) => dep.source,
  workspaceRoot?: string,
): DependencyRef[] {
  if (ecosystem === 'npm') return applyNpmLockfile(fsPath, deps, sourceFor, workspaceRoot);
  const dir = dirname(fsPath);
  let lockfile: string | undefined;
  const readLock = (name: string) => {
    const filename = join(dir, name);
    const text = readProjectFile(filename);
    if (text !== undefined) lockfile = filename;
    return text;
  };
  const versions = new Map<DependencyRef, Set<string>>();
  const expectedSource = (dep: DependencyRef) => {
    const source = sourceFor(dep) ?? defaultSources[ecosystem];
    return sourceIdentity(ecosystem === 'swift' && source && !source.includes('://') ? `https://${source}` : source);
  };
  const normalizeName = (name: string) => ecosystem === 'python' ? name.toLowerCase().replace(/[-_.]+/g, '-')
    : ecosystem === 'swift' ? name.toLowerCase() : name;
  const declarations = new Map<string, DependencyRef[]>();
  for (const dep of deps) {
    const name = normalizeName(dep.name);
    const matches = declarations.get(name) ?? [];
    matches.push(dep);
    declarations.set(name, matches);
  }
  const select = (dep: DependencyRef, version: unknown) => {
    if (typeof version !== 'string') return;
    const set = versions.get(dep) ?? new Set<string>(); set.add(version); versions.set(dep, set);
  };
  const add = (name: unknown, version: unknown, source: string | undefined) => {
    if (typeof name !== 'string' || typeof version !== 'string') return;
    const identity = sourceIdentity(source);
    if (!identity) return;
    for (const dep of declarations.get(normalizeName(name)) ?? []) {
      if (expectedSource(dep) === identity) select(dep, version);
    }
  };
  try {
    if (ecosystem === 'php') {
      const text = readLock('composer.lock');
      if (text) for (const item of [...JSON.parse(text).packages ?? [], ...JSON.parse(text)['packages-dev'] ?? []]) {
        // Composer locks do not identify their metadata repository. Do not guess custom sources.
        add(item.name, item.version?.replace(/^v/, ''), defaultSources.php);
      }
    } else if (ecosystem === 'dart') {
      const text = readLock('pubspec.lock');
      if (text) {
        const document = parseDocument(text, { uniqueKeys: true });
        if (!document.errors.length) for (const [name, item] of Object.entries(document.toJS({ maxAliasCount: 0 }).packages ?? {})) {
          const pkg = item as { version?: string; source?: string; description?: string | { url?: string } };
          if (pkg.source === 'hosted') add(name, pkg.version,
            typeof pkg.description === 'string' ? defaultSources.dart : pkg.description?.url);
        }
      }
    } else if (ecosystem === 'swift') {
      const text = readLock('Package.resolved');
      if (text) for (const pin of JSON.parse(text).pins ?? JSON.parse(text).object?.pins ?? []) {
        const repo = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/(.+?)(?:\.git)?\/?$/.exec(pin.location ?? pin.repositoryURL ?? '');
        if (repo) add(repo[2], pin.state?.version, `https://${repo[1]}`);
      }
    } else if (ecosystem === 'rust' || ecosystem === 'python') {
      const primary = readLock(ecosystem === 'rust' ? 'Cargo.lock' : 'uv.lock');
      const text = primary ?? (ecosystem === 'python' ? readLock('poetry.lock') : undefined);
      if (text) for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
        const entries = scanToml(block);
        const name = entries.find((entry) => entry.path.join('.') === 'name')?.value;
        const version = entries.find((entry) => entry.path.join('.') === 'version')?.value;
        const source = entries.find((entry) => entry.path.join('.') === 'source')?.value;
        let registry: string | undefined;
        if (ecosystem === 'rust') {
          if (source?.kind === 'string' && /^(?:registry|sparse)\+https:\/\//.test(source.text)) registry = source.text;
        } else if (primary !== undefined) {
          registry = tomlString(source && tomlField(source, 'registry'));
        } else {
          const type = entries.find((entry) => ['source.type', 'package.source.type'].includes(entry.path.join('.')))?.value;
          const url = entries.find((entry) => ['source.url', 'package.source.url'].includes(entry.path.join('.')))?.value;
          if (!type && !source) registry = defaultSources.python;
          else if (tomlString(type) === 'legacy') registry = tomlString(url);
        }
        if (name?.kind === 'string' && version?.kind === 'string') add(name.text, version.text, registry);
      }
    } else if (ecosystem === 'terraform') {
      const text = readLock('.terraform.lock.hcl');
      if (text) for (const match of text.matchAll(/provider\s+"([^"]+)"\s*\{[^}]*?\bversion\s*=\s*"([^"]+)"/g)) {
        const name = match[1].replace(/^registry\.terraform\.io\//, '');
        for (const dep of deps) if (dep.name === name) select(dep, match[2]);
      }
    } else if (ecosystem === 'elixir') {
      const text = readLock('mix.lock');
      if (text) for (const match of text.matchAll(/"[^"]+":\s*\{:hex,\s*:([\w]+),\s*"([^"]+)"[^\n]*/g)) {
        // The repository belongs to the outer tuple, not to one of its dependencies.
        if (/,\s*"hexpm"\s*,\s*"[a-f\d]+"\s*\}\s*,?\s*$/.test(match[0])) add(match[1], match[2], defaultSources.elixir);
      }
    }
  } catch { return deps; }
  return deps.map((dep) => {
    const selected = versions.get(dep);
    return selected?.size === 1 && !dep.skipReason && !dep.githubRepository ? { ...dep, resolvedVersion: [...selected][0], ...(lockfile ? { baselineOrigin: { lockfile } } : {}) } : dep;
  });
}
