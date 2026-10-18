import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';


/** Named, read-only reports that close without a save prompt. */
export class ReportDocumentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly contents = new Map<string, string>();
  private readonly disposables: vscode.Disposable[];
  private disposed = false;

  constructor(private readonly scheme = 'fresh-deps-report') {
    this.disposables = [
      vscode.workspace.registerTextDocumentContentProvider(scheme, this),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme === scheme) this.contents.delete(document.uri.toString());
      }),
    ];
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }

  async open(content: string, format: 'markdown' | 'json' = 'markdown', title = 'Outdated Dependencies Report'): Promise<void> {
    if (this.disposed) return;
    const uri = vscode.Uri.from({ scheme: this.scheme, path: `/${randomUUID()}/${title}.${format === 'json' ? 'json' : 'md'}` });
    this.contents.set(uri.toString(), content);
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.languages.setTextDocumentLanguage(document, format);
      if (format === 'markdown') await vscode.commands.executeCommand('markdown.showPreview', uri);
      else await vscode.window.showTextDocument(document);
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
