import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Uri } from 'vscode';
import type { AnalyzeResult } from '../src/analyzer';
import { AuditCache } from '../src/audit';
import { createSettings } from './settings';
import { NpmClient } from '../src/registries/npm';
import type * as candidateAuditCommand from '../src/candidateAuditCommand';

function setup(t: TestContext) {
  const Module = require('node:module') as {
    _load: (id: string, parent: NodeModule | null | undefined, isMain?: boolean) => unknown;
  };
  let command!: () => Promise<void>;
  let text = '{"dependencies":{"example":"1.0.0"}}';
  const settings = createSettings({ auditEnabled: true });
  const result: AnalyzeResult = {
    ecosystem: 'npm',
    declarations: 1,
    audits: [],
    failures: new Map(),
    incomplete: false,
    updates: [
      {
        dep: { name: 'example', spec: '1.0.0', section: 'dependencies', line: 0 },
        current: '1.0.0',
        latest: '2.0.0',
        kind: 'major',
        inRange: false,
      },
    ],
  };
  const messages: string[] = [];
  const outputs: string[] = [];
  let picks = 0;
  let mutateAfterPick = () => {};
  let cancelled = false;
  const vscode = {
    commands: {
      registerCommand: (name: string, work: typeof command) => {
        assert.equal(name, 'freshDeps.auditCandidate');
        command = work;
        return { dispose() {} };
      },
    },
    ProgressLocation: { Notification: 1 },
    window: {
      activeTextEditor: {
        document: {
          uri: { fsPath: '/repo/package.json', toString: () => 'file:///repo/package.json' } as Uri,
          getText: () => text,
        },
      },
      showInformationMessage: async (message: string) => {
        messages.push(message);
      },
      showErrorMessage: async (message: string) => {
        assert.fail(message);
      },
      showQuickPick: async (choices: unknown[]) => {
        picks++;
        mutateAfterPick();
        return choices[0];
      },
      withProgress: async (
        _options: unknown,
        work: (progress: unknown, token: unknown) => Promise<unknown>
      ) =>
        work(
          {},
          {
            isCancellationRequested: cancelled,
            onCancellationRequested: () => ({ dispose() {} }),
          }
        ),
    },
  };
  const mocks: Record<string, unknown> = {
    vscode,
    './config': { readSettings: () => settings },
    './hover': { buildAuditHover: (audit: unknown) => ({ value: JSON.stringify(audit) }) },
    './reportDocument': {
      ReportDocumentProvider: class {
        async open(content: string) {
          outputs.push(content);
        }
        dispose() {}
      },
    },
  };
  const load = Module._load;
  const filename = require.resolve('../src/candidateAuditCommand');
  delete require.cache[filename];
  t.mock.method(
    Module,
    '_load',
    function (
      this: typeof Module,
      id: string,
      parent: NodeModule | null | undefined,
      ...args: [isMain?: boolean]
    ) {
      if (parent?.filename === filename && mocks[id]) return mocks[id];
      return load.call(this, id, parent, ...args);
    }
  );
  const { registerCandidateAuditCommand } = require(filename) as typeof candidateAuditCommand;
  const registration = registerCandidateAuditCommand(() => result, new AuditCache());
  t.after(() => {
    registration.dispose();
    delete require.cache[filename];
  });
  return {
    run: () => command(),
    settings,
    result,
    messages,
    outputs,
    picks: () => picks,
    afterPick: (callback: () => void) => {
      mutateAfterPick = callback;
    },
    edit: () => {
      text += ' ';
    },
    cancel: () => {
      cancelled = true;
    },
  };
}

test('candidate command requires audit opt-in before requesting a selection', async (t) => {
  const state = setup(t);
  state.settings.auditEnabled = false;
  await state.run();
  assert.equal(state.picks(), 0);
  assert.match(state.messages[0], /enable freshDeps.audit.enabled/);
});

test('candidate command audits the selected exact version and opens a labeled read-only result', async (t) => {
  const state = setup(t);
  const fetch = t.mock.method(
    NpmClient.prototype,
    'fetchAudit',
    async (name: string, version: string) => {
      assert.equal(name, 'example');
      assert.equal(version, '2.0.0');
      return { status: 'checked' as const, advisories: [] };
    }
  );
  await Promise.all([state.run(), state.run()]);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(state.picks(), 2);
  assert.equal(state.outputs.length, 1);
  assert.match(state.outputs[0], /"target":"candidate"/);
  assert.match(state.outputs[0], /"version":"2.0.0"/);
});

test('editing while selecting a candidate prevents a stale audit', async (t) => {
  const state = setup(t);
  state.afterPick(state.edit);
  t.mock.method(globalThis, 'fetch', () => assert.fail('Stale candidate was audited'));
  await state.run();
  assert.match(state.messages[0], /declaration or settings changed/);
  assert.equal(state.outputs.length, 0);
});

test('pre-cancelled candidate audits do not request or publish results', async (t) => {
  const state = setup(t);
  state.cancel();
  t.mock.method(globalThis, 'fetch', () => assert.fail('Cancelled audit made a request'));
  await state.run();
  assert.equal(state.outputs.length, 0);
});
