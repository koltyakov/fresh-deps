const test = require('node:test');
const assert = require('node:assert');
const { parsePyProject, poetryToPep440 } = require('../out/parsers/pyproject');
const { parsePipfile } = require('../out/parsers/pipfile');
const { parseRequirementsTxt } = require('../out/parsers/requirementsTxt');
const { parseRequirement } = require('../out/parsers/pep508');
const { normalizeName, versionFromFilename, yankedVersions } = require('../out/registries/pypi');
const { resolveIndexUrl, splitCredentials } = require('../out/pipconf');

const summary = (deps) => deps.map((d) => [d.name, d.spec, d.section, d.line]);

test('pep508: splits name, extras, specifier and marker', () => {
  assert.deepStrictEqual(parseRequirement('requests>=2.28,<3'), {
    name: 'requests',
    spec: '>=2.28,<3',
    specOffset: 8,
  });
  assert.strictEqual(parseRequirement('celery[redis] >= 5.3 ; python_version >= "3.9"').spec, '>= 5.3');
  assert.strictEqual(parseRequirement('  django (>=4.2)  ').spec, '>=4.2');
  // A direct reference names no registry version.
  assert.strictEqual(parseRequirement('mylib @ https://example.com/mylib.whl'), undefined);
});

test('requirements.txt: reads pinned requirements and skips options', () => {
  const text = [
    '# production deps',
    '-r base.txt',
    '--index-url https://example.internal/simple',
    'requests==2.28.0',
    'django>=4.2,<5  # LTS',
    'celery[redis]~=5.3',
    'unpinned',
    '-e ./local-package',
    'mylib @ https://example.com/mylib.whl',
  ].join('\n');

  assert.deepStrictEqual(summary(parseRequirementsTxt(text)), [
    ['requests', '==2.28.0', 'requirements', 3],
    ['django', '>=4.2,<5', 'requirements', 4],
    ['celery', '~=5.3', 'requirements', 5],
  ]);
});

test('requirements.txt: anchors a continued requirement on the specifier line', () => {
  const text = 'requests \\\n    >=2.28';
  const [dep] = parseRequirementsTxt(text);
  assert.strictEqual(dep.spec, '>=2.28');
  assert.strictEqual(dep.line, 1);
});

test('pyproject: reads PEP 621 dependencies and optional groups', () => {
  const text = [
    '[project]',
    'name = "demo"',
    'dependencies = [',
    '  "requests>=2.28",',
    '  "django>=4.2,<5",',
    ']',
    '',
    '[project.optional-dependencies]',
    'test = ["pytest>=7.0"]',
    '',
    '[dependency-groups]',
    'dev = ["ruff>=0.4", {include-group = "test"}]',
  ].join('\n');

  assert.deepStrictEqual(summary(parsePyProject(text, { includeBuildRequires: false })), [
    ['requests', '>=2.28', 'project.dependencies', 3],
    ['django', '>=4.2,<5', 'project.dependencies', 4],
    ['pytest', '>=7.0', 'project.optional-dependencies.test', 8],
    ['ruff', '>=0.4', 'dependency-groups.dev', 11],
  ]);
});

test('pyproject: build requirements only on request', () => {
  const text = '[build-system]\nrequires = ["setuptools>=61"]\n';
  assert.deepStrictEqual(parsePyProject(text, { includeBuildRequires: false }), []);
  assert.deepStrictEqual(summary(parsePyProject(text, { includeBuildRequires: true })), [
    ['setuptools', '>=61', 'build-system.requires', 1],
  ]);
});

test('pyproject: reads Poetry tables and skips python itself', () => {
  const text = [
    '[tool.poetry.dependencies]',
    'python = "^3.9"',
    'requests = "^2.28.0"',
    'django = { version = "~4.2", optional = true }',
    'internal = { git = "https://example.com/internal.git" }',
    'anything = "*"',
    '',
    '[tool.poetry.group.dev.dependencies]',
    'pytest = "^7.0"',
  ].join('\n');

  assert.deepStrictEqual(summary(parsePyProject(text, { includeBuildRequires: false })), [
    ['requests', '>=2.28.0,<3.0.0', 'tool.poetry.dependencies', 2],
    ['django', '>=4.2,<4.3', 'tool.poetry.dependencies', 3],
    ['pytest', '>=7.0,<8.0', 'tool.poetry.group.dev.dependencies', 8],
  ]);
});

test('poetryToPep440 expands the bounds caret and tilde stand for', () => {
  assert.strictEqual(poetryToPep440('^1.2.3'), '>=1.2.3,<2.0.0');
  assert.strictEqual(poetryToPep440('^0.2.3'), '>=0.2.3,<0.3.0');
  assert.strictEqual(poetryToPep440('^0.0.3'), '>=0.0.3,<0.0.4');
  assert.strictEqual(poetryToPep440('^0'), '>=0,<1');
  assert.strictEqual(poetryToPep440('~1.2.3'), '>=1.2.3,<1.3.0');
  assert.strictEqual(poetryToPep440('~1'), '>=1,<2');
  assert.strictEqual(poetryToPep440('2.28.0'), '==2.28.0');
  assert.strictEqual(poetryToPep440('>=2.0,<3.0'), '>=2.0,<3.0');
  assert.strictEqual(poetryToPep440('*'), undefined);
  // PEP 440 has no way to spell an alternative.
  assert.strictEqual(poetryToPep440('^1.0 || ^2.0'), undefined);
});

test('Pipfile: reads packages and dev-packages, skipping VCS entries', () => {
  const text = [
    '[[source]]',
    'url = "https://pypi.org/simple"',
    '',
    '[packages]',
    'requests = "==2.28.0"',
    'django = { version = ">=4.2", extras = ["argon2"] }',
    'internal = { git = "https://example.com/internal.git" }',
    'anything = "*"',
    '',
    '[dev-packages]',
    'pytest = ">=7.0"',
  ].join('\n');

  assert.deepStrictEqual(summary(parsePipfile(text)), [
    ['requests', '==2.28.0', 'packages', 4],
    ['django', '>=4.2', 'packages', 5],
    ['pytest', '>=7.0', 'dev-packages', 10],
  ]);
});

test('pypi: normalises names the way the simple index spells them', () => {
  assert.strictEqual(normalizeName('Zope.Interface'), 'zope-interface');
  assert.strictEqual(normalizeName('ruamel_yaml'), 'ruamel-yaml');
  assert.strictEqual(normalizeName('requests'), 'requests');
});

test('pypi: recovers a version from a distribution filename', () => {
  assert.strictEqual(versionFromFilename('requests-2.31.0-py3-none-any.whl'), '2.31.0');
  assert.strictEqual(versionFromFilename('numpy-1.26.4-cp312-cp312-macosx_11_0_arm64.whl'), '1.26.4');
  assert.strictEqual(versionFromFilename('zope.interface-5.4.0.tar.gz'), '5.4.0');
  assert.strictEqual(versionFromFilename('README.md'), undefined);
});

test('pypi: a release is withdrawn only when all of its files are yanked', () => {
  const withdrawn = yankedVersions([
    { filename: 'pkg-1.0-py3-none-any.whl', yanked: 'broken' },
    { filename: 'pkg-1.0.tar.gz', yanked: true },
    { filename: 'pkg-1.1-py3-none-any.whl', yanked: true },
    { filename: 'pkg-1.1.tar.gz' },
  ]);
  assert.deepStrictEqual([...withdrawn], ['1.0']);
});

test('pip config: setting beats environment beats config file beats PyPI', () => {
  const config = { get: (key) => (key === 'global.index-url' ? 'https://from-file.example/simple' : undefined) };
  const empty = { get: () => undefined };

  delete process.env.PIP_INDEX_URL;
  delete process.env.UV_INDEX_URL;
  assert.strictEqual(resolveIndexUrl('', empty), 'https://pypi.org/simple');
  assert.strictEqual(resolveIndexUrl('', config), 'https://from-file.example/simple');

  process.env.PIP_INDEX_URL = 'https://from-env.example/simple/';
  assert.strictEqual(resolveIndexUrl('', config), 'https://from-env.example/simple');
  assert.strictEqual(resolveIndexUrl('https://override.example/simple', config), 'https://override.example/simple');
  delete process.env.PIP_INDEX_URL;
});

test('pip config: credentials in the index URL become a Basic auth header', () => {
  const plain = splitCredentials('https://pypi.org/simple');
  assert.strictEqual(plain.url, 'https://pypi.org/simple');
  assert.strictEqual(plain.auth, undefined);

  const authed = splitCredentials('https://user:p%40ss@index.example/simple');
  assert.strictEqual(authed.url, 'https://index.example/simple');
  assert.strictEqual(authed.auth, `Basic ${Buffer.from('user:p@ss').toString('base64')}`);
});
