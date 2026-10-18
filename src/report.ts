import type { AnalyzeResult } from './analyzer';
import { createReportSnapshot, type ReportSnapshot } from './reportSnapshot';

export const reportExcludedDirectories = [
  'node_modules',
  'bower_components',
  'vendor',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'target',
  'bin',
  'obj',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  '.turbo',
  '.parcel-cache',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '.tox',
  '.nox',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.gradle',
  '.terraform',
  '.dart_tool',
  '.pub-cache',
  '.bundle',
  '_build',
  'deps',
  '.build',
  '.swiftpm',
  '.yarn/cache',
  '.yarn/unplugged',
  '.pnpm-store',
  'bazel-*',
];

export interface ReportFile {
  /** Collection context only. Never included in JSON exports. */
  rootPath?: string;
  workspace?: string;
  excluded?: string;
  directory?: boolean;
  path: string;
  uri: string;
  result?: AnalyzeResult;
  error?: string;
}

/** Escape untrusted manifest and registry text in Markdown headings and table cells. */
function text(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()!#|]/g, '\\$&')
    .replace(/[\r\n]+/g, ' ');
}

/** Markdown preview rejects file: links, but explicitly supports VS Code file URLs. */
function fileLink(label: string, uri: string, line?: number, relativePath = label): string {
  const source = new URL(uri);
  const target =
    source.protocol === 'file:'
      ? `vscode://file${source.host ? `//${source.host}` : ''}${source.pathname}${line ? `:${line}` : ''}`
      : `${uri}${line ? `#L${line}` : ''}`;
  const encoded = target.replace(/[<>()[\]|\s]/g, (char) =>
    encodeURIComponent(char).replace(
      /[()]/g,
      (bracket) => `%${bracket.charCodeAt(0).toString(16).toUpperCase()}`
    )
  );
  const title = text(`${relativePath}${line ? `:${line}` : ''}`).replace(/"/g, '&quot;');
  return `[${text(label)}](${encoded} "${title}")`;
}

export function renderReport(files: ReportFile[], roots: string[], now = new Date()): string {
  return renderReportSnapshot(
    createReportSnapshot(files, roots, now),
    (path, workspace) =>
      files.find((file) => file.path === path && file.workspace === workspace)?.uri
  );
}

export function renderReportSnapshot(
  snapshot: ReportSnapshot,
  uriFor: (path: string, workspace?: string) => string | undefined = () => undefined
): string {
  const { summary } = snapshot;
  const location = (label: string, path: string, workspace?: string, line?: number) => {
    const uri = uriFor(path, workspace);
    return uri ? fileLink(label, uri, line, path) : text(label);
  };
  const lines = [
    '# Outdated dependency report',
    '',
    `Generated ${snapshot.generatedAt}`,
    '',
    `Workspace folders: ${snapshot.workspaces.map(text).join(', ')}`,
    '',
    '## Summary',
    '',
    '| Metric | Count |',
    '| --- | ---: |',
    `| Manifests analyzed | ${summary.manifestsAnalyzed} |`,
    `| Declarations found | ${summary.declarationsFound} |`,
    `| Outdated declarations | ${summary.outdatedDeclarations} |`,
    `| Files with updates | ${summary.filesWithUpdates} |`,
    ...Object.entries(summary.updatesByKind).map(
      ([kind, count]) => `| ${kind} updates | ${count} |`
    ),
    `| Excluded files | ${summary.excludedFiles} |`,
    `| Excluded directories | ${summary.excludedDirectories} |`,
    '',
    'Only dependencies with updates or warnings are listed. Versions show declared requirements. Updates compare declaration baselines or optional lockfile selections, not installed or transitive dependencies. Minor/patch shows the newest update within the current major. A dash means no update or warning was found; check details lists failed or skipped lookups. Audits follow the audit setting and provider.',
    '',
    ...(summary.incomplete ? ['Some checks were incomplete. See check details below.', ''] : []),
    '## Dependencies by file',
    '',
  ];
  if (!summary.outdatedDeclarations)
    lines.push(
      snapshot.files.some((file) => file.declarations.some((dep) => dep.policy?.ignoreUpdates))
        ? 'No update suggestions among unsuppressed declarations. Suppressed packages may still have newer versions.'
        : 'No updates found among checked declarations.',
      ''
    );
  for (const file of snapshot.files.filter((entry) => entry.ecosystem && !entry.excluded)) {
    const rows = file.declarations.filter((dep) => {
      const audit = dep.audit;
      return (
        dep.update ||
        dep.failure ||
        ['version-missing', 'range-missing', 'package-missing', 'failed'].includes(
          dep.availability?.status ?? ''
        ) ||
        audit?.result.status === 'failed' ||
        (audit?.result.status === 'checked' && audit.result.advisories.length > 0)
      );
    });
    if (!rows.length) continue;
    const showAudit = rows.some((dep) => {
      const audit = dep.audit;
      return audit && audit.result.status !== 'unsupported';
    });
    lines.push(
      `### ${location(file.path, file.path, file.workspace)}`,
      '',
      `Manifest ecosystem: ${text(file.ecosystem!)}`,
      '',
      `| Type | Name | Version | Minor/patch | Major |${showAudit ? ' Audit warning |' : ''}`,
      `| --- | --- | --- | --- | --- |${showAudit ? ' --- |' : ''}`
    );
    for (const dep of rows) {
      const update = dep.update;
      const audit = dep.audit;
      const link = location(dep.name, file.path, file.workspace, dep.line);
      let minor = '-';
      let major = '-';
      if (update) {
        const latest = update.latest;
        if (update.commit) minor = `${latest} commit`;
        else if (update.matrix) {
          minor = update.matrix.versions.join(', ');
          major = update.matrix.newer ?? '-';
        } else if (update.kind === 'major') {
          minor = update.sameMajor ?? '-';
          major = update.alternatePath ? `${update.alternatePath} ${latest}` : latest;
        } else minor = update.kind === 'prerelease' ? `${latest} prerelease` : latest;
      }
      const warning =
        audit?.result.status === 'checked'
          ? audit.result.advisories
              .map(
                (advisory) =>
                  `${advisory.severity ? `${advisory.severity}: ` : ''}${advisory.id} ${advisory.title}`
              )
              .join('; ') || '-'
          : audit?.result.status === 'failed'
            ? `Failed: ${audit.result.error}`
            : !audit || audit.result.status === 'unsupported'
              ? ''
              : 'Not checked';
      const versionWarning =
        dep.failure ||
        ['version-missing', 'range-missing', 'package-missing', 'failed'].includes(
          dep.availability?.status ?? ''
        )
          ? (dep.availability?.message ?? dep.failure)
          : undefined;
      const version = `${dep.declared}${versionWarning ? `; ${versionWarning}` : ''}`;
      lines.push(
        `| ${text(dep.section)} | ${link} | ${text(version)} | ${text(minor)} | ${text(major)} |${showAudit ? ` ${text(warning)} |` : ''}`
      );
    }
    lines.push('');
  }
  lines.push('## Check details', '');
  let details = 0;
  for (const file of snapshot.files) {
    const notes: string[] = [...file.issues];
    if (file.error) notes.push(file.error);
    if (file.excluded)
      notes.push(
        `Excluded ${file.directory ? 'directory' : 'file'} by ${file.excluded}. Contained files were not counted.`
      );
    for (const dep of file.declarations) {
      const hasEvidence =
        dep.update ||
        dep.policy ||
        dep.baselineUnavailable ||
        dep.failure ||
        dep.audit?.result.status === 'failed' ||
        (dep.audit?.result.status === 'checked' && dep.audit.result.advisories.length > 0);
      if (!hasEvidence) continue;
      if (dep.baseline)
        notes.push(
          `${dep.name} baseline: ${dep.baseline.kind} ${dep.baseline.version}${dep.baseline.lockfile ? `, ${dep.baseline.lockfile}` : ''}${dep.baseline.importer ? `, importer ${dep.baseline.importer}` : ''}.`
        );
      if (dep.source) notes.push(`${dep.name} source: ${dep.source}`);
      if (dep.audit?.result.status === 'checked')
        for (const advisory of dep.audit.result.advisories) {
          notes.push(
            `${dep.name} audit: ${advisory.id}, ${advisory.title}${advisory.severity ? `, severity ${advisory.severity}` : ', severity unavailable'}`
          );
          if (advisory.fixedVersions?.length)
            notes.push(
              `Published fixed versions: ${advisory.fixedVersions.join(', ')}. Candidate versions have not been checked.`
            );
          for (const score of advisory.scores ?? []) notes.push(`${score.type}: ${score.score}`);
          for (const range of advisory.affected ?? [])
            notes.push(
              `Affected ${range.type}: ${range.events
                .map((event) =>
                  Object.entries(event)
                    .map(([key, value]) => `${key} ${value}`)
                    .join(', ')
                )
                .join('; ')}. Fixed boundaries apply to their release branches.`
            );
        }
    }
    if (Object.keys(file.runtimeVersions ?? {}).length)
      notes.push(`Runtime assumptions: ${JSON.stringify(file.runtimeVersions)}`);
    if (!notes.length) continue;
    details += notes.length;
    lines.push(
      `### ${location(file.path, file.path, file.workspace)}`,
      '',
      ...notes.map((note) => `- ${text(note)}`),
      ''
    );
  }
  if (!details) lines.push('No check issues reported.', '');
  lines.push(
    '## Scan scope',
    '',
    'Scans supported manifests recursively across all workspace folders, including hidden project configuration. Disabled ecosystems and Python files without script metadata are omitted.',
    '',
    snapshot.scope,
    ''
  );
  return lines.join('\n');
}
