import { dirname, join, relative } from 'path';
import { minimatch } from 'minimatch';
import { parseDocument } from 'yaml';
import * as semver from 'semver';
import { projectFileExists, readProjectFile } from '../projectFiles';
import { isWithin, normalizedPath } from '../policies';
import type { DependencyRef } from '../types';
import { cachedLockfile } from './cache';
import { bunSelection, parseBunLock } from './bun';

// Legacy lockfile readers validate selected fields across several untyped formats.
// eslint-disable-next-line typescript/no-explicit-any
type ObjectValue = Record<string, any>;
const directSections = ['dependencies', 'devDependencies', 'optionalDependencies'];
const publicRegistry = 'https://registry.npmjs.org';
interface Lock {
  path: string;
  text: string;
  manager: string;
  root: string;
  unavailable?: string;
}
interface Selection {
  version: string;
  descriptor?: string;
}
interface YarnLock {
  berry: boolean;
  entries: Map<string, ObjectValue[]>;
  config?: ObjectValue;
}

function yaml(text: string): ObjectValue {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error('Malformed YAML lockfile.');
  const value = document.toJS({ maxAliasCount: 0 });
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid lockfile object.');
  return value;
}

function manifestAt(dir: string): ObjectValue | undefined {
  const text = readProjectFile(join(dir, 'package.json'));
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function member(root: string, dir: string, manager: string, manifest?: ObjectValue): boolean {
  const rel = normalizedPath(relative(root, dir));
  let patterns: unknown = Array.isArray(manifest?.workspaces)
    ? manifest.workspaces
    : manifest?.workspaces?.packages;
  if (manager === 'pnpm') {
    const text = readProjectFile(join(root, 'pnpm-workspace.yaml'));
    if (!text) return false;
    patterns = yaml(text).packages;
  }
  if (!Array.isArray(patterns) || !patterns.every((entry) => typeof entry === 'string'))
    return false;
  return (
    patterns.some(
      (pattern) => !pattern.startsWith('!') && minimatch(rel, pattern, { dot: true })
    ) &&
    !patterns.some(
      (pattern) => pattern.startsWith('!') && minimatch(rel, pattern.slice(1), { dot: true })
    )
  );
}

function discover(fsPath: string, boundary?: string): Lock | string | undefined {
  const start = dirname(fsPath);
  const own = manifestAt(start);
  let manager = /^(npm|pnpm|yarn|bun)@/.exec(own?.packageManager ?? '')?.[1];
  let dir = start;
  for (let depth = 0; depth < 20; depth++) {
    if (boundary && !isWithin(boundary, dir)) break;
    const manifest = dir === start ? own : manifestAt(dir);
    const declared = /^(npm|pnpm|yarn|bun)@/.exec(manifest?.packageManager ?? '')?.[1];
    const locks: Lock[] = [];
    for (const [filename, kind] of [
      ['npm-shrinkwrap.json', 'npm'],
      ['package-lock.json', 'npm'],
      ['pnpm-lock.yaml', 'pnpm'],
      ['yarn.lock', 'yarn'],
      ['bun.lock', 'bun'],
      ['bun.lockb', 'bun'],
    ]) {
      if (locks.some((entry) => entry.manager === kind)) continue;
      const path = join(dir, filename);
      if (filename === 'bun.lockb') {
        if (projectFileExists(path))
          locks.push({
            path,
            text: '',
            manager: kind,
            root: dir,
            unavailable:
              'Binary bun.lockb baselines are unsupported. Migrate to text bun.lock with Bun; Fresh Deps never invokes package managers.',
          });
        continue;
      }
      const text = readProjectFile(path);
      if (text !== undefined || projectFileExists(path))
        locks.push({
          path,
          text: text ?? '',
          manager: kind,
          root: dir,
          ...(text === undefined
            ? { unavailable: 'Lockfile is unreadable or exceeds the 4 MiB read limit.' }
            : {}),
        });
    }
    if (locks.length) {
      if (manager && declared && manager !== declared)
        return 'Conflicting packageManager declarations.';
      manager ??= declared;
      const selected = manager ? locks.filter((entry) => entry.manager === manager) : locks;
      if (selected.length !== 1)
        return 'Conflicting lockfiles or no lockfile for the declared package manager.';
      if (dir !== start && !member(dir, start, selected[0].manager, manifest))
        return 'Ancestor lockfile does not belong to a verified workspace containing this manifest.';
      return selected[0];
    }
    if (dir !== start && declared && !member(dir, start, declared, manifest)) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function identity(value: string | undefined): string | undefined {
  try {
    const url = new URL(value ?? '');
    if (!['https:', 'http:'].includes(url.protocol)) return undefined;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function sourceMatches(resolved: unknown, expected: string | undefined): boolean {
  const source = identity(expected);
  if (!source) return false;
  if (resolved === undefined) return source === publicRegistry;
  if (typeof resolved !== 'string') return false;
  const target = identity(resolved);
  return (
    !!target &&
    (target.startsWith(`${source}/`) ||
      (source === publicRegistry && target.startsWith('https://registry.yarnpkg.com/')))
  );
}

function npmSelection(
  lock: ObjectValue,
  importer: string,
  dep: DependencyRef,
  source: string | undefined
): Selection | undefined {
  const name = dep.alias ?? dep.name;
  let item: ObjectValue | undefined;
  if (lock.packages) {
    if (importer !== '.' && !lock.packages[importer]) return undefined;
    let location = importer === '.' ? '' : importer;
    for (;;) {
      item = lock.packages[`${location ? `${location}/` : ''}node_modules/${name}`];
      if (item || !location) break;
      location = normalizedPath(dirname(location));
      if (location === '.') location = '';
    }
  } else if (importer === '.') item = lock.dependencies?.[name];
  if (
    !item ||
    item.link ||
    (dep.alias && item.name !== dep.name) ||
    !sourceMatches(item.resolved, source)
  )
    return undefined;
  return typeof item.version === 'string' ? { version: item.version } : undefined;
}

function pnpmSelection(
  lock: ObjectValue,
  importer: string,
  dep: DependencyRef,
  source: string | undefined
): Selection | undefined {
  if (!['6', '6.0', '9', '9.0'].includes(String(lock.lockfileVersion)))
    throw new Error('Unsupported pnpm lockfile version. Supported versions are 6 and 9.');
  const entries =
    lock.importers?.[importer] ?? (importer === '.' && !lock.importers ? lock : undefined);
  const item = entries?.[dep.section]?.[dep.alias ?? dep.name];
  if (!item || typeof item !== 'object' || typeof item.version !== 'string') return undefined;
  const spec = dep.alias ? `npm:${dep.name}@${dep.spec}` : dep.spec;
  if (item.specifier !== spec) return undefined;
  const raw = item.version;
  const escapedName = dep.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `^(?:/?${escapedName}@)?(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?)(.*)$`
  ).exec(raw);
  if (!match || !peerContext(match[2])) return undefined;
  const version = match[1];
  const key = `${dep.name}@${version}`;
  const pkg =
    lock.packages?.[key] ??
    lock.packages?.[`/${key}`] ??
    lock.packages?.[`${dep.name}@${raw}`] ??
    lock.packages?.[`/${dep.name}@${raw}`];
  if (
    !pkg ||
    pkg.resolution?.directory ||
    pkg.resolution?.repo ||
    (pkg.resolution?.type && pkg.resolution.type !== 'tarball') ||
    !sourceMatches(pkg.resolution?.tarball, source)
  )
    return undefined;
  return { version, descriptor: spec };
}

/** Strip only recognized, balanced peer groups. Patch hashes and other locators are not peers. */
function peerContext(value: string): boolean {
  let index = 0;
  const group = (depth: number): boolean => {
    if (depth > 20 || value[index++] !== '(') return false;
    const start = index;
    while (index < value.length && !['(', ')'].includes(value[index])) index++;
    if (
      !/^(?:@[^/\s()]+\/)?[^@/\s()]+@\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(
        value.slice(start, index)
      )
    )
      return false;
    while (value[index] === '(') if (!group(depth + 1)) return false;
    return value[index++] === ')';
  };
  while (index < value.length) if (!group(0)) return false;
  return true;
}

/** Yarn Classic is not YAML. Read only its top-level descriptors and scalar fields. */
export function parseYarnClassic(text: string): Map<string, ObjectValue[]> {
  const entries = new Map<string, ObjectValue[]>();
  let current: ObjectValue | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (/^\S/.test(line)) {
      if (!line.endsWith(':')) throw new Error('Malformed Yarn Classic descriptor.');
      let header = line.slice(0, -1).trim();
      if (!header) throw new Error('Empty Yarn descriptor.');
      current = {};
      while (header) {
        const match = /^("(?:\\.|[^"\\])*"|[^,"\s]+)(?:,\s*|$)/.exec(header);
        if (!match) throw new Error('Malformed Yarn Classic descriptor.');
        const token = match[1];
        const descriptor = token.startsWith('"') ? JSON.parse(token) : token;
        const existing = entries.get(descriptor) ?? [];
        existing.push(current);
        entries.set(descriptor, existing);
        header = header.slice(match[0].length);
      }
    } else if (current && /^ {2}(version|resolved)\s/.test(line)) {
      const field = /^ {2}(version|resolved)\s+("(?:\\.|[^"\\])*")\s*$/.exec(line);
      if (!field || current[field[1]] !== undefined)
        throw new Error('Malformed Yarn Classic field.');
      current[field[1]] = JSON.parse(field[2]);
    }
  }
  return entries;
}

function parseYarnLock(text: string): YarnLock {
  const berry = /^__metadata:/m.test(text);
  if (!berry) {
    if (!/^# yarn lockfile v1\s*$/m.test(text))
      throw new Error('Unsupported Yarn lockfile format.');
    return { berry, entries: parseYarnClassic(text) };
  }
  const lock = yaml(text);
  if (![4, 5, 6, 8].includes(Number(lock.__metadata?.version)))
    throw new Error('Unsupported Yarn Berry lockfile version.');
  const entries = new Map<string, ObjectValue[]>();
  for (const [key, item] of Object.entries(lock)) {
    if (key === '__metadata') continue;
    for (const descriptor of key.split(/,\s+/)) {
      const values = entries.get(descriptor) ?? [];
      values.push(item);
      entries.set(descriptor, values);
    }
  }
  return { berry, entries };
}

function yarnSelection(
  lock: YarnLock,
  dep: DependencyRef,
  source: string | undefined
): Selection | undefined {
  const name = dep.alias ?? dep.name;
  const spec = dep.alias ? `npm:${dep.name}@${dep.spec}` : dep.spec;
  if (!lock.berry) {
    const descriptor = `${name}@${spec}`;
    const matches = lock.entries.get(descriptor) ?? [];
    const usable = matches.filter(
      (item) => typeof item.version === 'string' && sourceMatches(item.resolved, source)
    );
    if (usable.length !== matches.length || new Set(usable.map((item) => item.version)).size !== 1)
      return undefined;
    return { version: usable[0].version, descriptor };
  }
  const descriptor = `${name}@${dep.alias ? spec : `npm:${spec}`}`;
  const matches = lock.entries.get(descriptor) ?? [];
  const scope = dep.name.startsWith('@') ? dep.name.slice(1, dep.name.indexOf('/')) : undefined;
  const configured =
    (scope ? lock.config?.npmScopes?.[scope]?.npmRegistryServer : undefined) ??
    lock.config?.npmRegistryServer;
  if (
    configured !== undefined &&
    ![publicRegistry, 'https://registry.yarnpkg.com'].includes(identity(configured) ?? '')
  )
    return undefined;
  if (
    !matches.length ||
    matches.some(
      (item) =>
        !item ||
        typeof item.version !== 'string' ||
        item.linkType === 'soft' ||
        item.resolution !== `${dep.name}@npm:${item.version}` ||
        !sourceMatches(undefined, source)
    )
  )
    return undefined;
  if (new Set(matches.map((item) => item.version)).size !== 1) return undefined;
  return { version: matches[0].version, descriptor };
}

export function applyNpmLockfile(
  fsPath: string,
  deps: DependencyRef[],
  sourceFor: (dep: DependencyRef) => string | undefined,
  boundary?: string
): DependencyRef[] {
  const fail = (reason: string) => deps.map((dep) => ({ ...dep, baselineUnavailable: reason }));
  try {
    const selected = discover(fsPath, boundary);
    if (typeof selected === 'string') return fail(selected);
    if (!selected)
      return fail(
        'No readable lockfile within the project boundary. Lockfile reads are limited to 4 MiB.'
      );
    if (selected.unavailable) return fail(selected.unavailable);
    const importer = normalizedPath(relative(selected.root, dirname(fsPath))) || '.';
    const lock =
      selected.manager === 'yarn'
        ? undefined
        : cachedLockfile(`${selected.manager}|${selected.path}`, selected.text, () =>
            selected.manager === 'npm'
              ? JSON.parse(selected.text)
              : selected.manager === 'bun'
                ? parseBunLock(selected.text)
                : yaml(selected.text)
          );
    const yarn =
      selected.manager === 'yarn'
        ? {
            ...cachedLockfile(`yarn|${selected.path}`, selected.text, () =>
              parseYarnLock(selected.text)
            ),
            config: undefined as ObjectValue | undefined,
          }
        : undefined;
    if (yarn?.berry) {
      const config = readProjectFile(join(selected.root, '.yarnrc.yml'));
      if (config !== undefined)
        yarn.config = cachedLockfile(`config|${selected.root}`, config, () => yaml(config));
    }
    return deps.map((dep) => {
      if (!directSections.includes(dep.section))
        return {
          ...dep,
          baselineUnavailable:
            'This declaration does not identify a direct dependency in one workspace importer.',
        };
      if (dep.skipReason || dep.githubRepository) return dep;
      const source = sourceFor(dep) ?? publicRegistry;
      const selection =
        selected.manager === 'npm'
          ? npmSelection(lock, importer, dep, source)
          : selected.manager === 'pnpm'
            ? pnpmSelection(lock, importer, dep, source)
            : selected.manager === 'bun'
              ? bunSelection(lock, importer, dep, (resolved) => sourceMatches(resolved, source))
              : yarnSelection(yarn!, dep, source);
      if (
        !selection ||
        !semver.valid(selection.version) ||
        !semver.satisfies(selection.version, dep.spec, { loose: true, includePrerelease: true })
      ) {
        return {
          ...dep,
          baselineUnavailable:
            'No unambiguous, source-matched lockfile selection satisfies this declaration.',
        };
      }
      return {
        ...dep,
        resolvedVersion: selection.version,
        baselineOrigin: {
          lockfile: selected.path,
          importer,
          ...(selection.descriptor ? { descriptor: selection.descriptor } : {}),
        },
      };
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Unable to read lockfile.');
  }
}
