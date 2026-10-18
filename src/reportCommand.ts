import * as vscode from 'vscode';
import { collectReport, type CollectedReport } from './reportCollector';
import { renderReportSnapshot } from './report';
import { renderJsonReport } from './reportSnapshot';
import { ReportDocumentProvider } from './reportDocument';

export function registerReportCommand(): vscode.Disposable {
  const documents = new ReportDocumentProvider();
  const operations = new Map<string, Promise<void>>();
  let collection: Promise<CollectedReport | undefined> | undefined;
  const commands = (['markdown', 'json'] as const).map((format) =>
    vscode.commands.registerCommand(
      format === 'json' ? 'freshDeps.reportJson' : 'freshDeps.report',
      () => {
        let operation = operations.get(format);
        if (!operation) {
          collection ??= collectReport().finally(() => {
            collection = undefined;
          });
          operation = collection
            .then(async (report) => {
              if (!report) return;
              const content =
                format === 'json'
                  ? renderJsonReport(report.snapshot)
                  : renderReportSnapshot(
                      report.snapshot,
                      (path, workspace) =>
                        report.files.find(
                          (file) => file.path === path && file.workspace === workspace
                        )?.uri
                    );
              await documents.open(content, format);
            })
            .catch(async (error) => {
              await vscode.window.showErrorMessage(
                `Fresh Deps: could not generate dependency report: ${error instanceof Error ? error.message : String(error)}`
              );
            })
            .finally(() => {
              operations.delete(format);
            });
          operations.set(format, operation);
        }
        return operation;
      }
    )
  );
  return {
    dispose: () => {
      commands.forEach((command) => command.dispose());
      documents.dispose();
    },
  };
}
