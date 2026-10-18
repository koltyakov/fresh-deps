import * as vscode from 'vscode';
import { analyze, manifestOf } from './analyzer';
import { AuditCache } from './audit';
import { VersionCache } from './cache';
import { readSettings } from './config';
import { registeredManifest } from './manifests';
import { clearManifestCache } from './projectFiles';
import { exclusionFor, isWithin } from './policies';
import { reportExcludedDirectories, type ReportFile } from './report';
import { createReportSnapshot, type ReportSnapshot } from './reportSnapshot';

export interface CollectedReport { snapshot: ReportSnapshot; files: ReportFile[] }

export async function collectReport(): Promise<CollectedReport | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    await vscode.window.showInformationMessage('Fresh Deps: open a project folder to generate a dependency report.');
    return undefined;
  }
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Fresh Deps: generating dependency report', cancellable: true }, async (progress, token) => {
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    if (token.isCancellationRequested) controller.abort();
    try {
      clearManifestCache();
      const cache = new VersionCache(readSettings().cacheDurationMinutes * 60_000);
      const auditCache = new AuditCache();
      const candidates = new Map<string, vscode.Uri>();
      const results: ReportFile[] = [];
      const visited = new Set<string>();
      const workspaceLabel = (folder: vscode.WorkspaceFolder) => folders.filter((entry) => entry.name === folder.name).length > 1 ? `${folder.name} [${folders.indexOf(folder) + 1}]` : folder.name;
      const ownerOf = (uri: vscode.Uri) => [...folders].filter((folder) => isWithin(folder.uri.fsPath, uri.fsPath)).sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)[0];
      for (const folder of folders) {
        const directories = [folder.uri];
        while (directories.length) {
          if (token.isCancellationRequested) return undefined;
          const directory = directories.pop()!;
          if (visited.has(directory.toString())) continue;
          visited.add(directory.toString());
          const owner = ownerOf(directory) ?? folder;
          const directoryExcluded = exclusionFor(directory.fsPath, readSettings(directory).exclude, owner.uri.fsPath, true);
          if (directoryExcluded) {
            results.push({ path: vscode.workspace.asRelativePath(directory, false), uri: directory.toString(), workspace: workspaceLabel(owner), rootPath: owner.uri.fsPath, excluded: directoryExcluded, directory: true });
            continue;
          }
          progress.report({ message: `Finding manifests in ${vscode.workspace.asRelativePath(directory, false)}` });
          try {
            for (const [name, type] of await vscode.workspace.fs.readDirectory(directory)) {
              const uri = vscode.Uri.joinPath(directory, name);
              if (type & vscode.FileType.SymbolicLink) continue;
              if (type & vscode.FileType.Directory) {
                const excluded = reportExcludedDirectories.some((pattern) => pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : uri.path.endsWith(`/${pattern}`));
                if (!excluded) directories.push(uri);
              } else if (type & vscode.FileType.File && (registeredManifest(uri.fsPath) || /\.jsonc?$/i.test(name) && manifestOf(uri.fsPath))) candidates.set(uri.toString(), uri);
            }
          } catch (error) {
            results.push({ path: vscode.workspace.asRelativePath(directory, false), uri: directory.toString(), workspace: workspaceLabel(owner), rootPath: owner.uri.fsPath,
              error: `Could not scan directory: ${error instanceof Error ? error.message : String(error)}` });
          }
        }
      }
      const files = [...candidates.values()].sort((a, b) => a.toString().localeCompare(b.toString()));
      for (const [index, uri] of files.entries()) {
        if (token.isCancellationRequested) return undefined;
        const label = vscode.workspace.asRelativePath(uri, false);
        const owner = ownerOf(uri)!;
        const base = { path: label, uri: uri.toString(), workspace: workspaceLabel(owner), rootPath: owner.uri.fsPath };
        progress.report({ message: `${index + 1}/${files.length}: ${label}` });
        try {
          if (!manifestOf(uri.fsPath)) continue;
          const settings = { ...readSettings(uri), showSatisfyingUpdates: true };
          const excluded = exclusionFor(uri.fsPath, settings.exclude, owner.uri.fsPath);
          if (excluded) { results.push({ ...base, excluded }); continue; }
          const document = await vscode.workspace.openTextDocument(uri);
          cache.setTtl(settings.cacheDurationMinutes * 60_000);
          const result = await analyze({ fsPath: uri.fsPath, workspaceRoot: owner.uri.fsPath, text: document.getText(), settings,
            cache, auditCache, allowNetwork: true, isCancelled: () => token.isCancellationRequested, signal: controller.signal });
          if (result) results.push({ ...base, result });
        } catch (error) { results.push({ ...base, error: error instanceof Error ? error.message : String(error) }); }
      }
      if (token.isCancellationRequested) return undefined;
      return { snapshot: createReportSnapshot(results, folders.map(workspaceLabel)), files: results };
    } finally { cancellation.dispose(); }
  });
}
