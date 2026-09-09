import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestOf } from '../src/analyzer';
import { parseGradleBuild } from '../src/parsers/gradleBuild';
import { parseDeno } from '../src/parsers/deno';
import { parseGithubActions } from '../src/parsers/githubActions';
import { actionVersion, githubActionsScheme } from '../src/githubActions';
import { GithubActionsClient, githubActionVersions } from '../src/registries/githubActions';
import { JsrClient, jsrVersions } from '../src/registries/jsr';
import { computeUpdate } from '../src/versions';
import { schemeFor } from '../src/schemes';
import manifest from '../package.json';

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
  for (const file of ['ci.yml', '.github/ci.yml', '.github/workflows/nested/ci.yml', 'settings.gradle.kts', 'other.json']) {
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
