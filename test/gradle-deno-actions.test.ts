import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestOf } from '../src/analyzer';
import { parseGradleBuild } from '../src/parsers/gradleBuild';
import { parseDeno } from '../src/parsers/deno';
import { parseGithubActions } from '../src/parsers/githubActions';
import { actionVersion, githubActionsScheme } from '../src/githubActions';
import { GithubActionsClient, githubActionVersions, actionRuntimeVersions } from '../src/registries/githubActions';
import { JsrClient, jsrVersions } from '../src/registries/jsr';
import { computeUpdate } from '../src/versions';
import { schemeFor } from '../src/schemes';
import manifest from '../package.json';

test('runtime matrix updates select the latest within each major and preserve precision', () => {
  const resolve = (matrix: string, releases: string[], runtime = 'node') => {
    const text = `jobs:\n  test:\n    strategy:\n      matrix:\n        version: ${matrix}\n    steps:\n      - uses: actions/setup-${runtime}@main\n        with:\n          ${runtime}-version: \${{ matrix.version }}`;
    const [dep] = parseGithubActions(text);
    return dep && computeUpdate(dep, { all: releases }, { scheme: githubActionsScheme, includePrerelease: false, showSatisfyingUpdates: true });
  };
  assert.equal(resolve('[20, 22, 24]', ['20.19.5', '22.18.0', '24.2.0']), undefined);
  assert.deepEqual(resolve('[20.18, "22.1.0", 24]', ['20.19.5', '22.1.4', '22.2.0', '24.2.0'])?.matrixUpdate,
    { versions: ['20.19', '22.2.0', '24'], newer: undefined });
  assert.deepEqual(resolve('[20.0.0, 22, 24]', ['20.19.5', '22.18.0', '24.2.0', '26.0.0'])?.matrixUpdate,
    { versions: ['20.19.5', '22', '24'], newer: '26' });
  assert.deepEqual(resolve('["3.10.1", "3.12.0"]', ['3.10.9', '3.12.8', '3.13.2'], 'python')?.matrixUpdate,
    { versions: ['3.13.2', '3.13.2'], newer: undefined });
  assert.equal(resolve('[24, 26]', ['24.1.0', '26.0.0', '27.0.0-rc.1']), undefined);
  assert.deepEqual(resolve('["3.10", "3.12"]', ['3.10.9', '3.12.8'], 'python')?.matrixUpdate,
    { versions: ['3.12', '3.12'], newer: undefined });
  assert.deepEqual(resolve('["1.22", "1.23"]', ['1.22.9', '1.23.8', '1.24.1'], 'go')?.matrixUpdate,
    { versions: ['1.24', '1.24'], newer: undefined });
  assert.equal(resolve('[20, "lts/*"]', ['26.0.0']), undefined);
  assert.deepEqual(resolve('\n          - 20\n          - 24', ['26.0.0'])?.matrixUpdate,
    { versions: ['20', '24'], newer: '26' });
});

test('recognizes Gradle, Deno, import maps and scoped GitHub workflow filenames', () => {
  for (const file of ['build.gradle', 'build.gradle.kts']) {
    assert.equal(manifestOf(`/project/${file}`)?.kind, 'gradle-build');
    assert.ok(manifest.activationEvents.includes(`workspaceContains:**/${file}`));
  }
  for (const file of ['deno.json', 'deno.jsonc', 'import_map.json', 'import-map.jsonc']) {
    assert.equal(manifestOf(`/project/${file}`)?.ecosystem, 'deno');
  }
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/release.yaml', 'tools/action.yml', 'action.yaml']) {
    assert.equal(manifestOf(`/project/${file}`)?.ecosystem, 'githubActions');
  }
  assert.equal(manifestOf('/project/settings.gradle.kts')?.kind, 'gradle-build');
  for (const file of ['ci.yml', '.github/ci.yml', '.github/workflows/nested/ci.yml', 'other.json']) {
    assert.equal(manifestOf(`/project/${file}`), undefined);
  }
});

test('Gradle reads Groovy and Kotlin literals, plugin markers, wrappers and multiline calls', () => {
  const deps = parseGradleBuild([
    'plugins {', '  id("org.example.plugin") version "1.2.0" apply false',
    '  kotlin("jvm") version("2.0.0")', "  id 'org.example.groovy' version '1.0'", '}',
    'dependencies {', '  implementation("org.example:core:1.0.0")',
    "  testImplementation 'org.example:test:1.1.0'",
    '  implementation(platform("org.example:bom:2.0.0"))',
    '  api(', '    "org.example:multi:3.0.0"', '  )',
    '  customConfiguration("org.example:custom:1.0.0") { exclude(group = "other") }', '}',
  ].join('\r\n'));
  assert.deepEqual(deps.map((dep) => [dep.name, dep.spec, dep.line]), [
    ['org.example.plugin:org.example.plugin.gradle.plugin', '1.2.0', 1],
    ['org.jetbrains.kotlin.jvm:org.jetbrains.kotlin.jvm.gradle.plugin', '2.0.0', 2],
    ['org.example.groovy:org.example.groovy.gradle.plugin', '1.0', 3],
    ['org.example:core', '1.0.0', 6], ['org.example:test', '1.1.0', 7], ['org.example:bom', '2.0.0', 8],
    ['org.example:multi', '3.0.0', 10], ['org.example:custom', '1.0.0', 12],
  ]);
  assert.equal(deps[0].alias, 'org.example.plugin');
  assert.equal(deps[1].section, 'plugins');
});

test('Gradle skips comments, strings, dynamic versions and computed declarations', () => {
  const text = [
    '// dependencies { implementation("bad:comment:1.0") }',
    'val docs = """', 'dependencies { implementation("bad:string:1.0") }', '"""',
    'dependencies {', '  // implementation("bad:line:1.0")',
    '  /* implementation("bad:block:1.0") */',
    '  implementation("bad:interpolated:$version")',
    '  implementation("bad:concat:1.0" + suffix)',
    '  implementation("bad:dynamic:1.+")', '  implementation(libs.core)',
    '  implementation(project(":local"))', '  implementation("bad:classifier:1.0:tests")',
    '  implementation(group = "bad", name = "map", version = version)',
    '}', 'implementation("bad:outside:1.0")',
    '/* dependencies { implementation("bad:unfinished:1.0") }',
  ].join('\n');
  assert.deepEqual(parseGradleBuild(text), []);
});

test('Deno reads scoped npm and JSR imports with ranges and subpaths', () => {
  const deps = parseDeno([
    '{', '  // imports', '  "imports": {', '    "assert": "jsr:@std/assert@^1.0.0",',
    '    "jsx": "npm:react@^18.0.0/jsx-runtime",', '    "types": "npm:@types/node@~20.0.0",',
    '    "url": "https://example.com/mod.ts",', '    "local": "./local.ts",',
    '    "unversioned": "jsr:@std/path",', '    "tag": "npm:react@next"', '  },',
    '  "scopes": { "https://example.com/": { "react": "npm:react@^17.0.0" } },',
    '  "tasks": { "fake": "npm:fake@1.0.0" }', '}',
  ].join('\n'));
  assert.deepEqual(deps.map((dep) => [dep.name, dep.spec, dep.alias, dep.line]), [
    ['jsr:@std/assert', '^1.0.0', 'assert', 3], ['npm:react', '^18.0.0', 'jsx', 4],
    ['npm:@types/node', '~20.0.0', 'types', 5], ['npm:react', '^17.0.0', 'react', 11],
  ]);
  assert.deepEqual(parseDeno('{"imports":{"bad":"jsr:unscoped@1.0.0","wild":"npm:pkg@*"}}'), []);
  assert.deepEqual(parseDeno('{"imports":{"bad":"npm:pkg@1.0.0"}'), []);
  assert.deepEqual(parseDeno('{"scopes":[{"bad":"npm:pkg@1.0.0"}]}'), []);
  assert.deepEqual(parseDeno('{"imports":{"bad":"jsr:@scope/..@1.0.0"}}'), []);
  assert.equal(parseDeno('{"imports":{"escaped":"npm:re\\u0061ct@1.0.0",},}')[0]?.name, 'npm:react');
});

test('JSR excludes yanked versions and supports prerelease and in-range updates', async (t) => {
  const doc = { latest: '3.0.0', versions: { '1.0.0': {}, '1.9.0': {}, '2.0.0': {}, '3.0.0': { yanked: true }, '4.0.0-beta.1': {} } };
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, 'https://jsr.io/@std/assert/meta.json');
    return Response.json(doc);
  });
  const versions = await new JsrClient(1000).fetchVersions('@std/assert');
  assert.equal(versions.latest, '2.0.0');
  assert.ok(!versions.all?.includes('3.0.0'));
  const dep = parseDeno('{"imports":{"assert":"jsr:@std/assert@^1.0.0"}}')[0];
  const opts = { scheme: schemeFor('deno'), includePrerelease: false, showSatisfyingUpdates: true };
  assert.equal(computeUpdate(dep, versions, opts)?.satisfying, '1.9.0');
  assert.equal(computeUpdate(dep, versions, { ...opts, includePrerelease: true })?.latest, '4.0.0-beta.1');
  assert.equal(jsrVersions({}).error, 'no comparable versions found');
});

test('Actions reads step and reusable workflow references without reading script content', () => {
  const deps = parseGithubActions([
    'jobs:', '  build:', '    steps:', '      - uses: actions/checkout@v4',
    '      - uses: owner/repo/path@v1.2.3', '      - uses: ./local',
    '      - uses: docker://alpine:3', '      - uses: owner/branch@main',
    '      - uses: owner/pinned@0123456789abcdef0123456789abcdef01234567',
    '      - run: |', '          uses: fake/script@v1',
    '  reuse:', '    uses: owner/workflows/.github/workflows/build.yml@v2',
  ].join('\n'));
  assert.deepEqual(deps.map((dep) => [dep.name, dep.spec, dep.line]), [
    ['actions/checkout', 'v4', 3], ['owner/repo', 'v1.2.3', 4], ['owner/workflows', 'v2', 12],
  ]);
  assert.equal(deps[1].alias, 'owner/repo/path');
  assert.equal(parseGithubActions('runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@v4').length, 1);
  assert.deepEqual(parseGithubActions('jobs: [broken'), []);
  assert.deepEqual(parseGithubActions('uses: &action actions/checkout@v4\njobs:\n  build:\n    steps:\n      - uses: *action'), []);
});

test('Actions preserves tag precision and prefix without suggesting updates within a moving tag', () => {
  const tags = ['v4', 'v4.0.0', 'v4.9.9', 'v5', 'v5.0.0', 'v6.0.0-beta.1', '99', 'main'];
  const dep = { name: 'actions/checkout', spec: 'v4', line: 0, section: 'steps' };
  const opts = { scheme: githubActionsScheme, includePrerelease: false, showSatisfyingUpdates: true };
  assert.equal(computeUpdate(dep, githubActionVersions(tags, dep.spec), opts)?.latest, 'v5');
  assert.equal(computeUpdate(dep, githubActionVersions(['v4', 'v4.9.9'], dep.spec), opts), undefined);
  const exact = { ...dep, spec: 'v4.0.0' };
  assert.equal(computeUpdate(exact, githubActionVersions(tags, exact.spec), opts)?.latest, 'v5.0.0');
  assert.equal(computeUpdate(exact, githubActionVersions(tags, exact.spec), { ...opts, includePrerelease: true })?.latest, 'v6.0.0-beta.1');
  for (const tag of ['main', 'v01', 'v1-beta', '1234567890123456789012345678901234567890']) assert.equal(actionVersion(tag), undefined);
  assert.equal(schemeFor('githubActions'), githubActionsScheme);
});

test('Actions reads setup inputs, retaining numeric spelling and the input line', () => {
  const deps = parseGithubActions([
    'jobs:', '  build:', '    steps:',
    '      - uses: actions/setup-node@v4', '        with:', '          node-version: 20 # runtime',
    '          cache: npm',
    '      - uses: actions/setup-python@main', '        with:', '          python-version: 3.10',
    '      - uses: actions/setup-go@0123456789abcdef0123456789abcdef01234567',
    '        with:', '          go-version: "1.22.0"',
  ].join('\r\n'));
  assert.deepEqual(deps.map((dep) => [dep.name, dep.spec, dep.line, dep.actionRuntime]), [
    ['actions/setup-node', 'v4', 3, undefined], ['node', '20', 5, 'node'],
    ['python', '3.10', 9, 'python'], ['go', '1.22.0', 12, 'go'],
  ]);
  assert.equal(deps[1].section, 'jobs.build.with.node-version');
  const composite = parseGithubActions('runs:\n  using: composite\n  steps:\n    - uses: actions/setup-node@main\n      with:\n        node-version: "20"');
  assert.equal(composite[0]?.actionRuntime, 'node');
});

test('Actions skips dynamic inputs, unrelated actions and reusable workflow inputs', () => {
  for (const value of ['${{ matrix.node }}', 'lts/*', 'latest', '20.x', '>=20', '[20, 22]', 'true', '|\n            20\n            22']) {
    assert.deepEqual(parseGithubActions(`jobs:\n  build:\n    steps:\n      - uses: actions/setup-node@main\n        with:\n          node-version: ${value}`), []);
  }
  for (const action of ['owner/setup-node@main', './actions/setup-node', 'actions/setup-node/subpath@main']) {
    assert.deepEqual(parseGithubActions(`jobs:\n  build:\n    steps:\n      - uses: ${action}\n        with:\n          node-version: 20`), []);
  }
  assert.deepEqual(parseGithubActions('jobs:\n  reuse:\n    uses: actions/setup-node@main\n    with:\n      node-version: 20'), []);
});

test('Runtime suggestions preserve precision and exclude unreleased moving selectors', () => {
  const versions = ['20.0.0', '20.19.0', '22.1.0', '24.0.0-beta.1'];
  assert.equal(actionRuntimeVersions(versions, '20').latest, '22');
  assert.equal(actionRuntimeVersions(versions, 'v20.0').latest, 'v22.1');
  assert.equal(actionRuntimeVersions(versions, '20.0.0').latest, '22.1.0');
  assert.deepEqual(actionRuntimeVersions(versions, '20').all, ['20', '22']);
  const opts = { scheme: githubActionsScheme, includePrerelease: false, showSatisfyingUpdates: true };
  const dep = { name: 'node', spec: '20', line: 0, section: 'with' };
  assert.equal(computeUpdate(dep, actionRuntimeVersions(['20.19.0'], dep.spec), opts), undefined);
  assert.equal(computeUpdate(dep, actionRuntimeVersions(versions, dep.spec), opts)?.kind, 'major');
  const exact = { ...dep, spec: '20.0.0' };
  assert.equal(computeUpdate(exact, actionRuntimeVersions(versions, exact.spec), { ...opts, includePrerelease: true })?.latest, '24.0.0-beta.1');
});

test('scalar runtime hints show the latest within major before the latest upgrade', () => {
  const opts = { scheme: githubActionsScheme, includePrerelease: false, showSatisfyingUpdates: true };
  const releases = ['22.0.0', '22.18.0', '22.19.1', '22.20.0-rc.1', '26.8.1'];
  for (const [spec, satisfying, latest] of [
    ['22.0.0', '22.19.1', '26.8.1'], ['22.0', '22.19', '26.8'], ['22', undefined, '26'],
    ['v22.0.0', 'v22.19.1', 'v26.8.1'], ['22.19.1', undefined, '26.8.1'],
  ]) {
    const dep = { name: 'node', spec: spec!, actionRuntime: 'node' as const, line: 0, section: 'with' };
    const versions = actionRuntimeVersions(releases, dep.spec);
    const update = computeUpdate(dep, versions, opts);
    assert.equal(update?.satisfying, satisfying);
    assert.equal(update?.latest, latest);
    assert.equal(computeUpdate(dep, versions, { ...opts, showSatisfyingUpdates: false })?.satisfying, undefined);
    assert.equal(computeUpdate({ ...dep, actionRuntime: undefined }, versions, opts)?.satisfying, undefined);
  }
  const dep = { name: 'node', spec: '22.0.0', actionRuntime: 'node' as const, line: 0, section: 'with' };
  const update = computeUpdate(dep, actionRuntimeVersions(['22.19.1'], dep.spec), opts);
  assert.equal(update?.latest, '22.19.1');
  assert.equal(update?.satisfying, undefined);
});

test('Runtime manifests share requests across precisions and report malformed responses', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    return Response.json([{ version: '22.1.0' }]);
  });
  const client = new GithubActionsClient(1000);
  const [major, exact] = await Promise.all([client.fetchRuntimeVersions('node', '20'), client.fetchRuntimeVersions('node', '20.0.0')]);
  assert.equal(major.latest, '22');
  assert.equal(exact.latest, '22.1.0');
  assert.deepEqual(calls, ['https://raw.githubusercontent.com/actions/node-versions/main/versions-manifest.json']);
  t.mock.method(globalThis, 'fetch', async () => Response.json([null]));
  await assert.rejects(new GithubActionsClient(1000).fetchRuntimeVersions('python', '3.10'), /invalid GitHub runtime manifest/);
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
  assert.equal((await new GithubActionsClient(1000).fetchRuntimeVersions('go', '1.22')).error, 'not found');
});

test('GitHub paginates tags and shares a repository lookup across tag styles', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    return Response.json(url.endsWith('page=1') ? Array.from({ length: 100 }, (_, i) => ({ name: `branch-${i}` }))
      : [{ name: 'v5' }, { name: 'v5.0.0' }]);
  });
  const client = new GithubActionsClient(1000);
  const [major, exact] = await Promise.all([client.fetchVersions('Actions/Checkout', 'v4'), client.fetchVersions('actions/checkout', 'v4.0.0')]);
  assert.equal(major.latest, 'v5');
  assert.equal(exact.latest, 'v5.0.0');
  assert.deepEqual(calls, [1, 2].map((page) => `https://api.github.com/repos/actions/checkout/tags?per_page=100&page=${page}`));
});

test('GitHub reports rate limits, missing repositories and incomplete pagination', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }));
  await assert.rejects(new GithubActionsClient(1000).fetchVersions('owner/repo', 'v1'), /403/);
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
  assert.equal((await new GithubActionsClient(1000).fetchVersions('owner/repo', 'v1')).error, 'not found');
  t.mock.method(globalThis, 'fetch', async () => Response.json(Array.from({ length: 100 }, () => ({ name: 'v1' }))));
  await assert.rejects(new GithubActionsClient(1000).fetchVersions('owner/repo', 'v1'), /pagination limit/);
});
