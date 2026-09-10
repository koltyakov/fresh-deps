import test from 'node:test';
import assert from 'node:assert/strict';
import type { CancellationToken, Position, TextDocument } from 'vscode';
import type { AnalyzeResult } from '../src/analyzer';
import type { Settings } from '../src/config';
import type { DetailsResolver } from '../src/details';
import type { DependencyAudit, DependencyUpdate } from '../src/types';
import { NpmClient } from '../src/registries/npm';
import { createSettings } from './settings';

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
const { DependencyHoverProvider, DetailsResolver: Resolver } = require('../src/details') as typeof import('../src/details');
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

test('hover distinguishes same-major updates from allowed range updates', () => {
  const value = buildHover({ ...update, latest: '2.0.0', kind: 'major', sameMajor: '1.150.0', satisfying: '1.120.1' }, 'npm',
    { ...dates, sameMajorPublishedAt: '2026-08-01T12:00:00Z' }).value;
  assert.match(value, /\| Declared \|[^\n]+\n\| Newest within major \| `1\.150\.0` · published [^\n]+2026[^\n]*\n\| Latest \|/);
  assert.match(value, /Newest in range \| `1\.120\.1`/);
  const pinned = buildHover({ ...update, latest: '2.0.0', kind: 'major', sameMajor: '1.150.0' }, 'npm').value;
  assert.match(pinned, /range needs to be widened/);
  assert.match(pinned, /Newest within major \| `1\.150\.0` \|/);
});

test('hover details request the same-major date and cache by all displayed versions', async (t) => {
  const calls: string[][] = [];
  t.mock.method(NpmClient.prototype, 'fetchPublishDates', async (_name: string, versions: string[]) => {
    calls.push(versions);
    return new Map(versions.map((version) => [version, '2026-08-01T12:00:00Z']));
  });
  const resolver = new Resolver();
  const settings = createSettings({ npm: { registry: 'https://registry.example' } });
  const candidate: DependencyUpdate = { ...update, latest: '2.0.0', kind: 'major', sameMajor: '1.150.0' };
  const resolve = (value: DependencyUpdate) => resolver.resolve('/project/package.json', 'npm', value, settings);
  const [first, concurrent] = await Promise.all([resolve(candidate), resolve(candidate)]);
  assert.equal(first.sameMajorPublishedAt, '2026-08-01T12:00:00Z');
  assert.deepEqual(first, concurrent);
  await resolve(candidate);
  assert.deepEqual(calls, [['1.120.0', '2.0.0', '1.150.0']]);
  await resolve({ ...candidate, sameMajor: '1.151.0' });
  assert.deepEqual(calls[1], ['1.120.0', '2.0.0', '1.151.0']);
});

test('new ecosystems link to their package listings', () => {
  for (const [ecosystem, name, section, url] of [
    ['php', 'vendor/pkg', 'require', 'https://packagist.org/packages/vendor/pkg'],
    ['dart', 'http', 'dependencies', 'https://pub.dev/packages/http/versions/1.136.0'],
    ['gradle', 'org.example:org.example.gradle.plugin', 'plugins', 'https://plugins.gradle.org/plugin/org.example/1.136.0'],
    ['ruby', 'rails', 'gems', 'https://rubygems.org/gems/rails/versions/1.136.0'],
    ['terraform', 'hashicorp/aws', 'required_providers', 'https://registry.terraform.io/providers/hashicorp/aws/1.136.0/docs'],
    ['terraform', 'tflint:terraform-linters/tflint-ruleset-azurerm', 'plugins', 'https://github.com/terraform-linters/tflint-ruleset-azurerm/releases'],
    ['elixir', 'phoenix', 'deps', 'https://hex.pm/packages/phoenix/1.136.0'],
    ['deno', 'jsr:@std/assert', 'imports', 'https://jsr.io/@std/assert@1.136.0'],
    ['deno', 'npm:react', 'imports', 'https://www.npmjs.com/package/react/v/1.136.0'],
    ['githubActions', 'actions/checkout', 'jobs.build', 'https://github.com/actions/checkout/tree/1.136.0'],
    ['docker', 'library/node', 'FROM', 'https://hub.docker.com/r/library/node/tags'],
    ['swift', 'apple/example', 'dependencies', 'https://github.com/apple/example/tree/1.136.0'],
    ['conan', 'fmt', 'requires', 'https://conan.io/center/recipes/fmt'],
    ['ansible', 'ansible.posix', 'collections', 'https://galaxy.ansible.com/ui/repo/published/ansible/posix/'],
    ['ansible', 'geerlingguy.docker', 'roles', 'https://galaxy.ansible.com/ui/standalone/roles/geerlingguy/docker/'],
    ['bazel', 'rules_cc', 'bazel_dep', 'https://registry.bazel.build/modules/rules_cc'],
    ['vcpkg', 'fmt', 'dependencies', 'https://vcpkg.io/en/package/fmt'],
    ['scala', 'org.example:core', 'libraryDependencies', 'https://mvnrepository.com/artifact/org.example/core/1.136.0'],
    ['clojure', 'org.clojure:clojure', 'deps', 'https://mvnrepository.com/artifact/org.clojure/clojure/1.136.0'],
    ['terraform', 'module:registry.terraform.io/a/b/c', 'modules', 'https://registry.terraform.io/modules/a/b/c/1.136.0'],
    ['dotnet', 'dotnet-sdk', 'sdk', 'https://dotnet.microsoft.com/download/dotnet'],
  ] as const) {
    assert.ok(buildHover({ ...update, dep: { ...update.dep, name, section } }, ecosystem).value.includes(url));
  }
  assert.ok(buildHover({ ...update, dep: { ...update.dep, name: 'redis', source: 'https://charts.example' } }, 'helm')
    .value.includes('https://charts.example/index.yaml'));
  assert.ok(buildHover({ ...update, dep: { ...update.dep, name: 'numpy', source: 'conda-forge' } }, 'conda')
    .value.includes('https://anaconda.org/conda-forge/numpy'));
});

test('vcpkg and Bazel hovers explain registry availability without claiming resolution', () => {
  assert.match(buildHover(update, 'vcpkg').value, /refreshing builtin-baseline/);
  const bazel = buildHover(update, 'bazel').value;
  assert.match(bazel, /compatibility levels and module resolution are not evaluated/);
  assert.ok(!bazel.includes('range needs to be widened'));
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

test('Deno multiline import aliases retain hovers on the specifier line', async () => {
  let text = '    "jsr:@std/assert@1.0.0",';
  const document = {
    uri: { fsPath: '/project/deno.json' },
    lineAt: () => ({ text, firstNonWhitespaceCharacterIndex: 4, range: { end: { character: text.length } } }),
  } as unknown as TextDocument;
  const provider = new DependencyHoverProvider(
    () => ({ ecosystem: 'deno', updates: [{ ...update, dep: { name: 'jsr:@std/assert', spec: '1.0.0', alias: 'check', line: 0, section: 'imports' } }], audits: [] } as unknown as AnalyzeResult),
    () => ({} as Settings),
    { resolve: async () => ({}) } as unknown as DetailsResolver,
  );
  const position = { line: 0, character: 5 } as Position;
  const token = { isCancellationRequested: false } as CancellationToken;
  assert.ok(await provider.provideHover(document, position, token));
  text = '    "jsr:@std/path@1.0.0",';
  assert.equal(await provider.provideHover(document, position, token), undefined);
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
