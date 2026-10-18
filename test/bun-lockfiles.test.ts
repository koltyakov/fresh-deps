import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { applyLockfile } from '../src/lockfiles';
import { parseBunLock } from '../src/lockfiles/bun';
import { analyze } from '../src/analyzer';
import { AuditCache } from '../src/audit';
import { VersionCache } from '../src/cache';
import { NpmClient } from '../src/registries/npm';
import { createSettings } from './settings';
import type { DependencyRef } from '../src/types';
import projectFiles = require('../src/projectFiles');

const dep = { name: 'example', spec: '^1.0.0', line: 0, section: 'dependencies' };
const publicRegistry = 'https://registry.npmjs.org';
const row = (version = '1.5.0', source = '') => [`example@${version}`, source, {}, 'sha512-test'];
function lock(
  packages: Record<string, unknown> = { example: row() },
  workspaces: Record<string, unknown> = {
    '': { name: 'root', dependencies: { example: '^1.0.0' } },
  },
  version = 1
): string {
  return JSON.stringify({ lockfileVersion: version, workspaces, packages });
}
function files(t: TestContext, contents: Record<string, string>, binary = false) {
  t.mock.method(projectFiles, 'readProjectFile', (filename: string) => {
    assert.ok(!filename.endsWith('bun.lockb'), 'Never decode binary lockfiles as UTF-8');
    return contents[filename];
  });
  t.mock.method(
    projectFiles,
    'projectFileExists',
    (filename: string) =>
      Object.hasOwn(contents, filename) || (binary && filename === '/repo/bun.lockb')
  );
}
const select = (
  deps: DependencyRef[] = [dep],
  filename = '/repo/package.json',
  source = publicRegistry
) => applyLockfile(filename, 'npm', deps, () => source, '/repo');

for (const version of [0, 1, 2, 3]) {
  test(`Bun text format ${version} supplies direct dependency baselines and provenance`, (t) => {
    files(t, { '/repo/bun.lock': lock(undefined, undefined, version) });
    const result = select()[0];
    assert.equal(result.resolvedVersion, '1.5.0');
    assert.deepEqual(result.baselineOrigin, {
      lockfile: '/repo/bun.lock',
      importer: '.',
      descriptor: 'example@^1.0.0',
    });
  });
}

test('Bun JSONC supports comments, trailing commas, scoped packages and aliases', (t) => {
  const text = `{
    // bun.lock is JSONC, not strict JSON.
    "lockfileVersion": 1,
    "workspaces": { "": { "dependencies": { "renamed": "npm:@scope/pkg@^1.0.0", }, }, },
    "packages": { "renamed": ["@scope/pkg@1.5.0", "", {}, "sha512-test"], },
  }`;
  files(t, { '/repo/bun.lock': text });
  const result = select([{ ...dep, name: '@scope/pkg', alias: 'renamed' }])[0];
  assert.equal(result.resolvedVersion, '1.5.0');
  assert.equal(result.baselineOrigin?.descriptor, 'renamed@npm:@scope/pkg@^1.0.0');
});

test('Bun uses workspace package names for nested selections and root entries for hoisting', (t) => {
  files(t, {
    '/repo/package.json': '{"packageManager":"bun@1.3.0","workspaces":["packages/*"]}',
    '/repo/bun.lock': lock(
      {
        web: ['web@workspace:packages/web'],
        api: ['api@workspace:packages/api'],
        example: row('1.9.0'),
        'web/example': row('1.5.0'),
      },
      {
        '': { name: 'root' },
        'packages/web': { name: 'web', dependencies: { example: '^1.0.0' } },
        'packages/api': { name: 'api', dependencies: { example: '^1.0.0' } },
      }
    ),
  });
  const web = select(undefined, '/repo/packages/web/package.json')[0];
  const api = select(undefined, '/repo/packages/api/package.json')[0];
  assert.equal(web.resolvedVersion, '1.5.0');
  assert.equal(web.baselineOrigin?.importer, 'packages/web');
  assert.equal(api.resolvedVersion, '1.9.0');
  assert.match(
    select(undefined, '/repo/unrelated/package.json')[0].baselineUnavailable!,
    /verified workspace/
  );
  assert.equal(
    applyLockfile(
      '/repo/packages/web/package.json',
      'npm',
      [dep],
      undefined,
      '/repo/packages/web'
    )[0].resolvedVersion,
    undefined
  );
});

test('Bun handles scoped workspace names and dependencies without confusing filesystem paths', (t) => {
  files(t, {
    '/repo/package.json': '{"workspaces":["apps/*"]}',
    '/repo/bun.lock': lock(
      {
        '@workspace/web': ['@workspace/web@workspace:apps/web'],
        '@workspace/web/@scope/pkg': ['@scope/pkg@1.5.0', '', {}, 'sha512-test'],
        '@scope/pkg': ['@scope/pkg@1.9.0', '', {}, 'sha512-test'],
      },
      {
        '': { name: 'root' },
        'apps/web': { name: '@workspace/web', dependencies: { '@scope/pkg': '^1.0.0' } },
      }
    ),
  });
  assert.equal(
    select([{ ...dep, name: '@scope/pkg' }], '/repo/apps/web/package.json')[0].resolvedVersion,
    '1.5.0'
  );
});

test('Bun shadowed workspaces use ./name selections rather than a registry package of that name', (t) => {
  files(t, {
    '/repo/package.json': '{"workspaces":["packages/*"]}',
    '/repo/bun.lock': lock(
      {
        web: ['web@2.0.0', '', {}, 'sha512-test'],
        './web/example': row('1.5.0'),
        example: row('1.9.0'),
      },
      { '': { name: 'root' }, 'packages/web': { name: 'web', dependencies: { example: '^1.0.0' } } }
    ),
  });
  assert.equal(select(undefined, '/repo/packages/web/package.json')[0].resolvedVersion, '1.5.0');
});

test('Bun rejects stale specs, missing workspaces, duplicate workspace names and incompatible selections', (t) => {
  for (const text of [
    lock({ example: row('2.0.0') }),
    lock(undefined, { '': { dependencies: { example: '^0.5.0' } } }),
    lock(undefined, { 'packages/other': { name: 'other', dependencies: { example: '^1.0.0' } } }),
    lock(
      { web: ['web@workspace:packages/web'], example: row() },
      { '': { name: 'web' }, 'packages/web': { name: 'web', dependencies: { example: '^1.0.0' } } }
    ),
  ]) {
    files(t, { '/repo/package.json': '{"workspaces":["packages/*"]}', '/repo/bun.lock': text });
    assert.equal(select()[0].resolvedVersion, undefined);
    assert.equal(
      select(undefined, '/repo/packages/web/package.json')[0].resolvedVersion,
      undefined
    );
  }
});

test('Bun private registry baselines require a matching recorded tarball source', (t) => {
  files(t, { '/repo/bun.lock': lock() });
  assert.equal(
    select(undefined, undefined, 'https://private.example/npm')[0].resolvedVersion,
    undefined
  );
  files(t, {
    '/repo/bun.lock': lock({
      example: row('1.5.0', 'https://user:secret@private.example/npm/example/-/example-1.5.0.tgz'),
    }),
  });
  assert.equal(
    select(undefined, undefined, 'https://private.example/npm')[0].resolvedVersion,
    '1.5.0'
  );
  assert.equal(select()[0].resolvedVersion, undefined);
  files(t, {
    '/repo/bun.lock': lock({
      example: row('1.5.0', 'https://registry.npmjs.org.evil/example/-/example-1.5.0.tgz'),
    }),
  });
  assert.equal(select()[0].resolvedVersion, undefined);
});

for (const reference of [
  'example@workspace:packages/example',
  'example@file:../example',
  'example@github:org/repo#abc',
  'example@git+https://github.com/org/repo',
  'example@https://example.test/pkg.tgz',
  'other@1.5.0',
]) {
  test(`Bun rejects nonmatching registry locator ${reference}`, (t) => {
    files(t, { '/repo/bun.lock': lock({ example: [reference, '', {}, 'sha512-test'] }) });
    assert.equal(select()[0].resolvedVersion, undefined);
  });
}

test('Bun rejects malformed tuples, future schemas, missing records and patched packages', (t) => {
  for (const text of [
    '{',
    '[]',
    '{"lockfileVersion":99,"workspaces":{},"packages":{}}',
    '{"lockfileVersion":1}',
    lock({ example: ['example@1.5.0', {}, 'sha512-test'] }),
    lock({ example: ['example@1.5.0', '', [], 'sha512-test'] }),
    JSON.stringify({
      ...JSON.parse(lock()),
      patchedDependencies: { 'example@1.5.0': 'patches/example.patch' },
    }),
  ]) {
    files(t, { '/repo/bun.lock': text });
    const result = select()[0];
    assert.equal(result.resolvedVersion, undefined);
    assert.ok(result.baselineUnavailable);
  }
  assert.throws(
    () => parseBunLock('{"lockfileVersion":"1","workspaces":{},"packages":{}}'),
    /Unsupported Bun/
  );
});

test('Bun locks participate in packageManager conflict detection and text takes precedence over binary', (t) => {
  const contents = { '/repo/bun.lock': lock(), '/repo/package-lock.json': '{}' };
  files(t, contents, true);
  assert.match(select()[0].baselineUnavailable!, /Conflicting lockfiles/);
  files(t, { ...contents, '/repo/package.json': '{"packageManager":"bun@1.3.0"}' }, true);
  assert.equal(select()[0].resolvedVersion, '1.5.0');
  files(t, { ...contents, '/repo/package.json': '{"packageManager":"npm@11.0.0"}' });
  assert.equal(select()[0].resolvedVersion, undefined);
});

test('binary-only Bun projects explain the text migration rather than borrowing another manager baseline', (t) => {
  files(
    t,
    {
      '/repo/package.json': '{"packageManager":"bun@1.1.0"}',
      '/repo/yarn.lock': '# yarn lockfile v1',
    },
    true
  );
  const result = select()[0];
  assert.equal(result.resolvedVersion, undefined);
  assert.match(result.baselineUnavailable!, /Binary bun.lockb.*Migrate to text bun.lock/);
});

test('an unreadable Bun text lock does not fall through to an old binary or another manager', (t) => {
  files(t, { '/repo/package.json': '{"packageManager":"bun@1.3.0"}' }, true);
  t.mock.method(
    projectFiles,
    'projectFileExists',
    (path: string) => path === '/repo/bun.lock' || path === '/repo/bun.lockb'
  );
  assert.match(select()[0].baselineUnavailable!, /unreadable or exceeds/);
});

test('analysis uses Bun selections for version and audit baselines, including cached typing', async (t) => {
  files(t, { '/repo/bun.lock': lock() });
  t.mock.method(NpmClient.prototype, 'fetchLatest', async () => ({
    latest: '2.0.0',
    all: ['1.0.0', '1.5.0', '1.9.0', '2.0.0'],
    allComplete: true,
  }));
  const audit = t.mock.method(
    NpmClient.prototype,
    'fetchAudit',
    async (_name: string, version: string) => {
      assert.equal(version, '1.5.0');
      return { status: 'checked' as const, advisories: [] };
    }
  );
  const request = {
    fsPath: '/repo/package.json',
    workspaceRoot: '/repo',
    text: '{"dependencies":{"example":"^1.0.0"}}',
    settings: createSettings({
      useLockfiles: true,
      auditEnabled: true,
      npm: { registry: publicRegistry },
    }),
    cache: new VersionCache(60_000),
    auditCache: new AuditCache(),
    allowNetwork: true,
  };
  const result = await analyze(request);
  assert.equal(result?.updates[0].current, '1.5.0');
  assert.equal(result?.audits[0].version, '1.5.0');
  assert.equal(result?.audits[0].baseline, false);
  assert.equal(result?.dependencies?.[0].baselineOrigin?.lockfile, '/repo/bun.lock');
  t.mock.method(globalThis, 'fetch', () => assert.fail('Typing made a network request'));
  assert.equal((await analyze({ ...request, allowNetwork: false }))?.updates[0].current, '1.5.0');
  assert.equal(audit.mock.callCount(), 1);
});
