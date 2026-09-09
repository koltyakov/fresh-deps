import * as path from 'path';
import { AuditCache } from './audit';
import type { VersionCache } from './cache';
import type { Settings } from './config';
import { parseCargoToml } from './parsers/cargoToml';
import { parseComposerJson } from './parsers/composerJson';
import { parseGoMod } from './parsers/goMod';
import { parseGradleCatalog } from './parsers/gradleCatalog';
import { parseNugetManifest } from './parsers/nuget';
import { parsePackageJson } from './parsers/packageJson';
import { parsePipfile } from './parsers/pipfile';
import { parsePnpmWorkspace } from './parsers/pnpmWorkspace';
import { parsePomXml } from './parsers/pomXml';
import { parsePubspec } from './parsers/pubspec';
import { parsePyProject } from './parsers/pyproject';
import { parseRequirementsTxt } from './parsers/requirementsTxt';
import { CratesClient } from './registries/crates';
import { GoClient } from './registries/go';
import { NpmClient } from './registries/npm';
import { MavenClient } from './registries/maven';
import { NugetClient } from './registries/nuget';
import { PackagistClient } from './registries/packagist';
import { PubClient } from './registries/pub';
import { normalizeName, PyPiClient } from './registries/pypi';
import { schemeFor } from './schemes';
import type {
  DependencyRef,
  DependencyAudit,
  AuditResponse,
  DependencyUpdate,
  Ecosystem,
  PackageMeta,
  RegistryVersions,
  ResolveOptions,
} from './types';
import { computeUpdate, needsFullVersionList } from './versions';

export interface AnalyzeRequest {
  fsPath: string;
  text: string;
  settings: Settings;
  cache: VersionCache;
  auditCache: AuditCache;
  /** When false only cached versions are used, so typing never hits the network. */
  allowNetwork: boolean;
  isCancelled?: () => boolean;
}

export interface AnalyzeResult {
  ecosystem: Ecosystem;
  updates: DependencyUpdate[];
  audits: DependencyAudit[];
  /** Dependencies whose lookup failed, by name. */
  failures: Map<string, string>;
  /** True while some dependency has no cached answer yet. */
  incomplete: boolean;
}

/** Which manifest a file is, since Python spreads its dependencies over several. */
export type ManifestKind =
  | 'package.json'
  | 'composer.json'
  | 'pubspec.yaml'
  | 'gradle-catalog'
  | 'pnpm-workspace.yaml'
  | 'go.mod'
  | 'Cargo.toml'
  | 'pyproject.toml'
  | 'Pipfile'
  | 'requirements.txt'
  | 'pom.xml'
  | 'nuget';

interface Manifest {
  ecosystem: Ecosystem;
  kind: ManifestKind;
}

/**
 * pip has no single manifest name, so the conventional ones are recognised:
 * `requirements.txt` and its suffixed variants, plus any `.txt` inside a
 * `requirements/` directory.
 */
function isRequirementsFile(fsPath: string): boolean {
  const name = path.basename(fsPath);
  if (!/\.txt$/i.test(name)) {
    return false;
  }
  return (
    /^(requirements|constraints)([-._].*)?\.txt$/i.test(name) ||
    /[-._]requirements\.txt$/i.test(name) ||
    path.basename(path.dirname(fsPath)).toLowerCase() === 'requirements'
  );
}

export function manifestOf(fsPath: string): Manifest | undefined {
  const name = path.basename(fsPath);
  if (name === 'composer.json') return { ecosystem: 'php', kind: 'composer.json' };
  if (name === 'pubspec.yaml') return { ecosystem: 'dart', kind: 'pubspec.yaml' };
  if (name === 'pnpm-workspace.yaml') return { ecosystem: 'npm', kind: 'pnpm-workspace.yaml' };
  if (name.endsWith('.versions.toml')) return { ecosystem: 'gradle', kind: 'gradle-catalog' };
  if (name === 'package.json') {
    return { ecosystem: 'npm', kind: 'package.json' };
  }
  if (name === 'go.mod') {
    return { ecosystem: 'go', kind: 'go.mod' };
  }
  if (name === 'Cargo.toml') {
    return { ecosystem: 'rust', kind: 'Cargo.toml' };
  }
  if (name === 'pom.xml') {
    return { ecosystem: 'java', kind: 'pom.xml' };
  }
  if (name === 'pyproject.toml') {
    return { ecosystem: 'python', kind: 'pyproject.toml' };
  }
  if (name === 'Pipfile') {
    return { ecosystem: 'python', kind: 'Pipfile' };
  }
  if (isRequirementsFile(fsPath)) {
    return { ecosystem: 'python', kind: 'requirements.txt' };
  }
  if (/\.(?:cs|fs|vb)proj$/i.test(name) || /^Directory\.(?:Packages|Build)\.props$/i.test(name) || name === 'packages.config') {
    return { ecosystem: 'dotnet', kind: 'nuget' };
  }
  return undefined;
}

export function ecosystemOf(fsPath: string): Ecosystem | undefined {
  return manifestOf(fsPath)?.ecosystem;
}

export async function analyze(request: AnalyzeRequest): Promise<AnalyzeResult | undefined> {
  const manifest = manifestOf(request.fsPath);
  if (!manifest || !enabledFor(manifest.ecosystem, request.settings)) {
    return undefined;
  }

  const { ecosystem } = manifest;
  const deps = parseManifest(manifest.kind, request);
  const lookup = lookupFor(ecosystem, request.fsPath, request.settings);
  if (!lookup) {
    return undefined;
  }

  const { settings } = request;
  const result: AnalyzeResult = { ecosystem, updates: [], audits: [], failures: new Map(), incomplete: false };
  const opts: ResolveOptions = {
    includePrerelease: settings.includePrerelease,
    showSatisfyingUpdates: settings.showSatisfyingUpdates,
    scheme: schemeFor(ecosystem),
  };

  await pool(deps, settings.concurrency, async (dep) => {
    if (request.isCancelled?.()) {
      return;
    }

    const key = lookup.key(dep);
    if (settings.auditEnabled) {
      const version = opts.scheme.baseline(dep.spec);
      const audit: DependencyAudit = {
        dep, version, baseline: !opts.scheme.isPinned(dep.spec),
        result: { status: lookup.fetchAudit ? 'unchecked' : 'unsupported' },
      };
      if (lookup.fetchAudit && version) {
        const auditKey = `${key}|audit|${version}`;
        const cached = request.auditCache.get(auditKey, settings.cacheDurationMinutes * 60_000);
        audit.result = cached ?? (request.allowNetwork
          ? await request.auditCache.resolve(auditKey, () => lookup.fetchAudit!(dep, version))
          : { status: 'pending' });
        if (audit.result.status === 'pending') result.incomplete = true;
      }
      result.audits.push(audit);
    }
    if (request.isCancelled?.()) return;
    let versions = request.cache.get(key);
    const wantsAll = versions?.latest ? needsFullVersionList(dep.spec, versions.latest, opts) : false;

    if (!versions || (wantsAll && !versions.all)) {
      if (!request.allowNetwork) {
        result.incomplete = true;
        return;
      }
      // The abbreviated version list carries no descriptive fields, so anything
      // already known about the package is kept rather than fetched again.
      const known = versions?.meta;
      try {
        versions = wantsAll && lookup.fetchAll ? await lookup.fetchAll(dep) : await lookup.fetch(dep);
        // The latest version fell outside the declared range: ask for the full
        // list so the newest in-range version can be reported too.
        if (lookup.fetchAll && versions.latest && !versions.all && needsFullVersionList(dep.spec, versions.latest, opts)) {
          const full = await lookup.fetchAll(dep);
          versions = { ...versions, ...full, ...(versions.meta ? { meta: versions.meta } : {}) };
        }
        if (known && !versions.meta && !versions.error) {
          versions = { ...versions, meta: known };
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

function enabledFor(ecosystem: Ecosystem, settings: Settings): boolean {
  return settings[ecosystem].enabled;
}

function parseManifest(kind: ManifestKind, request: AnalyzeRequest): DependencyRef[] {
  const { settings, text } = request;
  switch (kind) {
    case 'composer.json': return parseComposerJson(text);
    case 'pubspec.yaml': return parsePubspec(text, process.env.PUB_HOSTED_URL);
    case 'gradle-catalog': return parseGradleCatalog(text);
    case 'pnpm-workspace.yaml': return parsePnpmWorkspace(text);
    case 'package.json':
      return parsePackageJson(text, settings.npm.sections);
    case 'go.mod':
      return parseGoMod(text, { includeIndirect: settings.go.includeIndirect });
    case 'Cargo.toml':
      return parseCargoToml(text);
    case 'pyproject.toml':
      return parsePyProject(text, { includeBuildRequires: settings.python.includeBuildRequires });
    case 'Pipfile':
      return parsePipfile(text);
    case 'requirements.txt':
      return parseRequirementsTxt(text);
    case 'pom.xml':
      return parsePomXml(text);
    case 'nuget':
      return parseNugetManifest(text);
  }
}

export interface Lookup {
  key(dep: DependencyRef): string;
  fetch(dep: DependencyRef): Promise<RegistryVersions>;
  fetchAll?(dep: DependencyRef): Promise<RegistryVersions>;
  fetchAudit?(dep: DependencyRef, version: string): Promise<AuditResponse>;
  /**
   * Detail worth a request of its own - publish dates, prose the version lookup
   * does not carry. Fetched only when someone asks to see it, so a check never
   * pays for it, and absent where no registry answer is cheap enough to be worth it.
   */
  fetchDetails?(dep: DependencyRef, versions: VersionPair): Promise<PackageDetails>;
}

/** The two versions a hint compares, spelled the way their registry spells them. */
export interface VersionPair {
  current: string;
  latest: string;
}

/** What a detail lookup managed to find; every part of it is optional. */
export interface PackageDetails {
  /** ISO 8601 publish dates. */
  currentPublishedAt?: string;
  latestPublishedAt?: string;
  meta?: PackageMeta;
}

/**
 * Builds the registry client for an ecosystem. Taking the manifest path and the
 * settings rather than a whole request lets the hover reuse it without inventing
 * an analysis it does not need.
 */
export function lookupFor(ecosystem: Ecosystem, fsPath: string, settings: Settings): Lookup | undefined {
  switch (ecosystem) {
    case 'php':
      return composerLookup(settings);
    case 'dart':
      return dartLookup(settings);
    case 'gradle':
      return gradleLookup(settings);
    case 'npm':
      return npmLookup(fsPath, settings);
    case 'go':
      return goLookup(settings);
    case 'python':
      return pythonLookup(settings);
    case 'rust':
      return rustLookup(settings);
    case 'dotnet':
      return dotnetLookup(settings);
    case 'java':
      return mavenLookup(settings);
  }
}

function npmLookup(fsPath: string, settings: Settings): Lookup {
  const client = new NpmClient({
    ...(settings.npm.registry ? { registryOverride: settings.npm.registry } : {}),
    cwd: path.dirname(fsPath),
    timeoutMs: settings.requestTimeoutMs,
  });
  return {
    key: (dep) => `npm|${client.registryFor(dep.name)}|${dep.name}`,
    fetch: (dep) => client.fetchLatest(dep.name),
    fetchAll: (dep) => client.fetchAll(dep.name),
    fetchAudit: (dep, version) => client.fetchAudit(dep.name, version),
    // The descriptive fields already came back with the version; only the dates
    // are missing, and they live in a document big enough to be worth deferring.
    async fetchDetails(dep, versions) {
      const dates = await client.fetchPublishDates(dep.name, [versions.current, versions.latest]);
      return {
        currentPublishedAt: dates.get(versions.current),
        latestPublishedAt: dates.get(versions.latest),
      };
    },
  };
}

function goLookup(settings: Settings): Lookup | undefined {
  const client = new GoClient({
    ...(settings.go.proxy ? { proxyOverride: settings.go.proxy } : {}),
    checkMajorVersions: settings.go.checkMajorVersions,
    timeoutMs: settings.requestTimeoutMs,
  });
  if (!client.proxy) {
    return undefined;
  }
  return {
    key: (dep) => `go|${client.proxy}|${dep.name}|${settings.go.checkMajorVersions ? 'major' : 'base'}`,
    fetch: (dep) => client.fetchLatest(dep.name),
    // The proxy dated the latest version on the response that resolved it, so only
    // the declared one is still unknown - one small request under its own path,
    // which is where it lives even when the module has since moved to a new major.
    fetchDetails: async (dep, versions) => ({
      currentPublishedAt: await client.fetchPublishDate(dep.name, versions.current),
    }),
  };
}

function pythonLookup(settings: Settings): Lookup {
  const client = new PyPiClient({
    ...(settings.python.indexUrl ? { indexOverride: settings.python.indexUrl } : {}),
    timeoutMs: settings.requestTimeoutMs,
  });
  return {
    key: (dep) => `python|${client.index}|${normalizeName(dep.name)}`,
    fetch: (dep) => client.fetchVersions(dep.name),
    fetchAudit: (dep, version) => client.fetchAudit(dep.name, version),
    // The index already dated every file it listed, so only the prose costs a request.
    async fetchDetails(dep, versions) {
      const [dates, meta] = await Promise.all([
        client.fetchPublishDates(dep.name, [versions.current, versions.latest]),
        client.fetchInfo(dep.name, versions.latest),
      ]);
      return {
        currentPublishedAt: dates.get(versions.current),
        latestPublishedAt: dates.get(versions.latest),
        ...(meta ? { meta } : {}),
      };
    },
  };
}

function rustLookup(settings: Settings): Lookup {
  const client = new CratesClient(settings.requestTimeoutMs);
  return {
    key: (dep) => `rust|crates.io|${dep.name.toLowerCase().replace(/_/g, '-')}`,
    fetch: (dep) => client.fetchVersions(dep.name),
  };
}

function dotnetLookup(settings: Settings): Lookup {
  const client = new NugetClient(settings.dotnet.indexUrl, settings.requestTimeoutMs);
  return {
    key: (dep) => `dotnet|${client.index}|${dep.name.toLowerCase()}`,
    fetch: (dep) => client.fetchVersions(dep.name),
  };
}

function mavenLookup(settings: Settings): Lookup {
  const client = new MavenClient(settings.java.repository, settings.requestTimeoutMs);
  return {
    key: (dep) => `maven|${client.repository}|${dep.name}`,
    fetch: (dep) => client.fetchVersions(dep.name),
  };
}

function composerLookup(settings: Settings): Lookup {
  const client = new PackagistClient(settings.requestTimeoutMs);
  return { key: (dep) => `php|packagist.org|${dep.name}`, fetch: (dep) => client.fetchVersions(dep.name) };
}

function dartLookup(settings: Settings): Lookup {
  const client = new PubClient(settings.requestTimeoutMs);
  return { key: (dep) => `dart|pub.dev|${dep.name}`, fetch: (dep) => client.fetchVersions(dep.name) };
}

function gradleLookup(settings: Settings): Lookup {
  const clients = settings.gradle.repositories.map((repository) => new MavenClient(repository, settings.requestTimeoutMs));
  return {
    key: (dep) => `gradle|${clients.map((client) => client.repository).join('|')}|${dep.name}`,
    async fetch(dep) {
      for (const client of clients) {
        const result = await client.fetchVersions(dep.name);
        if (result.error !== 'not found') return result;
      }
      return { error: 'not found' };
    },
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
