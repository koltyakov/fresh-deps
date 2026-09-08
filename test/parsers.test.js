const test = require('node:test');
const assert = require('node:assert');
const { parsePackageJson } = require('../out/parsers/packageJson');
const { parseGoMod } = require('../out/parsers/goMod');
const { parseCargoToml } = require('../out/parsers/cargoToml');

const SECTIONS = require('../package.json').contributes.configuration.properties['freshDeps.npm.sections'].default;

test('package.json: reads the configured sections', () => {
  const text = [
    '{',
    '  "name": "demo",',
    '  "version": "1.0.0",',
    '  "dependencies": {',
    '    "lodash": "^4.17.20"',
    '  },',
    '  "devDependencies": {',
    '    "typescript": "~5.4.0"',
    '  },',
    '  "scripts": {',
    '    "build": "1.0.0"',
    '  }',
    '}',
  ].join('\n');

  const deps = parsePackageJson(text, SECTIONS);
  assert.deepStrictEqual(
    deps.map((d) => [d.name, d.spec, d.section, d.line]),
    [
      ['lodash', '^4.17.20', 'dependencies', 4],
      ['typescript', '~5.4.0', 'devDependencies', 7],
    ],
  );
});

test('package.json: reports the line a declaration sits on, across multi-line values', () => {
  const text = '{\n  "name": "demo",\n  "dependencies": {\n\n    "lodash": "^4.17.20"\n  }\n}';
  const [dep] = parsePackageJson(text, SECTIONS);
  assert.strictEqual(dep.line, 4);
  assert.strictEqual(text.split('\n')[dep.line].trim(), '"lodash": "^4.17.20"');
});

test('package.json: skips specs that do not resolve to a registry version', () => {
  const text = JSON.stringify(
    {
      dependencies: {
        local: 'file:../local',
        sibling: 'workspace:*',
        forked: 'github:user/repo',
        tagged: 'latest',
        anything: '*',
        real: '1.2.3',
      },
    },
    null,
    2,
  );
  const deps = parsePackageJson(text, SECTIONS);
  assert.deepStrictEqual(deps.map((d) => d.name), ['real']);
});

test('package.json: unwraps npm: aliases', () => {
  const text = JSON.stringify({ dependencies: { 'my-react': 'npm:react@^18.2.0' } }, null, 2);
  const [dep] = parsePackageJson(text, SECTIONS);
  assert.strictEqual(dep.name, 'react');
  assert.strictEqual(dep.spec, '^18.2.0');
  assert.strictEqual(dep.alias, 'my-react');
});

test('package.json: unwraps scoped npm: aliases', () => {
  const text = JSON.stringify({ dependencies: { alias: 'npm:@scope/pkg@~1.0.0' } }, null, 2);
  const [dep] = parsePackageJson(text, SECTIONS);
  assert.strictEqual(dep.name, '@scope/pkg');
  assert.strictEqual(dep.spec, '~1.0.0');
});

test('package.json: tolerates comments and ignores nested objects', () => {
  const text = [
    '{',
    '  // a comment',
    '  "dependencies": {',
    '    /* block */',
    '    "lodash": "^4.0.0"',
    '  },',
    '  "overrides": {',
    '    "dependencies": {',
    '      "nested": "^1.0.0"',
    '    }',
    '  }',
    '}',
  ].join('\n');
  const deps = parsePackageJson(text, SECTIONS);
  assert.deepStrictEqual(deps.map((d) => d.name), ['lodash']);
});

test('package.json: reads Volta pins with comments and multi-line values', () => {
  const text = [
    '{',
    '  "devDependencies": { "typescript": "5.3.3" },',
    '  "volta": {',
    '    "node": "20.5.0", // runtime',
    '    "npm": "10.0.0",',
    '    "yarn": "1.22.19",',
    '    "pnpm":',
    '      "9.0.0",',
    '    "extends": "../package.json",',
    '    "unknown": "1.0.0",',
    '    "nested": { "node": "18.0.0" }',
    '  },',
    '  "config": { "volta": { "node": "16.0.0" } }',
    '}',
  ].join('\n');
  assert.deepStrictEqual(parsePackageJson(text, SECTIONS), [
    { name: 'typescript', spec: '5.3.3', section: 'devDependencies', line: 1 },
    { name: 'node', spec: '20.5.0', section: 'volta', line: 3 },
    { name: 'npm', spec: '10.0.0', section: 'volta', line: 4 },
    { name: 'yarn', spec: '1.22.19', section: 'volta', line: 5 },
    { name: 'pnpm', spec: '9.0.0', section: 'volta', line: 7 },
  ]);
  assert.deepStrictEqual(parsePackageJson(text, ['dependencies']), []);
});

test('package.json: skips non-version Volta values and never treats extends as a package', () => {
  const text = JSON.stringify({ volta: {
    node: 'latest', npm: null, yarn: false, pnpm: 'file:../pnpm', extends: '1.2.3',
  } });
  assert.deepStrictEqual(parsePackageJson(text, SECTIONS), []);
});

test('go.mod: reads block and single-line requires', () => {
  const text = [
    'module example.com/demo',
    '',
    'go 1.22',
    '',
    'require github.com/spf13/cobra v1.8.0',
    '',
    'require (',
    '\tgithub.com/stretchr/testify v1.9.0',
    '\tgolang.org/x/sync v0.7.0 // indirect',
    ')',
  ].join('\n');

  const deps = parseGoMod(text, { includeIndirect: false });
  assert.deepStrictEqual(
    deps.map((d) => [d.name, d.spec, d.line]),
    [
      ['github.com/spf13/cobra', 'v1.8.0', 4],
      ['github.com/stretchr/testify', 'v1.9.0', 7],
    ],
  );
});

test('go.mod: includes indirect modules on request', () => {
  const text = 'require (\n\tgolang.org/x/sync v0.7.0 // indirect\n)';
  const deps = parseGoMod(text, { includeIndirect: true });
  assert.strictEqual(deps.length, 1);
  assert.strictEqual(deps[0].indirect, true);
});

test('go.mod: reports the line a requirement sits on', () => {
  const line = '\tgithub.com/stretchr/testify v1.9.0 // indirect';
  const [dep] = parseGoMod(`module example.com/demo\n\nrequire (\n${line}\n)`, { includeIndirect: true });
  assert.strictEqual(dep.line, 3);
  assert.strictEqual(dep.spec, 'v1.9.0');
});

test('go.mod: skips replaced modules and other directives', () => {
  const text = [
    'require (',
    '\tgithub.com/a/b v1.0.0',
    '\tgithub.com/c/d v2.0.0',
    ')',
    '',
    'replace github.com/a/b => ../local',
    '',
    'exclude (',
    '\tgithub.com/e/f v1.0.0',
    ')',
    '',
    'retract v1.0.1',
  ].join('\n');

  const deps = parseGoMod(text, { includeIndirect: false });
  assert.deepStrictEqual(deps.map((d) => d.name), ['github.com/c/d']);
});

test('Cargo.toml: reads standard, workspace and target dependency tables', () => {
  const text = [
    '[dependencies]',
    'serde = "1.0"',
    'tokio = { version = "1.35", features = ["full"] }',
    '',
    '[dev-dependencies]',
    'pretty_assertions = "1.4"',
    '',
    '[workspace.dependencies]',
    'anyhow = "~1.0.75"',
    '',
    '[target.\'cfg(unix)\'.build-dependencies]',
    'cc = ">= 1.0, < 2"',
  ].join('\n');

  assert.deepStrictEqual(
    parseCargoToml(text).map((d) => [d.name, d.spec, d.section, d.line]),
    [
      ['serde', '1.0', 'dependencies', 1],
      ['tokio', '1.35', 'dependencies', 2],
      ['pretty_assertions', '1.4', 'dev-dependencies', 5],
      ['anyhow', '~1.0.75', 'workspace.dependencies', 8],
      ['cc', '>= 1.0, < 2', 'target.cfg(unix).build-dependencies', 11],
    ],
  );
});

test('Cargo.toml: handles renamed and expanded dependencies', () => {
  const text = [
    '[dependencies]',
    'json = { package = "serde_json", version = "1.0" }',
    '',
    '[dependencies.regex]',
    'version = "1.10"',
    'features = ["unicode"]',
  ].join('\n');

  const deps = parseCargoToml(text);
  assert.deepStrictEqual(deps.map((d) => [d.name, d.spec, d.alias, d.line]), [
    ['serde_json', '1.0', 'json', 1],
    ['regex', '1.10', undefined, 4],
  ]);
});

test('Cargo.toml: skips dependencies that do not resolve through crates.io', () => {
  const text = [
    '[dependencies]',
    'local = { path = "../local", version = "1" }',
    'fork = { git = "https://example.com/fork", version = "1" }',
    'private = { registry = "company", version = "1" }',
    'inherited = { workspace = true }',
    'anything = "*"',
    'real = "1"',
  ].join('\n');
  assert.deepStrictEqual(parseCargoToml(text).map((d) => d.name), ['real']);
});
