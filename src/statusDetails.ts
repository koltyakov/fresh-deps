import type { AnalyzeResult } from './analyzer';
import { display, escapeMarkdown } from './format';
import { redact } from './sanitize';
import type { DependencyAudit, DependencyRef } from './types';

const text = (value: string) => escapeMarkdown(redact(value));
const sameDeclaration = (a: DependencyRef, b: DependencyRef) =>
  a.name === b.name &&
  a.line === b.line &&
  a.section === b.section &&
  a.spec === b.spec &&
  a.alias === b.alias &&
  a.ecosystem === b.ecosystem &&
  a.source === b.source;

function auditSummary(audit: DependencyAudit | undefined): string {
  if (!audit) return 'Audit not enabled.';
  switch (audit.result.status) {
    case 'checked': {
      const count = audit.result.advisories.length;
      return count
        ? `Audit: ${count} warning${count === 1 ? '' : 's'}.`
        : 'Audit: no known vulnerabilities.';
    }
    case 'failed':
      return `Audit failed: ${text(audit.result.error)}.`;
    case 'unsupported':
      return 'Audit unsupported.';
    case 'pending':
    case 'unchecked':
      return 'Audit not checked.';
  }
}

/** Detailed evidence belongs in the tooltip, not the status-bar label. */
export function statusDetails(result: AnalyzeResult): string {
  const label = (dep: DependencyRef) => `**${text(dep.alias ?? dep.name)}**, ${text(dep.section)}`;
  const version = (value: string, dep: DependencyRef) =>
    text(display(value, dep.ecosystem ?? result.ecosystem));
  const ignored = result.suppressedUpdates?.map((update) => {
    const audit = result.audits.find((entry) => sameDeclaration(entry.dep, update.dep));
    return `- ${label(update.dep)}: ${version(update.current, update.dep)} → ${version(update.latestRaw ?? update.latest, update.dep)}. ${update.reason === 'major' ? 'Major updates ignored.' : 'Updates ignored.'} ${auditSummary(audit)}`;
  });
  const warnings = result.audits.flatMap((audit) => {
    if (audit.result.status !== 'checked') return [];
    return audit.result.advisories.map(
      (advisory) =>
        `- ${label(audit.dep)}${audit.version ? ` at ${version(audit.version, audit.dep)}` : ''}: ${text(advisory.id)}${advisory.severity ? `, ${text(advisory.severity)}` : ''}. ${text(advisory.title)}`
    );
  });
  const failures = result.audits.flatMap((audit) =>
    audit.result.status === 'failed' ? [`- ${label(audit.dep)}: ${text(audit.result.error)}`] : []
  );
  return [
    ignored?.length ? `\n\nIgnored updates:\n${ignored.join('\n')}` : '',
    warnings.length ? `\n\nAudit warnings:\n${warnings.join('\n')}` : '',
    failures.length ? `\n\nAudit failures:\n${failures.join('\n')}` : '',
  ].join('');
}
