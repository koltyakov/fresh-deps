const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const load = Module._load;
Module._load = function (id, ...args) {
  if (id !== 'vscode') return load.call(this, id, ...args);
  return {
    window: { createTextEditorDecorationType: options => ({ options, dispose() {} }) },
    ThemeColor: class { constructor(id) { this.id = id; } },
    Range: class { constructor(...args) { this.args = args; } },
    DecorationRangeBehavior: { ClosedClosed: 0 },
  };
};
const { DecorationRenderer } = require('../out/decorations');
Module._load = load;

test('audit hints merge with updates and remain visible without updates', () => {
  const renderer = new DecorationRenderer();
  const decorations = new Map();
  const editor = {
    options: { tabSize: 2 },
    document: { lineCount: 2, lineAt: line => ({ text: 'package', range: { end: { line, character: 7 } } }) },
    setDecorations: (type, values) => decorations.set(type, values),
  };
  const dep = { name: 'pkg', spec: '^1.0.0', line: 0, section: 'dependencies' };
  const other = { ...dep, name: 'other', spec: '1.0.0', line: 1 };
  const updates = [{ dep, current: '1.0.0', latest: '2.0.0', kind: 'major', inRange: false }];
  const result = { status: 'checked', advisories: [{ id: 'GHSA-test', title: 'Unsafe input' }] };
  const audits = [
    { dep, version: '1.0.0', baseline: true, result },
    { dep: other, version: '1.0.0', baseline: false, result },
  ];
  renderer.render(editor, updates, 'npm', audits);
  const hints = [...decorations.values()].flat();
  assert.equal(hints.length, 2);
  assert.match(hints[0].renderOptions.after.contentText, /2\.0\.0 \| ! 1 audit warning at baseline/);
  assert.equal(hints[1].renderOptions.after.contentText, '! 1 audit warning');
  const warningType = [...decorations].find(([, values]) => values.length)[0];
  assert.equal(warningType.options.after.color.id, 'editorWarning.foreground');

  renderer.render(editor, updates, 'java', audits);
  for (const hint of [...decorations.values()].flat()) {
    assert.equal(hint.renderOptions.before.contentText, '<!--');
    assert.ok(hint.renderOptions.after.contentText.endsWith(' -->'));
  }
  renderer.render(editor, [], 'npm', []);
  assert.equal([...decorations.values()].flat().length, 0);
  renderer.dispose();
});
