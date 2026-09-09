import * as vscode from 'vscode';
import type { PackageDetails } from './analyzer';
import { display, escapeMarkdown, formatSize, publishedOn } from './format';
import type { DependencyAudit, DependencyUpdate, Ecosystem } from './types';

export function buildAuditHover(audit: DependencyAudit): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendText(`Security audit: ${audit.dep.name}`);
  md.appendMarkdown('\n\n');
  if (audit.result.status !== 'checked') {
    const message = audit.result.status === 'failed' ? `Audit failed: ${audit.result.error}`
      : audit.result.status === 'unsupported' ? 'Security audits are not supported for this ecosystem or registry.'
      : audit.result.status === 'pending' ? 'Audit not cached. Save or refresh to check.'
      : 'No concrete version could be determined from this declaration.';
    md.appendText(message);
    return md;
  }
  md.appendText(`Checked ${audit.baseline ? 'range baseline' : 'declared version'} ${audit.version}. This is not an installed-dependency or transitive audit.`);
  md.appendMarkdown('\n\n');
  if (!audit.result.advisories.length) md.appendText('No advisories reported for the checked version.');
  for (const advisory of audit.result.advisories) {
    md.appendText(`${advisory.id}: ${advisory.title}${advisory.severity ? ` (${advisory.severity})` : ''}`);
    md.appendMarkdown('\n\n');
    if (advisory.fixedVersions?.length) {
      md.appendText(`Fixed versions: ${advisory.fixedVersions.join(', ')}`);
      md.appendMarkdown('\n\n');
    }
    if (advisory.url) {
      try {
        const url = new URL(advisory.url);
        if (url.protocol === 'https:' || url.protocol === 'http:') {
          md.appendMarkdown(`[Advisory](<${url.href.replace(/[<>]/g, encodeURIComponent)}>)\n\n`);
        }
      } catch { /* Ignore invalid advisory links. */ }
    }
  }
  return md;
}

/**
 * The hover shown for one outdated dependency. `dates` is filled in only where the
 * publish dates have already been resolved - everything else on the card comes from
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
  md.appendMarkdown(`**${name}** - ${update.kind} update available\n\n`);
  if (meta.description) {
    md.appendMarkdown(`${escapeMarkdown(meta.description)}\n\n`);
  }

  const currentDisplay = display(update.current, ecosystem);
  const currentDate = publishedOn(details.currentPublishedAt);
  const latestDate = publishedOn(details.latestPublishedAt ?? meta.latestPublishedAt);

  md.appendMarkdown(`| | |\n|---|---|\n`);
  // A pinned declaration already spells out the version in use, so the date goes
  // on that row rather than repeating the same number twice.
  const declared = update.dep.specRaw ?? update.dep.spec;
  const declaredIsCurrent = declared.trim() === currentDisplay;
  md.appendMarkdown(`| Declared | ${row(declared, declaredIsCurrent ? currentDate : undefined)} |\n`);
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
    md.appendMarkdown(`| In range | no - the ${constraint} needs to be widened |\n`);
  }
  if (meta.license) {
    md.appendMarkdown(`| License | ${escapeMarkdown(meta.license)} |\n`);
  }
  if (meta.publisher) {
    md.appendMarkdown(`| Published by | ${escapeMarkdown(meta.publisher)} |\n`);
  }
  const projectUrl = meta.homepage || meta.repository;
  if (projectUrl && /^https?:\/\//i.test(projectUrl)) {
    const target = projectUrl.replace(/[\s<>|()]/g, (char) => encodeURIComponent(char)
      .replace(/\(/g, '%28').replace(/\)/g, '%29'));
    md.appendMarkdown(`| Project | [${escapeMarkdown(projectUrl)}](${target}) |\n`);
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
    md.appendMarkdown(`\n$(warning) **Deprecated** - ${escapeMarkdown(meta.deprecated)}\n`);
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
  } else if (ecosystem === 'php') {
    parts.push(`[Packagist](https://packagist.org/packages/${update.dep.name})`);
  } else if (ecosystem === 'dart') {
    parts.push(`[pub.dev](https://pub.dev/packages/${update.dep.name}/versions/${update.latest})`);
  } else if (ecosystem === 'gradle' && update.dep.section === 'plugins') {
    parts.push(`[Gradle Plugin Portal](https://plugins.gradle.org/plugin/${update.dep.name.split(':')[0]}/${update.latest})`);
  } else if (ecosystem === 'gradle') {
    const [groupId, artifactId] = update.dep.name.split(':');
    parts.push(`[Maven Repository](https://mvnrepository.com/artifact/${groupId}/${artifactId}/${update.latest})`);
  } else if (ecosystem === 'java') {
    const [groupId, artifactId] = update.dep.name.split(':');
    parts.push(`[Maven Central](https://central.sonatype.com/artifact/${groupId}/${artifactId}/${update.latest})`);
  } else if (ecosystem === 'ruby') {
    parts.push(`[RubyGems](https://rubygems.org/gems/${encodeURIComponent(update.dep.name)}/versions/${encodeURIComponent(update.latest)})`);
  } else if (ecosystem === 'terraform') {
    const tofu = update.dep.name.startsWith('registry.opentofu.org/');
    const name = tofu ? update.dep.name.slice('registry.opentofu.org/'.length) : update.dep.name;
    const registry = tofu ? 'registry.opentofu.org' : 'registry.terraform.io';
    parts.push(`[${tofu ? 'OpenTofu' : 'Terraform'} Registry](https://${registry}/providers/${name}/${encodeURIComponent(update.latest)}/docs)`);
  } else if (ecosystem === 'elixir') {
    parts.push(`[Hex](https://hex.pm/packages/${encodeURIComponent(update.dep.name)}/${encodeURIComponent(update.latest)})`);
  } else {
    parts.push(`[npm](https://www.npmjs.com/package/${update.dep.name}/v/${update.latest})`);
  }
  // The homepage is often the repository read differently; showing it twice is noise.
  if (repository && homepage && repository !== homepage) {
    parts.push(`[Repository](${repository})`);
  }
  return parts.join(' · ');
}
