import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';

const SCHEME = 'fresh-deps-report';

/** Named, read-only reports that close without a save prompt. */
export class ReportDocumentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly contents = new Map<string, string>();
  private readonly disposables: vscode.Disposable[];
  private disposed = false;

  constructor() {
    this.disposables = [
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, this),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme === SCHEME) this.contents.delete(document.uri.toString());
      }),
    ];
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }

  async open(content: string): Promise<void> {
    if (this.disposed) return;
    const uri = vscode.Uri.from({ scheme: SCHEME, path: `/${randomUUID()}/Outdated Dependencies Report.md` });
    this.contents.set(uri.toString(), content);
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.languages.setTextDocumentLanguage(document, 'markdown');
      await vscode.commands.executeCommand('markdown.showPreview', uri);
    } catch (error) {
      this.contents.delete(uri.toString());
      throw error;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.contents.clear();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
