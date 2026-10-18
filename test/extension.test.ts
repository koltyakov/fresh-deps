import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from 'vscode';
import { matchesGlob } from 'node:path';
import type { AnalyzeResult } from '../src/analyzer';

const Module = require('node:module') as {
  _load: (id: string, parent: NodeModule | null | undefined, isMain?: boolean) => unknown;
};

type MockEditor = { document: { uri: { fsPath: string; toString(): string }; getText(): string } };
type Events = {
  active: (editor: MockEditor) => void;
  visible: (editors: MockEditor[]) => void;
  change: (event: { document: MockEditor['document'] }) => void;
  save: (document: MockEditor['document']) => void;
  close: (document: MockEditor['document']) => void;
  config: (event: { affectsConfiguration(): boolean }) => void;
};

function setup(t: TestContext) {
  // Activation registers these listeners before setup returns.
  const events = {} as Events;
  const calls: string[] = [];
  const hoverPatterns: string[] = [];
  const pending: {
    request: { isCancelled(): boolean; signal: AbortSignal };
    resolve: (value: ReturnType<typeof result> | undefined) => void;
    reject: (reason: Error) => void;
  }[] = [];
  const settings = { enabled: true, useLockfiles: true, cacheDurationMinutes: 60, exclude: [] as string[] };
  const lockEvents: (() => void)[] = [];
  const lockPatterns: string[] = [];
  const scopedSettings = new Map<string, typeof settings>();
  const commands = new Map<string, () => Promise<void>>();
  const inspection: { workspaceFolderValue?: boolean; workspaceValue?: boolean } = {};
  const writes: { scope?: MockEditor['document']['uri']; key: string; value: unknown; target: number }[] = [];
  const subscriptions: { dispose(): void }[] = [];
  const editor = (name: string): MockEditor => ({ document: {
    uri: { fsPath: `/${name}/package.json`, toString: () => `file:///${name}/package.json` },
    getText: () => '{}',
  } });
  const editors = [editor('a'), editor('b')];
  const noop = () => {};
  const status = { text: '', hide: noop, show: () => calls.push('status') };
  const vscode = {
    window: {
      activeTextEditor: editors[0], visibleTextEditors: editors,
      createOutputChannel: () => ({ appendLine: noop }),
      createStatusBarItem: () => status,
      onDidChangeActiveTextEditor: (cb: Events['active']) => { events.active = cb; },
      onDidChangeVisibleTextEditors: (cb: Events['visible']) => { events.visible = cb; },
    },
    workspace: {
      getWorkspaceFolder: (uri: MockEditor['document']['uri']) => ({ uri: { fsPath: uri.fsPath.split('/').slice(0, 2).join('/') } }),
      createFileSystemWatcher: (pattern: string) => { lockPatterns.push(pattern); return { dispose: noop, onDidChange: (callback: () => void) => { lockEvents.push(callback); return { dispose: noop }; },
        onDidCreate: (callback: () => void) => { lockEvents.push(callback); return { dispose: noop }; },
        onDidDelete: (callback: () => void) => { lockEvents.push(callback); return { dispose: noop }; } }; },
      onDidCloseTextDocument: (cb: Events['close']) => { events.close = cb; },
      onDidSaveTextDocument: (cb: Events['save']) => { events.save = cb; },
      onDidChangeTextDocument: (cb: Events['change']) => { events.change = cb; },
      onDidChangeConfiguration: (cb: Events['config']) => { events.config = cb; },
      getConfiguration: (_section: string, scope?: MockEditor['document']['uri']) => ({
        inspect: () => inspection,
        update: async (key: string, value: unknown, target: number) => { writes.push({ scope, key, value, target }); },
      }),
    },
    commands: { executeCommand: noop, registerCommand: (name: string, callback: () => Promise<void>) => { commands.set(name, callback); } },
    languages: { registerHoverProvider: (selector: { pattern: string }[]) => { hoverPatterns.push(...selector.map((filter) => filter.pattern)); } },
    StatusBarAlignment: { Right: 1 }, MarkdownString: class {},
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  };
  const mocks: Record<string, unknown> = {
    vscode,
    './config': { readSettings: (uri?: MockEditor['document']['uri']) => uri && scopedSettings.get(uri.toString()) || settings },
    './reportCommand': { registerReportCommand: noop },
    './candidateAuditCommand': { registerCandidateAuditCommand: noop },
    './analyzer': {
      ecosystemOf: () => 'npm',
      analyze: (request: { isCancelled(): boolean; signal: AbortSignal }) => new Promise<ReturnType<typeof result> | undefined>((resolve, reject) => pending.push({ request, resolve, reject })),
    },
    './decorations': { DecorationRenderer: class {
      clear(editor: MockEditor) { calls.push(`clear:${editor.document.uri.fsPath}`); }
      render(editor: MockEditor) { calls.push(`render:${editor.document.uri.fsPath}`); }
    } },
    './details': { DetailsResolver: class { clear() {} }, DependencyHoverProvider: class {} },
  };
  const load = Module._load;
  t.mock.method(Module, '_load', function (this: typeof Module, id: string, parent: NodeModule | null | undefined, ...args: [isMain?: boolean]) {
    if (parent?.filename === require.resolve('../src/extension') && mocks[id]) return mocks[id];
    return load.call(this, id, parent, ...args);
  });
  const filename = require.resolve('../src/extension');
  delete require.cache[filename];
  t.after(() => { delete require.cache[filename]; });
  const { activate } = require(filename) as typeof import('../src/extension');
  activate({ subscriptions, globalState: { get: noop, update: noop } } as unknown as ExtensionContext);
  const configure = () => events.config({ affectsConfiguration: () => true });
  const activateEditor = (editor: MockEditor) => {
    vscode.window.activeTextEditor = editor;
    events.active(editor);
  };
  return { calls, pending, settings, scopedSettings, editors, events, activate: activateEditor, configure, hoverPatterns, status,
    commands, inspection, writes, subscriptions, lockEvents, lockPatterns };
}

const result = (): AnalyzeResult => ({ ecosystem: 'npm', updates: [], audits: [], failures: new Map(), incomplete: false });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

for (const stateName of ['version-missing', 'unknown', 'ahead', 'available'] as const) {
  test(`status bar summarizes ${stateName} without hiding incomplete checks`, async (t) => {
    const state = setup(t);
    const checked = result();
    checked.statuses = [{ dep: { name: 'pkg', spec: '3.0.0', section: 'dependencies', line: 0 }, status: stateName, message: 'Test' }];
    checked.incomplete = stateName === 'unknown';
    state.pending[0].resolve(checked);
    await flush();
    assert.equal(state.status.text, stateName === 'version-missing' ? '$(warning) 1 version issue'
      : stateName === 'unknown' ? '$(info) Dependency check incomplete' : '$(check) Deps up to date');
  });
}

test('hover registration covers Compose suffixes and Containerfiles', (t) => {
  const state = setup(t);
  for (const file of ['docker-compose-db.yml', 'docker-compose-dev.yml', 'docker-compose-otel.yml',
    'compose-prod.yaml', 'compose_test.yml', 'Containerfile', 'Containerfile.dev', 'Containerfile-prod',
    'Containerfile_test', 'prod.Containerfile', 'Dockerfile-prod', 'Dockerfile_test']) {
    assert.ok(state.hoverPatterns.some((pattern) => matchesGlob(`/workspace/${file}`, pattern)), file);
  }
});

test('hover registration covers Ansible, Bazel and vcpkg manifests', (t) => {
  const state = setup(t);
  for (const file of ['requirements.yml', 'collections/requirements.yaml', 'MODULE.bazel', 'vcpkg.json']) {
    assert.ok(state.hoverPatterns.some((pattern) => matchesGlob(`/workspace/${file}`, pattern)), file);
  }
});

for (const reject of [false, true]) {
  test(`disabling hints cancels in-flight ${reject ? 'failures' : 'results'} and clears all editors`, async (t) => {
    const state = setup(t);
    state.events.active(state.editors[1]);
    state.settings.enabled = false;
    state.configure();
    assert.ok(state.calls.includes('clear:/a/package.json'));
    assert.ok(state.calls.includes('clear:/b/package.json'));
    const before = [...state.calls];
    for (const pending of state.pending) {
      assert.equal(pending.request.isCancelled(), true);
      assert.equal(pending.request.signal.aborted, true);
      if (reject) pending.reject(new Error('offline'));
      else pending.resolve(result());
    }
    await flush();
    assert.deepEqual(state.calls, before);
  });
}

test('an ecosystem disabled during a check clears its existing decorations', async (t) => {
  const state = setup(t);
  state.pending[0].resolve(result());
  await flush();
  assert.ok(state.calls.includes('render:/a/package.json'));
  state.configure();
  state.pending[1].resolve(undefined);
  state.pending[2].resolve(undefined);
  await flush();
  assert.ok(state.calls.includes('clear:/a/package.json'));
});

test('closing a document invalidates its pending check', async (t) => {
  const state = setup(t);
  state.events.close(state.editors[0].document);
  assert.equal(state.pending[0].request.isCancelled(), true);
  assert.equal(state.pending[0].request.signal.aborted, true);
  state.pending[0].resolve(result());
  await flush();
  assert.ok(!state.calls.some((call) => call.startsWith('render:')));
});

for (const fail of [false, true]) {
  test(`a background ${fail ? 'failure' : 'result'} cannot replace the active editor status`, async (t) => {
    const state = setup(t);
    state.activate(state.editors[1]);
    const checked = result();
    checked.incomplete = true;
    state.pending[1].resolve(checked);
    await flush();
    const activeStatus = state.status.text;
    if (fail) state.pending[0].reject(new Error('offline'));
    else state.pending[0].resolve(result());
    await flush();
    assert.equal(state.status.text, activeStatus);
  });
}

test('folder-specific disabled hints make no analysis request', (t) => {
  const state = setup(t);
  state.scopedSettings.set(state.editors[1].document.uri.toString(), { ...state.settings, enabled: false });
  state.activate(state.editors[1]);
  assert.equal(state.pending.length, 1);
  assert.ok(state.calls.includes('clear:/b/package.json'));
});

test('folder-specific enabled hints work when the unscoped setting is disabled', (t) => {
  const state = setup(t);
  state.settings.enabled = false;
  state.scopedSettings.set(state.editors[1].document.uri.toString(), { ...state.settings, enabled: true });
  state.activate(state.editors[1]);
  assert.equal(state.pending.length, 2);
  assert.equal(state.pending[1].request.isCancelled(), false);
});

test('results render and clear in every split editor without duplicate checks', async (t) => {
  const state = setup(t);
  state.editors.push({ document: state.editors[0].document });
  state.pending[0].resolve(result());
  await flush();
  assert.equal(state.calls.filter((call) => call === 'render:/a/package.json').length, 2);
  state.configure();
  assert.equal(state.pending.length, 3);
  state.settings.enabled = false;
  state.configure();
  assert.equal(state.calls.filter((call) => call === 'clear:/a/package.json').length, 2);
});

test('opening a split editor reuses the existing result without a registry check', async (t) => {
  const state = setup(t);
  state.pending[0].resolve(result());
  await flush();
  const split = { document: state.editors[0].document };
  state.editors.push(split);
  state.events.visible([split]);
  assert.equal(state.calls.filter((call) => call === 'render:/a/package.json').length, 2);
  assert.equal(state.pending.length, 1);
});

test('a replacement check aborts the earlier request for the same document', (t) => {
  const state = setup(t);
  state.activate(state.editors[0]);
  assert.equal(state.pending[0].request.signal.aborted, true);
  assert.equal(state.pending[1].request.signal.aborted, false);
});

test('saving a hidden document does not hide or replace the active editor status', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = setup(t);
  state.pending[0].resolve(result());
  await flush();
  const before = [...state.calls];
  state.editors.splice(1, 1);
  state.events.save({ uri: { fsPath: '/hidden/package.json', toString: () => 'file:///hidden/package.json' }, getText: () => '{}' });
  t.mock.timers.tick(400);
  await flush();
  assert.deepEqual(state.calls, before);
  assert.equal(state.pending.length, 1);
});

test('disposing the extension aborts unfinished checks', (t) => {
  const state = setup(t);
  for (const disposable of state.subscriptions) disposable?.dispose?.();
  assert.equal(state.pending[0].request.signal.aborted, true);
});

test('editing immediately invalidates an older request before the typing debounce', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = setup(t);
  state.events.change({ document: state.editors[0].document });
  assert.equal(state.pending[0].request.signal.aborted, true);
  state.pending[0].resolve(result());
  await flush();
  assert.ok(!state.calls.some((call) => call.startsWith('render:')));
  t.mock.timers.tick(400);
  assert.equal(state.pending.length, 2);
});

test('workspace-relative exclusions clear hints before analysis', (t) => {
  const state = setup(t);
  state.scopedSettings.set(state.editors[1].document.uri.toString(), { ...state.settings, exclude: ['package.json'] });
  state.activate(state.editors[1]);
  assert.equal(state.pending.length, 1);
  assert.ok(state.calls.includes('clear:/b/package.json'));
});

test('external lockfile changes, creation and deletion refresh visible manifest baselines', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = setup(t);
  assert.equal(state.lockEvents.length, 3);
  for (const notify of state.lockEvents) notify();
  t.mock.timers.tick(400);
  assert.equal(state.pending.length, 3, 'Repeated notifications coalesce per visible manifest');
  assert.equal(state.pending[0].request.signal.aborted, true);
});

for (const filename of ['bun.lock', 'bun.lockb']) {
  test(`${filename} saves refresh manifests and external changes are watched`, (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const state = setup(t);
    assert.ok(state.lockPatterns.some((pattern) => matchesGlob(`/a/${filename}`, pattern)));
    state.events.save({ uri: { fsPath: `/a/${filename}`, toString: () => `file:///a/${filename}` }, getText: () => '' });
    assert.equal(state.pending[0].request.signal.aborted, true);
    t.mock.timers.tick(400);
    assert.equal(state.pending.length, 3);
  });
}

for (const [scope, target] of [['folder', 3], ['workspace', 2], ['global', 1]] as const) {
  test(`toggle updates the existing ${scope} setting instead of a shadowed global value`, async (t) => {
    const state = setup(t);
    if (scope === 'folder') state.inspection.workspaceFolderValue = true;
    if (scope === 'workspace') state.inspection.workspaceValue = true;
    const toggle = state.commands.get('freshDeps.toggle')!();
    await flush();
    state.pending[1].resolve(result());
    await toggle;
    assert.deepEqual(state.writes, [{ scope: state.editors[0].document.uri, key: 'enabled', value: false, target }]);
  });
}
