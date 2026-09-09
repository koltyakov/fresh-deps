import * as vscode from 'vscode';
import { lookupFor, type AnalyzeResult, type PackageDetails, type VersionPair } from './analyzer';
import type { Settings } from './config';
import { buildAuditHover, buildHover } from './hover';
import type { DependencyUpdate, Ecosystem } from './types';

/**
 * The detail that is not worth a request until someone looks for it: publish
 * dates, and whatever prose the version lookup did not already carry. Nothing
 * here is fetched during a check, so hints appear exactly as fast as before;
 * the first hover over a dependency pays for it, and every hover after is free.
 */
export class DetailsResolver {
  private readonly resolved = new Map<string, PackageDetails>();
  private readonly inFlight = new Map<string, Promise<PackageDetails>>();

  async resolve(
    fsPath: string,
    ecosystem: Ecosystem,
    update: DependencyUpdate,
    settings: Settings,
  ): Promise<PackageDetails> {
    const versions = versionsOf(update, ecosystem);
    const lookup = lookupFor(ecosystem, fsPath, settings);
    if (!lookup?.fetchDetails) {
      return {};
    }

    const key = `${lookup.key(update.dep)}|${versions.current}|${versions.latest}`;
    const cached = this.resolved.get(key);
    if (cached) {
      return cached;
    }

    // Hovering wanders over the same line repeatedly; one request answers all of it.
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = lookup
        .fetchDetails(update.dep, versions)
        .then((details) => {
          this.resolved.set(key, details);
          return details;
        })
        // A failed lookup is not cached, so the next hover tries again rather than
        // leaving the card permanently thinner than it should be.
        .catch(() => ({}) as PackageDetails)
        .finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    return pending;
  }

  clear(): void {
    this.resolved.clear();
  }
}

/** How each registry spells the two versions a hint compares. */
function versionsOf(update: DependencyUpdate, ecosystem: Ecosystem): VersionPair {
  return {
    // A go.mod names the exact version, `+incompatible` and all, and the proxy
    // knows it under no other spelling.
    current: ecosystem === 'go' ? update.dep.spec.trim() : update.current,
    latest: update.latestRaw ?? update.latest,
  };
}

/** One on-demand hover for both the declaration and its inline update hint. */
export class DependencyHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly resultFor: (uri: vscode.Uri) => AnalyzeResult | undefined,
    private readonly settingsFor: (uri: vscode.Uri) => Settings,
    private readonly details: DetailsResolver,
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    const result = this.resultFor(document.uri);
    const update = result?.updates.find((candidate) => candidate.dep.line === position.line);
    const audit = result?.audits.find((candidate) => candidate.dep.line === position.line);
    const dep = update?.dep ?? audit?.dep;
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
    const declarationPresent = line.text.includes(dep.alias ?? dep.name)
      || (result.ecosystem === 'deno' && line.text.includes(dep.name));
    if (!['java', 'ruby', 'terraform', 'elixir'].includes(result.ecosystem) && !declarationPresent) {
      return undefined;
    }

    const range = new vscode.Range(
      position.line,
      line.firstNonWhitespaceCharacterIndex,
      position.line,
      line.range.end.character,
    );
    const details = update ? await this.details.resolve(document.uri.fsPath, result.ecosystem, update, this.settingsFor(document.uri)) : {};
    if (token.isCancellationRequested) {
      return undefined;
    }
    const contents = update ? [buildHover(update, result.ecosystem, details)] : [];
    if (audit) contents.push(buildAuditHover(audit));
    return new vscode.Hover(contents, range);
  }
}
