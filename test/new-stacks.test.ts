import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestOf } from '../src/analyzer';
import { composerVersion } from '../src/composer';
import { composerScheme, dartScheme } from '../src/schemes';
import { parseComposerJson } from '../src/parsers/composerJson';
import { parsePubspec } from '../src/parsers/pubspec';
import { parsePnpmWorkspace } from '../src/parsers/pnpmWorkspace';
import { parseGradleCatalog } from '../src/parsers/gradleCatalog';
import { packagistVersions } from '../src/registries/packagist';
import { pubVersions } from '../src/registries/pub';
import { computeUpdate } from '../src/versions';
import manifest from '../package.json';

const stable = { includePrerelease: false };
const all = { includePrerelease: true };

test('new manifests are recognized and activate the extension', () => {
  for (const [file, ecosystem, activation] of [
    ['composer.json', 'php', 'composer.json'], ['pubspec.yaml', 'dart', 'pubspec.yaml'],
    ['pnpm-workspace.yaml', 'npm', 'pnpm-workspace.yaml'], ['gradle/libs.versions.toml', 'gradle', '*.versions.toml'],
    ['gradle/tools.versions.toml', 'gradle', '*.versions.toml'],
  ]) {
    assert.equal(manifestOf(`/project/${file}`)?.ecosystem, ecosystem);
    assert.ok(manifest.activationEvents.includes(`workspaceContains:**/${activation}`));
  }
  assert.equal(manifestOf('/project/build.gradle.kts')?.kind, 'gradle-build');
  assert.equal(manifestOf('/project/unrelated.toml'), undefined);
});

test('Composer handles exact partial versions, tilde, caret, wildcards and OR constraints', () => {
  assert.equal(composerScheme.baseline('1.2'), '1.2.0');
  assert.equal(composerScheme.isPinned('1.2'), true);
  assert.equal(composerScheme.satisfies('1.2.1', '1.2', stable), false);
  assert.equal(composerScheme.satisfies('1.9.0', '~1.2', stable), true);
  assert.equal(composerScheme.satisfies('2.0.0', '~1.2', stable), false);
  assert.equal(composerScheme.satisfies('1.3.0', '~1.2.3', stable), false);
  assert.equal(composerScheme.satisfies('0.3.0', '^0.2.3', stable), false);
  assert.equal(composerScheme.satisfies('0.0.9', '^0.0', stable), true);
  assert.equal(composerScheme.satisfies('0.9.0', '^0', stable), true);
  assert.equal(composerScheme.satisfies('1.9.0', '~1.2-beta1', stable), true);
  assert.equal(composerScheme.satisfies('2.4.0', '^1.2 | ^2.0', stable), true);
  assert.equal(composerScheme.satisfies('1.5.0', '>=1.2, <2.0', stable), true);
  assert.equal(composerScheme.satisfies('1.2.9', '1.2.*', stable), true);
  assert.equal(composerScheme.satisfies('2.0.9', '1.0 - 2.0', stable), true);
  assert.equal(composerScheme.satisfies('1.1.0', '>=1.0 !=1.1', stable), false);
  assert.equal(composerScheme.satisfies('1.2.0', '>=1.0 !=1.1', stable), true);
  for (const spec of ['dev-main', '^1.0@beta', '1.0 as 2.0', '*']) {
    assert.equal(composerScheme.baseline(spec), undefined, spec);
  }
  assert.equal(composerVersion('v1.2.3'), '1.2.3');
  assert.equal(composerVersion('2.0.0-RC1'), '2.0.0-rc.1');
  assert.equal(composerVersion('1.0.0.0'), '1.0.0');
  assert.equal(composerVersion('1.0.0.1'), undefined);
  assert.equal(composerVersion('1.0.0-p1'), undefined);
});

test('Composer reads requirements with line anchors and skips platforms and custom repositories', () => {
  const text = [
    '{', '  "require": {', '    "php": "^8.2",', '    "ext-json": "*",',
    '    "laravel/framework": "^11.0",', '    "vendor/branch": "dev-main"', '  },',
    '  "require-dev": { "phpunit/phpunit": "~10.5.0" },',
    '  "suggest": { "vendor/suggestion": "^1.0" }', '}',
  ].join('\r\n');
  assert.deepEqual(parseComposerJson(text), [
    { name: 'laravel/framework', spec: '^11.0', line: 4, section: 'require' },
    { name: 'phpunit/phpunit', spec: '~10.5.0', line: 7, section: 'require-dev' },
  ]);
  assert.match(parseComposerJson('{"repositories":[{"type":"path","url":"../pkg"}],"require":{"vendor/pkg":"^1.0"}}')[0].skipReason!, /repository/);
  assert.deepEqual(parseComposerJson('{"require":'), []);
  const update = computeUpdate(parseComposerJson(text)[0], { latest: '12.0.0', all: ['11.0.0', '11.9.0', '12.0.0'] },
    { ...stable, showSatisfyingUpdates: true, scheme: composerScheme });
  assert.equal(update?.satisfying, '11.9.0');
  assert.equal(update?.inRange, false);
});

test('Dart uses pub caret bounds and build suffix ordering', () => {
  assert.equal(dartScheme.satisfies('0.0.9', '^0.0.3', stable), true);
  assert.equal(dartScheme.satisfies('0.1.0', '^0.0.3', stable), false);
  assert.equal(dartScheme.satisfies('1.9.0', '^1.2.0', stable), true);
  assert.equal(dartScheme.satisfies('2.0.0-beta.1', '^1.2.0', all), false);
  assert.equal(dartScheme.satisfies('2.0.0-beta.1', '>2.0.0-alpha <2.0.0', all), true);
  assert.equal(dartScheme.baseline('1.0.0+2'), '1.0.0+2');
  assert.equal(dartScheme.satisfies('1.0.0+3', '1.0.0+2', stable), false);
  assert.equal(dartScheme.satisfies('1.0.0+3', '>=1.0.0+2 <2.0.0', stable), true);
  assert.equal(dartScheme.max(['1.0.0+2', '1.0.0+10', '1.0.0'], stable), '1.0.0+10');
  for (const spec of ['any', '*', '1.0', '~1.0.0', '1.0.0 || 2.0.0', '<2.0.0']) {
    assert.equal(dartScheme.baseline(spec), undefined, spec);
  }
  const update = computeUpdate({ name: 'plugin', spec: '1.0.0+2', line: 0, section: 'dependencies' },
    { latest: '1.0.0+3', all: ['1.0.0+2', '1.0.0+3'] }, { ...stable, showSatisfyingUpdates: true, scheme: dartScheme });
  assert.equal(update?.latest, '1.0.0+3');
  assert.equal(update?.kind, 'patch');
  assert.equal(update?.inRange, false);
});

test('pubspec parses block and flow declarations and skips non-public sources and aliases', () => {
  const text = [
    'name: example', 'dependencies:', '  http: ^1.0.0 # comment', '  flutter:', '    sdk: flutter',
    '  local: {path: ../local, version: ^1.0.0}', '  remote: {git: https://example.com/repo, version: ^1.0.0}',
    '  custom: {hosted: https://example.com, version: ^1.0.0}', '  unconstrained: any',
    '  public_package:', '    hosted: https://pub.dev', '    version: ">=1.0.0 <2.0.0"',
    'dev_dependencies: {test: ^1.24.0}', 'dependency_overrides:', '  http: 1.2.0',
  ].join('\n');
  assert.deepEqual(parsePubspec(text), [
    { name: 'custom', spec: '^1.0.0', line: 7, section: 'dependencies', source: 'https://example.com' },
    { name: 'public_package', spec: '>=1.0.0 <2.0.0', line: 11, section: 'dependencies' },
    { name: 'test', spec: '^1.24.0', line: 12, section: 'dev_dependencies' },
    { name: 'http', spec: '1.2.0', line: 14, section: 'dependency_overrides' },
  ]);
  assert.deepEqual(parsePubspec('dependencies: [broken'), []);
  assert.deepEqual(parsePubspec('dependencies:\n  test: ^1.0.0\n  test: ^2.0.0'), []);
  assert.deepEqual(parsePubspec('pin: &pin ^1.0.0\ndependencies:\n  http: *pin'), []);
  assert.equal(parsePubspec('dependencies:\n  http: {hosted: {url: https://pub.dev, name: http}, version: ^1.0.0}')[0]?.name, 'http');
  assert.equal(parsePubspec('dependencies:\n  private: ^1.0.0', 'https://private.example')[0]?.source, 'https://private.example');
  assert.equal(parsePubspec('dependencies:\n  http: {hosted: https://pub.dev, version: ^1.0.0}', 'https://private.example')[0]?.name, 'http');
});

test('pnpm reads default and named catalogs including scoped aliases', () => {
  assert.deepEqual(parsePnpmWorkspace([
    'packages: [packages/*]', 'catalog:', '  react: ^18.0.0', '  local: workspace:*',
    '  alias: npm:@scope/real@^2.0.0', 'catalogs:', '  modern:', '    "@types/node": ">=20.0.0 <21.0.0"',
    '  legacy: {react: "^17.0.0"}', 'overrides: {ignored: "^1.0.0"}',
  ].join('\n')), [
    { name: 'react', spec: '^18.0.0', line: 2, section: 'catalog' },
    { name: '@scope/real', spec: '^2.0.0', alias: 'alias', line: 4, section: 'catalog' },
    { name: 'ignored', spec: '^1.0.0', line: 9, section: 'overrides' },
    { name: '@types/node', spec: '>=20.0.0 <21.0.0', line: 7, section: 'catalogs.modern' },
    { name: 'react', spec: '^17.0.0', line: 8, section: 'catalogs.legacy' },
  ]);
  assert.deepEqual(parsePnpmWorkspace('catalog:\n  foo: [not-a-version]'), []);
});

test('Gradle catalogs resolve version refs per declaration, coordinates, and plugin markers', () => {
  const deps = parseGradleCatalog([
    '[versions]', 'kotlin = "2.0.0"', 'rich = { strictly = "[1.0,2.0)" }', '[libraries]',
    'core = { module = "org.example:core", version.ref = "kotlin" }',
    'other = { group = "org.example", name = "other", version = "1.0.0" }',
    'short = "org.example:short:1.2.0"',
    'nested = { module = "org.example:nested", version = { ref = "kotlin" } }',
    'missing = { module = "org.example:missing", version.ref = "unknown" }',
    'rich = { module = "org.example:rich", version.ref = "rich" }',
    'dynamic = { module = "org.example:dynamic", version = "1.+" }',
    '[plugins]', 'kotlin = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }',
    '[bundles]', 'all = ["core", "other"]',
  ].join('\n'));
  assert.deepEqual(deps.map((dep) => [dep.name, dep.spec, dep.line, dep.section]), [
    ['org.example:core', '2.0.0', 4, 'libraries'], ['org.example:other', '1.0.0', 5, 'libraries'],
    ['org.example:short', '1.2.0', 6, 'libraries'], ['org.example:nested', '2.0.0', 7, 'libraries'],
    ['org.example:rich', '[1.0,2.0)', 9, 'libraries'],
    ['org.jetbrains.kotlin.jvm:org.jetbrains.kotlin.jvm.gradle.plugin', '2.0.0', 12, 'plugins'],
  ]);
});

test('Packagist responses ignore branches and normalize releases before ordering', () => {
  const result = packagistVersions({ packages: { 'vendor/pkg': [
    { version: 'dev-main' }, { version: 'v1.0.0' }, { version: '2.0.0-RC1' },
    { version: '1.9.0', description: 'Package', license: ['MIT'], time: '2026-01-01T00:00:00Z' },
  ] } }, 'vendor/pkg');
  assert.equal(result.latest, '1.9.0');
  assert.deepEqual(result.all, ['1.0.0', '2.0.0-rc.1', '1.9.0']);
  assert.equal(result.meta?.license, 'MIT');
  assert.equal(packagistVersions({}, 'vendor/pkg').error, 'no comparable versions found');
});

test('pub responses exclude retracted releases and preserve build suffixes', () => {
  const result = pubVersions({ versions: [
    { version: '1.0.0+2' }, { version: '1.0.0+10', pubspec: { description: 'Plugin' } },
    { version: '2.0.0', retracted: true }, { version: '3.0.0-beta.1' }, { version: 'invalid' },
  ] });
  assert.equal(result.latest, '1.0.0+10');
  assert.deepEqual(result.all, ['1.0.0+2', '1.0.0+10', '3.0.0-beta.1']);
  assert.equal(result.meta?.description, 'Plugin');
  assert.equal(pubVersions({}).error, 'no comparable versions found');
});
