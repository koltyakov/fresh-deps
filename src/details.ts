import * as vscode from 'vscode';
import { lookupFor, type AnalyzeResult, type PackageDetails, type VersionPair } from './analyzer';
import type { Settings } from './config';
import { buildAuditHover, buildHover, buildStatusHover } from './hover';
import type { DependencyUpdate, Ecosystem } from './types';
import { goRepository } from './packageLinks';
import { githubTags } from './registries/github';
import { SharedRequests } from './requests';

/**
 * The detail that is not worth a request until someone looks for it: publish
 * dates, and whatever prose the version lookup did not already carry. Nothing
 * here is fetched during a check, so hints appear exactly as fast as before;
 * the first hover over a dependency pays for it, and every hover after is free.
 */
export class DetailsResolver {
  private readonly resolved = new Map<string, PackageDetails>();
  private readonly inFlight = new SharedRequests<PackageDetails>();
  private generation = 0;

  async resolve(
    fsPath: string,
    ecosystem: Ecosystem,
    update: DependencyUpdate,
    settings: Settings,
    signal?: AbortSignal
  ): Promise<PackageDetails> {
    if (update.dep.runtime) return {};
    ecosystem = update.dep.ecosystem ?? ecosystem;
    const versions = versionsOf(update, ecosystem);
    const lookup = lookupFor(ecosystem, fsPath, settings);
    const repository =
      ecosystem === 'go' && update.source === 'https://proxy.golang.org' && !update.dep.source
        ? goRepository(update)
        : undefined;
    if (!lookup || (!lookup.fetchDetails && !repository)) {
      return {};
    }

    const key = `${lookup.key(update.dep)}|${repository ?? ''}|${versions.current}|${versions.latest}|${versions.sameMajor ?? ''}`;
    const cached = this.resolved.get(key);
    if (cached) {
      return cached;
    }

    // Hovering wanders over the same line repeatedly; one request answers all of it.
    const generation = this.generation;
    return this.inFlight
      .resolve(
        key,
        async () => {
          const details = (await lookup.fetchDetails?.(update.dep, versions)) ?? {};
          if (repository) {
            try {
              const tags = await githubTags(repository, settings.requestTimeoutMs);
              const tagFor = (version: string) =>
                tags?.find((tag) => tag === version) ??
                tags?.find(
                  (tag) => tag === `v${version.replace(/^v/, '').replace(/\+incompatible$/, '')}`
                );
              const from = tagFor(versions.current),
                to = tagFor(versions.latest);
              if (from && to)
                details.links = [
                  {
                    label: 'Compare versions',
                    url: `https://github.com/${repository}/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}`,
                  },
                ];
            } catch {
              /* Optional evidence must not hide dates or other metadata. */
            }
          }
          if (generation === this.generation) {
            if (this.resolved.size >= 512) this.resolved.delete(this.resolved.keys().next().value!);
            this.resolved.set(key, details);
          }
          return details;
        },
        signal
      )
      .catch(() => ({}));
  }

  clear(): void {
    this.generation++;
    this.inFlight.clear();
    this.resolved.clear();
  }
}

/** How each registry spells the versions a hint compares. */
function versionsOf(update: DependencyUpdate, ecosystem: Ecosystem): VersionPair {
  return {
    // A go.mod names the exact version, `+incompatible` and all, and the proxy
    // knows it under no other spelling.
    current: ecosystem === 'go' ? update.dep.spec.trim() : update.current,
    latest: update.latestRaw ?? update.latest,
    ...(update.sameMajor ? { sameMajor: update.sameMajor } : {}),
  };
}

/** One on-demand hover for both the declaration and its inline update hint. */
export class DependencyHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly resultFor: (uri: vscode.Uri) => AnalyzeResult | undefined,
    private readonly settingsFor: (uri: vscode.Uri) => Settings,
    private readonly details: DetailsResolver
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    const result = this.resultFor(document.uri);
    const update = result?.updates.find((candidate) => candidate.dep.line === position.line);
    const audit = result?.audits.find((candidate) => candidate.dep.line === position.line);
    const statuses =
      result?.statuses?.filter(
        (candidate) => candidate.dep.line === position.line && candidate.status !== 'available'
      ) ?? [];
    const dep = update?.dep ?? audit?.dep ?? statuses[0]?.dep;
    if (!result || !dep) {
      return undefined;
    }

    const line = document.lineAt(position.line);
    // Inline decorations map to the end-of-line position in the document.
    if (position.character < line.firstNonWhitespaceCharacterIndex) {
      return undefined;
    }
    // Typing moves declarations around while the last analysis still describes
    // where they were, so the line has to still be the one that was measured
    // before its card is shown.
    const declared = dep.specRaw ?? dep.spec;
    const versionOnly =
      /^\s*(?:["']?(?:version(?:-semver|-date|>=)?|Version|exact|from)["']?\s*[:=]\s*)?["']([^"']+)["']\s*\)?[,]?\s*$/.exec(
        line.text
      )?.[1] ?? /^\s*version\s*:\s*([^"'#]+?)\s*(?:#.*)?$/.exec(line.text)?.[1];
    const declarationPresent =
      line.text.includes(dep.alias ?? dep.name) ||
      (result.ecosystem === 'deno' && line.text.includes(dep.name)) ||
      (result.ecosystem === 'docker' &&
        dep.name.startsWith('library/') &&
        line.text.includes(dep.name.slice(8))) ||
      versionOnly === declared;
    if (
      !['java', 'ruby', 'terraform', 'elixir'].includes(result.ecosystem) &&
      !declarationPresent
    ) {
      return undefined;
    }

    const range = new vscode.Range(
      position.line,
      line.firstNonWhitespaceCharacterIndex,
      position.line,
      line.range.end.character
    );
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested?.(() => controller.abort());
    if (token.isCancellationRequested) controller.abort();
    let details: PackageDetails;
    try {
      details = update
        ? await this.details.resolve(
            document.uri.fsPath,
            result.ecosystem,
            update,
            this.settingsFor(document.uri),
            controller.signal
          )
        : {};
    } finally {
      cancellation?.dispose();
    }
    if (token.isCancellationRequested || this.resultFor(document.uri) !== result) {
      return undefined;
    }
    const contents = update ? [buildHover(update, result.ecosystem, details)] : [];
    contents.unshift(...statuses.map(buildStatusHover));
    if (audit) contents.push(buildAuditHover(audit));
    return new vscode.Hover(contents, range);
  }
}
