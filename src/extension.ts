import * as vscode from 'vscode';
import { analyze, ecosystemOf } from './analyzer';
import { VersionCache } from './cache';
import { readSettings } from './config';
import { DecorationRenderer } from './decorations';

const CACHE_STATE_KEY = 'freshDeps.cache';
const TYPING_DEBOUNCE_MS = 400;

export function activate(context: vscode.ExtensionContext): void {
  const cache = new VersionCache(readSettings().cacheDurationMinutes * 60_000);
  cache.restore(context.globalState.get(CACHE_STATE_KEY));

  const renderer = new DecorationRenderer();
  const output = vscode.window.createOutputChannel('Fresh Deps');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'freshDeps.refresh';

  let hintsEnabled = readSettings().enabled;
  const timers = new Map<string, NodeJS.Timeout>();
  const generations = new Map<string, number>();

  context.subscriptions.push(renderer, output, status);

  async function refresh(editor: vscode.TextEditor | undefined, allowNetwork: boolean): Promise<void> {
    if (!editor) {
      status.hide();
      return;
    }

    const document = editor.document;
    const key = document.uri.toString();
    const ecosystem = ecosystemOf(document.uri.fsPath);

    if (!ecosystem || !hintsEnabled) {
      renderer.clear(editor);
      status.hide();
      return;
    }

    const settings = readSettings(document.uri);
    cache.setTtl(settings.cacheDurationMinutes * 60_000);

    const generation = (generations.get(key) ?? 0) + 1;
    generations.set(key, generation);
    const isCancelled = () => generations.get(key) !== generation;

    status.text = '$(sync~spin) Checking dependencies…';
    status.tooltip = 'Fresh Deps is querying the registry';
    status.show();

    try {
      const result = await analyze({
        fsPath: document.uri.fsPath,
        text: document.getText(),
        settings,
        cache,
        allowNetwork,
        isCancelled,
      });

      if (isCancelled() || !result) {
        if (!result) {
          status.hide();
        }
        return;
      }

      // The editor may have been closed or replaced while requests were in flight.
      const target = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === key);
      if (target) {
        renderer.render(target, result.updates, result.ecosystem);
      }

      const count = result.updates.length;
      status.text = count === 0 ? '$(check) Deps up to date' : `$(arrow-up) ${count} update${count === 1 ? '' : 's'}`;
      status.tooltip = new vscode.MarkdownString(
        [
          count === 0 ? 'All dependencies are up to date.' : `${count} dependencies have newer versions.`,
          result.failures.size ? `\n\n${result.failures.size} lookups failed — see the Fresh Deps output channel.` : '',
          '\n\nClick to re-check.',
        ].join(''),
      );
      status.show();

      for (const [name, error] of result.failures) {
        output.appendLine(`[${new Date().toISOString()}] ${name}: ${error}`);
      }

      void context.globalState.update(CACHE_STATE_KEY, cache.serialize());
    } catch (error) {
      output.appendLine(`[${new Date().toISOString()}] ${document.uri.fsPath}: ${String(error)}`);
      status.text = '$(warning) Dependency check failed';
      status.show();
    }
  }

  function schedule(document: vscode.TextDocument, allowNetwork: boolean): void {
    if (!ecosystemOf(document.uri.fsPath)) {
      return;
    }
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === key);
        void refresh(editor, allowNetwork);
      }, TYPING_DEBOUNCE_MS),
    );
  }

  function updateContext(editor: vscode.TextEditor | undefined): void {
    void vscode.commands.executeCommand(
      'setContext',
      'freshDeps.supportedFile',
      editor ? ecosystemOf(editor.document.uri.fsPath) !== undefined : false,
    );
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateContext(editor);
      void refresh(editor, true);
    }),
    vscode.workspace.onDidSaveTextDocument((document) => schedule(document, true)),
    vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document, false)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('freshDeps')) {
        return;
      }
      hintsEnabled = readSettings().enabled;
      void refresh(vscode.window.activeTextEditor, true);
    }),
    vscode.commands.registerCommand('freshDeps.refresh', async () => {
      cache.clear();
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Fresh Deps: checking for updates' },
        () => refresh(vscode.window.activeTextEditor, true),
      );
    }),
    vscode.commands.registerCommand('freshDeps.toggle', async () => {
      hintsEnabled = !hintsEnabled;
      await vscode.workspace.getConfiguration('freshDeps').update('enabled', hintsEnabled, true);
      await refresh(vscode.window.activeTextEditor, true);
    }),
    vscode.commands.registerCommand('freshDeps.clearCache', async () => {
      cache.clear();
      await context.globalState.update(CACHE_STATE_KEY, undefined);
      vscode.window.showInformationMessage('Fresh Deps: version cache cleared.');
    }),
    { dispose: () => timers.forEach(clearTimeout) },
  );

  updateContext(vscode.window.activeTextEditor);
  void refresh(vscode.window.activeTextEditor, true);
}

export function deactivate(): void {
  // Decorations and listeners are disposed through the extension context.
}
