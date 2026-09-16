import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSettings } from './settings';
import { NpmClient } from '../src/registries/npm';

const Module = require('node:module') as { _load: (id: string, parent: NodeModule | null | undefined, isMain?: boolean) => unknown };
const uri = (fsPath: string) => ({ scheme: 'file', fsPath, path: fsPath, toString: () => pathToFileURL(fsPath).toString() });
type Uri = ReturnType<typeof uri>;
const folders: { name: string; uri: Uri }[] = [];
let command: () => Promise<void>;
let cancelled = false;
let opened = '';
let unsavedPath = '';
const scans: string[] = [];
const previews: string[] = [];
const previewUris: Uri[] = [];
let provider: { provideTextDocumentContent(uri: Uri): string };
let closeDocument: (document: { uri: Uri }) => void;
let disposed = 0;
const settings = createSettings({ enabled: false, auditEnabled: true, showSatisfyingUpdates: false });
const content = JSON.stringify({ dependencies: { example: '^1.0.0' }, devDependencies: { current: '1.0.0' } }, null, 2);
const vscode = {
  commands: {
    registerCommand: (name: string, callback: () => Promise<void>) => {
      assert.equal(name, 'freshDeps.report'); command = callback; return { dispose() {} };
    },
    executeCommand: async (name: string, value: Uri) => { previews.push(name); previewUris.push(value); },
  },
  Uri: {
    joinPath: (base: Uri, name: string) => uri(join(base.fsPath, name)),
    from: ({ scheme, path }: { scheme: string; path: string }) => ({ scheme, path, fsPath: path, toString: () => `${scheme}:${path}` }),
  },
  languages: { setTextDocumentLanguage: async (_document: unknown, language: string) => { assert.equal(language, 'markdown'); } },
  FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
  ProgressLocation: { Notification: 15 },
  workspace: {
    registerTextDocumentContentProvider: (scheme: string, value: typeof provider) => {
      assert.equal(scheme, 'fresh-deps-report'); provider = value;
      return { dispose: () => { disposed++; } };
    },
    onDidCloseTextDocument: (callback: typeof closeDocument) => {
      closeDocument = callback;
      return { dispose: () => { disposed++; } };
    },
    workspaceFolders: folders,
    fs: { readDirectory: async (directory: Uri) => {
      scans.push(directory.fsPath);
      return (await readdir(directory.fsPath, { withFileTypes: true })).map((entry) =>
        [entry.name, entry.isSymbolicLink() ? 64 : entry.isDirectory() ? 2 : 1]);
    } },
    asRelativePath: (value: Uri, includeWorkspaceFolder: boolean) => {
      assert.equal(includeWorkspaceFolder, false);
      const folder = folders.filter((entry) => value.fsPath === entry.uri.fsPath || value.fsPath.startsWith(entry.uri.fsPath + sep))
        .sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)[0];
      return folder ? relative(folder.uri.fsPath, value.fsPath).split(sep).join('/') : value.fsPath;
    },
    openTextDocument: async (value: Uri | { content: string }) => {
      if ('content' in value) assert.fail('Reports must not open an untitled document');
      if (value.scheme === 'fresh-deps-report') {
        opened = provider.provideTextDocumentContent(value);
        return { uri: value, getText: () => opened };
      }
      const text = value.fsPath === unsavedPath ? content : await readFile(value.fsPath, 'utf8');
      return { getText: () => text };
    },
  },
  window: {
    withProgress: async (_options: unknown, work: (progress: unknown, token: unknown) => Promise<unknown>) =>
      work({ report() {} }, { get isCancellationRequested() { return cancelled; } }),
    showTextDocument: async () => { assert.fail('Open only the Markdown preview, not a source editor'); },
    showErrorMessage: async (message: string) => { assert.fail(message); },
  },
};
const load = Module._load;
Module._load = function (id, ...args) {
  if (id === 'vscode') return vscode;
  if (id === './config') return { readSettings: () => settings };
  return load.call(this, id, ...args);
};
const { registerReportCommand } = require('../src/reportCommand') as typeof import('../src/reportCommand');
Module._load = load;

test('recursively scans real nested manifests and renders actual analysis, including current and audited dependencies', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'fresh-deps-report-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['one', 'one/apps/web', 'one/.hidden', 'two', 'one/node_modules/pkg', 'one/apps/web/node_modules/pkg', 'one/.venv/lib', 'one/dist', 'one/.yarn/cache/pkg']) {
    await mkdir(join(root, name), { recursive: true });
    await writeFile(join(root, name, 'package.json'), content);
  }
  await symlink(join(root, 'one'), join(root, 'one', 'cycle'));
  unsavedPath = join(root, 'one/package.json');
  await writeFile(unsavedPath, '{}');
  folders.push(...['one', 'one/apps', 'two'].map((name) => ({ name, uri: uri(join(root, name)) })));
  const fetched: string[] = [];
  t.mock.method(NpmClient.prototype, 'fetchLatest', async (name: string) => {
    fetched.push(name);
    return { latest: name === 'example' ? '2.0.0' : '1.0.0', all: ['1.0.0', '1.5.2', '2.0.0'], allComplete: true };
  });
  t.mock.method(NpmClient.prototype, 'fetchAll', async () => ({ latest: '2.0.0', all: ['1.0.0', '1.5.2', '2.0.0'], allComplete: true }));
  t.mock.method(NpmClient.prototype, 'fetchAudit', async (name: string) => ({ status: 'checked', advisories:
    name === 'current' ? [{ id: 'TEST-1', title: 'Test advisory', severity: 'high' }] : [] }));
  const registration = registerReportCommand();
  t.after(() => { registration.dispose(); assert.equal(disposed, 2); });
  const first = command();
  assert.equal(command(), first);
  await first;
  assert.match(opened, /Manifests analyzed \| 4/);
  assert.match(opened, /Declarations found \| 8/);
  assert.match(opened, /\| Type \| Name \| Version \| Minor\/patch \| Major \| Audit warning \|/);
  for (const name of ['one/package.json', 'one/apps/web/package.json', 'one/.hidden/package.json', 'two/package.json']) {
    assert.ok(opened.includes(join(root, name)), name);
  }
  assert.ok(opened.includes('### [package.json]('));
  assert.ok(opened.includes('### [web/package.json]('));
  assert.ok(opened.includes('"web/package.json:3"'));
  assert.ok(!opened.includes(`### [${root}`));
  assert.match(opened, /\| \^1.0.0 \| 1.5.2 \| 2.0.0 \| - \|/);
  assert.match(opened, /\| devDependencies \| \[current\].*\| 1.0.0 \| - \| - \| high: TEST-1 Test advisory \|/);
  assert.equal(new Set(scans).size, scans.length, 'overlapping workspace folders are visited once');
  assert.ok(scans.every((path) => !/node_modules|\.venv|\/dist|\.yarn\/cache|\/cycle/.test(path)));
  assert.deepEqual(fetched.sort(), ['current', 'example'], 'registry results are shared across files');
  assert.deepEqual(previews, ['markdown.showPreview']);
  assert.equal(previewUris[0].scheme, 'fresh-deps-report');
  assert.ok(previewUris[0].path.endsWith('/Outdated Dependencies Report.md'));
  assert.equal(provider.provideTextDocumentContent(previewUris[0]), opened);
  closeDocument({ uri: previewUris[0] });
  assert.equal(provider.provideTextDocumentContent(previewUris[0]), '');
  const scanCount = scans.length;
  cancelled = true;
  await command();
  assert.equal(scans.length, scanCount);
  assert.equal(previews.length, 1);
});
