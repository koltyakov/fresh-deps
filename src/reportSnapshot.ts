import { basename, dirname, isAbsolute, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { ReportFile } from './report';
import { normalizedPath } from './policies';
import { schemeFor, semverScheme } from './schemes';
import { redact, safeUrl } from './sanitize';
import type {
  AuditResponse,
  DependencyRef,
  Ecosystem,
  SecurityAdvisory,
  UpdateKind,
} from './types';

export interface ReportDeclaration {
  name: string;
  alias?: string;
  section: string;
  line: number;
  ecosystem: Ecosystem;
  declared: string;
  source?: string;
  baseline?: {
    version: string;
    kind: 'lockfile' | 'declared' | 'range';
    lockfile?: string;
    importer?: string;
    descriptor?: string;
  };
  baselineUnavailable?: string;
  update?: {
    current: string;
    latest: string;
    kind: UpdateKind;
    inRange: boolean;
    sameMajor?: string;
    satisfying?: string;
    compatible?: string;
    alternatePath?: string;
    commit?: boolean;
    matrix?: { versions: string[]; newer?: string };
  };
  availability?: { status: string; message: string; latest?: string };
  audit?: {
    version?: string;
    baseline: boolean;
    provider?: string;
    result: AuditResponse | { status: 'pending' | 'unchecked' };
  };
  policy?: { ignoreUpdates: boolean; ignoreMajorUpdates?: boolean; prereleasePolicy: string };
  failure?: string;
  skipped?: string;
}

export interface ReportSnapshotFile {
  path: string;
  workspace?: string;
  ecosystem?: Ecosystem;
  declarationCount: number;
  declarations: ReportDeclaration[];
  incomplete: boolean;
  error?: string;
  excluded?: string;
  directory?: boolean;
  runtimeVersions?: Record<string, string>;
  issues: string[];
}

export interface ReportSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  workspaces: string[];
  scope: string;
  summary: {
    manifestsAnalyzed: number;
    declarationsFound: number;
    outdatedDeclarations: number;
    filesWithUpdates: number;
    updatesByKind: Record<UpdateKind, number>;
    excludedFiles: number;
    excludedDirectories: number;
    incomplete: boolean;
  };
  files: ReportSnapshotFile[];
}

const declarationKey = (dep: DependencyRef) =>
  JSON.stringify([dep.line, dep.section, dep.name, dep.spec, dep.alias, dep.ecosystem, dep.source]);

function advisory(value: SecurityAdvisory, clean: (value: string) => string): SecurityAdvisory {
  return {
    id: clean(value.id),
    title: clean(value.title),
    ...(value.severity ? { severity: clean(value.severity) } : {}),
    ...(safeUrl(value.url) ? { url: safeUrl(value.url) } : {}),
    ...(value.fixedVersions ? { fixedVersions: value.fixedVersions.map(clean) } : {}),
    ...(value.scores
      ? {
          scores: value.scores.map((score) => ({
            type: clean(score.type),
            score: clean(score.score),
          })),
        }
      : {}),
    ...(value.affected
      ? {
          affected: value.affected.map((range) => ({
            type: clean(range.type),
            ...(safeUrl(range.repo) ? { repo: safeUrl(range.repo) } : {}),
            events: range.events.map((event) =>
              Object.fromEntries(
                Object.entries(event).map(([key, version]) => [key, clean(version)])
              )
            ),
          })),
        }
      : {}),
  };
}

/** Explicit, serializable schema. Never export lookup keys, raw refs, credentials, or file URIs. */
export function createReportSnapshot(
  files: ReportFile[],
  roots: string[],
  now = new Date()
): ReportSnapshot {
  const normalized = files
    .map((file): ReportSnapshotFile => {
      const label = normalizedPath(isAbsolute(file.path) ? basename(file.path) : file.path);
      let directory: string | undefined;
      try {
        directory = dirname(fileURLToPath(file.uri));
      } catch {
        /* Non-file providers need no local path rewriting. */
      }
      const root =
        file.rootPath ??
        (directory ? resolve(directory, relative(dirname(label), '.')) : undefined);
      const clean = (value: string) =>
        redact(root && root !== '/' ? value.split(root).join('.') : value);
      const result = file.result;
      const out: ReportSnapshotFile = {
        path: clean(label),
        workspace: file.workspace ? clean(file.workspace) : undefined,
        ecosystem: result?.ecosystem,
        declarationCount: result?.declarations ?? result?.dependencies?.length ?? 0,
        declarations: [],
        incomplete: !!(
          file.error ||
          result?.incomplete ||
          result?.failures.size ||
          result?.skipped?.length
        ),
        ...(file.error ? { error: clean(file.error) } : {}),
        ...(file.excluded || result?.excluded
          ? { excluded: clean(file.excluded ?? result!.excluded!) }
          : {}),
        ...(file.directory ? { directory: true } : {}),
        runtimeVersions: result?.runtimeVersions
          ? Object.fromEntries(
              Object.entries(result.runtimeVersions)
                .sort()
                .map(([key, value]) => [key, clean(value)])
            )
          : undefined,
        issues: [],
      };
      if (!result) return out;
      const deps = new Map((result.dependencies ?? []).map((dep) => [declarationKey(dep), dep]));
      for (const entry of [...result.updates, ...(result.statuses ?? []), ...result.audits])
        deps.set(declarationKey(entry.dep), entry.dep);
      for (const dep of [...deps.values()].sort(
        (a, b) =>
          a.line - b.line || a.section.localeCompare(b.section) || a.name.localeCompare(b.name)
      )) {
        const key = declarationKey(dep);
        const update = result.updates.find((entry) => declarationKey(entry.dep) === key);
        const status = result.statuses?.find((entry) => declarationKey(entry.dep) === key);
        const audit = result.audits.find((entry) => declarationKey(entry.dep) === key);
        const policy = result.policies?.find(
          (entry) =>
            entry.line === dep.line && entry.name === dep.name && entry.section === dep.section
        );
        const ecosystem = dep.ecosystem ?? result.ecosystem;
        const scheme = dep.versionScheme ?? (dep.semver ? semverScheme : schemeFor(ecosystem));
        const baseline = dep.resolvedVersion ?? update?.current ?? scheme.baseline(dep.spec);
        const origin = dep.baselineOrigin;
        const lockfile =
          origin && directory
            ? normalizedPath(join(dirname(label), relative(directory, origin.lockfile)))
            : origin
              ? basename(origin.lockfile)
              : undefined;
        const entry: ReportDeclaration = {
          name: clean(dep.name),
          alias: dep.alias ? clean(dep.alias) : undefined,
          section: clean(dep.section),
          line: dep.line + 1,
          ecosystem,
          declared: clean(
            dep.specRaw ??
              (dep.alias && ecosystem === 'npm' ? `npm:${dep.name}@${dep.spec}` : dep.spec)
          ),
          source:
            status?.source || update?.source || dep.source
              ? clean(status?.source ?? update?.source ?? dep.source!)
              : undefined,
          baseline: baseline
            ? {
                version: clean(baseline),
                kind: dep.resolvedVersion
                  ? 'lockfile'
                  : scheme.isPinned(dep.spec)
                    ? 'declared'
                    : 'range',
                ...(origin
                  ? {
                      lockfile: clean(lockfile!),
                      importer: origin.importer ? clean(origin.importer) : undefined,
                      descriptor: origin.descriptor ? clean(origin.descriptor) : undefined,
                    }
                  : {}),
              }
            : undefined,
          baselineUnavailable: dep.baselineUnavailable ? clean(dep.baselineUnavailable) : undefined,
          update: update
            ? {
                current: clean(update.current),
                latest: clean(update.latestRaw ?? update.latest),
                kind: update.kind,
                inRange: update.inRange,
                sameMajor: update.sameMajor ? clean(update.sameMajor) : undefined,
                satisfying: update.satisfying ? clean(update.satisfying) : undefined,
                compatible: update.compatible ? clean(update.compatible) : undefined,
                alternatePath: update.alternatePath ? clean(update.alternatePath) : undefined,
                commit: !!update.githubDefaultBranch,
                matrix: update.matrixUpdate
                  ? {
                      versions: update.matrixUpdate.versions.map(clean),
                      newer: update.matrixUpdate.newer
                        ? clean(update.matrixUpdate.newer)
                        : undefined,
                    }
                  : undefined,
              }
            : undefined,
          availability: status
            ? {
                status: status.status,
                message: clean(status.message),
                latest: status.latest ? clean(status.latest) : undefined,
              }
            : undefined,
          policy: policy
            ? {
                ignoreUpdates: policy.ignoreUpdates,
                ...(policy.ignoreMajorUpdates ? { ignoreMajorUpdates: true } : {}),
                prereleasePolicy: policy.prereleasePolicy,
              }
            : undefined,
          failure: result.failures.has(dep.name)
            ? clean(result.failures.get(dep.name)!)
            : undefined,
          skipped: dep.skipReason ? clean(dep.skipReason) : undefined,
        };
        if (audit)
          entry.audit = {
            version: audit.version ? clean(audit.version) : undefined,
            baseline: audit.baseline,
            provider: audit.provider ?? result.auditProvider,
            result:
              audit.result.status === 'checked'
                ? {
                    status: 'checked',
                    advisories: audit.result.advisories
                      .map((value) => advisory(value, clean))
                      .sort((a, b) => a.id.localeCompare(b.id)),
                  }
                : audit.result.status === 'failed'
                  ? { status: 'failed', error: clean(audit.result.error) }
                  : { status: audit.result.status },
          };
        out.declarations.push(entry);
      }
      if (result.incomplete) out.issues.push('Version check incomplete.');
      for (const [name, error] of result.failures) out.issues.push(clean(`${name}: ${error}`));
      for (const skip of result.skipped ?? [])
        out.issues.push(clean(`Line ${skip.line + 1}, ${skip.name}: skipped, ${skip.reason}`));
      for (const status of result.statuses ?? [])
        if (status.status !== 'available' && status.status !== 'failed')
          out.issues.push(
            clean(`Line ${status.dep.line + 1}, ${status.dep.name}: ${status.message}`)
          );
      for (const dep of out.declarations) {
        if (dep.baselineUnavailable)
          out.issues.push(`Line ${dep.line}, ${dep.name}: ${dep.baselineUnavailable}`);
        if (dep.policy)
          out.issues.push(
            `Line ${dep.line}, ${dep.name}: ${dep.policy.ignoreUpdates ? 'update suggestions suppressed; availability and audits retained; ' : dep.policy.ignoreMajorUpdates ? 'major update suggestions suppressed; availability and audits retained; ' : ''}prerelease policy ${dep.policy.prereleasePolicy}.`
          );
        if (dep.audit?.result.status === 'failed') {
          out.issues.push(`${dep.name} audit failed: ${dep.audit.result.error}`);
          out.incomplete = true;
        }
        if (dep.audit?.result.status === 'pending' || dep.audit?.result.status === 'unchecked')
          out.incomplete = true;
      }
      out.issues.sort();
      return out;
    })
    .sort(
      (a, b) => (a.workspace ?? '').localeCompare(b.workspace ?? '') || a.path.localeCompare(b.path)
    );
  const analyzed = normalized.filter((file) => file.ecosystem && !file.excluded);
  const updates = analyzed.flatMap((file) =>
    file.declarations.flatMap((dep) => (dep.update ? [dep.update] : []))
  );
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    workspaces: roots.map(redact),
    scope:
      'Supported declarations only, not installed packages or a transitive dependency graph. Audits are opt-in. Excluded directories are not traversed; their contained file count is unknown.',
    summary: {
      manifestsAnalyzed: analyzed.length,
      declarationsFound: analyzed.reduce((sum, file) => sum + file.declarationCount, 0),
      outdatedDeclarations: updates.length,
      filesWithUpdates: analyzed.filter((file) => file.declarations.some((dep) => dep.update))
        .length,
      updatesByKind: Object.fromEntries(
        (['major', 'minor', 'patch', 'prerelease'] as const).map((kind) => [
          kind,
          updates.filter((update) => update.kind === kind).length,
        ])
      ) as Record<UpdateKind, number>,
      excludedFiles: normalized.filter((file) => file.excluded && !file.directory).length,
      excludedDirectories: normalized.filter((file) => file.excluded && file.directory).length,
      incomplete: normalized.some((file) => file.incomplete),
    },
    files: normalized,
  };
}

export function renderJsonReport(snapshot: ReportSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
