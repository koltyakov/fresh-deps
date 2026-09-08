const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

class MarkdownString {
  value = '';
  appendMarkdown(text) { this.value += text; }
  appendText(text) { this.value += text.replace(/[\\`*_{}\[\]()<>!]/g, '\\$&'); }
}
class Range {
  constructor(...args) { this.args = args; }
}
class Hover {
  constructor(contents, range) { this.contents = contents; this.range = range; }
}

const load = Module._load;
Module._load = function (id, ...args) {
  return id === 'vscode' ? { MarkdownString, Range, Hover } : load.call(this, id, ...args);
};
const { DependencyHoverProvider } = require('../out/details');
const { buildAuditHover, buildHover } = require('../out/hover');
Module._load = load;

const update = {
  dep: { name: '@types/vscode', spec: '1.120.0', line: 0, section: 'devDependencies' },
  current: '1.120.0', latest: '1.136.0', kind: 'minor', inRange: false,
};
const dates = {
  currentPublishedAt: '2026-05-13T12:00:00Z',
  latestPublishedAt: '2026-09-02T12:00:00Z',
};

test('project link shows the homepage URL and retains a distinct repository link', () => {
  const homepage = 'https://www.typescriptlang.org/';
  const repository = 'https://github.com/microsoft/TypeScript';
  const hover = buildHover({ ...update, meta: { homepage, repository } }, 'npm');
  assert.ok(hover.value.includes(`| Project | [${homepage}](${homepage}) |`));
  assert.ok(hover.value.includes(`[Repository](${repository})`));
  assert.ok(!hover.value.includes('[Homepage]'));
});

test('project link falls back to the repository from resolved details', () => {
  const repository = 'https://github.com/example/project';
  const hover = buildHover(update, 'npm', { meta: { repository } });
  assert.ok(hover.value.includes(`| Project | [${repository}](${repository}) |`));
  assert.ok(!hover.value.includes('[Repository]'));
  assert.ok(!buildHover(update, 'npm').value.includes('| Project |'));
  assert.ok(!buildHover(update, 'npm', { meta: { homepage: 'javascript:alert(1)' } }).value.includes('| Project |'));
});

test('declaration and inline hint both resolve publication dates', async () => {
  const text = '  "@types/vscode": "1.120.0",';
  const document = {
    uri: { fsPath: '/project/package.json' },
    lineAt: () => ({ text, firstNonWhitespaceCharacterIndex: 2, range: { end: { character: text.length } } }),
  };
  let calls = 0;
  const provider = new DependencyHoverProvider(
    () => ({ ecosystem: 'npm', updates: [update], audits: [] }),
    () => ({}),
    { resolve: async () => { calls++; return dates; } },
  );
  for (const character of [5, text.length]) {
    const hover = await provider.provideHover(document, { line: 0, character }, { isCancellationRequested: false });
    assert.match(hover.contents[0].value, /Declared \| `1\.120\.0` .*published/);
    assert.match(hover.contents[0].value, /Latest \| `1\.136\.0` .*published/);
    assert.match(hover.contents[0].value, /2026/);
  }
  assert.equal(calls, 2);
  assert.equal(await provider.provideHover(document, { line: 0, character: 0 }, {}), undefined);
  assert.equal(calls, 2);
  assert.equal(await provider.provideHover(document, { line: 0, character: 5 }, { isCancellationRequested: true }), undefined);
});

test('ranges date the current baseline without dating the declared range', () => {
  const hover = buildHover({ ...update, dep: { ...update.dep, spec: '^1.120.0' } }, 'npm', dates);
  assert.match(hover.value, /Declared \| `\^1\.120\.0` \|/);
  assert.match(hover.value, /Current \| `1\.120\.0` .*published/);
});

test('unavailable or invalid publication dates leave version rows usable', () => {
  for (const details of [{}, { currentPublishedAt: 'invalid', latestPublishedAt: 'invalid' }]) {
    const hover = buildHover(update, 'npm', details);
    assert.match(hover.value, /Declared \| `1\.120\.0` \|/);
    assert.match(hover.value, /Latest \| `1\.136\.0` \|/);
    assert.doesNotMatch(hover.value, /published|Invalid Date/);
  }
});

test('audit hovers label baselines and reject executable advisory links', () => {
  const hover = buildAuditHover({
    dep: update.dep, version: '1.120.0', baseline: true,
    result: { status: 'checked', advisories: [
      { id: 'GHSA-test', title: '[run](command:evil)', severity: 'high', url: 'command:evil' },
      { id: 'PYSEC-test', title: 'Unsafe input', url: 'https://example.com/advisory', fixedVersions: ['2.0'] },
    ] },
  });
  assert.match(hover.value, /range baseline 1\.120\.0/);
  assert.ok(hover.value.includes('\\[run\\]\\(command:evil\\)'));
  assert.ok(!hover.value.includes('[Advisory](<command:'));
  assert.ok(hover.value.includes('[Advisory](<https://example.com/advisory>)'));
  assert.match(hover.value, /Fixed versions: 2\.0/);
});

test('audit-only declarations show advisories without resolving update details', async () => {
  const text = '  "@types/vscode": "1.120.0",';
  const document = {
    uri: { fsPath: '/project/package.json' },
    lineAt: () => ({ text, firstNonWhitespaceCharacterIndex: 2, range: { end: { character: text.length } } }),
  };
  const audit = { dep: update.dep, version: '1.120.0', baseline: false,
    result: { status: 'checked', advisories: [{ id: 'GHSA-test', title: 'Unsafe input' }] } };
  const provider = new DependencyHoverProvider(
    () => ({ ecosystem: 'npm', updates: [], audits: [audit] }), () => ({}),
    { resolve: () => assert.fail('audit-only hover must not fetch update details') },
  );
  for (const character of [5, text.length]) {
    const hover = await provider.provideHover(document, { line: 0, character }, {});
    assert.match(hover.contents[0].value, /GHSA-test: Unsafe input/);
    assert.match(hover.contents[0].value, /declared version 1\.120\.0/);
  }
});
