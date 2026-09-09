import { dirname, join } from 'path';
import { parseDocument } from 'yaml';
import { readProjectFile } from './projectFiles';
import { scanToml } from './parsers/toml';
import type { DependencyRef, Ecosystem } from './types';

/** Only use unambiguous lock selections. Multiple resolved versions stay unknown. */
export function applyLockfile(fsPath: string, ecosystem: Ecosystem, deps: DependencyRef[]): DependencyRef[] {
  const dir = dirname(fsPath);
  const versions = new Map<string, Set<string>>();
  const add = (name: unknown, version: unknown) => {
    if (typeof name !== 'string' || typeof version !== 'string') return;
    const set = versions.get(name) ?? new Set<string>(); set.add(version); versions.set(name, set);
  };
  try {
    if (ecosystem === 'npm') {
      const text = readProjectFile(join(dir, 'npm-shrinkwrap.json')) ?? readProjectFile(join(dir, 'package-lock.json'));
      if (!text) return deps;
      const lock = JSON.parse(text);
      for (const dep of deps) {
        if (!['dependencies', 'devDependencies', 'optionalDependencies'].includes(dep.section)) continue;
        const item = lock.packages?.[`node_modules/${dep.alias ?? dep.name}`] ?? lock.dependencies?.[dep.alias ?? dep.name];
        if (item && !item.link && (!dep.alias || item.name === dep.name)) add(dep.name, item.version);
      }
    } else if (ecosystem === 'php') {
      const text = readProjectFile(join(dir, 'composer.lock'));
      if (text) for (const item of [...JSON.parse(text).packages ?? [], ...JSON.parse(text)['packages-dev'] ?? []]) add(item.name, item.version?.replace(/^v/, ''));
    } else if (ecosystem === 'dart') {
      const text = readProjectFile(join(dir, 'pubspec.lock'));
      if (text) {
        const document = parseDocument(text, { uniqueKeys: true });
        if (!document.errors.length) for (const [name, item] of Object.entries(document.toJS({ maxAliasCount: 0 }).packages ?? {})) {
          const pkg = item as { version?: string; source?: string };
          if (pkg.source === 'hosted') add(name, pkg.version);
        }
      }
    } else if (ecosystem === 'swift') {
      const text = readProjectFile(join(dir, 'Package.resolved'));
      if (text) for (const pin of JSON.parse(text).pins ?? JSON.parse(text).object?.pins ?? []) {
        const repo = /^https:\/\/github\.com\/(.+?)(?:\.git)?$/.exec(pin.location ?? pin.repositoryURL ?? '');
        if (repo) add(repo[1], pin.state?.version);
      }
    } else if (ecosystem === 'rust' || ecosystem === 'python') {
      const text = readProjectFile(join(dir, ecosystem === 'rust' ? 'Cargo.lock' : 'uv.lock'))
        ?? (ecosystem === 'python' ? readProjectFile(join(dir, 'poetry.lock')) : undefined);
      if (text) for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
        const entries = scanToml(block);
        const name = entries.find((entry) => entry.path.join('.') === 'name')?.value;
        const version = entries.find((entry) => entry.path.join('.') === 'version')?.value;
        if (name?.kind === 'string' && version?.kind === 'string') add(name.text, version.text);
      }
    } else if (ecosystem === 'terraform') {
      const text = readProjectFile(join(dir, '.terraform.lock.hcl'));
      if (text) for (const match of text.matchAll(/provider\s+"([^"]+)"\s*\{[^}]*?\bversion\s*=\s*"([^"]+)"/g)) {
        add(match[1].replace(/^registry\.terraform\.io\//, ''), match[2]);
      }
    } else if (ecosystem === 'elixir') {
      const text = readProjectFile(join(dir, 'mix.lock'));
      if (text) for (const match of text.matchAll(/"[^"]+":\s*\{:hex,\s*:([\w]+),\s*"([^"]+)"/g)) add(match[1], match[2]);
    }
  } catch { return deps; }
  return deps.map((dep) => {
    const selected = versions.get(dep.name);
    return selected?.size === 1 && !dep.skipReason ? { ...dep, resolvedVersion: [...selected][0] } : dep;
  });
}
