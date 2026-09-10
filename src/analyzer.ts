import * as path from 'path';
import { parseAnsible } from './parsers/ansible';
import { parseBazelProject } from './parsers/bazelProject';
import { parseVcpkgProject } from './parsers/vcpkgProject';
import { AnsibleClient } from './registries/ansible';
import { BazelClient } from './registries/bazel';
import { VcpkgClient } from './registries/vcpkg';
import { parseDockerfile, parseCompose } from './parsers/docker';
import { parseHelm } from './parsers/helm';
import { parseSwift } from './parsers/swift';
import { parseConan } from './parsers/conan';
import { parseSbt } from './parsers/scala';
import { parseConda } from './parsers/conda';
import { parseClojure, parseLeiningen } from './parsers/clojure';
import { parseDotnetPins } from './parsers/dotnetPins';
import { parseYarnCatalog } from './parsers/yarnCatalog';
import { DockerClient } from './registries/docker';
import { HelmClient } from './registries/helm';
import { SwiftClient } from './registries/swift';
import { ConanClient } from './registries/conan';
import { CondaClient, condaSubdir } from './registries/conda';
import { DotnetSdkClient } from './registries/dotnetSdk';
import { dockerTag } from './docker';
import { AuditCache } from './audit';
import type { VersionCache } from './cache';
import type { Settings } from './config';
import { parseCargoToml } from './parsers/cargoToml';
import { parseComposerJson } from './parsers/composerJson';
import { parseGoMod } from './parsers/goMod';
import { parseGradleCatalog } from './parsers/gradleCatalog';
import { parseGradleBuild } from './parsers/gradleBuild';
import { parseDeno } from './parsers/deno';
import { parseGithubActions } from './parsers/githubActions';
import { JsrClient } from './registries/jsr';
import { GithubActionsClient } from './registries/githubActions';
import { actionTagStyle } from './githubActions';
import { parseNugetManifest } from './parsers/nuget';
import { parsePackageJson } from './parsers/packageJson';
import { parsePipfile } from './parsers/pipfile';
import { parsePnpmWorkspace } from './parsers/pnpmWorkspace';
import { parsePomXml } from './parsers/pomXml';
import { parsePubspec } from './parsers/pubspec';
import { parsePyProject } from './parsers/pyproject';
import { parsePythonScript } from './parsers/pythonScript';
import { parseRequirementsTxt } from './parsers/requirementsTxt';
import { parseGemfile, parseGemspec } from './parsers/gemfile';
import { parseMixExs } from './parsers/mixExs';
import { parseTerraform, parseTflint } from './parsers/terraform';
import { CratesClient } from './registries/crates';
import { GoClient, proxyExclusion } from './registries/go';
import { NpmClient } from './registries/npm';
import { MavenClient } from './registries/maven';
import { NugetClient } from './registries/nuget';
import { PackagistClient } from './registries/packagist';
import { PubClient } from './registries/pub';
import { normalizeName, PyPiClient } from './registries/pypi';
import { RubyGemsClient } from './registries/rubygems';
import { HexClient } from './registries/hex';
import { TerraformClient } from './registries/terraform';
import { schemeFor, semverScheme } from './schemes';
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
import { applyLockfile } from './lockfiles';
import { osvAudit } from './registries/osv';
import { addCompatibility } from './compatibility';
import { RuntimeClient } from './registries/runtime';
import { cargoProject, nugetProject, dartProject } from './projectSources';
import { readProjectFile, isReferencedImportMap, jsonc } from './projectFiles';
import { registeredManifest } from './manifests';

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
  skipped?: { name: string; line: number; reason: string }[];
  declarations?: number;
}

/** Which manifest a file is, since Python spreads its dependencies over several. */
export type ManifestKind =
  | 'python-script'
  | 'gradle-wrapper'
  | 'leiningen'
  | 'gemspec'
  | 'ansible' | 'bazel' | 'vcpkg'
  | 'dockerfile' | 'compose' | 'helm' | 'swift' | 'conan-txt' | 'conan-py' | 'sbt' | 'conda' | 'clojure'
  | 'dotnet-tools' | 'dotnet-sdk' | 'yarn-catalog'
  | 'package.json'
  | 'composer.json'
  | 'pubspec.yaml'
  | 'gradle-catalog'
  | 'gradle-build'
  | 'deno'
  | 'github-actions'
  | 'pnpm-workspace.yaml'
  | 'go.mod'
  | 'Cargo.toml'
  | 'pyproject.toml'
  | 'Pipfile'
  | 'requirements.txt'
  | 'pom.xml'
  | 'nuget'
  | 'Gemfile'
  | 'mix.exs'
  | 'terraform'
  | 'tflint';

interface Manifest {
  ecosystem: Ecosystem;
  kind: ManifestKind;
}

export function manifestOf(fsPath: string): Manifest | undefined {
  return registeredManifest(fsPath) ?? (isReferencedImportMap(fsPath) ? { ecosystem: 'deno', kind: 'deno' } : undefined);
}

export function ecosystemOf(fsPath: string): Ecosystem | undefined {
  return manifestOf(fsPath)?.ecosystem;
}

export async function analyze(request: AnalyzeRequest): Promise<AnalyzeResult | undefined> {
  const cacheGeneration = request.cache.generation;
  const manifest = manifestOf(request.fsPath);
  if (!manifest || !enabledFor(manifest.ecosystem, request.settings)) {
    return undefined;
  }

  const { ecosystem } = manifest;
  const parsed = parseManifest(manifest.kind, request);
  if (manifest.kind === 'python-script' && !/^# \/\/\/ script\r?$/m.test(request.text)) return undefined;
  const deps = request.settings.useLockfiles ? applyLockfile(request.fsPath, ecosystem, parsed) : parsed;
  const defaultLookup = lookupFor(ecosystem, request.fsPath, request.settings);
  const lookups = new Map<Ecosystem, Lookup | undefined>([[ecosystem, defaultLookup]]);
  const forEcosystem = (target: Ecosystem): Lookup | undefined => {
    if (!lookups.has(target)) lookups.set(target, lookupFor(target, request.fsPath, request.settings));
    return lookups.get(target);
  };
  if (!defaultLookup && !deps.some((dep) => dep.runtime || dep.ecosystem)) {
    return undefined;
  }

  const { settings } = request;
  const result: AnalyzeResult = { ecosystem, updates: [], audits: [], failures: new Map(), incomplete: false,
    declarations: deps.length, skipped: [] };
  const baseOptions: ResolveOptions = {
    includePrerelease: settings.includePrerelease,
    showSatisfyingUpdates: settings.showSatisfyingUpdates,
    scheme: schemeFor(ecosystem),
  };

  await pool(deps, settings.concurrency, async (dep) => {
    const lookup: Lookup | undefined = dep.runtime ? { key: () => `runtime|${dep.runtime}`, fetch: () => new RuntimeClient(settings.requestTimeoutMs).fetch(dep.runtime!) }
      : dep.ecosystem ? forEcosystem(dep.ecosystem) : defaultLookup;
    if (!lookup || (dep.ecosystem && !enabledFor(dep.ecosystem, settings))) return;
    if (dep.skipReason) {
      result.skipped!.push({ name: dep.name, line: dep.line, reason: dep.skipReason });
      return;
    }
    const opts: ResolveOptions = { ...baseOptions, scheme: dep.versionScheme ?? (dep.semver ? semverScheme : dep.ecosystem ? schemeFor(dep.ecosystem) : baseOptions.scheme),
      includePrerelease: (baseOptions.includePrerelease || !!dep.minimumStability && dep.minimumStability !== 'stable') && dep.allowPrerelease !== false };
    if (dep.resolvedVersion && (!opts.scheme.isVersion(dep.resolvedVersion) || !opts.scheme.satisfies(dep.resolvedVersion, dep.spec, { includePrerelease: true }))) delete dep.resolvedVersion;
    if (request.isCancelled?.()) {
      return;
    }

    const key = lookup.key(dep);
    const sourceUrls = key.match(/https?:\/\/[^|]+/g) ?? [];
    const hasPublicSource = sourceUrls.length > 0 ? sourceUrls.every((url) => {
      try { return ['registry.npmjs.org', 'pypi.org', 'api.nuget.org', 'repo.maven.apache.org', 'repo1.maven.org', 'dl.google.com', 'plugins.gradle.org', 'repo.clojars.org', 'proxy.golang.org'].includes(new URL(url).hostname); }
      catch { return false; }
    }) : /^(?:rust\|crates\.io|php\|packagist\.org|ruby\|rubygems\.org|dart\|pub\.dev|elixir\|hex\.pm)\|/.test(key);
    const publicSource = !dep.runtime && !dep.skipReason && (!dep.source || dep.source === 'https://pub.dev') && hasPublicSource
      && (ecosystem !== 'go' || !proxyExclusion(dep.name));
    const auditFetcher = settings.auditProvider === 'osv'
      ? publicSource ? (dependency: DependencyRef, version: string) => osvAudit(dependency.ecosystem ?? ecosystem, dependency.name, version, settings.requestTimeoutMs) : undefined
      : lookup.fetchAudit;
    if (settings.auditEnabled) {
      const version = dep.resolvedVersion && opts.scheme.isVersion(dep.resolvedVersion) && opts.scheme.satisfies(dep.resolvedVersion, dep.spec, { includePrerelease: true })
        ? dep.resolvedVersion : opts.scheme.baseline(dep.spec);
      const audit: DependencyAudit = {
        dep, version, baseline: !dep.resolvedVersion && !opts.scheme.isPinned(dep.spec),
        result: { status: auditFetcher ? 'unchecked' : 'unsupported' },
      };
      if (auditFetcher && version) {
        const auditKey = `${key}|audit|${version}|${settings.auditProvider}`;
        const cached = request.auditCache.get(auditKey, settings.cacheDurationMinutes * 60_000);
        audit.result = cached ?? (request.allowNetwork
          ? await request.auditCache.resolve(auditKey, () => auditFetcher(dep, version))
          : { status: 'pending' });
        if (audit.result.status === 'pending') result.incomplete = true;
      }
      result.audits.push(audit);
    }
    if (request.isCancelled?.()) return;
    let versions = request.cache.get(key);
    const wantsAll = !!settings.runtimeVersions[dep.ecosystem ?? ecosystem] || (versions?.latest ? needsFullVersionList(dep.spec, versions.latest, opts) : false);

    if (!versions || (wantsAll && !versions.all)) {
      if (!request.allowNetwork) {
        result.incomplete = true;
        return;
      }
      // The abbreviated version list carries no descriptive fields, so anything
      // already known about the package is kept rather than fetched again.
      const known = versions?.meta;
      try {
        versions = wantsAll && lookup.fetchAll
          ? await request.cache.resolve(`${key}|all`, () => lookup.fetchAll!(dep))
          : await request.cache.resolve(`${key}|latest`, () => lookup.fetch(dep));
        // The latest version fell outside the declared range: ask for the full
        // list so the newest in-range version can be reported too.
        if (lookup.fetchAll && versions.latest && !versions.all && (wantsAll || needsFullVersionList(dep.spec, versions.latest, opts))) {
          const full = await request.cache.resolve(`${key}|all`, () => lookup.fetchAll!(dep));
          versions = { ...versions, ...full, ...(versions.meta ? { meta: versions.meta } : {}) };
        }
        if (known && !versions.meta && !versions.error) {
          versions = { ...versions, meta: known };
        }
      } catch (error) {
        versions = { error: error instanceof Error ? error.message : String(error) };
      }
      if (request.cache.generation === cacheGeneration) request.cache.set(key, versions);
    }

    if (versions.error) {
      result.failures.set(dep.name, versions.error);
      return;
    }

    if (dep.minimumStability && versions.all) {
      const ranks = { dev: 0, alpha: 1, beta: 2, rc: 3, stable: 4 };
      const minimum = ranks[dep.minimumStability];
      const all = versions.all.filter((version) => {
        const stability = !opts.scheme.isPrerelease(version) ? 'stable' : /-rc[.\d-]/i.test(version) ? 'rc' : /-beta[.\d-]/i.test(version) ? 'beta' : /-alpha[.\d-]/i.test(version) ? 'alpha' : 'dev';
        return ranks[stability] >= minimum;
      });
      versions = { ...versions, all, latest: opts.scheme.max(all, { includePrerelease: opts.includePrerelease }) };
    }
    if (dep.preferStable && versions.all?.some((version) => !opts.scheme.isPrerelease(version) && opts.scheme.satisfies(version, dep.spec, { includePrerelease: false }))) {
      opts.includePrerelease = false;
      versions = { ...versions, latest: opts.scheme.max(versions.all, { includePrerelease: false }) };
    }
    const update = computeUpdate(dep, versions, opts);
    if (update) {
      addCompatibility(update, versions, dep.ecosystem ?? ecosystem, settings.runtimeVersions[dep.ecosystem ?? ecosystem]);
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
    case 'gradle-wrapper': {
      const match = /^\s*distributionUrl\s*=.*\/gradle-(\d+\.\d+(?:\.\d+)?)-(?:bin|all)\.zip\s*$/m.exec(text);
      return match ? [{ name: 'gradle', runtime: 'gradle', spec: match[1].split('.').length === 2 ? `${match[1]}.0` : match[1],
        specRaw: match[1], semver: true, line: text.slice(0, match.index).split('\n').length - 1, section: 'distributionUrl' }] : [];
    }
    case 'python-script': return parsePythonScript(text);
    case 'ansible': return parseAnsible(text);
    case 'bazel': {
      const rc = readProjectFile(path.join(path.dirname(request.fsPath), '.bazelrc')) ?? '';
      const registries = [...rc.matchAll(/^\s*(?:common|build)\s+--registry(?:=|\s+)(https:\/\/[^\s#]+)/gm)].map((match) => match[1].replace(/\/$/, ''));
      return parseBazelProject(text, request.fsPath).map((dep) => registries.length ? { ...dep, source: registries.join('|') } : dep);
    }
    case 'vcpkg': return parseVcpkgProject(text, request.fsPath);
    case 'dockerfile': return parseDockerfile(text);
    case 'compose': return parseCompose(text);
    case 'helm': return parseHelm(text);
    case 'swift': {
      const deps = parseSwift(text);
      const config = readProjectFile(path.join(path.dirname(request.fsPath), '.swiftpm/configuration/registries.json'));
      return deps.map((dep) => {
        if (dep.source !== 'swift-registry') return dep;
        try {
          const registries = config ? (jsonc(config) as { registries?: Record<string, { url?: string }> }).registries : undefined;
          const source = (registries?.[dep.name.split('.')[0]] ?? registries?.['[default]'])?.url;
          return source && /^https:\/\/[^\s]+$/.test(source) ? { ...dep, source: source.replace(/\/$/, '') } : { ...dep, skipReason: 'Swift package registry is not configured' };
        } catch { return { ...dep, skipReason: 'Invalid Swift registry configuration' }; }
      });
    }
    case 'conan-txt': return parseConan(text, false);
    case 'conan-py': return parseConan(text, true);
    case 'sbt': return parseSbt(text, settings.scala);
    case 'conda': return parseConda(text);
    case 'clojure': return parseClojure(text);
    case 'leiningen': return parseLeiningen(text);
    case 'dotnet-tools': return nugetProject(request.fsPath, parseDotnetPins(text, false));
    case 'dotnet-sdk': return parseDotnetPins(text, true);
    case 'yarn-catalog': return parseYarnCatalog(text);
    case 'composer.json': return parseComposerJson(text);
    case 'pubspec.yaml': return dartProject(request.fsPath, parsePubspec(text, process.env.PUB_HOSTED_URL));
    case 'gradle-catalog': return parseGradleCatalog(text);
    case 'gradle-build': return parseGradleBuild(text);
    case 'deno': return parseDeno(text);
    case 'github-actions': {
      const normalized = request.fsPath.replace(/\\/g, '/');
      const workflow = normalized.indexOf('/.github/workflows/');
      const root = workflow >= 0 ? normalized.slice(0, workflow) : path.dirname(request.fsPath);
      return parseGithubActions(text, (filename) => {
        const target = path.resolve(root, filename);
        return target.startsWith(path.resolve(root) + path.sep) ? readProjectFile(target) : undefined;
      });
    }
    case 'pnpm-workspace.yaml': return parsePnpmWorkspace(text);
    case 'package.json':
      return parsePackageJson(text, settings.npm.sections);
    case 'go.mod':
      return parseGoMod(text, { includeIndirect: settings.go.includeIndirect });
    case 'Cargo.toml':
      return cargoProject(request.fsPath, text, parseCargoToml(text));
    case 'pyproject.toml':
      return parsePyProject(text, { includeBuildRequires: settings.python.includeBuildRequires });
    case 'Pipfile':
      return parsePipfile(text);
    case 'requirements.txt':
      return parseRequirementsTxt(text);
    case 'pom.xml':
      return parsePomXml(text);
    case 'nuget':
      return nugetProject(request.fsPath, parseNugetManifest(text));
    case 'Gemfile': return parseGemfile(text);
    case 'gemspec': {
      const gemfile = readProjectFile(path.join(path.dirname(request.fsPath), 'Gemfile'));
      const sources = gemfile && [...gemfile.matchAll(/^\s*source\s+["'](https:\/\/[^"']+)["']\s*$/gm)].map((match) => match[1].replace(/\/$/, ''));
      return parseGemspec(text, sources && new Set(sources).size === 1 ? sources[0] : undefined);
    }
    case 'mix.exs': return parseMixExs(text);
    case 'tflint': return parseTflint(text);
    case 'terraform': return parseTerraform(text, settings.terraform.defaultRegistry
      || (request.fsPath.endsWith('.tofu') ? 'registry.opentofu.org' : 'registry.terraform.io'));
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
    case 'ansible': {
      const client = new AnsibleClient(settings.requestTimeoutMs);
      return { key: (dep) => `ansible|${dep.source ?? 'galaxy.ansible.com'}|${dep.section}|${dep.name}`,
        fetch: (dep) => client.fetchVersions(dep.name, dep.section === 'roles', dep.source) };
    }
    case 'bazel': {
      const client = new BazelClient(settings.requestTimeoutMs);
      return { key: (dep) => `bazel|${dep.source ?? 'bcr.bazel.build'}|${dep.name}`, fetch: (dep) => client.fetchVersions(dep.name, dep.source),
        fetchDetails: async (dep, versions) => ({ meta: { compatibilityLevel: await client.compatibility(dep.name, versions.latest, dep.source) } }) };
    }
    case 'vcpkg': {
      const client = new VcpkgClient(settings.requestTimeoutMs);
      return { key: (dep) => `vcpkg|microsoft/vcpkg|${dep.name}|${dep.spec}|${dep.source}|${dep.vcpkgVersionField ?? ''}`,
        fetch: (dep) => client.fetchVersions(dep.name, dep.spec, dep.vcpkgVersionField, dep.source) };
    }
    case 'docker': {
      const client = new DockerClient(settings.requestTimeoutMs);
      return { key: (dep) => `docker|${dep.source ?? 'hub.docker.com'}|${dep.name}|${dockerTag(dep.spec)?.style}|${dep.revision ?? ''}`,
        fetch: (dep) => client.fetchVersions(dep.name, dep.spec, dep.source, dep.revision) };
    }
    case 'helm': {
      const client = new HelmClient(settings.requestTimeoutMs);
      return { key: (dep) => `helm|${dep.source}|${dep.name}`, fetch: (dep) => client.fetchVersions(dep.name, dep.source!) };
    }
    case 'swift': {
      const client = new SwiftClient(settings.requestTimeoutMs);
      return { key: (dep) => `swift|${dep.source ?? 'github.com'}|${dep.name.toLowerCase()}`, fetch: (dep) => client.fetchVersions(dep.name, dep.source) };
    }
    case 'conan': {
      const client = new ConanClient(settings.requestTimeoutMs);
      return { key: (dep) => `conan|${client.remotes.map((remote) => remote.url).join('|') || 'conan-center-index'}|${dep.name}|${dep.revision ?? ''}`, fetch: (dep) => client.fetchVersions(dep.name, dep.revision) };
    }
    case 'conda': {
      const client = new CondaClient(settings.requestTimeoutMs, settings.conda.subdir || condaSubdir());
      return { key: (dep) => `conda|${dep.source}|${client.subdir}|${dep.name}`, fetch: (dep) => client.fetchVersions(dep.name, dep.source!) };
    }
    case 'scala': {
      const lookup = mavenRepositoriesLookup(ecosystem, settings.scala.repositories, settings.requestTimeoutMs);
      return { ...lookup, key: (dep) => `${lookup.key(dep)}|${dep.variants?.join(',') ?? ''}`,
        async fetch(dep) {
          if (!dep.variants?.length) return lookup.fetch(dep);
          const results = await Promise.all(dep.variants.map((name) => lookup.fetch({ ...dep, name })));
          const failure = results.find((result) => result.error);
          if (failure) return failure;
          const all = results[0].all?.filter((version) => results.every((result) => result.all?.includes(version))) ?? [];
          return { all, latest: schemeFor('scala').max(all, { includePrerelease: false }) };
        } };
    }
    case 'clojure': return mavenRepositoriesLookup(ecosystem, settings.clojure.repositories, settings.requestTimeoutMs);
    case 'deno': {
      const npm = npmLookup(fsPath, settings);
      const jsr = new JsrClient(settings.requestTimeoutMs);
      const unprefixed = (dep: DependencyRef): DependencyRef => ({ ...dep, name: dep.name.slice(4) });
      return {
        key: (dep) => dep.name.startsWith('npm:') ? npm.key(unprefixed(dep)) : `deno|jsr.io|${dep.name}`,
        fetch: (dep) => dep.name.startsWith('npm:') ? npm.fetch(unprefixed(dep)) : jsr.fetchVersions(dep.name.slice(4)),
        fetchAll: (dep) => dep.name.startsWith('npm:') ? npm.fetchAll!(unprefixed(dep)) : jsr.fetchVersions(dep.name.slice(4)),
        fetchAudit: (dep, version) => dep.name.startsWith('npm:') ? npm.fetchAudit!(unprefixed(dep), version)
          : Promise.resolve({ status: 'unsupported' }),
        fetchDetails: (dep, versions) => dep.name.startsWith('npm:') ? npm.fetchDetails!(unprefixed(dep), versions) : Promise.resolve({}),
      };
    }
    case 'githubActions': {
      const client = new GithubActionsClient(settings.requestTimeoutMs);
      return {
        key: (dep) => dep.actionRuntime
          ? `githubActions|runtime|${dep.actionRuntime}|${dep.matrixVersions ? '3' : actionTagStyle(dep.spec)}`
          : `githubActions|github.com|${dep.name.toLowerCase()}|${actionTagStyle(dep.spec)}${dep.revision ? `|${dep.revision}` : ''}`,
        fetch: (dep) => dep.actionRuntime ? client.fetchRuntimeVersions(dep.actionRuntime, dep.matrixVersions ? '0.0.0' : dep.spec)
          : client.fetchVersions(dep.name, dep.spec, dep.revision),
      };
    }
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
    case 'ruby':
      return rubyLookup(settings);
    case 'terraform':
      return terraformLookup(settings);
    case 'elixir':
      return hexLookup(settings);
  }
}

function npmLookup(fsPath: string, settings: Settings): Lookup {
  const client = new NpmClient({
    ...(settings.npm.registry ? { registryOverride: settings.npm.registry } : {}),
    cwd: path.dirname(fsPath),
    timeoutMs: settings.requestTimeoutMs,
  });
  const clients = new Map<string, NpmClient>();
  const clientFor = (dep: DependencyRef) => {
    if (!dep.source || settings.npm.registry) return client;
    let scoped = clients.get(dep.source);
    if (!scoped) {
      scoped = new NpmClient({ registryOverride: dep.source, cwd: path.dirname(fsPath), timeoutMs: settings.requestTimeoutMs });
      clients.set(dep.source, scoped);
    }
    return scoped;
  };
  return {
    key: (dep) => `npm|${clientFor(dep).registryFor(dep.name)}|${dep.name}`,
    fetch: (dep) => clientFor(dep).fetchLatest(dep.name),
    fetchAll: (dep) => clientFor(dep).fetchAll(dep.name),
    fetchAudit: (dep, version) => clientFor(dep).fetchAudit(dep.name, version),
    // The descriptive fields already came back with the version; only the dates
    // are missing, and they live in a document big enough to be worth deferring.
    async fetchDetails(dep, versions) {
      const dates = await clientFor(dep).fetchPublishDates(dep.name, [versions.current, versions.latest]);
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
  const clients = new Map<string, PyPiClient>();
  const clientFor = (dep: DependencyRef): PyPiClient => {
    if (!dep.source || settings.python.indexUrl) return client;
    let scoped = clients.get(dep.source);
    if (!scoped) {
      scoped = new PyPiClient({ indexOverride: dep.source, timeoutMs: settings.requestTimeoutMs });
      clients.set(dep.source, scoped);
    }
    return scoped;
  };
  return {
    key: (dep) => `python|${clientFor(dep).index}|${normalizeName(dep.name)}`,
    fetch: (dep) => clientFor(dep).fetchVersions(dep.name),
    fetchAudit: (dep, version) => clientFor(dep).fetchAudit(dep.name, version),
    // The index already dated every file it listed, so only the prose costs a request.
    async fetchDetails(dep, versions) {
      const [dates, meta] = await Promise.all([
        clientFor(dep).fetchPublishDates(dep.name, [versions.current, versions.latest]),
        clientFor(dep).fetchInfo(dep.name, versions.latest),
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
    key: (dep) => `rust|${dep.source ?? 'crates.io'}|${dep.name.toLowerCase().replace(/_/g, '-')}`,
    fetch: (dep) => client.fetchVersions(dep.name, dep.source),
  };
}

function dotnetLookup(settings: Settings): Lookup {
  const client = new NugetClient(settings.dotnet.indexUrl, settings.requestTimeoutMs);
  const sdk = new DotnetSdkClient(settings.requestTimeoutMs);
  return {
    key: (dep) => dep.section === 'sdk' ? 'dotnet|sdk|release-metadata' : `dotnet|${settings.dotnet.indexUrl || dep.source || client.index}|${dep.name.toLowerCase()}`,
    async fetch(dep) {
      if (dep.section === 'sdk') return sdk.fetchVersions();
      if (!dep.source || settings.dotnet.indexUrl) return client.fetchVersions(dep.name);
      const all: string[] = [];
      for (const url of dep.source.split('|')) {
        const result = await new NugetClient(url, settings.requestTimeoutMs).fetchVersions(dep.name);
        if (result.error && result.error !== 'not found') return result;
        all.push(...result.all ?? []);
      }
      return all.length ? { all: [...new Set(all)], latest: schemeFor('dotnet').max(all, { includePrerelease: false }) } : { error: 'not found' };
    },
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
  return { key: (dep) => `php|${dep.source ?? 'packagist.org'}|${dep.name}`, fetch: (dep) => client.fetchVersions(dep.name, dep.source) };
}

function dartLookup(settings: Settings): Lookup {
  const client = new PubClient(settings.requestTimeoutMs);
  return { key: (dep) => `dart|${dep.source ?? 'pub.dev'}|${dep.name}`, fetch: (dep) => client.fetchVersions(dep.name, dep.source) };
}

function gradleLookup(settings: Settings): Lookup {
  return mavenRepositoriesLookup('gradle', settings.gradle.repositories, settings.requestTimeoutMs);
}

function mavenRepositoriesLookup(ecosystem: string, repositories: string[], timeoutMs: number): Lookup {
  const clients = repositories.map((repository) => new MavenClient(repository, timeoutMs));
  const forDependency = (dep: DependencyRef) => dep.source ? dep.source.split('|').map((url) => new MavenClient(url, timeoutMs)) : clients;
  return {
    key: (dep) => `${ecosystem}|${forDependency(dep).map((client) => client.repository).join('|')}|${dep.name}`,
    async fetch(dep) {
      for (const client of forDependency(dep)) {
        const result = await client.fetchVersions(dep.name);
        if (result.error !== 'not found') return result;
      }
      return { error: 'not found' };
    },
  };
}

function rubyLookup(settings: Settings): Lookup {
  const client = new RubyGemsClient(settings.requestTimeoutMs);
  return { key: (dep) => `ruby|${dep.source ?? 'rubygems.org'}|${dep.name}`, fetch: (dep) => client.fetchVersions(dep.name, dep.source) };
}

function terraformLookup(settings: Settings): Lookup {
  const client = new TerraformClient(settings.requestTimeoutMs);
  return { key: (dep) => `terraform|${dep.name.toLowerCase()}`, fetch: (dep) => client.fetchVersions(dep.name) };
}

function hexLookup(settings: Settings): Lookup {
  const client = new HexClient(settings.requestTimeoutMs);
  return { key: (dep) => `elixir|${dep.source ?? 'hex.pm'}|${dep.name.toLowerCase()}`, fetch: (dep) => client.fetchVersions(dep.name, dep.source) };
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
