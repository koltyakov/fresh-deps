import { jsonc } from '../projectFiles';
import type { DependencyRef } from '../types';

type JsonObject = Record<string, unknown>;
export interface BunLock {
  lockfileVersion: number;
  workspaces: JsonObject;
  packages: JsonObject;
  patchedDependencies?: JsonObject;
}

function object(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function own(entries: JsonObject, key: string): unknown {
  return Object.hasOwn(entries, key) ? entries[key] : undefined;
}

/** Bun's text format is JSONC. Registry rows are [name@version, tarball, info, integrity]. */
export function parseBunLock(text: string): BunLock {
  const lock = jsonc(text);
  if (
    !object(lock) ||
    !Number.isInteger(lock.lockfileVersion) ||
    ![0, 1, 2, 3].includes(lock.lockfileVersion as number)
  ) {
    throw new Error('Unsupported Bun lockfile version. Supported text formats are 0, 1, 2 and 3.');
  }
  if (
    !object(lock.workspaces) ||
    !object(lock.packages) ||
    (lock.patchedDependencies !== undefined && !object(lock.patchedDependencies))
  ) {
    throw new Error('Malformed Bun lockfile workspace or package records.');
  }
  return {
    lockfileVersion: lock.lockfileVersion as number,
    workspaces: lock.workspaces,
    packages: lock.packages,
    patchedDependencies: lock.patchedDependencies as JsonObject | undefined,
  };
}

/** Select only the exact workspace's direct registry dependency, never an arbitrary matching version. */
export function bunSelection(
  lock: BunLock,
  importer: string,
  dep: DependencyRef,
  sourceMatches: (resolved: unknown) => boolean
): { version: string; descriptor: string } | undefined {
  const workspacePath = importer === '.' ? '' : importer;
  const workspace = own(lock.workspaces, workspacePath);
  const name = dep.alias ?? dep.name;
  const spec = dep.alias ? `npm:${dep.name}@${dep.spec}` : dep.spec;
  if (!object(workspace)) return undefined;
  const section = workspace[dep.section];
  if (!object(section) || own(section, name) !== spec) return undefined;

  let key = name;
  if (workspacePath) {
    if (typeof workspace.name !== 'string' || !/^(?:@[\w.-]+\/)?[\w.-]+$/.test(workspace.name))
      return undefined;
    if (
      Object.values(lock.workspaces).filter(
        (entry) => object(entry) && entry.name === workspace.name
      ).length !== 1
    )
      return undefined;
    const linked = own(lock.packages, workspace.name);
    const isWorkspace =
      Array.isArray(linked) && linked[0] === `${workspace.name}@workspace:${workspacePath}`;
    // Bun prefixes an unlinked workspace with ./ when a root registry dependency shadows its name.
    const local = `${isWorkspace ? '' : './'}${workspace.name}/${name}`;
    if (Object.hasOwn(lock.packages, local)) key = local;
    else if (!isWorkspace) return undefined;
  }

  const row = own(lock.packages, key);
  if (
    !Array.isArray(row) ||
    row.length !== 4 ||
    typeof row[0] !== 'string' ||
    typeof row[1] !== 'string' ||
    !object(row[2]) ||
    typeof row[3] !== 'string' ||
    !row[0].startsWith(`${dep.name}@`)
  )
    return undefined;
  const version = row[0].slice(dep.name.length + 1);
  // Git, file, workspace, tarball, and other non-version locators cannot become registry baselines.
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)) return undefined;
  if (
    lock.patchedDependencies &&
    (Object.hasOwn(lock.patchedDependencies, dep.name) ||
      Object.hasOwn(lock.patchedDependencies, `${dep.name}@${version}`))
  )
    return undefined;
  if (!sourceMatches(row[1] === '' ? undefined : row[1])) return undefined;
  return { version, descriptor: `${name}@${spec}` };
}
