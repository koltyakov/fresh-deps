import * as vscode from 'vscode';
import type { PackageDetails } from './analyzer';
import { display, escapeMarkdown, formatSize, publishedOn } from './format';
import type { DependencyUpdate, Ecosystem } from './types';

/**
 * The hover shown for one outdated dependency. `dates` is filled in only where the
 * publish dates have already been resolved — everything else on the card comes from
 * the lookup that produced the hint, so the card is complete either way.
 */
export function buildHover(
  update: DependencyUpdate,
  ecosystem: Ecosystem,
  details: PackageDetails = {},
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.supportThemeIcons = true;

  const name = update.alternatePath ?? update.dep.name;
  const meta = { ...update.meta, ...details.meta };
  md.appendMarkdown(`**${name}** — ${update.kind} update available\n\n`);
  if (meta.description) {
    md.appendMarkdown(`${escapeMarkdown(meta.description)}\n\n`);
  }

  const currentDisplay = display(update.current, ecosystem);
  const currentDate = publishedOn(details.currentPublishedAt);
  const latestDate = publishedOn(details.latestPublishedAt ?? meta.latestPublishedAt);

  md.appendMarkdown(`| | |\n|---|---|\n`);
  // A pinned declaration already spells out the version in use, so the date goes
  // on that row rather than repeating the same number twice.
  const declaredIsCurrent = update.dep.spec.trim() === currentDisplay;
  md.appendMarkdown(`| Declared | ${row(update.dep.spec, declaredIsCurrent ? currentDate : undefined)} |\n`);
  if (!declaredIsCurrent) {
    md.appendMarkdown(`| Current | ${row(currentDisplay, currentDate)} |\n`);
  }
  md.appendMarkdown(
    `| Latest | ${row(display(update.latestRaw ?? update.latest, ecosystem), latestDate)} |\n`,
  );
  if (update.satisfying) {
    md.appendMarkdown(`| Newest in range | \`${display(update.satisfying, ecosystem)}\` |\n`);
  } else if (!update.inRange && ecosystem !== 'go') {
    const constraint = ecosystem === 'python' ? 'specifier' : 'range';
    md.appendMarkdown(`| In range | no — the ${constraint} needs to be widened |\n`);
  }
  if (meta.license) {
    md.appendMarkdown(`| License | ${escapeMarkdown(meta.license)} |\n`);
  }
  if (meta.publisher) {
    md.appendMarkdown(`| Published by | ${escapeMarkdown(meta.publisher)} |\n`);
  }
  if (meta.unpackedSize) {
    const files = meta.fileCount ? ` in ${meta.fileCount} file${meta.fileCount === 1 ? '' : 's'}` : '';
    md.appendMarkdown(`| Size | ${formatSize(meta.unpackedSize)}${files} |\n`);
  }
  if (update.dep.alias) {
    md.appendMarkdown(`| Aliased as | \`${update.dep.alias}\` |\n`);
  }
  if (update.alternatePath) {
    md.appendMarkdown(`| New import path | \`${update.alternatePath}\` |\n`);
  }

  if (meta.deprecated) {
    md.appendMarkdown(`\n$(warning) **Deprecated** — ${escapeMarkdown(meta.deprecated)}\n`);
  }

  md.appendMarkdown(`\n${links(update, ecosystem, meta.homepage, meta.repository)}`);
  return md;
}

function row(version: string, date: string | undefined): string {
  return date ? `\`${version}\` · published ${date}` : `\`${version}\``;
}

function links(
  update: DependencyUpdate,
  ecosystem: Ecosystem,
  homepage: string | undefined,
  repository: string | undefined,
): string {
  const parts: string[] = [];
  if (ecosystem === 'go') {
    const modulePath = update.alternatePath ?? update.dep.name;
    parts.push(`[pkg.go.dev](https://pkg.go.dev/${modulePath}@v${update.latest})`);
  } else if (ecosystem === 'python') {
    parts.push(`[PyPI](https://pypi.org/project/${update.dep.name}/${update.latest}/)`);
  } else if (ecosystem === 'rust') {
    parts.push(`[crates.io](https://crates.io/crates/${update.dep.name}/${update.latest})`);
  } else if (ecosystem === 'dotnet') {
    parts.push(`[NuGet](https://www.nuget.org/packages/${update.dep.name}/${update.latest})`);
  } else if (ecosystem === 'java') {
    const [groupId, artifactId] = update.dep.name.split(':');
    parts.push(`[Maven Central](https://central.sonatype.com/artifact/${groupId}/${artifactId}/${update.latest})`);
  } else {
    parts.push(`[npm](https://www.npmjs.com/package/${update.dep.name}/v/${update.latest})`);
  }
  // The homepage is often the repository read differently; showing it twice is noise.
  if (repository && repository !== homepage) {
    parts.push(`[Repository](${repository})`);
  }
  if (homepage) {
    parts.push(`[Homepage](${homepage})`);
  }
  return parts.join(' · ');
}
