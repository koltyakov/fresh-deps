import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { applyLockfile } from '../src/lockfiles';
import projectFiles = require('../src/projectFiles');

const dep = { name: 'example', spec: '^1.0.0', line: 0, section: 'dependencies' };
const root = '/repo';
function files(t: TestContext, contents: Record<string, string>) {
  t.mock.method(projectFiles, 'readProjectFile', (filename: string) => contents[filename]);
}
function workspace(manager: string) {
  return {
    '/repo/package.json': JSON.stringify({
      packageManager: `${manager}@9.0.0`,
      workspaces: ['packages/*'],
    }),
    '/repo/pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
  };
}

for (const version of ['6.0', '9.0']) {
  test(`pnpm ${version} selects the exact importer and preserves provenance and peer contexts`, (t) => {
    const key = version === '6.0' ? '/example@1.5.0(peer@2.0.0)' : 'example@1.5.0';
    files(t, {
      ...workspace('pnpm'),
      '/repo/pnpm-lock.yaml': `lockfileVersion: '${version}'\nimporters:\n  packages/web:\n    dependencies:\n      example:\n        specifier: ^1.0.0\n        version: 1.5.0(peer@2.0.0)\n  packages/api:\n    dependencies:\n      example:\n        specifier: ^1.0.0\n        version: 1.9.0\npackages:\n  '${key}':\n    resolution: {integrity: sha512-test}\n  ${version === '6.0' ? '/' : ''}example@1.9.0:\n    resolution: {integrity: sha512-test}\n`,
    });
    const web = applyLockfile('/repo/packages/web/package.json', 'npm', [dep], undefined, root)[0];
    const api = applyLockfile('/repo/packages/api/package.json', 'npm', [dep], undefined, root)[0];
    assert.equal(web.resolvedVersion, '1.5.0');
    assert.equal(api.resolvedVersion, '1.9.0');
    assert.deepEqual(web.baselineOrigin, {
      lockfile: '/repo/pnpm-lock.yaml',
      importer: 'packages/web',
      descriptor: '^1.0.0',
    });
  });
}

test('pnpm aliases resolve their target package, not the alias key', (t) => {
  files(t, {
    '/repo/pnpm-lock.yaml':
      'lockfileVersion: 9\nimporters:\n  .:\n    dependencies:\n      renamed:\n        specifier: npm:example@^1.0.0\n        version: example@1.5.0\npackages:\n  example@1.5.0:\n    resolution: {integrity: sha512-test}',
  });
  assert.equal(
    applyLockfile('/repo/package.json', 'npm', [{ ...dep, alias: 'renamed' }], undefined, root)[0]
      .resolvedVersion,
    '1.5.0'
  );
});

test('workspace selections reject unrelated parents, nested project boundaries and missing importers', (t) => {
  files(t, {
    ...workspace('pnpm'),
    '/repo/pnpm-lock.yaml': 'lockfileVersion: 9\nimporters: {}\npackages: {}',
  });
  const missing = applyLockfile(
    '/repo/packages/web/package.json',
    'npm',
    [dep],
    undefined,
    root
  )[0];
  assert.equal(missing.resolvedVersion, undefined);
  assert.match(missing.baselineUnavailable!, /No unambiguous/);
  const outside = applyLockfile(
    '/repo/examples/app/package.json',
    'npm',
    [dep],
    undefined,
    root
  )[0];
  assert.match(outside.baselineUnavailable!, /verified workspace/);
  const bounded = applyLockfile(
    '/repo/packages/web/package.json',
    'npm',
    [dep],
    undefined,
    '/repo/packages/web'
  )[0];
  assert.match(bounded.baselineUnavailable!, /No readable lockfile/);
});

test('conflicting package managers never pick an arbitrary lockfile', (t) => {
  files(t, { '/repo/package-lock.json': '{}', '/repo/pnpm-lock.yaml': 'lockfileVersion: 9' });
  assert.match(
    applyLockfile('/repo/package.json', 'npm', [dep], undefined, root)[0].baselineUnavailable!,
    /Conflicting lockfiles/
  );
  files(t, {
    ...workspace('pnpm'),
    '/repo/packages/web/package.json': '{"packageManager":"yarn@4.0.0"}',
    '/repo/pnpm-lock.yaml': 'lockfileVersion: 9',
  });
  assert.match(
    applyLockfile('/repo/packages/web/package.json', 'npm', [dep], undefined, root)[0]
      .baselineUnavailable!,
    /Conflicting packageManager/
  );
});

for (const reference of [
  'link:../other',
  'file:../archive.tgz',
  'https://example.test/pkg.tgz',
  'github:org/repo',
  'example@1.5.0(unclosed',
  '1.5.0(patch_hash=abcdef)',
  '1.5.0(peer@1.0.0))',
]) {
  test(`pnpm does not turn ${reference} into a registry selection`, (t) => {
    files(t, {
      '/repo/pnpm-lock.yaml': `lockfileVersion: 9\nimporters:\n  .:\n    dependencies:\n      example: {specifier: ^1.0.0, version: '${reference}'}\npackages:\n  example@1.5.0:\n    resolution: {integrity: sha512-test}`,
    });
    assert.equal(
      applyLockfile('/repo/package.json', 'npm', [dep], undefined, root)[0].resolvedVersion,
      undefined
    );
  });
}

test('pnpm source matching does not infer private registries from integrity hashes', (t) => {
  const text =
    'lockfileVersion: 9\nimporters:\n  .:\n    dependencies:\n      example: {specifier: ^1.0.0, version: 1.5.0}\npackages:\n  example@1.5.0:\n    resolution: {integrity: sha512-test}';
  files(t, { '/repo/pnpm-lock.yaml': text });
  assert.equal(
    applyLockfile('/repo/package.json', 'npm', [dep], () => 'https://private.example/npm', root)[0]
      .resolvedVersion,
    undefined
  );
  files(t, {
    '/repo/pnpm-lock.yaml': text.replace(
      '{integrity: sha512-test}',
      '{tarball: "https://private.example/npm/example/-/example-1.5.0.tgz"}'
    ),
  });
  assert.equal(
    applyLockfile('/repo/package.json', 'npm', [dep], () => 'https://private.example/npm', root)[0]
      .resolvedVersion,
    '1.5.0'
  );
  assert.equal(
    applyLockfile('/repo/package.json', 'npm', [dep], undefined, root)[0].resolvedVersion,
    undefined
  );
});

test('pnpm accepts nested and scoped peer contexts but rejects non-registry resolutions', (t) => {
  const text =
    'lockfileVersion: 9\nimporters:\n  .:\n    dependencies:\n      example: {specifier: ^1.0.0, version: "1.5.0(@scope/peer@2.0.0(nested@1.0.0))(other@3.0.0)"}\npackages:\n  example@1.5.0:\n    resolution: {integrity: sha512-test}';
  files(t, { '/repo/pnpm-lock.yaml': text });
  assert.equal(
    applyLockfile('/repo/package.json', 'npm', [dep], undefined, root)[0].resolvedVersion,
    '1.5.0'
  );
  files(t, {
    '/repo/pnpm-lock.yaml': text.replace(
      '{integrity: sha512-test}',
      '{type: git, repo: "https://github.com/org/repo"}'
    ),
  });
  assert.equal(
    applyLockfile('/repo/package.json', 'npm', [dep], undefined, root)[0].resolvedVersion,
    undefined
  );
});

test('malformed, unsupported and stale pnpm locks explain why no baseline was selected', (t) => {
  for (const text of [
    'lockfileVersion: 99',
    'lockfileVersion: 9\nlockfileVersion: 6',
    'lockfileVersion: 9\nimporters: &a\n  .: *a',
  ]) {
    files(t, { '/repo/pnpm-lock.yaml': text });
    const result = applyLockfile('/repo/package.json', 'npm', [dep], undefined, root)[0];
    assert.equal(result.resolvedVersion, undefined);
    assert.ok(result.baselineUnavailable);
  }
});

test('shared catalog declarations never inherit one arbitrary consumer selection', (t) => {
  files(t, { ...workspace('pnpm'), '/repo/pnpm-lock.yaml': 'lockfileVersion: 9\nimporters: {}' });
  const result = applyLockfile(
    '/repo/pnpm-workspace.yaml',
    'npm',
    [{ ...dep, section: 'catalog' }],
    undefined,
    root
  )[0];
  assert.equal(result.resolvedVersion, undefined);
  assert.match(result.baselineUnavailable!, /one workspace importer/);
});

test('npm workspaces select nested dependencies before hoisted versions', (t) => {
  files(t, {
    ...workspace('npm'),
    '/repo/package-lock.json': JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'packages/web': { dependencies: { example: '^1.0.0' } },
        'packages/api': { dependencies: { example: '^1.0.0' } },
        'node_modules/example': {
          version: '1.9.0',
          resolved: 'https://registry.npmjs.org/example/-/example-1.9.0.tgz',
        },
        'packages/web/node_modules/example': {
          version: '1.5.0',
          resolved: 'https://registry.npmjs.org/example/-/example-1.5.0.tgz',
        },
      },
    }),
  });
  assert.equal(
    applyLockfile('/repo/packages/web/package.json', 'npm', [dep], undefined, root)[0]
      .resolvedVersion,
    '1.5.0'
  );
  assert.equal(
    applyLockfile('/repo/packages/api/package.json', 'npm', [dep], undefined, root)[0]
      .resolvedVersion,
    '1.9.0'
  );
});

test('Yarn Classic matches grouped descriptors and accepts the public Yarn mirror', (t) => {
  files(t, {
    ...workspace('yarn'),
    '/repo/yarn.lock':
      '# yarn lockfile v1\n\nexample@^1.0.0, example@~1.5.0:\n  version "1.5.0"\n  resolved "https://registry.yarnpkg.com/example/-/example-1.5.0.tgz#hash"\n\nexample@^2.0.0:\n  version "2.2.0"\n  resolved "https://registry.npmjs.org/example/-/example-2.2.0.tgz"\n',
  });
  assert.equal(
    applyLockfile('/repo/packages/web/package.json', 'npm', [dep], undefined, root)[0]
      .resolvedVersion,
    '1.5.0'
  );
  assert.equal(
    applyLockfile(
      '/repo/packages/web/package.json',
      'npm',
      [{ ...dep, spec: '^2.0.0' }],
      undefined,
      root
    )[0].resolvedVersion,
    '2.2.0'
  );
  assert.equal(
    applyLockfile(
      '/repo/packages/web/package.json',
      'npm',
      [dep],
      () => 'https://private.example',
      root
    )[0].resolvedVersion,
    undefined
  );
});

test('Yarn Classic aliases and conflicting duplicate descriptors retain identity', (t) => {
  const entry =
    '"renamed@npm:example@^1.0.0":\n  version "1.5.0"\n  resolved "https://registry.npmjs.org/example/-/example-1.5.0.tgz"\n';
  files(t, { '/repo/yarn.lock': `# yarn lockfile v1\n${entry}` });
  assert.equal(
    applyLockfile('/repo/package.json', 'npm', [{ ...dep, alias: 'renamed' }], undefined, root)[0]
      .resolvedVersion,
    '1.5.0'
  );
  files(t, {
    '/repo/yarn.lock': `# yarn lockfile v1\n${entry}${entry.replace(/1\.5\.0/g, '1.9.0')}`,
  });
  assert.equal(
    applyLockfile('/repo/package.json', 'npm', [{ ...dep, alias: 'renamed' }], undefined, root)[0]
      .resolvedVersion,
    undefined
  );
});

for (const version of [4, 5, 6, 8]) {
  test(`Yarn Berry metadata ${version} matches npm descriptors rather than bare package names`, (t) => {
    files(t, {
      ...workspace('yarn'),
      '/repo/yarn.lock': `__metadata:\n  version: ${version}\n"example@npm:^1.0.0, example@npm:~1.5.0":\n  version: 1.5.0\n  resolution: "example@npm:1.5.0"\n  linkType: hard\n"example@npm:^2.0.0":\n  version: 2.2.0\n  resolution: "example@npm:2.2.0"\n`,
    });
    const result = applyLockfile(
      '/repo/packages/web/package.json',
      'npm',
      [dep],
      undefined,
      root
    )[0];
    assert.equal(result.resolvedVersion, '1.5.0');
    assert.equal(result.baselineOrigin?.descriptor, 'example@npm:^1.0.0');
    assert.equal(
      applyLockfile(
        '/repo/packages/web/package.json',
        'npm',
        [dep],
        () => 'https://private.example',
        root
      )[0].resolvedVersion,
      undefined
    );
  });
}

test('Yarn Berry rejects patches, workspace links and unknown schemas', (t) => {
  for (const resolution of [
    'example@workspace:packages/example',
    'example@patch:example@npm%3A1.5.0#patch',
    'example@npm:1.5.0::__archiveUrl=https%3A%2F%2Fprivate.example',
  ]) {
    files(t, {
      '/repo/yarn.lock': `__metadata: {version: 8}\n"example@npm:^1.0.0":\n  version: 1.5.0\n  resolution: "${resolution}"`,
    });
    assert.equal(
      applyLockfile('/repo/package.json', 'npm', [dep], undefined, root)[0].resolvedVersion,
      undefined
    );
  }
  files(t, { '/repo/yarn.lock': '__metadata: {version: 99}' });
  assert.match(
    applyLockfile('/repo/package.json', 'npm', [dep], undefined, root)[0].baselineUnavailable!,
    /Unsupported Yarn Berry/
  );
});

test('Berry does not assume public source identity when Yarn configuration selects a private registry', (t) => {
  files(t, {
    '/repo/yarn.lock':
      '__metadata: {version: 8}\n"example@npm:^1.0.0":\n  version: 1.5.0\n  resolution: "example@npm:1.5.0"',
    '/repo/.yarnrc.yml': 'npmRegistryServer: "https://private.example"',
  });
  assert.equal(
    applyLockfile('/repo/package.json', 'npm', [dep], undefined, root)[0].resolvedVersion,
    undefined
  );
});
