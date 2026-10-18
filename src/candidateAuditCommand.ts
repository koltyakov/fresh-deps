import * as vscode from 'vscode';
import type { AnalyzeResult } from './analyzer';
import type { AuditCache } from './audit';
import { auditCandidate, candidateVersions } from './candidateAudit';
import { readSettings } from './config';
import { buildAuditHover } from './hover';
import { ReportDocumentProvider } from './reportDocument';

export function registerCandidateAuditCommand(
  resultFor: (uri: vscode.Uri) => AnalyzeResult | undefined,
  cache: AuditCache
): vscode.Disposable {
  let documents: ReportDocumentProvider | undefined;
  let running = false;
  let disposed = false;
  let controller: AbortController | undefined;
  const command = vscode.commands.registerCommand('freshDeps.auditCandidate', async () => {
    if (running || disposed) return;
    const document = vscode.window.activeTextEditor?.document;
    if (!document) return;
    const settings = readSettings(document.uri);
    if (!settings.auditEnabled) {
      await vscode.window.showInformationMessage(
        'Fresh Deps: enable freshDeps.audit.enabled before auditing an update version.'
      );
      return;
    }
    const result = resultFor(document.uri);
    if (!result?.updates.length || result.excluded) {
      await vscode.window.showInformationMessage(
        'Fresh Deps: refresh this manifest to find update versions to audit.'
      );
      return;
    }
    running = true;
    const text = document.getText();
    try {
      const selected = await vscode.window.showQuickPick(
        result.updates.map((update) => ({
          label: update.dep.alias ? `${update.dep.alias} → ${update.dep.name}` : update.dep.name,
          description: `${update.dep.section}, line ${update.dep.line + 1}`,
          update,
        })),
        { placeHolder: 'Select a dependency update to audit' }
      );
      if (!selected) return;
      const version = await vscode.window.showQuickPick(candidateVersions(selected.update), {
        placeHolder: 'Select the exact candidate version to audit',
      });
      if (!version) return;
      const currentSettings = readSettings(document.uri);
      if (
        text !== document.getText() ||
        resultFor(document.uri) !== result ||
        JSON.stringify(currentSettings) !== JSON.stringify(settings)
      ) {
        await vscode.window.showInformationMessage(
          'Fresh Deps: the declaration or settings changed. Refresh and select the update again.'
        );
        return;
      }
      const audit = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Fresh Deps: auditing candidate version',
          cancellable: true,
        },
        async (_progress, token) => {
          const requestController = new AbortController();
          controller = requestController;
          const cancellation = token.onCancellationRequested(() => requestController.abort());
          if (token.isCancellationRequested || disposed) requestController.abort();
          try {
            return await auditCandidate(
              document.uri.fsPath,
              result.ecosystem,
              selected.update,
              version,
              settings,
              cache,
              requestController.signal
            );
          } finally {
            cancellation.dispose();
            if (controller === requestController) controller = undefined;
          }
        }
      );
      if (disposed) return;
      documents ??= new ReportDocumentProvider('fresh-deps-audit');
      await documents.open(
        `# Update version audit\n\n${buildAuditHover(audit).value}`,
        'markdown',
        'Candidate Version Audit'
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      await vscode.window.showErrorMessage(
        `Fresh Deps: candidate audit failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      running = false;
    }
  });
  return {
    dispose: () => {
      disposed = true;
      controller?.abort();
      command?.dispose();
      documents?.dispose();
    },
  };
}
