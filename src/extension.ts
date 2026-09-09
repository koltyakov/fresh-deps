import * as vscode from 'vscode';
import { analyze, ecosystemOf, type AnalyzeResult } from './analyzer';
import { VersionCache } from './cache';
import { AuditCache } from './audit';
import { readSettings } from './config';
import { DecorationRenderer } from './decorations';
import { DependencyHoverProvider, DetailsResolver } from './details';

const CACHE_STATE_KEY = 'freshDeps.cache';
const TYPING_DEBOUNCE_MS = 400;

export function activate(context: vscode.ExtensionContext): void {
  const cache = new VersionCache(readSettings().cacheDurationMinutes * 60_000);
  const auditCache = new AuditCache();
  cache.restore(context.globalState.get(CACHE_STATE_KEY));

  const renderer = new DecorationRenderer();
  const output = vscode.window.createOutputChannel('Fresh Deps');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'freshDeps.refresh';

  let hintsEnabled = readSettings().enabled;
  const timers = new Map<string, NodeJS.Timeout>();
  const generations = new Map<string, number>();
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
    const ecosystem = ecosystemOf(document.uri.fsPath);
    const generation = (generations.get(key) ?? 0) + 1;
    generations.set(key, generation);
    const isCancelled = () => generations.get(key) !== generation;

    if (!ecosystem || !hintsEnabled) {
      results.delete(key);
      renderer.clear(editor);
      status.hide();
      return;
    }

    const settings = readSettings(document.uri);
    cache.setTtl(settings.cacheDurationMinutes * 60_000);

    status.text = '$(sync~spin) Checking dependencies…';
    status.tooltip = 'Fresh Deps is querying the registry';
    status.show();

    try {
      const result = await analyze({
        fsPath: document.uri.fsPath,
        text: document.getText(),
        settings,
        cache,
        auditCache,
        allowNetwork,
        isCancelled,
      });

      if (isCancelled() || !hintsEnabled) {
        return;
      }
      if (!result) {
        results.delete(key);
        renderer.clear(editor);
        status.hide();
        return;
      }

      results.set(key, result);

      // The editor may have been closed or replaced while requests were in flight.
      const target = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === key);
      if (target) {
        renderer.render(target, result.updates, result.ecosystem, result.audits);
      }

      const count = result.updates.length;
      const affected = result.audits.filter((audit) => audit.result.status === 'checked' && audit.result.advisories.length > 0).length;
      const checked = result.audits.filter((audit) => audit.result.status === 'checked').length;
      const auditFailed = result.audits.filter((audit) => audit.result.status === 'failed').length;
      status.text = count === 0 ? '$(check) Deps up to date' : `$(arrow-up) ${count} update${count === 1 ? '' : 's'}`;
      if (affected) status.text += ` | $(warning) ${affected} audited deps with warnings`;
      else if (auditFailed) status.text += ' | $(warning) Audit incomplete';
      status.tooltip = new vscode.MarkdownString(
        [
          count === 0 ? 'All dependencies are up to date.' : `${count} dependencies have newer versions.`,
          result.failures.size ? `\n\n${result.failures.size} lookups failed - see the Fresh Deps output channel.` : '',
          settings.auditEnabled ? `\n\nAudit: ${checked}/${result.audits.length} declarations checked; ${affected} with warnings; ${auditFailed} failed. Checks declared versions or range baselines, not installed dependencies. Unsupported or uncached declarations are not checked.` : '',
          '\n\nClick to re-check.',
        ].join(''),
      );
      status.show();

      for (const [name, error] of result.failures) {
        output.appendLine(`[${new Date().toISOString()}] ${name}: ${error}`);
      }
      for (const audit of result.audits) {
        if (audit.result.status === 'failed') {
          output.appendLine(`[${new Date().toISOString()}] ${audit.dep.name} audit: ${audit.result.error}`);
        }
      }

      void context.globalState.update(CACHE_STATE_KEY, cache.serialize());
    } catch (error) {
      if (isCancelled() || !hintsEnabled) {
        return;
      }
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

  // Every language a supported manifest can be opened as. The provider itself only
  // answers on a line the last check reported an update for.
  const MANIFEST_SELECTOR: vscode.DocumentSelector = [
    { scheme: 'file', pattern: '**/requirements.{yml,yaml}' },
    { scheme: 'file', pattern: '**/MODULE.bazel' },
    { scheme: 'file', pattern: '**/vcpkg.json' },
    { scheme: 'file', pattern: '**/{Dockerfile,Containerfile}{,.*,-*,_*}' },
    { scheme: 'file', pattern: '**/*.{Dockerfile,Containerfile}' },
    { scheme: 'file', pattern: '**/{compose,docker-compose}{,.*,-*,_*}.{yml,yaml}' },
    { scheme: 'file', pattern: '**/Chart.yaml' },
    { scheme: 'file', pattern: '**/Package.swift' },
    { scheme: 'file', pattern: '**/conanfile.{txt,py}' },
    { scheme: 'file', pattern: '**/build.sbt' },
    { scheme: 'file', pattern: '**/project/plugins.sbt' },
    { scheme: 'file', pattern: '**/environment.{yml,yaml}' },
    { scheme: 'file', pattern: '**/deps.edn' },
    { scheme: 'file', pattern: '**/.yarnrc.yml' },
    { scheme: 'file', pattern: '**/{dotnet-tools,global}.json' },
    { scheme: 'file', pattern: '**/package.json' },
    { scheme: 'file', pattern: '**/composer.json' },
    { scheme: 'file', pattern: '**/pubspec.yaml' },
    { scheme: 'file', pattern: '**/pnpm-workspace.yaml' },
    { scheme: 'file', pattern: '**/*.versions.toml' },
    { scheme: 'file', pattern: '**/build.gradle{,.kts}' },
    { scheme: 'file', pattern: '**/deno.{json,jsonc}' },
    { scheme: 'file', pattern: '**/import{_,-}map.{json,jsonc}' },
    { scheme: 'file', pattern: '**/.github/workflows/*.{yml,yaml}' },
    { scheme: 'file', pattern: '**/action.{yml,yaml}' },
    { scheme: 'file', pattern: '**/go.mod' },
    { scheme: 'file', pattern: '**/Cargo.toml' },
    { scheme: 'file', pattern: '**/pom.xml' },
    { scheme: 'file', pattern: '**/pyproject.toml' },
    { scheme: 'file', pattern: '**/Pipfile' },
    { scheme: 'file', pattern: '**/*.txt' },
    { scheme: 'file', pattern: '**/*.{cs,fs,vb}proj' },
    { scheme: 'file', pattern: '**/Directory.{Packages,Build}.props' },
    { scheme: 'file', pattern: '**/packages.config' },
    { scheme: 'file', pattern: '**/Gemfile' },
    { scheme: 'file', pattern: '**/mix.exs' },
    { scheme: 'file', pattern: '**/*.tf' },
    { scheme: 'file', pattern: '**/*.tofu' },
    { scheme: 'file', pattern: '**/.tflint.hcl' },
  ];

  context.subscriptions.push(
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
      clearTimeout(timers.get(key));
      timers.delete(key);
    }),
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
      // Invalidate checks for hidden documents too, before refreshing visible ones.
      for (const [key, generation] of generations) {
        generations.set(key, generation + 1);
      }
      results.clear();
      for (const editor of vscode.window.visibleTextEditors) {
        void refresh(editor, true);
      }
    }),
    vscode.commands.registerCommand('freshDeps.refresh', async () => {
      cache.clear();
      auditCache.clear();
      details.clear();
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
      auditCache.clear();
      details.clear();
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
