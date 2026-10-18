import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { applyLockfile } from '../src/lockfiles';
import { analyze } from '../src/analyzer';
import { VersionCache } from '../src/cache';
import { AuditCache } from '../src/audit';
import { createSettings } from './settings';
import projectFiles = require('../src/projectFiles');

function files(t: TestContext, contents: Record<string, string>): void {
  t.mock.method(
    projectFiles,
    'readProjectFile',
    (filename: string) => contents[basename(filename)]
  );
}
const dep = { name: 'example', spec: '>=1.0', line: 0, section: 'dependencies' };

test('uv lock selections match canonical names and the selected registry', (t) => {
  files(t, {
    'uv.lock':
      '[[package]]\nname="example"\nversion="1.5"\nsource={registry="https://pypi.org/simple/"}\n[[package]]\nname="example"\nversion="1.9"\nsource={registry="https://private.example/simple"}',
  });
  const deps = [dep, { ...dep, source: 'https://private.example/simple/' }];
  assert.deepEqual(
    applyLockfile('/project/pyproject.toml', 'python', deps).map((entry) => entry.resolvedVersion),
    ['1.5', '1.9']
  );
  files(t, {
    'uv.lock':
      '[[package]]\nname="some-package"\nversion="1.5"\nsource={registry="https://pypi.org/simple"}',
  });
  assert.equal(
    applyLockfile('/project/pyproject.toml', 'python', [{ ...dep, name: 'Some_Package' }])[0]
      .resolvedVersion,
    '1.5'
  );
});

test('uv Git, local and unknown sources never become registry baselines', (t) => {
  for (const source of ['{git="https://github.com/org/example"}', '{editable="."}', '{}']) {
    files(t, { 'uv.lock': `[[package]]\nname="example"\nversion="1.5"\nsource=${source}` });
    assert.equal(
      applyLockfile('/project/pyproject.toml', 'python', [dep])[0].resolvedVersion,
      undefined
    );
  }
});

test('Poetry locks distinguish public, custom and Git sources', (t) => {
  for (const [source, expected] of [
    ['', '1.5'],
    ['\n[package.source]\ntype="legacy"\nurl="https://private.example/simple"', undefined],
    ['\n[package.source]\ntype="git"\nurl="https://github.com/org/example"', undefined],
  ] as const) {
    files(t, { 'poetry.lock': `[[package]]\nname="example"\nversion="1.5"${source}` });
    assert.equal(
      applyLockfile('/project/pyproject.toml', 'python', [dep])[0].resolvedVersion,
      expected
    );
  }
});

test('Cargo locks distinguish crates.io, custom sparse registries and Git sources', (t) => {
  files(t, {
    'Cargo.lock':
      '[[package]]\nname="example"\nversion="1.5.0"\nsource="registry+https://github.com/rust-lang/crates.io-index"\n[[package]]\nname="example"\nversion="1.9.0"\nsource="sparse+https://private.example/index/"',
  });
  const deps = [dep, { ...dep, source: 'sparse+https://private.example/index' }];
  assert.deepEqual(
    applyLockfile('/project/Cargo.toml', 'rust', deps).map((entry) => entry.resolvedVersion),
    ['1.5.0', '1.9.0']
  );
  files(t, {
    'Cargo.lock':
      '[[package]]\nname="example"\nversion="1.9.0"\nsource="git+https://github.com/org/example"',
  });
  assert.equal(applyLockfile('/project/Cargo.toml', 'rust', [dep])[0].resolvedVersion, undefined);
});

test('npm selections stay attached to declarations and matching registries', (t) => {
  files(t, {
    'package-lock.json': JSON.stringify({
      packages: {
        'node_modules/first': {
          name: 'example',
          version: '1.5.0',
          resolved: 'https://registry.npmjs.org/example/-/example-1.5.0.tgz',
        },
        'node_modules/second': {
          name: 'example',
          version: '1.9.0',
          resolved: 'https://private.example/example/-/example-1.9.0.tgz',
        },
      },
    }),
  });
  const deps = [
    { ...dep, alias: 'first' },
    { ...dep, alias: 'second', source: 'https://private.example' },
    { ...dep, section: 'overrides' },
  ];
  assert.deepEqual(
    applyLockfile('/project/package.json', 'npm', deps).map((entry) => entry.resolvedVersion),
    ['1.5.0', '1.9.0', undefined]
  );
  assert.equal(
    applyLockfile('/project/package.json', 'npm', [deps[0]], () => 'https://private.example')[0]
      .resolvedVersion,
    undefined
  );
});

test('Dart hosted locks require the same hosted registry', (t) => {
  files(t, {
    'pubspec.lock':
      'packages:\n  example:\n    source: hosted\n    version: "1.5.0"\n    description:\n      name: example\n      url: "https://private.example"',
  });
  assert.equal(applyLockfile('/project/pubspec.yaml', 'dart', [dep])[0].resolvedVersion, undefined);
  assert.equal(
    applyLockfile('/project/pubspec.yaml', 'dart', [
      { ...dep, source: 'https://private.example' },
    ])[0].resolvedVersion,
    '1.5.0'
  );
});

test('analysis uses effective Python index settings when selecting audit baselines', async (t) => {
  files(t, {
    'uv.lock':
      '[[package]]\nname="example"\nversion="1.5"\nsource={registry="https://private.example/simple"}',
  });
  const queries: { package: { name: string }; version: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    if (url.includes('osv.dev')) {
      queries.push(JSON.parse(options!.body as string));
      return Response.json({});
    }
    return Response.json({ versions: ['1.0', '1.5', '2.0'] });
  });
  const request = {
    fsPath: '/project/pyproject.toml',
    text: '[project]\ndependencies=["example>=1.0"]',
    settings: createSettings({
      useLockfiles: true,
      auditEnabled: true,
      auditProvider: 'osv',
      python: { indexUrl: 'https://pypi.org/simple' },
    }),
    cache: new VersionCache(60_000),
    auditCache: new AuditCache(),
    allowNetwork: true,
  };
  const result = await analyze(request);
  assert.equal(result?.dependencies?.[0].resolvedVersion, undefined);
  assert.equal(queries[0].version, '1.0');
  const privateResult = await analyze({
    ...request,
    settings: createSettings({
      useLockfiles: true,
      python: { indexUrl: 'https://private.example/simple' },
    }),
  });
  assert.equal(privateResult?.dependencies?.[0].resolvedVersion, '1.5');
});

test('matching sources with conflicting versions remain unresolved', (t) => {
  files(t, {
    'uv.lock':
      '[[package]]\nname="example"\nversion="1.5"\nsource={registry="https://pypi.org/simple"}\n[[package]]\nname="example"\nversion="1.9"\nsource={registry="https://pypi.org/simple"}',
  });
  assert.equal(
    applyLockfile('/project/pyproject.toml', 'python', [dep])[0].resolvedVersion,
    undefined
  );
});

test('Swift locks distinguish identical repository paths on different hosts', (t) => {
  files(t, {
    'Package.resolved': JSON.stringify({
      pins: [
        { location: 'https://github.com/org/example.git', state: { version: '1.5.0' } },
        { location: 'https://gitlab.com/org/example.git', state: { version: '1.9.0' } },
      ],
    }),
  });
  const deps = [
    { ...dep, name: 'org/example' },
    { ...dep, name: 'org/example', source: 'gitlab.com' },
  ];
  assert.deepEqual(
    applyLockfile('/project/Package.swift', 'swift', deps).map((entry) => entry.resolvedVersion),
    ['1.5.0', '1.9.0']
  );
});

test('Mix locks use the outer Hex repository instead of a nested dependency repository', (t) => {
  const lock = (repo: string) =>
    `%{\n "example": {:hex, :example, "1.5.0", "abcd", [:mix], [{:child, "~> 1.0", [hex: :child, repo: "hexpm", optional: false]}], "${repo}", "abcd"},\n}`;
  files(t, { 'mix.lock': lock('private') });
  assert.equal(applyLockfile('/project/mix.exs', 'elixir', [dep])[0].resolvedVersion, undefined);
  files(t, { 'mix.lock': lock('hexpm') });
  assert.equal(applyLockfile('/project/mix.exs', 'elixir', [dep])[0].resolvedVersion, '1.5.0');
  assert.equal(
    applyLockfile('/project/mix.exs', 'elixir', [
      { ...dep, source: 'https://hex.pm/api/repos/private' },
    ])[0].resolvedVersion,
    undefined
  );
});
