import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAvailability } from '../src/availability';
import { semverScheme } from '../src/schemes';
import { analyze, type AnalyzeRequest } from '../src/analyzer';
import { VersionCache } from '../src/cache';
import { AuditCache } from '../src/audit';
import { NpmClient } from '../src/registries/npm';
import { createSettings } from './settings';

const opts = { scheme: semverScheme, includePrerelease: false, showSatisfyingUpdates: true };
const dep = { name: 'pkg', spec: '1.0.0', line: 0, section: 'dependencies' };
const versions = { latest: '2.0.0', all: ['1.0.1', '2.0.0', '3.0.0-beta.1', '3.0.0'], allComplete: true };

test('existence distinguishes pins, ranges, ahead releases, and incomplete metadata', () => {
  for (const [spec, expected] of [
    ['1.0.0', 'version-missing'], ['9.0.0', 'version-missing'], ['^1.0.0', 'available'],
    ['^9.0.0', 'range-missing'], ['3.0.0', 'available'], ['3.0.0-beta.1', 'ahead'],
  ]) assert.equal(checkAvailability({ ...dep, spec }, versions, opts).status, expected, spec);
  assert.equal(checkAvailability(dep, { ...versions, allComplete: false }, opts).status, 'unknown');
  assert.equal(checkAvailability(dep, { error: '401 Unauthorized' }, opts).status, 'failed');
  assert.equal(checkAvailability({ ...dep, spec: '^1.0.0' }, { ...versions, all: ['1.0.1'] }, opts).status, 'available');
});

test('npm validates duplicate declarations independently and reuses metadata while typing', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    return Response.json(url.endsWith('/latest') ? { version: '2.0.0' }
      : { 'dist-tags': { latest: '2.0.0' }, versions: { '1.0.1': {}, '2.0.0': {}, '3.0.0': {} } });
  });
  const request: AnalyzeRequest = {
    fsPath: '/project/package.json',
    text: '{"dependencies":{"pkg":"1.0.0"},"devDependencies":{"pkg":"3.0.0"}}',
    settings: createSettings({ npm: { registry: 'https://registry.example', sections: ['dependencies', 'devDependencies'] } }),
    cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: false,
  };
  assert.equal((await analyze(request))?.incomplete, true);
  assert.equal(calls.length, 0);
  const result = await analyze({ ...request, allowNetwork: true });
  assert.deepEqual(result?.statuses?.map((s) => [s.dep.section, s.status]).sort(), [
    ['dependencies', 'version-missing'], ['devDependencies', 'available'],
  ]);
  assert.equal(result?.updates.length, 1);
  assert.equal(result?.updates[0].dep.spec, '1.0.0');
  assert.equal(result?.incomplete, false);
  const count = calls.length;
  assert.deepEqual((await analyze(request))?.statuses, result?.statuses);
  assert.equal(calls.length, count);
});

test('npm falls back when latest is absent and keeps failed access distinct from missing packages', async (t) => {
  let mode = 'no-latest';
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (mode === 'denied') return new Response('', { status: 401 });
    if (url.endsWith('/latest') || mode === 'missing') return new Response('', { status: 404 });
    return Response.json({ versions: { '3.0.0-beta.1': {} } });
  });
  const client = new NpmClient({ cwd: '/project', registryOverride: 'https://registry.npmjs.org', timeoutMs: 1000 });
  const result = await client.fetchLatest('pkg');
  assert.equal(result.allComplete, true);
  assert.equal(checkAvailability({ ...dep, spec: '3.0.0-beta.1' }, result, opts).status, 'available');
  mode = 'missing';
  assert.equal((await client.fetchLatest('pkg')).packageMissing, true);
  assert.equal((await client.fetchLatest('@private/pkg')).packageMissing, undefined);
  mode = 'denied';
  await assert.rejects(client.fetchLatest('pkg'), /401/);
});

for (const spec of ['^22.20.3', '^26.5.1', '26.5.1']) {
  test(`npm suggests the highest stable release for ${spec} when latest points backward`, async (t) => {
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      calls.push(url);
      if (url.endsWith('/latest')) return Response.json({ version: '22.20.3', deprecated: 'Old release' });
      if (url.endsWith('/26.6.0')) return Response.json({ version: '26.6.0', description: 'Selected release' });
      return Response.json({ 'dist-tags': { latest: '22.20.3' }, versions: {
        '22.20.3': {}, '26.5.1': {}, '26.6.0': {}, '27.0.0-beta.1': {},
      } });
    });
    const request: AnalyzeRequest = {
      fsPath: '/project/package.json', text: JSON.stringify({ dependencies: { '@types/node': spec } }),
      settings: createSettings(), cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true,
    };
    const result = await analyze(request);
    assert.equal(result?.updates[0]?.latest, '26.6.0');
    assert.equal(result?.updates[0]?.meta?.description, 'Selected release');
    assert.equal(result?.updates[0]?.meta?.deprecated, undefined);
    assert.equal(result?.statuses?.[0]?.status, 'available');
    const count = calls.length;
    assert.deepEqual((await analyze({ ...request, allowNetwork: false }))?.updates, result?.updates);
    assert.equal(calls.length, count);
  });
}

test('npm keeps a newer latest tag even when the version list lags', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(url.endsWith('/latest')
    ? { version: '26.6.0' }
    : { 'dist-tags': { latest: '26.6.0' }, versions: { '26.5.1': {} } }));
  const client = new NpmClient({ cwd: '/project', timeoutMs: 1000 });
  assert.equal((await client.fetchAll('@types/node')).latest, '26.6.0');
  assert.equal((await client.fetchLatest('@types/node')).latest, '26.6.0');
});

test('npm preserves uncertainty for malformed metadata and reports request failures per declaration', async (t) => {
  let fail = false;
  t.mock.method(globalThis, 'fetch', async () => {
    if (fail) throw new Error('Network unavailable');
    return Response.json({});
  });
  const request: AnalyzeRequest = {
    fsPath: '/project/package.json', text: '{"dependencies":{"pkg":"1.0.0"}}',
    settings: createSettings(), cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true,
  };
  const unknown = await analyze(request);
  assert.equal(unknown?.statuses?.[0].status, 'unknown');
  assert.equal(unknown?.incomplete, true);
  fail = true;
  request.cache.clear();
  const failed = await analyze(request);
  assert.equal(failed?.statuses?.[0].status, 'failed');
  assert.equal(failed?.failures.size, 1);
});
