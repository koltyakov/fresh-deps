import type { AnalyzeResult } from './analyzer';
import type { DependencyRef } from './types';

export const reportExcludedDirectories = [
  'node_modules', 'bower_components', 'vendor', '.git', '.hg', '.svn',
  'dist', 'build', 'out', 'target', 'bin', 'obj', 'coverage',
  '.next', '.nuxt', '.output', '.cache', '.turbo', '.parcel-cache',
  '.venv', 'venv', 'env', '__pycache__', '.tox', '.nox', '.pytest_cache',
  '.mypy_cache', '.ruff_cache', '.gradle', '.terraform', '.dart_tool',
  '.pub-cache', '.bundle', '_build', 'deps', '.build', '.swiftpm',
  '.yarn/cache', '.yarn/unplugged', '.pnpm-store', 'bazel-*',
];

export interface ReportFile {
  path: string;
  uri: string;
  result?: AnalyzeResult;
  error?: string;
}

/** Escape untrusted manifest and registry text in Markdown headings and table cells. */
function text(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()!#|]/g, '\\$&').replace(/[\r\n]+/g, ' ');
}

/** Markdown preview rejects file: links, but explicitly supports VS Code file URLs. */
function fileLink(label: string, uri: string, line?: number, relativePath = label): string {
  const source = new URL(uri);
  const target = source.protocol === 'file:'
    ? `vscode://file${source.host ? `//${source.host}` : ''}${source.pathname}${line ? `:${line}` : ''}`
    : `${uri}${line ? `#L${line}` : ''}`;
  const encoded = target.replace(/[<>()[\]|\s]/g, (char) =>
    encodeURIComponent(char).replace(/[()]/g, (bracket) => `%${bracket.charCodeAt(0).toString(16).toUpperCase()}`));
  const title = text(`${relativePath}${line ? `:${line}` : ''}`).replace(/"/g, '&quot;');
  return `[${text(label)}](${encoded} "${title}")`;
}

export function renderReport(files: ReportFile[], roots: string[], now = new Date()): string {
  const analyzed = files.filter((file) => file.result);
  const updates = analyzed.flatMap((file) => file.result!.updates);
  const incomplete = files.some((file) => file.error || file.result?.incomplete || file.result?.failures.size || file.result?.skipped?.length);
  const lines = [
    '# Outdated dependency report', '',
    `Generated ${now.toISOString()}`, '',
    `Workspace folders: ${roots.map(text).join(', ')}`, '',
    '## Summary', '',
    '| Metric | Count |', '| --- | ---: |',
    `| Manifests analyzed | ${analyzed.length} |`,
    `| Declarations found | ${analyzed.reduce((sum, file) => sum + (file.result!.declarations ?? 0), 0)} |`,
    `| Outdated declarations | ${updates.length} |`,
    `| Files with updates | ${analyzed.filter((file) => file.result!.updates.length).length} |`,
    ...(['major', 'minor', 'patch', 'prerelease'] as const).map((kind) => `| ${kind} updates | ${updates.filter((update) => update.kind === kind).length} |`),
    '',
    'Only dependencies with updates or warnings are listed. Versions show declared requirements. Updates compare declaration baselines or optional lockfile selections, not installed or transitive dependencies. Minor/patch shows the newest update within the current major. A dash means no update or warning was found; check details lists failed or skipped lookups. Audits follow the audit setting and provider.', '',
    ...(incomplete ? ['Some checks were incomplete. See check details below.', ''] : []),
    '## Dependencies by file', '',
  ];
  if (!updates.length) lines.push('No updates found among checked declarations.', '');
  for (const file of analyzed) {
    const result = file.result!;
    const key = (dep: DependencyRef) => JSON.stringify([dep.line, dep.section, dep.name, dep.spec]);
    const dependencies = new Map((result.dependencies ?? []).map((dep) => [key(dep), dep]));
    for (const entry of [...result.updates, ...result.statuses ?? [], ...result.audits]) dependencies.set(key(entry.dep), entry.dep);
    const updatesByDep = new Map(result.updates.map((update) => [key(update.dep), update]));
    const auditsByDep = new Map(result.audits.map((audit) => [key(audit.dep), audit]));
    const statusesByDep = new Map((result.statuses ?? []).map((status) => [key(status.dep), status]));
    const hasVersionWarning = (dep: DependencyRef) => result.failures.has(dep.name)
      || ['version-missing', 'range-missing', 'package-missing', 'failed'].includes(statusesByDep.get(key(dep))?.status ?? '');
    const rows = [...dependencies.values()].filter((dep) => {
      const audit = auditsByDep.get(key(dep));
      return updatesByDep.has(key(dep)) || hasVersionWarning(dep)
        || audit?.result.status === 'failed'
        || audit?.result.status === 'checked' && audit.result.advisories.length > 0;
    }).sort((a, b) => a.line - b.line);
    if (!rows.length) continue;
    const showAudit = rows.some((dep) => {
      const audit = auditsByDep.get(key(dep));
      return audit && audit.result.status !== 'unsupported';
    });
    lines.push(`### ${fileLink(file.path, file.uri)}`, '', `Manifest ecosystem: ${text(result.ecosystem)}`, '',
      `| Type | Name | Version | Minor/patch | Major |${showAudit ? ' Audit warning |' : ''}`,
      `| --- | --- | --- | --- | --- |${showAudit ? ' --- |' : ''}`);
    for (const dep of rows) {
      const update = updatesByDep.get(key(dep));
      const audit = auditsByDep.get(key(dep));
      const line = dep.line + 1;
      const location = fileLink(dep.name, file.uri, line, file.path);
      let minor = '-';
      let major = '-';
      if (update) {
        const latest = update.latestRaw ?? update.latest;
        if (update.githubDefaultBranch) minor = `${latest} commit`;
        else if (update.matrixUpdate) {
          minor = update.matrixUpdate.versions.join(', ');
          major = update.matrixUpdate.newer ?? '-';
        } else if (update.kind === 'major') {
          minor = update.sameMajor ?? '-';
          major = update.alternatePath ? `${update.alternatePath} ${latest}` : latest;
        } else minor = update.kind === 'prerelease' ? `${latest} prerelease` : latest;
      }
      const warning = audit?.result.status === 'checked'
        ? audit.result.advisories.map((advisory) => `${advisory.severity ? `${advisory.severity}: ` : ''}${advisory.id} ${advisory.title}`).join('; ') || '-'
        : audit?.result.status === 'failed' ? `Failed: ${audit.result.error}`
        : !audit || audit.result.status === 'unsupported' ? '' : 'Not checked';
      const versionWarning = hasVersionWarning(dep)
        ? statusesByDep.get(key(dep))?.message ?? result.failures.get(dep.name) : undefined;
      const version = `${dep.specRaw ?? dep.spec}${versionWarning ? `; ${versionWarning}` : ''}`;
      lines.push(`| ${text(dep.section)} | ${location} | ${text(version)} | ${text(minor)} | ${text(major)} |${showAudit ? ` ${text(warning)} |` : ''}`);
    }
    lines.push('');
  }
  lines.push('## Check details', '');
  let details = 0;
  for (const file of files) {
    const notes: string[] = [];
    if (file.error) notes.push(file.error);
    const result = file.result;
    if (result) {
      if (result.incomplete) notes.push('Version check incomplete.');
      for (const [name, error] of result.failures) notes.push(`${name}: ${error}`);
      for (const skip of result.skipped ?? []) notes.push(`Line ${skip.line + 1}, ${skip.name}: skipped, ${skip.reason}`);
      for (const status of result.statuses ?? []) {
        if (status.status !== 'available' && status.status !== 'failed') notes.push(`Line ${status.dep.line + 1}, ${status.dep.name}: ${status.message}`);
      }
      for (const audit of result.audits) {
        if (audit.result.status === 'failed') notes.push(`${audit.dep.name} audit failed: ${audit.result.error}`);
        if (audit.result.status === 'checked') for (const advisory of audit.result.advisories) notes.push(`${audit.dep.name} audit: ${advisory.id}, ${advisory.title}`);
      }
    }
    if (!notes.length) continue;
    details += notes.length;
    lines.push(`### ${fileLink(file.path, file.uri)}`, '', ...notes.map((note) => `- ${text(note)}`), '');
  }
  if (!details) lines.push('No check issues reported.', '');
  lines.push('## Scan scope', '',
    'Scans supported manifests recursively across all workspace folders, including hidden project configuration. Disabled ecosystems and Python files without script metadata are omitted.', '');
  return lines.join('\n');
}
