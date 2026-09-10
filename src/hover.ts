import * as vscode from 'vscode';
import { actionRuntimes } from './githubActions';
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
  md.appendText(`Checked ${audit.dep.resolvedVersion === audit.version ? 'lockfile version' : audit.baseline ? 'range baseline' : 'declared version'} ${audit.version}. This is not an installed-dependency or transitive audit.`);
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
  ecosystem = update.dep.ecosystem ?? ecosystem;

  const name = update.alternatePath ?? update.dep.name;
  const meta = { ...update.meta, ...details.meta };
  md.appendMarkdown(`**${name}** - ${update.kind} update available\n\n`);
  if (meta.description) {
    md.appendMarkdown(`${escapeMarkdown(meta.description)}\n\n`);
  }

  const displayVersion = (version: string) => update.dep.runtime ? version : display(version, ecosystem);
  const currentDisplay = displayVersion(update.current);
  const currentDate = publishedOn(details.currentPublishedAt);
  const latestDate = publishedOn(details.latestPublishedAt ?? meta.latestPublishedAt);

  md.appendMarkdown(`| | |\n|---|---|\n`);
  // A pinned declaration already spells out the version in use, so the date goes
  // on that row rather than repeating the same number twice.
  const declared = update.dep.spec === '@baseline' ? 'registry baseline' : update.dep.specRaw ?? update.dep.spec;
  const declaredIsCurrent = declared.trim() === currentDisplay;
  md.appendMarkdown(`| Declared | ${row(declared, declaredIsCurrent ? currentDate : undefined)} |\n`);
  if (update.sameMajor) {
    md.appendMarkdown(`| Newest within major | ${row(displayVersion(update.sameMajor), publishedOn(details.sameMajorPublishedAt))} |\n`);
  }
  if (!declaredIsCurrent && !update.matrixUpdate) {
    md.appendMarkdown(`| Current | ${row(currentDisplay, currentDate)} |\n`);
  }
  if (update.matrixUpdate) {
    md.appendMarkdown(`| Updated matrix | ${row(`[${update.matrixUpdate.versions.join(', ')}]`, undefined)} |\n`);
    if (update.matrixUpdate.newer) md.appendMarkdown(`| Newer release line | ${row(update.matrixUpdate.newer, undefined)} |\n`);
  } else md.appendMarkdown(
    `| Latest | ${row(displayVersion(update.latestRaw ?? update.latest), latestDate)} |\n`,
  );
  if (update.satisfying && update.satisfying !== update.sameMajor) {
    md.appendMarkdown(`| ${update.dep.actionRuntime ? 'Newest within major' : 'Newest in range'} | \`${displayVersion(update.satisfying)}\` |\n`);
  } else if (ecosystem === 'bazel') {
    md.appendMarkdown('| Module | a newer registry version is available; compatibility levels and module resolution are not evaluated |\n');
  } else if (ecosystem === 'githubActions' || ecosystem === 'docker') {
    md.appendMarkdown(update.dep.actionRuntime ? '| Runtime | a newer version is available |\n'
      : '| Reference | a newer tag is available |\n');
  } else if (!update.inRange && ecosystem !== 'go') {
    const constraint = ecosystem === 'python' ? 'specifier' : 'range';
    md.appendMarkdown(`| In range | no - the ${constraint} needs to be widened |\n`);
  }
  if (update.dep.resolvedVersion === update.current) md.appendMarkdown('| Baseline | resolved from lockfile |\n');
  if (update.compatible) md.appendMarkdown(`| Runtime-compatible release | ${row(update.compatible, undefined)} |\n`);
  if (meta.runtimeRequirement) md.appendMarkdown(`| Latest runtime requirement | ${escapeMarkdown(meta.runtimeRequirement)} |\n`);
  if (meta.compatibilityLevel !== undefined) md.appendMarkdown(`| Latest module compatibility level | ${meta.compatibilityLevel} |\n`);
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

  if (ecosystem === 'vcpkg') {
    md.appendMarkdown('\nHints compare explicit declarations or selected baseline versions with the current registry. Updating may require refreshing builtin-baseline or a custom registry baseline and the local checkout. Triplets and transitive resolution are not evaluated.\n');
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
  if (update.dep.runtime) {
    const downloads = { go: 'https://go.dev/dl/', node: 'https://nodejs.org/en/download', python: 'https://www.python.org/downloads/',
      gradle: 'https://gradle.org/releases/', terraform: 'https://releases.hashicorp.com/terraform/', opentofu: 'https://github.com/opentofu/opentofu/releases', dotnet: 'https://dotnet.microsoft.com/download/dotnet' };
    return `[Runtime downloads](${downloads[update.dep.runtime]})`;
  }
  if (update.dep.source && ['python', 'rust', 'dotnet', 'php', 'dart', 'ruby', 'elixir', 'clojure', 'scala'].includes(ecosystem)) {
    const sources = update.dep.source.split('|').flatMap((source) => {
      try {
        const url = new URL(source.replace(/^sparse\+/, ''));
        if (!['https:', 'http:'].includes(url.protocol)) return [];
        url.username = ''; url.password = '';
        return [`[Package source](<${url.href.replace(/[<>]/g, encodeURIComponent)}>)`];
      } catch { return []; }
    });
    if (sources.length) return sources.join(' · ');
  }
  if (ecosystem === 'ansible') {
    const [namespace, name] = update.dep.name.split('.');
    parts.push(`[Ansible Galaxy](https://galaxy.ansible.com/ui/${update.dep.section === 'roles' ? 'standalone/roles' : 'repo/published'}/${namespace}/${name}/)`);
  } else if (ecosystem === 'bazel') {
    parts.push(`[Bazel Central Registry](https://registry.bazel.build/modules/${encodeURIComponent(update.dep.name)})`);
  } else if (ecosystem === 'vcpkg') {
    parts.push(`[vcpkg](https://vcpkg.io/en/package/${encodeURIComponent(update.dep.name)})`);
  } else if (ecosystem === 'docker') {
    parts.push(update.dep.source ? `[Container registry](https://${update.dep.source}/)` : `[Docker Hub](https://hub.docker.com/r/${update.dep.name}/tags)`);
  } else if (ecosystem === 'helm') {
    parts.push(update.dep.source?.startsWith('oci://') ? `[OCI registry](<${update.dep.source.replace(/^oci:/, 'https:')}>)`
      : `[Chart repository](<${update.dep.source}/index.yaml>)`);
  } else if (ecosystem === 'swift') {
    parts.push(update.dep.source ? `[Package source](<${update.dep.source.startsWith('https:') ? update.dep.source : `https://${update.dep.source}/${update.dep.name}`}>)`
      : `[GitHub](https://github.com/${update.dep.name}/tree/${encodeURIComponent(update.latest)})`);
  } else if (ecosystem === 'conan') {
    parts.push(`[Conan Center](https://conan.io/center/recipes/${encodeURIComponent(update.dep.name)})`);
  } else if (ecosystem === 'conda') {
    for (const channel of (update.dep.source ?? '').split('|').filter(Boolean)) {
      parts.push(`[${escapeMarkdown(channel)}](https://anaconda.org/${encodeURIComponent(channel)}/${encodeURIComponent(update.dep.name)})`);
    }
  } else if (ecosystem === 'scala' || ecosystem === 'clojure') {
    const [group, artifact] = update.dep.name.split(':');
    parts.push(`[Maven Repository](https://mvnrepository.com/artifact/${group}/${artifact}/${encodeURIComponent(update.latest)})`);
  } else if (ecosystem === 'dotnet' && update.dep.section === 'sdk') {
    parts.push('[.NET downloads](https://dotnet.microsoft.com/download/dotnet)');
  } else if (ecosystem === 'terraform' && update.dep.name.startsWith('tflint:')) {
    parts.push(`[GitHub releases](https://github.com/${update.dep.name.slice(7)}/releases)`);
  } else if (ecosystem === 'terraform' && update.dep.name.startsWith('module:')) {
    const [host, ...path] = update.dep.name.slice(7).split('/');
    parts.push(`[Module registry](https://${host}/modules/${path.join('/')}/${encodeURIComponent(update.latest)})`);
  } else if (ecosystem === 'deno') {
    const name = update.dep.name.slice(4);
    parts.push(update.dep.name.startsWith('jsr:') ? `[JSR](https://jsr.io/${name}@${update.latest})`
      : `[npm](https://www.npmjs.com/package/${name}/v/${update.latest})`);
  } else if (ecosystem === 'githubActions') {
    parts.push(update.dep.actionRuntime ? `[Downloads](${actionRuntimes[update.dep.actionRuntime].homepage})`
      : `[GitHub](https://github.com/${update.dep.name}/tree/${encodeURIComponent(update.latest)})`);
  } else if (ecosystem === 'go') {
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
    const address = update.dep.name.split('/');
    const registry = address.length === 3 ? address.shift()! : 'registry.terraform.io';
    const tofu = registry === 'registry.opentofu.org';
    const name = address.join('/');
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
