import test from 'node:test';
import assert from 'node:assert/strict';
import type { DecorationRenderOptions, TextEditor } from 'vscode';
import type { AuditResponse, DependencyUpdate } from '../src/types';

const Module = require('node:module') as {
  _load: (id: string, parent: NodeModule | null | undefined, isMain?: boolean) => unknown;
};
type MockPosition = { line: number; character: number };
type MockDecorationType = { options: DecorationRenderOptions; dispose(): void };
type MockHint = {
  range: { args: [MockPosition, MockPosition] };
  renderOptions: {
    before: { contentText: string; margin: string };
    after: { contentText: string; margin: string };
  };
};

const load = Module._load;
Module._load = function (id, ...args) {
  if (id !== 'vscode') return load.call(this, id, ...args);
  return {
    window: { createTextEditorDecorationType: (options: DecorationRenderOptions): MockDecorationType => ({ options, dispose() {} }) },
    ThemeColor: class { constructor(public id: string) {} },
    Range: class {
      args: [MockPosition, MockPosition];
      constructor(...args: [MockPosition, MockPosition]) { this.args = args; }
    },
    DecorationRangeBehavior: { ClosedClosed: 0 },
  };
};
const { DecorationRenderer } = require('../src/decorations') as typeof import('../src/decorations');
Module._load = load;

test('audit hints merge with updates and remain visible without updates', () => {
  const renderer = new DecorationRenderer();
  const decorations = new Map<MockDecorationType, MockHint[]>();
  const editor = {
    options: { tabSize: 2 },
    document: { uri: { fsPath: '/project/package.json' }, lineCount: 2, lineAt: (line: number) => ({ text: 'package', range: { end: { line, character: 7 } } }) },
    setDecorations: (type: MockDecorationType, values: MockHint[]) => decorations.set(type, values),
  } as unknown as TextEditor;
  const dep = { name: 'pkg', spec: '^1.0.0', line: 0, section: 'dependencies' };
  const other = { ...dep, name: 'other', spec: '1.0.0', line: 1 };
  const updates: DependencyUpdate[] = [{ dep, current: '1.0.0', latest: '2.0.0', kind: 'major', inRange: false }];
  const result: AuditResponse = { status: 'checked', advisories: [{ id: 'GHSA-test', title: 'Unsafe input' }] };
  const audits = [
    { dep, version: '1.0.0', baseline: true, result },
    { dep: other, version: '1.0.0', baseline: false, result },
  ];
  renderer.render(editor, updates, 'npm', audits);
  const hints = [...decorations.values()].flat();
  assert.equal(hints.length, 2);
  assert.match(hints[0].renderOptions.after.contentText, /2\.0\.0 \| ! 1 audit warning at baseline/);
  assert.equal(hints[1].renderOptions.after.contentText, '! 1 audit warning');
  const warningType = [...decorations].find(([, values]) => values.length)![0];
  assert.equal((warningType.options.after!.color as { id: string }).id, 'editorWarning.foreground');
  assert.equal((warningType.options.before!.color as { id: string }).id, 'freshDeps.commentForeground');

  renderer.render(editor, updates, 'java', audits);
  for (const hint of [...decorations.values()].flat()) {
    assert.equal(hint.renderOptions.before.contentText, '<!--');
    assert.ok(hint.renderOptions.after.contentText.endsWith(' -->'));
  }
  renderer.render(editor, [], 'npm', []);
  assert.equal([...decorations.values()].flat().length, 0);
  (editor.document.uri as unknown as { fsPath: string }).fsPath = '/project/pnpm-workspace.yaml';
  renderer.render(editor, updates, 'npm', []);
  assert.equal([...decorations.values()].flat()[0].renderOptions.before.contentText, '#');
  for (const file of ['build.gradle', 'build.gradle.kts']) {
    (editor.document.uri as unknown as { fsPath: string }).fsPath = `/project/${file}`;
    renderer.render(editor, updates, 'gradle', []);
    assert.equal([...decorations.values()].flat()[0].renderOptions.before.contentText, '//');
  }
  renderer.dispose();
});

test('matrix hints draw unchanged entries in gray without shifting the colored updates', () => {
  const renderer = new DecorationRenderer();
  const decorations = new Map<MockDecorationType, MockHint[]>();
  const editor = {
    options: { tabSize: 2 },
    document: { uri: { fsPath: '/project/.github/workflows/ci.yml' }, lineCount: 1,
      lineAt: () => ({ text: 'node: [20.0.0, 22, 24]', range: { end: { line: 0, character: 23 } } }) },
    setDecorations: (type: MockDecorationType, values: MockHint[]) => decorations.set(type, values),
  } as unknown as TextEditor;
  renderer.render(editor, [{
    dep: { name: 'node', spec: '24', matrixVersions: ['20.0.0', '22', '24'], line: 0, section: 'matrix' },
    current: '24', latest: '26', kind: 'major', inRange: false,
    matrixUpdate: { versions: ['20.19.5', '22', '24'], newer: '26' },
  }], 'githubActions', []);
  const colored = [...decorations.values()].flat().filter((hint) => hint.renderOptions.after?.contentText);
  assert.equal(colored.length, 1);
  assert.equal(colored[0].renderOptions.after.contentText, '↑ [20.19.5, \u00a0\u00a0, \u00a0\u00a0] → 26');
  const [grayType, gray] = [...decorations].find(([type]) => !type.options.after)!;
  assert.equal((grayType.options.before!.color as { id: string }).id, 'freshDeps.commentForeground');
  assert.equal(grayType.options.before!.width, '0');
  assert.deepEqual(gray.map((hint) => hint.renderOptions.before), [
    { contentText: '22', margin: '0 -15ch 0 15ch' },
    { contentText: '24', margin: '0 -19ch 0 19ch' },
  ]);
  renderer.clear(editor);
  assert.equal([...decorations.values()].flat().length, 0);
  renderer.dispose();
});

test('gray markers have zero layout width and versions reserve aligned space for them', () => {
  const renderer = new DecorationRenderer();
  const decorations = new Map<MockDecorationType, MockHint[]>();
  const lines = ['\t"pkg": "1",', '\t"longer": "1",'];
  const editor = {
    options: { tabSize: 4 },
    document: {
      uri: { fsPath: '/project/package.json' },
      lineCount: lines.length,
      lineAt: (line: number) => ({ text: lines[line], range: { end: { line, character: lines[line].length } } }),
    },
    setDecorations: (type: MockDecorationType, values: MockHint[]) => decorations.set(type, values),
  } as unknown as TextEditor;
  const updates: DependencyUpdate[] = lines.map((_, line) => ({
    dep: { name: line ? 'longer' : 'pkg', spec: '1', line, section: 'dependencies' },
    current: '1.0.0', latest: '2.0.0', kind: 'major', inRange: false,
  }));
  for (const [ecosystem, token, suffix] of [
    ['npm', '//', ''], ['go', '//', ''], ['python', '#', ''],
    ['rust', '#', ''], ['dotnet', '<!--', ' -->'], ['java', '<!--', ' -->'],
    ['php', '//', ''], ['dart', '#', ''], ['gradle', '#', ''],
    ['deno', '//', ''], ['githubActions', '#', ''],
    ['docker', '#', ''], ['helm', '#', ''], ['swift', '//', ''], ['conan', '#', ''],
    ['scala', '//', ''], ['conda', '#', ''], ['clojure', ';', ''],
    ['ansible', '#', ''], ['bazel', '#', ''], ['vcpkg', '//', ''],
  ] as const) {
    renderer.render(editor, updates, ecosystem, []);
    for (const [type, hints] of decorations) {
      assert.equal(type.options.before!.width, '0');
      assert.equal((type.options.before!.color as { id: string }).id, 'freshDeps.commentForeground');
      for (const hint of hints) {
        const line = hint.range.args[0].line;
        const end = { line, character: lines[line].length };
        assert.deepEqual(hint.range.args, [end, end]);
        const gap = line ? 1 : 4;
        assert.equal(hint.renderOptions.before.contentText, token);
        assert.equal(hint.renderOptions.before.margin, `0 -${gap}ch 0 ${gap}ch`);
        assert.equal(hint.renderOptions.after.contentText, `\u2191 ${ecosystem === 'go' ? 'v' : ''}2.0.0${suffix}`);
        assert.equal(hint.renderOptions.after.margin, `0 0 0 ${gap + token.length + 1}ch`);
      }
    }
    assert.equal([...decorations.values()].flat().length, 2);
  }
  for (const [file, ecosystem, token] of [
    ['.yarnrc.yml', 'npm', '#'], ['.config/dotnet-tools.json', 'dotnet', '//'], ['global.json', 'dotnet', '//'],
  ] as const) {
    (editor.document.uri as unknown as { fsPath: string }).fsPath = `/project/${file}`;
    renderer.render(editor, updates, ecosystem, []);
    const hint = [...decorations.values()].flat()[0];
    assert.equal(hint.renderOptions.before.contentText, token);
    assert.equal(hint.renderOptions.after.contentText.endsWith(' -->'), false);
  }
  renderer.dispose();
});
