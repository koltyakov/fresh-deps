import * as path from 'path';
import type { VersionCache } from './cache';
import type { Settings } from './config';
import { parseGoMod } from './parsers/goMod';
import { parsePackageJson } from './parsers/packageJson';
import { GoClient } from './registries/go';
import { NpmClient } from './registries/npm';
import type { DependencyRef, DependencyUpdate, Ecosystem, RegistryVersions } from './types';
import { computeUpdate, needsFullVersionList } from './versions';

export interface AnalyzeRequest {
  fsPath: string;
  text: string;
  settings: Settings;
  cache: VersionCache;
  /** When false only cached versions are used, so typing never hits the network. */
  allowNetwork: boolean;
  isCancelled?: () => boolean;
}

export interface AnalyzeResult {
  ecosystem: Ecosystem;
  updates: DependencyUpdate[];
  /** Dependencies whose lookup failed, by name. */
  failures: Map<string, string>;
  /** True while some dependency has no cached answer yet. */
  incomplete: boolean;
}

export function ecosystemOf(fsPath: string): Ecosystem | undefined {
  const name = path.basename(fsPath);
  if (name === 'package.json') {
    return 'npm';
  }
  if (name === 'go.mod') {
    return 'go';
  }
  return undefined;
}

export async function analyze(request: AnalyzeRequest): Promise<AnalyzeResult | undefined> {
  const ecosystem = ecosystemOf(request.fsPath);
  if (!ecosystem) {
    return undefined;
  }

  const { settings } = request;
  if (ecosystem === 'npm' && !settings.npm.enabled) {
    return undefined;
  }
  if (ecosystem === 'go' && !settings.go.enabled) {
    return undefined;
  }

  const deps =
    ecosystem === 'npm'
      ? parsePackageJson(request.text, settings.npm.sections)
      : parseGoMod(request.text, { includeIndirect: settings.go.includeIndirect });

  const lookup = ecosystem === 'npm' ? npmLookup(request) : goLookup(request);
  if (!lookup) {
    return undefined;
  }

  const result: AnalyzeResult = { ecosystem, updates: [], failures: new Map(), incomplete: false };
  const opts = {
    includePrerelease: settings.includePrerelease,
    showSatisfyingUpdates: settings.showSatisfyingUpdates,
  };

  await pool(deps, settings.concurrency, async (dep) => {
    if (request.isCancelled?.()) {
      return;
    }

    const key = lookup.key(dep);
    let versions = request.cache.get(key);
    const wantsAll = versions?.latest ? needsFullVersionList(dep.spec, versions.latest, opts) : false;

    if (!versions || (wantsAll && !versions.all)) {
      if (!request.allowNetwork) {
        result.incomplete = true;
        return;
      }
      try {
        versions = wantsAll && lookup.fetchAll ? await lookup.fetchAll(dep) : await lookup.fetch(dep);
        // The latest version fell outside the declared range: ask for the full
        // list so the newest in-range version can be reported too.
        if (lookup.fetchAll && versions.latest && !versions.all && needsFullVersionList(dep.spec, versions.latest, opts)) {
          versions = { ...versions, ...(await lookup.fetchAll(dep)) };
        }
      } catch (error) {
        versions = { error: error instanceof Error ? error.message : String(error) };
      }
      request.cache.set(key, versions);
    }

    if (versions.error) {
      result.failures.set(dep.name, versions.error);
      return;
    }

    const update = computeUpdate(dep, versions, opts);
    if (update) {
      result.updates.push(update);
    }
  });

  result.updates.sort((a, b) => a.dep.line - b.dep.line);
  return result;
}

interface Lookup {
  key(dep: DependencyRef): string;
  fetch(dep: DependencyRef): Promise<RegistryVersions>;
  fetchAll?(dep: DependencyRef): Promise<RegistryVersions>;
}

function npmLookup(request: AnalyzeRequest): Lookup {
  const client = new NpmClient({
    ...(request.settings.npm.registry ? { registryOverride: request.settings.npm.registry } : {}),
    cwd: path.dirname(request.fsPath),
    timeoutMs: request.settings.requestTimeoutMs,
  });
  return {
    key: (dep) => `npm|${client.registryFor(dep.name)}|${dep.name}`,
    fetch: (dep) => client.fetchLatest(dep.name),
    fetchAll: (dep) => client.fetchAll(dep.name),
  };
}

function goLookup(request: AnalyzeRequest): Lookup | undefined {
  const client = new GoClient({
    ...(request.settings.go.proxy ? { proxyOverride: request.settings.go.proxy } : {}),
    checkMajorVersions: request.settings.go.checkMajorVersions,
    timeoutMs: request.settings.requestTimeoutMs,
  });
  if (!client.proxy) {
    return undefined;
  }
  return {
    key: (dep) => `go|${client.proxy}|${dep.name}|${request.settings.go.checkMajorVersions ? 'major' : 'base'}`,
    fetch: (dep) => client.fetchLatest(dep.name),
  };
}

/** Runs `worker` over every item with a bounded number of requests in flight. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (cursor < items.length) {
      await worker(items[cursor++]);
    }
  });
  await Promise.all(runners);
}
