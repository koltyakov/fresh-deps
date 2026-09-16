import * as vscode from 'vscode';
import { analyze, manifestOf } from './analyzer';
import { AuditCache } from './audit';
import { VersionCache } from './cache';
import { readSettings } from './config';
import { registeredManifest } from './manifests';
import { clearManifestCache } from './projectFiles';
import { renderReport, reportExcludedDirectories, type ReportFile } from './report';
import { ReportDocumentProvider } from './reportDocument';

export function registerReportCommand(): vscode.Disposable {
  const documents = new ReportDocumentProvider();
  let operation: Promise<void> | undefined;
  const command = vscode.commands.registerCommand('freshDeps.report', () => {
    if (!operation) operation = generateReport(documents).finally(() => { operation = undefined; });
    return operation;
  });
  return { dispose: () => { command.dispose(); documents.dispose(); } };
}

async function generateReport(documents: ReportDocumentProvider): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    await vscode.window.showInformationMessage('Fresh Deps: open a project folder to generate a dependency report.');
    return;
  }
  try {
    const content = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Fresh Deps: generating dependency report', cancellable: true,
    }, async (progress, token) => {
      clearManifestCache();
      // A report starts fresh without invalidating inline checks in flight.
      const cache = new VersionCache(readSettings().cacheDurationMinutes * 60_000);
      const auditCache = new AuditCache();
      const files = new Map<string, vscode.Uri>();
      const results: ReportFile[] = [];
      const visited = new Set<string>();
      for (const folder of folders) {
        const directories = [folder.uri];
        while (directories.length) {
          if (token.isCancellationRequested) return;
          const directory = directories.pop()!;
          if (visited.has(directory.toString())) continue;
          visited.add(directory.toString());
          progress.report({ message: `Finding manifests in ${vscode.workspace.asRelativePath(directory, false)}` });
          try {
            for (const [name, type] of await vscode.workspace.fs.readDirectory(directory)) {
              const uri = vscode.Uri.joinPath(directory, name);
              // Do not follow symlinks into dependency trees or back to parent folders.
              if (type & vscode.FileType.SymbolicLink) continue;
              if (type & vscode.FileType.Directory) {
                const normalized = uri.path;
                const excluded = reportExcludedDirectories.some((pattern) => pattern.endsWith('*')
                  ? name.startsWith(pattern.slice(0, -1)) : normalized.endsWith(`/${pattern}`));
                if (!excluded) directories.push(uri);
              } else if (type & vscode.FileType.File && (registeredManifest(uri.fsPath) || /\.jsonc?$/i.test(name) && manifestOf(uri.fsPath))) {
                files.set(uri.toString(), uri);
              }
            }
          } catch (error) {
            results.push({ path: vscode.workspace.asRelativePath(directory, false), uri: directory.toString(),
              error: `Could not scan directory: ${error instanceof Error ? error.message : String(error)}` });
          }
        }
      }
      const candidates = [...files.values()].sort((a, b) => a.toString().localeCompare(b.toString()));
      for (const [index, uri] of candidates.entries()) {
        if (token.isCancellationRequested) return;
        const label = vscode.workspace.asRelativePath(uri, false);
        progress.report({ message: `${index + 1}/${candidates.length}: ${label}` });
        try {
          if (!manifestOf(uri.fsPath)) continue;
          const document = await vscode.workspace.openTextDocument(uri);
          const settings = { ...readSettings(uri), showSatisfyingUpdates: true };
          cache.setTtl(settings.cacheDurationMinutes * 60_000);
          const result = await analyze({ fsPath: uri.fsPath, text: document.getText(), settings,
            cache, auditCache, allowNetwork: true, isCancelled: () => token.isCancellationRequested });
          if (result) results.push({ path: label, uri: uri.toString(), result });
        } catch (error) {
          results.push({ path: label, uri: uri.toString(), error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (token.isCancellationRequested) return;
      return renderReport(results, folders.map((folder) => folder.name));
    });
    if (content === undefined) return;
    await documents.open(content);
  } catch (error) {
    await vscode.window.showErrorMessage(`Fresh Deps: could not generate dependency report: ${error instanceof Error ? error.message : String(error)}`);
  }
}
