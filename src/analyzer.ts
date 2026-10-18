import * as path from 'path';
import { checkAvailability } from './availability';
import { parseAnsible } from './parsers/ansible';
import { parseBazelProject } from './parsers/bazelProject';
import { parseVcpkgProject } from './parsers/vcpkgProject';
import { parseDockerfile, parseCompose } from './parsers/docker';
import { parseHelm } from './parsers/helm';
import { parseSwift } from './parsers/swift';
import { parseConan } from './parsers/conan';
import { parseSbt } from './parsers/scala';
import { parseConda } from './parsers/conda';
import { parseClojure, parseLeiningen } from './parsers/clojure';
import { parseDotnetPins } from './parsers/dotnetPins';
import { parseYarnCatalog } from './parsers/yarnCatalog';
import type { AuditCache } from './audit';
import type { VersionCache } from './cache';
import type { Settings } from './config';
import { parseCargoToml } from './parsers/cargoToml';
import { parseComposerJson } from './parsers/composerJson';
import { parseGoMod } from './parsers/goMod';
import { parseGradleCatalog } from './parsers/gradleCatalog';
import { parseGradleBuild } from './parsers/gradleBuild';
import { parseDeno } from './parsers/deno';
import { parseGithubActions } from './parsers/githubActions';
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
import { lookupFor } from './lookups';
import type { Lookup } from './lookups/types';
import { schemeFor, semverScheme } from './schemes';
import type {
  DependencyRef,
  DependencyStatus,
  DependencyAudit,
  DependencyUpdate,
  Ecosystem,
  RegistryVersions,
  ResolveOptions,
} from './types';
import { computeUpdate, needsFullVersionList } from './versions';
import { applyLockfile } from './lockfiles';
import { auditFetcher as fetchAuditFor } from './auditRouting';
import { allowsPrerelease, exclusionFor, packagePolicy } from './policies';
import { addCompatibility } from './compatibility';
import { RuntimeClient } from './registries/runtime';
import { cargoProject, nugetProject, dartProject } from './projectSources';
import { readProjectFile, isReferencedImportMap, jsonc } from './projectFiles';
import { registeredManifest } from './manifests';

export { lookupFor } from './lookups';
export type { Lookup, PackageDetails, VersionPair } from './lookups/types';

export interface AnalyzeRequest {
  workspaceRoot?: string;
  fsPath: string;
  text: string;
  settings: Settings;
  cache: VersionCache;
  auditCache: AuditCache;
  /** When false only cached versions are used, so typing never hits the network. */
  allowNetwork: boolean;
  isCancelled?: () => boolean;
  signal?: AbortSignal;
}

export interface AnalyzeResult {
  excluded?: string;
  policies?: {
    name: string;
    line: number;
    section: string;
    ignoreUpdates: boolean;
    ignoreMajorUpdates?: boolean;
    prereleasePolicy: string;
  }[];
  runtimeVersions?: Record<string, string>;
  auditProvider?: 'registry' | 'osv';
  ecosystem: Ecosystem;
  /** Parsed declarations, including those with no update or a skipped lookup. */
  dependencies?: DependencyRef[];
  updates: DependencyUpdate[];
  /** Confirmed updates hidden by package rules, retained for status details only. */
  suppressedUpdates?: (DependencyUpdate & { reason: 'updates' | 'major' })[];
  statuses?: DependencyStatus[];
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
  | 'ansible'
  | 'bazel'
  | 'vcpkg'
  | 'dockerfile'
  | 'compose'
  | 'helm'
  | 'swift'
  | 'conan-txt'
  | 'conan-py'
  | 'sbt'
  | 'conda'
  | 'clojure'
  | 'dotnet-tools'
  | 'dotnet-sdk'
  | 'yarn-catalog'
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
  return (
    registeredManifest(fsPath) ??
    (isReferencedImportMap(fsPath) ? { ecosystem: 'deno', kind: 'deno' } : undefined)
  );
}

export function ecosystemOf(fsPath: string): Ecosystem | undefined {
  return manifestOf(fsPath)?.ecosystem;
}

export async function analyze(request: AnalyzeRequest): Promise<AnalyzeResult | undefined> {
  const isCancelled = () => request.signal?.aborted || request.isCancelled?.();
  const cacheGeneration = request.cache.generation;
  const manifest = manifestOf(request.fsPath);
  if (!manifest || !enabledFor(manifest.ecosystem, request.settings)) {
    return undefined;
  }

  const { ecosystem } = manifest;
  const excluded = exclusionFor(request.fsPath, request.settings.exclude, request.workspaceRoot);
  if (excluded)
    return {
      ecosystem,
      excluded,
      declarations: 0,
      dependencies: [],
      updates: [],
      audits: [],
      failures: new Map(),
      incomplete: false,
    };
  const parsed = parseManifest(manifest.kind, request);
  if (manifest.kind === 'python-script' && !/^# \/\/\/ script\r?$/m.test(request.text))
    return undefined;
  const defaultLookup = lookupFor(ecosystem, request.fsPath, request.settings);
  const deps = request.settings.useLockfiles
    ? applyLockfile(
        request.fsPath,
        ecosystem,
        parsed,
        (dep) => defaultLookup?.availabilitySource?.(dep) ?? dep.source,
        request.workspaceRoot
      )
    : parsed;
  const lookups = new Map<Ecosystem, Lookup | undefined>([[ecosystem, defaultLookup]]);
  const forEcosystem = (target: Ecosystem): Lookup | undefined => {
    if (!lookups.has(target))
      lookups.set(target, lookupFor(target, request.fsPath, request.settings));
    return lookups.get(target);
  };
  if (!defaultLookup && !deps.some((dep) => dep.runtime || dep.ecosystem)) {
    return undefined;
  }

  const { settings } = request;
  const result: AnalyzeResult = {
    ecosystem,
    updates: [],
    suppressedUpdates: [],
    audits: [],
    failures: new Map(),
    incomplete: false,
    declarations: deps.length,
    dependencies: deps,
    skipped: [],
    statuses: [],
    policies: [],
    runtimeVersions: settings.runtimeVersions,
    auditProvider: settings.auditEnabled ? settings.auditProvider : undefined,
  };
  const baseOptions: ResolveOptions = {
    includePrerelease: settings.includePrerelease,
    showSatisfyingUpdates: settings.showSatisfyingUpdates,
    scheme: schemeFor(ecosystem),
  };

  await pool(deps, settings.concurrency, async (dep) => {
    const lookup: Lookup | undefined = dep.runtime
      ? {
          key: () => `runtime|${dep.runtime}`,
          fetch: () => new RuntimeClient(settings.requestTimeoutMs).fetch(dep.runtime!),
        }
      : dep.ecosystem
        ? forEcosystem(dep.ecosystem)
        : defaultLookup;
    if (!lookup || (dep.ecosystem && !enabledFor(dep.ecosystem, settings))) return;
    if (dep.skipReason) {
      result.skipped!.push({ name: dep.name, line: dep.line, reason: dep.skipReason });
      return;
    }
    const policy = packagePolicy(dep, ecosystem, settings);
    const opts: ResolveOptions = {
      ...baseOptions,
      scheme:
        dep.versionScheme ??
        (dep.semver ? semverScheme : dep.ecosystem ? schemeFor(dep.ecosystem) : baseOptions.scheme),
    };
    if (
      dep.resolvedVersion &&
      (!opts.scheme.isVersion(dep.resolvedVersion) ||
        !opts.scheme.satisfies(dep.resolvedVersion, dep.spec, { includePrerelease: true }))
    ) {
      delete dep.resolvedVersion;
      delete dep.baselineOrigin;
      dep.baselineUnavailable = 'Lockfile selection does not satisfy the declaration.';
    }
    opts.includePrerelease = allowsPrerelease(
      dep,
      opts.scheme,
      policy.prereleasePolicy,
      baseOptions.includePrerelease
    );
    opts.ignoreMajorUpdates = policy.ignoreMajorUpdates;
    if (policy.ignoreUpdates || policy.ignoreMajorUpdates || policy.prereleasePolicy !== 'inherit')
      result.policies!.push({ name: dep.name, line: dep.line, section: dep.section, ...policy });
    if (isCancelled()) {
      return;
    }

    const key = lookup.key(dep);
    const auditFetcher = fetchAuditFor(dep, dep.ecosystem ?? ecosystem, lookup, settings);
    if (settings.auditEnabled) {
      const version =
        dep.resolvedVersion &&
        opts.scheme.isVersion(dep.resolvedVersion) &&
        opts.scheme.satisfies(dep.resolvedVersion, dep.spec, { includePrerelease: true })
          ? dep.resolvedVersion
          : opts.scheme.baseline(dep.spec);
      const audit: DependencyAudit = {
        dep,
        version,
        baseline: !dep.resolvedVersion && !opts.scheme.isPinned(dep.spec),
        provider: settings.auditProvider,
        result: { status: auditFetcher ? 'unchecked' : 'unsupported' },
      };
      if (auditFetcher && version) {
        const auditKey = `${key}|audit|${version}|${settings.auditProvider}`;
        const cached = request.auditCache.get(auditKey, settings.cacheDurationMinutes * 60_000);
        audit.result =
          cached ??
          (request.allowNetwork
            ? await request.auditCache.resolve(
                auditKey,
                () => auditFetcher(dep, version),
                request.signal
              )
            : { status: 'pending' });
        if (audit.result.status === 'pending') result.incomplete = true;
      }
      result.audits.push(audit);
    }
    if (isCancelled()) return;
    let versions = request.cache.get(key);
    const source = lookup.availabilitySource?.(dep) ?? dep.source ?? key.split('|')[1];
    const needsAvailability = (value: RegistryVersions | undefined) => {
      if (dep.githubRepository) return false;
      if (!lookup.fetchAll || !value || value.error || value.packageMissing || value.allComplete)
        return false;
      const current = dep.resolvedVersion ?? opts.scheme.baseline(dep.spec);
      return (
        checkAvailability(dep, value, opts).status === 'unknown' ||
        (!!current &&
          !!value.latest &&
          opts.scheme.isVersion(value.latest) &&
          opts.scheme.compare(current, value.latest) > 0)
      );
    };
    const policyNeedsAll = (value: RegistryVersions | undefined) =>
      policy.prereleasePolicy !== 'inherit' &&
      !opts.includePrerelease &&
      !!value?.latest &&
      opts.scheme.isVersion(value.latest) &&
      opts.scheme.isPrerelease(value.latest);
    const wantsAll =
      !dep.githubRepository &&
      (needsAvailability(versions) ||
        policyNeedsAll(versions) ||
        !!settings.runtimeVersions[dep.ecosystem ?? ecosystem] ||
        (versions?.latest ? needsFullVersionList(dep.spec, versions.latest, opts) : false));

    if (
      !request.allowNetwork &&
      (!versions || (wantsAll && !versions.all) || needsAvailability(versions))
    ) {
      result.incomplete = true;
      if (!versions) {
        result.statuses!.push(checkAvailability(dep, { source }, opts));
        return;
      }
    }
    if (
      request.allowNetwork &&
      (!versions || (wantsAll && !versions.all) || needsAvailability(versions))
    ) {
      // The abbreviated version list carries no descriptive fields, so anything
      // already known about the package is kept rather than fetched again.
      const known = versions?.meta;
      try {
        versions =
          wantsAll && lookup.fetchAll
            ? await request.cache.resolve(`${key}|all`, () => lookup.fetchAll!(dep), request.signal)
            : await request.cache.resolve(`${key}|latest`, () => lookup.fetch(dep), request.signal);
        // Fetch release history when a same-major or in-range step may exist.
        if (
          !dep.githubRepository &&
          lookup.fetchAll &&
          !versions.all &&
          !versions.error &&
          !versions.packageMissing &&
          (needsAvailability(versions) ||
            policyNeedsAll(versions) ||
            (versions.latest &&
              (wantsAll || needsFullVersionList(dep.spec, versions.latest, opts))))
        ) {
          const full = await request.cache.resolve(
            `${key}|all`,
            () => lookup.fetchAll!(dep),
            request.signal
          );
          versions = { ...versions, ...full, ...(versions.meta ? { meta: versions.meta } : {}) };
        }
        if (known && !versions.meta && !versions.error) {
          versions = { ...versions, meta: known };
        }
      } catch (error) {
        if (isCancelled()) return;
        versions = { error: error instanceof Error ? error.message : String(error) };
      }
      if (request.cache.generation === cacheGeneration) request.cache.set(key, versions);
    }

    if (!versions || isCancelled()) return;
    let availability = versions;
    const initialStatus = checkAvailability(dep, versions, opts).status;
    if (
      lookup.fetchAvailability &&
      !versions.error &&
      initialStatus !== 'available' &&
      initialStatus !== 'ahead'
    ) {
      const availabilityKey = `${key}|availability|${dep.spec}`;
      let evidence = request.cache.get(availabilityKey);
      if (!evidence && request.allowNetwork) {
        try {
          evidence = await request.cache.resolve(
            availabilityKey,
            () => lookup.fetchAvailability!(dep, versions!),
            request.signal
          );
        } catch (error) {
          if (isCancelled()) return;
          evidence = { error: error instanceof Error ? error.message : String(error) };
        }
        if (request.cache.generation === cacheGeneration)
          request.cache.set(availabilityKey, evidence);
      }
      if (!evidence) result.incomplete = true;
      availability = {
        ...versions,
        ...evidence,
        published: evidence?.published ?? [],
        allComplete: evidence?.allComplete ?? false,
      };
    }
    const status = checkAvailability(
      dep,
      { ...availability, source: availability.source ?? source },
      opts
    );
    result.statuses!.push(status);
    if (status.status === 'unknown') result.incomplete = true;
    if (availability.error) result.failures.set(dep.name, availability.error);
    if (versions.error) return;

    if (dep.minimumStability && versions.all) {
      const ranks = { dev: 0, alpha: 1, beta: 2, rc: 3, stable: 4 };
      const minimum = ranks[dep.minimumStability];
      const all = versions.all.filter((version) => {
        const stability = !opts.scheme.isPrerelease(version)
          ? 'stable'
          : /-rc[.\d-]/i.test(version)
            ? 'rc'
            : /-beta[.\d-]/i.test(version)
              ? 'beta'
              : /-alpha[.\d-]/i.test(version)
                ? 'alpha'
                : 'dev';
        return ranks[stability] >= minimum;
      });
      versions = {
        ...versions,
        all,
        latest: opts.scheme.max(all, { includePrerelease: opts.includePrerelease }),
      };
    }
    if (
      dep.preferStable &&
      versions.all?.some(
        (version) =>
          !opts.scheme.isPrerelease(version) &&
          opts.scheme.satisfies(version, dep.spec, { includePrerelease: false })
      )
    ) {
      opts.includePrerelease = false;
      versions = {
        ...versions,
        latest: opts.scheme.max(versions.all, { includePrerelease: false }),
      };
    }
    // Explicit policies also filter registries that return a prerelease as `latest`.
    if (policy.prereleasePolicy !== 'inherit' && !opts.includePrerelease) {
      const all = versions.all?.filter(
        (version) => opts.scheme.isVersion(version) && !opts.scheme.isPrerelease(version)
      );
      versions = {
        ...versions,
        all,
        latest:
          versions.latest && opts.scheme.isPrerelease(versions.latest)
            ? opts.scheme.max(all ?? [], { includePrerelease: false })
            : versions.latest,
      };
    }
    const update = policy.ignoreUpdates ? undefined : computeUpdate(dep, versions, opts);
    if (policy.ignoreUpdates || policy.ignoreMajorUpdates) {
      const suppressed = computeUpdate(dep, versions, { ...opts, ignoreMajorUpdates: false });
      if (suppressed && (policy.ignoreUpdates || suppressed.latest !== update?.latest))
        result.suppressedUpdates!.push({
          ...suppressed,
          source,
          reason: policy.ignoreUpdates ? 'updates' : 'major',
        });
    }
    if (update) {
      update.source = source;
      addCompatibility(
        update,
        versions,
        dep.ecosystem ?? ecosystem,
        settings.runtimeVersions[dep.ecosystem ?? ecosystem]
      );
      if (
        policy.ignoreMajorUpdates &&
        update.compatible &&
        opts.scheme.classify(update.current, update.compatible) === 'major'
      )
        delete update.compatible;
      result.updates.push(update);
    }
  });

  result.updates.sort((a, b) => a.dep.line - b.dep.line);
  result.suppressedUpdates?.sort((a, b) => a.dep.line - b.dep.line);
  result.statuses?.sort((a, b) => a.dep.line - b.dep.line);
  result.policies?.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return result;
}

function enabledFor(ecosystem: Ecosystem, settings: Settings): boolean {
  return settings[ecosystem].enabled;
}

function parseManifest(kind: ManifestKind, request: AnalyzeRequest): DependencyRef[] {
  const { settings, text } = request;
  switch (kind) {
    case 'gradle-wrapper': {
      const match =
        /^\s*distributionUrl\s*=.*\/gradle-(\d+\.\d+(?:\.\d+)?)-(?:bin|all)\.zip\s*$/m.exec(text);
      return match
        ? [
            {
              name: 'gradle',
              runtime: 'gradle',
              spec: match[1].split('.').length === 2 ? `${match[1]}.0` : match[1],
              specRaw: match[1],
              semver: true,
              line: text.slice(0, match.index).split('\n').length - 1,
              section: 'distributionUrl',
            },
          ]
        : [];
    }
    case 'python-script':
      return parsePythonScript(text);
    case 'ansible':
      return parseAnsible(text);
    case 'bazel': {
      const rc = readProjectFile(path.join(path.dirname(request.fsPath), '.bazelrc')) ?? '';
      const registries = [
        ...rc.matchAll(/^\s*(?:common|build)\s+--registry(?:=|\s+)(https:\/\/[^\s#]+)/gm),
      ].map((match) => match[1].replace(/\/$/, ''));
      return parseBazelProject(text, request.fsPath).map((dep) =>
        registries.length ? { ...dep, source: registries.join('|') } : dep
      );
    }
    case 'vcpkg':
      return parseVcpkgProject(text, request.fsPath);
    case 'dockerfile':
      return parseDockerfile(text);
    case 'compose':
      return parseCompose(text);
    case 'helm':
      return parseHelm(text);
    case 'swift': {
      const deps = parseSwift(text);
      const config = readProjectFile(
        path.join(path.dirname(request.fsPath), '.swiftpm/configuration/registries.json')
      );
      return deps.map((dep) => {
        if (dep.source !== 'swift-registry') return dep;
        try {
          const registries = config
            ? (jsonc(config) as { registries?: Record<string, { url?: string }> }).registries
            : undefined;
          const source = (registries?.[dep.name.split('.')[0]] ?? registries?.['[default]'])?.url;
          return source && /^https:\/\/[^\s]+$/.test(source)
            ? { ...dep, source: source.replace(/\/$/, '') }
            : { ...dep, skipReason: 'Swift package registry is not configured' };
        } catch {
          return { ...dep, skipReason: 'Invalid Swift registry configuration' };
        }
      });
    }
    case 'conan-txt':
      return parseConan(text, false);
    case 'conan-py':
      return parseConan(text, true);
    case 'sbt':
      return parseSbt(text, settings.scala);
    case 'conda':
      return parseConda(text);
    case 'clojure':
      return parseClojure(text);
    case 'leiningen':
      return parseLeiningen(text);
    case 'dotnet-tools':
      return nugetProject(request.fsPath, parseDotnetPins(text, false));
    case 'dotnet-sdk':
      return parseDotnetPins(text, true);
    case 'yarn-catalog':
      return parseYarnCatalog(text);
    case 'composer.json':
      return parseComposerJson(text);
    case 'pubspec.yaml':
      return dartProject(request.fsPath, parsePubspec(text, process.env.PUB_HOSTED_URL));
    case 'gradle-catalog':
      return parseGradleCatalog(text);
    case 'gradle-build':
      return parseGradleBuild(text);
    case 'deno':
      return parseDeno(text);
    case 'github-actions': {
      const normalized = request.fsPath.replace(/\\/g, '/');
      const workflow = normalized.indexOf('/.github/workflows/');
      const root = workflow >= 0 ? normalized.slice(0, workflow) : path.dirname(request.fsPath);
      return parseGithubActions(text, (filename) => {
        const target = path.resolve(root, filename);
        return target.startsWith(path.resolve(root) + path.sep)
          ? readProjectFile(target)
          : undefined;
      });
    }
    case 'pnpm-workspace.yaml':
      return parsePnpmWorkspace(text);
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
    case 'Gemfile':
      return parseGemfile(text);
    case 'gemspec': {
      const gemfile = readProjectFile(path.join(path.dirname(request.fsPath), 'Gemfile'));
      const sources =
        gemfile &&
        [...gemfile.matchAll(/^\s*source\s+["'](https:\/\/[^"']+)["']\s*$/gm)].map((match) =>
          match[1].replace(/\/$/, '')
        );
      return parseGemspec(text, sources && new Set(sources).size === 1 ? sources[0] : undefined);
    }
    case 'mix.exs':
      return parseMixExs(text);
    case 'tflint':
      return parseTflint(text);
    case 'terraform':
      return parseTerraform(
        text,
        settings.terraform.defaultRegistry ||
          (request.fsPath.endsWith('.tofu') ? 'registry.opentofu.org' : 'registry.terraform.io')
      );
  }
}

/** Runs `worker` over every item with a bounded number of requests in flight. */
async function pool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (cursor < items.length) {
      await worker(items[cursor++]);
    }
  });
  await Promise.all(runners);
}
