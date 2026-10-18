import test from 'node:test';
import assert from 'node:assert/strict';
import { allowsPrerelease, exclusionFor, packagePolicy } from '../src/policies';
import { semverScheme, pep440Scheme } from '../src/schemes';
import { analyze } from '../src/analyzer';
import { VersionCache } from '../src/cache';
import { AuditCache } from '../src/audit';
import { NpmClient } from '../src/registries/npm';
import { createSettings } from './settings';

const dep = { name: '@types/node', spec: '^1.0.0', section: 'dependencies', line: 0 };

test('exclusions use the same glob semantics for manifests and pruned directories', () => {
  for (const pattern of ['**/fixtures/**', 'fixtures', 'fixtures/']) {
    assert.equal(exclusionFor('/repo/fixtures/app/package.json', [pattern], '/repo'), pattern);
    assert.equal(exclusionFor('/repo/fixtures', [pattern], '/repo', true), pattern);
  }
  assert.equal(exclusionFor('/repo/.test/package.json', ['**/.test/**'], '/repo'), '**/.test/**');
  assert.equal(exclusionFor('C:\\repo\\fixtures\\package.json', ['**/fixtures/**'], 'C:\\repo'), '**/fixtures/**');
  assert.equal(exclusionFor('/other/package.json', ['**'], '/repo'), undefined);
  assert.equal(exclusionFor('/repo/package.json', [], '/repo'), undefined);
});

test('ordered package policies match canonical names, effective ecosystems and aliases', () => {
  const settings = createSettings({ packageRules: [
    { name: '@types/*', ignoreUpdates: true, prereleasePolicy: 'never' },
    { name: '@types/node', ecosystem: 'npm', ignoreUpdates: false },
    { name: 'some-package', ecosystem: 'python', ignoreUpdates: true },
    { name: 'react', ecosystem: 'npm', ignoreUpdates: true },
  ] });
  assert.deepEqual(packagePolicy(dep, 'npm', settings), { ignoreUpdates: false, prereleasePolicy: 'never' });
  assert.equal(packagePolicy({ ...dep, name: '@types/react', alias: 'renamed' }, 'npm', settings).ignoreUpdates, true);
  assert.equal(packagePolicy({ ...dep, name: 'Some_Package', ecosystem: 'python' }, 'conda', settings).ignoreUpdates, true);
  assert.equal(packagePolicy({ ...dep, name: 'Some_Package' }, 'conda', settings).ignoreUpdates, false);
  assert.equal(packagePolicy({ ...dep, name: 'npm:react' }, 'deno', settings).ignoreUpdates, true);
});

test('prerelease policies preserve legacy defaults and use the validated baseline', () => {
  assert.equal(allowsPrerelease(dep, semverScheme, 'inherit', false), false);
  assert.equal(allowsPrerelease(dep, semverScheme, 'inherit', true), true);
  assert.equal(allowsPrerelease(dep, semverScheme, 'if-current-prerelease', true), false);
  assert.equal(allowsPrerelease({ ...dep, spec: '^2.0.0-beta.1' }, semverScheme, 'if-current-prerelease', false), true);
  assert.equal(allowsPrerelease({ ...dep, spec: '>=1.0', resolvedVersion: '2.0rc1' }, pep440Scheme, 'if-current-prerelease', false), true);
  assert.equal(allowsPrerelease({ ...dep, minimumStability: 'beta' }, semverScheme, 'inherit', false), true);
  assert.equal(allowsPrerelease({ ...dep, minimumStability: 'beta' }, semverScheme, 'never', true), false);
  assert.equal(allowsPrerelease({ ...dep, allowPrerelease: false }, semverScheme, 'always', true), false);
});

test('suppression retains availability and security evidence without update suggestions', async (t) => {
  t.mock.method(NpmClient.prototype, 'fetchLatest', async () => ({ latest: '2.0.0', all: ['1.0.0', '2.0.0'], allComplete: true }));
  t.mock.method(NpmClient.prototype, 'fetchAudit', async () => ({ status: 'checked' as const, advisories: [{ id: 'TEST', title: 'Vulnerable' }] }));
  const result = await analyze({ fsPath: '/repo/package.json', workspaceRoot: '/repo', text: '{"dependencies":{"example":"1.0.0"}}',
    settings: createSettings({ auditEnabled: true, packageRules: [{ name: 'example', ignoreUpdates: true }] }),
    cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true });
  assert.equal(result?.updates.length, 0);
  assert.equal(result?.statuses?.[0].status, 'available');
  assert.equal(result?.audits[0].result.status, 'checked');
  assert.equal(result?.audits[0].result.advisories[0].id, 'TEST');
  assert.equal(result?.policies?.[0].ignoreUpdates, true);
});

test('excluded manifests never look up versions or audits', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Excluded file made a request'));
  const result = await analyze({ fsPath: '/repo/fixtures/package.json', workspaceRoot: '/repo', text: '{"dependencies":{"example":"1.0.0"}}',
    settings: createSettings({ auditEnabled: true, exclude: ['fixtures'] }), cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true });
  assert.equal(result?.excluded, 'fixtures');
  assert.equal(result?.declarations, 0);
});

for (const [policy, spec, expected] of [
  ['if-current-prerelease', '1.0.0', '2.0.0'], ['if-current-prerelease', '2.0.0-beta.1', '3.0.0-beta.1'],
  ['always', '1.0.0', '3.0.0-beta.1'], ['never', '2.0.0-beta.1', '2.0.0'],
] as const) {
  test(`${policy} selects ${expected} for ${spec} without changing existence evidence`, async (t) => {
    t.mock.method(NpmClient.prototype, 'fetchLatest', async () => ({ latest: '2.0.0', all: ['1.0.0', '2.0.0-beta.1', '2.0.0', '3.0.0-beta.1'], allComplete: true }));
    const result = await analyze({ fsPath: '/repo/package.json', text: JSON.stringify({ dependencies: { example: spec } }),
      settings: createSettings({ prereleasePolicy: policy }), cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true });
    assert.equal(result?.updates[0].latest, expected);
    assert.equal(result?.statuses?.[0].status, 'available');
  });
}

test('cache-only typing never fetches prerelease history', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Typing made a request'));
  const result = await analyze({ fsPath: '/repo/package.json', text: '{"dependencies":{"example":"1.0.0"}}',
    settings: createSettings({ prereleasePolicy: 'always' }), cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: false });
  assert.equal(result?.incomplete, true);
});

test('never fetches stable alternatives without discarding cached prerelease evidence', async (t) => {
  t.mock.method(NpmClient.prototype, 'fetchLatest', async () => ({ latest: '2.0.0-beta.1', published: ['1.0.0', '2.0.0-beta.1'], allComplete: true }));
  const history = t.mock.method(NpmClient.prototype, 'fetchAll', async () => ({ latest: '2.0.0-beta.1', all: ['1.0.0', '1.9.0', '2.0.0-beta.1'], allComplete: true }));
  const request = { fsPath: '/repo/package.json', text: '{"dependencies":{"example":"1.0.0"}}',
    settings: createSettings({ prereleasePolicy: 'never' }), cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true };
  const stable = await analyze(request);
  assert.equal(stable?.updates[0].latest, '1.9.0');
  assert.equal(history.mock.callCount(), 1);
  const prerelease = await analyze({ ...request, settings: createSettings({ prereleasePolicy: 'always' }), allowNetwork: false });
  assert.equal(prerelease?.updates[0].latest, '2.0.0-beta.1');
});
