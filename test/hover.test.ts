import test from 'node:test';
import assert from 'node:assert/strict';
import type { CancellationToken, Position, TextDocument } from 'vscode';
import type { AnalyzeResult } from '../src/analyzer';
import type { Settings } from '../src/config';
import type { DetailsResolver } from '../src/details';
import type { DependencyAudit, DependencyUpdate } from '../src/types';

const Module = require('node:module') as {
  _load: (id: string, parent: NodeModule | null | undefined, isMain?: boolean) => unknown;
};

class MarkdownString {
  value = '';
  appendMarkdown(text: string) { this.value += text; }
  appendText(text: string) { this.value += text.replace(/[\\`*_{}\[\]()<>!]/g, '\\$&'); }
}
class Range {
  args: number[];
  constructor(...args: number[]) { this.args = args; }
}
class Hover {
  constructor(public contents: MarkdownString[], public range: Range) {}
}

const load = Module._load;
Module._load = function (id, ...args) {
  return id === 'vscode' ? { MarkdownString, Range, Hover } : load.call(this, id, ...args);
};
const { DependencyHoverProvider } = require('../src/details') as typeof import('../src/details');
const { buildAuditHover, buildHover } = require('../src/hover') as typeof import('../src/hover');
Module._load = load;

const update: DependencyUpdate = {
  dep: { name: '@types/vscode', spec: '1.120.0', line: 0, section: 'devDependencies' },
  current: '1.120.0', latest: '1.136.0', kind: 'minor', inRange: false,
};
const dates = {
  currentPublishedAt: '2026-05-13T12:00:00Z',
  latestPublishedAt: '2026-09-02T12:00:00Z',
};

test('new ecosystems link to their package listings', () => {
  for (const [ecosystem, name, section, url] of [
    ['php', 'vendor/pkg', 'require', 'https://packagist.org/packages/vendor/pkg'],
    ['dart', 'http', 'dependencies', 'https://pub.dev/packages/http/versions/1.136.0'],
    ['gradle', 'org.example:org.example.gradle.plugin', 'plugins', 'https://plugins.gradle.org/plugin/org.example/1.136.0'],
  ] as const) {
    assert.ok(buildHover({ ...update, dep: { ...update.dep, name, section } }, ecosystem).value.includes(url));
  }
});

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
  } as unknown as TextDocument;
  let calls = 0;
  const provider = new DependencyHoverProvider(
    () => ({ ecosystem: 'npm', updates: [update], audits: [] } as unknown as AnalyzeResult),
    () => ({} as Settings),
    { resolve: async () => { calls++; return dates; } } as unknown as DetailsResolver,
  );
  for (const character of [5, text.length]) {
    const hover = await provider.provideHover(document, { line: 0, character } as Position, { isCancellationRequested: false } as CancellationToken) as unknown as Hover;
    assert.match(hover.contents[0].value, /Declared \| `1\.120\.0` .*published/);
    assert.match(hover.contents[0].value, /Latest \| `1\.136\.0` .*published/);
    assert.match(hover.contents[0].value, /2026/);
  }
  assert.equal(calls, 2);
  assert.equal(await provider.provideHover(document, { line: 0, character: 0 } as Position, {} as CancellationToken), undefined);
  assert.equal(calls, 2);
  assert.equal(await provider.provideHover(document, { line: 0, character: 5 } as Position, { isCancellationRequested: true } as CancellationToken), undefined);
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
  } as unknown as TextDocument;
  const audit: DependencyAudit = { dep: update.dep, version: '1.120.0', baseline: false,
    result: { status: 'checked', advisories: [{ id: 'GHSA-test', title: 'Unsafe input' }] } };
  const provider = new DependencyHoverProvider(
    () => ({ ecosystem: 'npm', updates: [], audits: [audit] } as unknown as AnalyzeResult), () => ({} as Settings),
    { resolve: () => assert.fail('audit-only hover must not fetch update details') } as unknown as DetailsResolver,
  );
  for (const character of [5, text.length]) {
    const hover = await provider.provideHover(document, { line: 0, character } as Position, {} as CancellationToken) as unknown as Hover;
    assert.match(hover.contents[0].value, /GHSA-test: Unsafe input/);
    assert.match(hover.contents[0].value, /declared version 1\.120\.0/);
  }
});
