import * as vscode from 'vscode';
import { analyze, ecosystemOf, type AnalyzeResult } from './analyzer';
import { VersionCache } from './cache';
import { AuditCache } from './audit';
import { readSettings } from './config';
import { DecorationRenderer } from './decorations';
import { DependencyHoverProvider, DetailsResolver } from './details';
import { manifestSelectors } from './manifests';
import { clearManifestCache } from './projectFiles';
import { isVersionIssue } from './availability';
import { registerReportCommand } from './reportCommand';

const CACHE_STATE_KEY = 'freshDeps.cache.v4';
const TYPING_DEBOUNCE_MS = 400;

export function activate(context: vscode.ExtensionContext): void {
  const cache = new VersionCache(readSettings().cacheDurationMinutes * 60_000);
  const auditCache = new AuditCache();
  cache.restore(context.globalState.get(CACHE_STATE_KEY));

  const renderer = new DecorationRenderer();
  const output = vscode.window.createOutputChannel('Fresh Deps');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'freshDeps.refresh';

  const timers = new Map<string, NodeJS.Timeout>();
  const generations = new Map<string, number>();
  const controllers = new Map<string, AbortController>();
  // What each open manifest last resolved to, so the hover can answer for a line
  // without analysing the document again.
  const results = new Map<string, AnalyzeResult>();
  const details = new DetailsResolver();

  context.subscriptions.push(renderer, output, status);

  async function refresh(editor: vscode.TextEditor | undefined, allowNetwork: boolean): Promise<void> {
    if (!editor) {
      status.hide();
      return;
    }

    const document = editor.document;
    const key = document.uri.toString();
    const isActive = () => vscode.window.activeTextEditor?.document.uri.toString() === key;
    const clearEditors = () => {
      for (const target of vscode.window.visibleTextEditors) {
        if (target.document.uri.toString() === key) renderer.clear(target);
      }
    };
    const ecosystem = ecosystemOf(document.uri.fsPath);
    const generation = (generations.get(key) ?? 0) + 1;
    generations.set(key, generation);
    controllers.get(key)?.abort();
    controllers.delete(key);
    const controller = new AbortController();
    const isCancelled = () => controller.signal.aborted || generations.get(key) !== generation;

    const settings = readSettings(document.uri);
    if (!ecosystem || !settings.enabled) {
      results.delete(key);
      clearEditors();
      if (isActive()) status.hide();
      return;
    }

    cache.setTtl(settings.cacheDurationMinutes * 60_000);
    controllers.set(key, controller);

    if (isActive()) {
      status.text = '$(sync~spin) Checking dependencies…';
      status.tooltip = 'Fresh Deps is querying the registry';
      status.show();
    }

    try {
      const result = await analyze({
        fsPath: document.uri.fsPath,
        text: document.getText(),
        settings,
        cache,
        auditCache,
        allowNetwork,
        isCancelled,
        signal: controller.signal,
      });

      if (isCancelled()) {
        return;
      }
      if (!result) {
        results.delete(key);
        clearEditors();
        if (isActive()) status.hide();
        return;
      }

      results.set(key, result);

      // The editor may have been closed or replaced while requests were in flight.
      for (const target of vscode.window.visibleTextEditors) {
        if (target.document.uri.toString() === key) {
          renderer.render(target, result.updates, result.ecosystem, result.audits, result.statuses);
        }
      }

      if (isActive()) {
        const count = result.updates.length;
        const issues = result.statuses?.filter(isVersionIssue).length ?? 0;
        const failed = result.statuses?.filter((entry) => entry.status === 'failed').length ?? result.failures.size;
        const affected = result.audits.filter((audit) => audit.result.status === 'checked' && audit.result.advisories.length > 0).length;
        const checked = result.audits.filter((audit) => audit.result.status === 'checked').length;
        const auditFailed = result.audits.filter((audit) => audit.result.status === 'failed').length;
        status.text = count === 0 ? '$(check) Deps up to date' : `$(arrow-up) ${count} update${count === 1 ? '' : 's'}`;
        if (count === 0 && (result.incomplete || result.failures.size || result.skipped?.length)) status.text = '$(info) Dependency check incomplete';
        else if (count === 0 && result.declarations === 0) status.text = '$(info) No supported declarations';
        if (issues) status.text = `${count ? `$(arrow-up) ${count} update${count === 1 ? '' : 's'} | ` : ''}$(warning) ${issues} version issue${issues === 1 ? '' : 's'}`;
        if (count > 0 || issues) {
          if (result.incomplete || failed || result.skipped?.length) status.text += ' | $(info) Check incomplete';
        }
        if (affected) status.text += ` | $(warning) ${affected} audited deps with warnings`;
        else if (auditFailed) status.text += ' | $(warning) Audit incomplete';
        status.tooltip = new vscode.MarkdownString(
          [
            count === 0 ? 'No updates found among checked declarations.' : `${count} dependencies have newer versions.`,
            issues ? `\n\n${issues} declarations have version issues. Hover over their hints for details.` : '',
            result.skipped?.length ? `\n\n${result.skipped.length} declarations skipped. See the Fresh Deps output channel for reasons.` : '',
            failed ? `\n\n${failed} lookups failed - see the Fresh Deps output channel.` : '',
            settings.auditEnabled ? `\n\nAudit: ${checked}/${result.audits.length} declarations checked; ${affected} with warnings; ${auditFailed} failed. Checks declared versions, range baselines, or optional lockfile selections, not installed dependencies. Unsupported or uncached declarations are not checked.` : '',
            '\n\nClick to re-check.',
          ].join(''),
        );
        status.show();
      }

      for (const [name, error] of result.failures) {
        output.appendLine(`[${new Date().toISOString()}] ${name}: ${error}`);
      }
      if (allowNetwork) for (const skip of result.skipped ?? []) {
        output.appendLine(`${document.uri.fsPath}:${skip.line + 1} ${skip.name}: skipped, ${skip.reason}`);
      }
      for (const audit of result.audits) {
        if (audit.result.status === 'failed') {
          output.appendLine(`[${new Date().toISOString()}] ${audit.dep.name} audit: ${audit.result.error}`);
        }
      }

      void context.globalState.update(CACHE_STATE_KEY, cache.serialize());
    } catch (error) {
      if (isCancelled()) {
        return;
      }
      output.appendLine(`[${new Date().toISOString()}] ${document.uri.fsPath}: ${String(error)}`);
      if (isActive()) {
        status.text = '$(warning) Dependency check failed';
        status.show();
      }
    } finally {
      if (controllers.get(key) === controller) controllers.delete(key);
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
        if (editor) void refresh(editor, allowNetwork);
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

  // Every language a supported manifest can be opened as. The provider itself only
  // answers on a line the last check reported an update for.
  const MANIFEST_SELECTOR: vscode.DocumentSelector = manifestSelectors;

  context.subscriptions.push(
    registerReportCommand(),
    vscode.languages.registerHoverProvider(
      MANIFEST_SELECTOR,
      new DependencyHoverProvider(
        (uri) => results.get(uri.toString()),
        (uri) => readSettings(uri),
        details,
      ),
    ),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      results.delete(key);
      generations.set(key, (generations.get(key) ?? 0) + 1);
      controllers.get(key)?.abort();
      controllers.delete(key);
      clearTimeout(timers.get(key));
      timers.delete(key);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateContext(editor);
      void refresh(editor, true);
    }),
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        const result = results.get(editor.document.uri.toString());
        if (result && readSettings(editor.document.uri).enabled) {
          renderer.render(editor, result.updates, result.ecosystem, result.audits, result.statuses);
        } else renderer.clear(editor);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => { clearManifestCache(); schedule(document, true); }),
    vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document, false)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('freshDeps')) {
        return;
      }
      // Invalidate checks for hidden documents too, before refreshing visible ones.
      for (const [key, generation] of generations) {
        generations.set(key, generation + 1);
      }
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      results.clear();
      const visible = new Map(vscode.window.visibleTextEditors.map((editor) => [editor.document.uri.toString(), editor]));
      for (const editor of visible.values()) {
        void refresh(editor, true);
      }
    }),
    vscode.commands.registerCommand('freshDeps.refresh', async () => {
      clearManifestCache();
      cache.clear();
      auditCache.clear();
      details.clear();
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Fresh Deps: checking for updates' },
        () => refresh(vscode.window.activeTextEditor, true),
      );
    }),
    vscode.commands.registerCommand('freshDeps.toggle', async () => {
      const scope = vscode.window.activeTextEditor?.document.uri;
      const enabled = readSettings(scope).enabled;
      const configuration = vscode.workspace.getConfiguration('freshDeps', scope);
      const inspected = configuration.inspect<boolean>('enabled');
      const target = inspected?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
        : inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      await configuration.update('enabled', !enabled, target);
      await refresh(vscode.window.activeTextEditor, true);
    }),
    vscode.commands.registerCommand('freshDeps.clearCache', async () => {
      cache.clear();
      auditCache.clear();
      details.clear();
      await context.globalState.update(CACHE_STATE_KEY, undefined);
      vscode.window.showInformationMessage('Fresh Deps: version cache cleared.');
    }),
    { dispose: () => {
      timers.forEach(clearTimeout);
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    } },
  );

  updateContext(vscode.window.activeTextEditor);
  void refresh(vscode.window.activeTextEditor, true);
}

export function deactivate(): void {
  // Decorations and listeners are disposed through the extension context.
}
