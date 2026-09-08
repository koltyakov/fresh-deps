const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function setup(t) {
  const events = {};
  const calls = [];
  const pending = [];
  const settings = { enabled: true, cacheDurationMinutes: 60 };
  const editor = (name) => ({ document: {
    uri: { fsPath: `/${name}/package.json`, toString: () => `file:///${name}/package.json` },
    getText: () => '{}',
  } });
  const editors = [editor('a'), editor('b')];
  const noop = () => {};
  const vscode = {
    window: {
      activeTextEditor: editors[0], visibleTextEditors: editors,
      createOutputChannel: () => ({ appendLine: noop }),
      createStatusBarItem: () => ({ hide: noop, show: () => calls.push('status') }),
      onDidChangeActiveTextEditor: (cb) => { events.active = cb; },
    },
    workspace: {
      onDidCloseTextDocument: (cb) => { events.close = cb; },
      onDidSaveTextDocument: noop, onDidChangeTextDocument: noop,
      onDidChangeConfiguration: (cb) => { events.config = cb; },
    },
    commands: { executeCommand: noop, registerCommand: noop },
    languages: { registerHoverProvider: noop },
    StatusBarAlignment: { Right: 1 }, MarkdownString: class {},
  };
  const mocks = {
    vscode,
    './config': { readSettings: () => settings },
    './analyzer': {
      ecosystemOf: () => 'npm',
      analyze: (request) => new Promise((resolve, reject) => pending.push({ request, resolve, reject })),
    },
    './decorations': { DecorationRenderer: class {
      clear(editor) { calls.push(`clear:${editor.document.uri.fsPath}`); }
      render(editor) { calls.push(`render:${editor.document.uri.fsPath}`); }
    } },
    './details': { DetailsResolver: class {}, DependencyHoverProvider: class {} },
  };
  const load = Module._load;
  t.mock.method(Module, '_load', function (id, parent, ...args) {
    if (parent?.filename === require.resolve('../out/extension') && mocks[id]) return mocks[id];
    return load.call(this, id, parent, ...args);
  });
  const filename = require.resolve('../out/extension');
  delete require.cache[filename];
  t.after(() => { delete require.cache[filename]; });
  require(filename).activate({ subscriptions: [], globalState: { get: noop, update: noop } });
  const configure = () => events.config({ affectsConfiguration: () => true });
  return { calls, pending, settings, editors, events, configure };
}

const result = () => ({ ecosystem: 'npm', updates: [{}], failures: new Map(), incomplete: false });
const flush = () => new Promise((resolve) => setImmediate(resolve));

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
  state.pending[0].resolve(result());
  await flush();
  assert.ok(!state.calls.some((call) => call.startsWith('render:')));
});
