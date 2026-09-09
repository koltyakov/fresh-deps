import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, type AnalyzeRequest } from '../src/analyzer';
import { AuditCache } from '../src/audit';
import { VersionCache } from '../src/cache';
import { NpmClient } from '../src/registries/npm';
import type { AuditResponse } from '../src/types';
import npmrc = require('../src/npmrc');

const vulnerable: AuditResponse = {
  status: 'checked',
  advisories: [{ id: 'GHSA-test', title: 'Example vulnerability', severity: 'high' }],
};
const clean: AuditResponse = { status: 'checked', advisories: [] };
const versionKey = 'npm|https://registry.example|pkg';

function setup(t: TestContext, spec = '1.0.0') {
  t.mock.method(npmrc, 'readNpmConfig', () => new Map());
  const network = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Unexpected network request');
  });
  t.after(() => assert.equal(network.mock.callCount(), 0));
  const audit = t.mock.method(NpmClient.prototype, 'fetchAudit', async (): Promise<AuditResponse> => vulnerable);
  const latest = t.mock.method(NpmClient.prototype, 'fetchLatest', async () => ({ latest: '1.0.0' }));
  const all = t.mock.method(NpmClient.prototype, 'fetchAll', async () => ({
    latest: '2.0.0', all: ['1.0.0', '1.5.0', '2.0.0'],
  }));
  const request: AnalyzeRequest = {
    fsPath: '/audit/package.json',
    text: JSON.stringify({ dependencies: { pkg: spec } }, null, 2),
    settings: {
      enabled: true, auditEnabled: true, cacheDurationMinutes: 60,
      concurrency: 8, requestTimeoutMs: 1000,
      includePrerelease: false, showSatisfyingUpdates: true,
      npm: {
        enabled: true, registry: 'https://registry.example',
        sections: ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'],
      },
      go: { enabled: true, proxy: '', includeIndirect: false, checkMajorVersions: true },
      python: { enabled: true, indexUrl: '', includeBuildRequires: false },
      rust: { enabled: true },
      dotnet: { enabled: true, indexUrl: '' },
      java: { enabled: true, repository: '' },
      php: { enabled: true },
      dart: { enabled: true },
      gradle: { enabled: true, repositories: [] },
    },
    cache: new VersionCache(60 * 60_000),
    auditCache: new AuditCache(),
    allowNetwork: true,
  };
  return { request, audit, latest, all };
}

test('a vulnerable dependency at latest still produces an audit without an update', async (t) => {
  const { request, audit, latest, all } = setup(t);
  const result = await analyze(request);
  assert.ok(result);
  assert.equal(result.ecosystem, 'npm');
  assert.deepEqual(result.updates, []);
  assert.equal(result.audits.length, 1);
  assert.deepEqual(result.audits[0], {
    dep: { name: 'pkg', spec: '1.0.0', section: 'dependencies', line: 2 },
    version: '1.0.0', baseline: false, result: vulnerable,
  });
  assert.deepEqual(audit.mock.calls.map((call) => call.arguments), [['pkg', '1.0.0']]);
  assert.equal(latest.mock.callCount(), 1);
  assert.equal(all.mock.callCount(), 0);
  assert.equal(result.failures.size, 0);
  assert.equal(result.incomplete, false);
});

test('range audits label the declared baseline, not the latest or satisfying version', async (t) => {
  const { request, audit, latest, all } = setup(t, '^1.0.0');
  latest.mock.mockImplementation(async () => ({ latest: '2.0.0' }));
  const result = await analyze(request);
  assert.ok(result);
  assert.equal(result.audits.length, 1);
  assert.equal(result.audits[0].baseline, true);
  assert.equal(result.audits[0].version, '1.0.0');
  assert.deepEqual(result.audits[0].result, vulnerable);
  assert.deepEqual(audit.mock.calls.map((call) => call.arguments), [['pkg', '1.0.0']]);
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].latest, '2.0.0');
  assert.equal(result.updates[0].satisfying, '1.5.0');
  assert.deepEqual(all.mock.calls.map((call) => call.arguments), [['pkg']]);
});

test('an audit failure preserves the version update and is separate from lookup failures', async (t) => {
  const { request, audit, latest } = setup(t);
  audit.mock.mockImplementation(async () => { throw new Error('audit unavailable'); });
  latest.mock.mockImplementation(async () => ({ latest: '2.0.0' }));
  const result = await analyze(request);
  assert.ok(result);
  assert.deepEqual(result.audits[0].result, { status: 'failed', error: 'audit unavailable' });
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].current, '1.0.0');
  assert.equal(result.updates[0].latest, '2.0.0');
  assert.equal(result.failures.size, 0);
  assert.equal(result.incomplete, false);
});

test('disabling audits makes zero audit requests while version checks still run', async (t) => {
  const { request, audit, latest, all } = setup(t);
  request.settings.auditEnabled = false;
  latest.mock.mockImplementation(async () => ({ latest: '2.0.0' }));
  const result = await analyze(request);
  assert.ok(result);
  assert.deepEqual(result.audits, []);
  assert.equal(audit.mock.callCount(), 0);
  assert.equal(latest.mock.callCount(), 1);
  assert.equal(all.mock.callCount(), 0);
  assert.equal(result.updates.length, 1);
  assert.equal(request.auditCache.get(`${versionKey}|audit|1.0.0`, 60_000), undefined);
});

test('an unsupported ecosystem reports unsupported rather than a clean audit', async (t) => {
  const { request, audit, latest, all } = setup(t);
  request.fsPath = '/audit/Cargo.toml';
  request.text = '[dependencies]\nserde = "1.0.0"\n';
  request.allowNetwork = false;
  request.cache.set('rust|crates.io|serde', { latest: '1.0.0' });
  const result = await analyze(request);
  assert.ok(result);
  assert.equal(result.ecosystem, 'rust');
  assert.equal(result.audits.length, 1);
  assert.equal(result.audits[0].dep.name, 'serde');
  assert.deepEqual(result.audits[0].result, { status: 'unsupported' });
  assert.deepEqual(result.updates, []);
  assert.equal(result.incomplete, false);
  assert.equal(audit.mock.callCount(), 0);
  assert.equal(latest.mock.callCount(), 0);
  assert.equal(all.mock.callCount(), 0);
});

test('cache-only analysis leaves missing audits pending and reuses fetched results', async (t) => {
  const { request, audit, latest, all } = setup(t);
  request.cache.set(versionKey, { latest: '2.0.0' });
  request.allowNetwork = false;
  const pending = await analyze(request);
  assert.ok(pending);
  assert.deepEqual(pending.audits[0].result, { status: 'pending' });
  assert.equal(pending.incomplete, true);
  assert.equal(pending.updates.length, 1);
  assert.equal(audit.mock.callCount(), 0);
  assert.equal(request.auditCache.get(`${versionKey}|audit|1.0.0`, 60_000), undefined);

  const fetched = await analyze({ ...request, allowNetwork: true });
  assert.ok(fetched);
  assert.deepEqual(fetched.audits[0].result, vulnerable);
  assert.equal(fetched.incomplete, false);
  const cached = await analyze(request);
  assert.ok(cached);
  assert.deepEqual(cached.audits, fetched.audits);
  assert.deepEqual(cached.updates, fetched.updates);
  assert.equal(cached.incomplete, false);
  assert.equal(audit.mock.callCount(), 1);
  assert.equal(latest.mock.callCount(), 0);
  assert.equal(all.mock.callCount(), 0);

  request.text = JSON.stringify({ dependencies: { pkg: '2.0.0' } });
  const differentVersion = await analyze(request);
  assert.ok(differentVersion);
  assert.deepEqual(differentVersion.audits[0].result, { status: 'pending' });
  assert.equal(differentVersion.incomplete, true);
  assert.equal(audit.mock.callCount(), 1);
});

test('duplicate package declarations share an in-flight audit but retain both results', async (t) => {
  const { request, audit } = setup(t);
  request.text = JSON.stringify({
    dependencies: { pkg: '1.0.0' }, devDependencies: { pkg: '^1.0.0' },
  }, null, 2);
  request.cache.set(versionKey, { latest: '1.0.0' });
  let finish!: (result: AuditResponse) => void;
  const response = new Promise<AuditResponse>((resolve) => { finish = resolve; });
  audit.mock.mockImplementation(() => response);
  const analysis = analyze(request);
  await Promise.resolve();
  assert.equal(audit.mock.callCount(), 1);
  finish(vulnerable);
  const result = await analysis;
  assert.ok(result);
  assert.equal(result.audits.length, 2);
  assert.deepEqual(result.audits.map((entry) => entry.dep.section).sort(), ['dependencies', 'devDependencies']);
  assert.deepEqual(result.audits.map((entry) => entry.baseline).sort(), [false, true]);
  for (const entry of result.audits) assert.deepEqual(entry.result, vulnerable);
  assert.equal(audit.mock.callCount(), 1);
  assert.equal(result.incomplete, false);
});

for (const [label, response] of [['clean', clean], ['vulnerable', vulnerable], ['unsupported', { status: 'unsupported' }]] satisfies [string, AuditResponse][]) {
  test(`audit cache expires ${label} results at the requested TTL`, async (t) => {
    let now = 1000;
    t.mock.method(Date, 'now', () => now);
    const cache = new AuditCache();
    const fetch = t.mock.fn(async () => response);
    assert.equal(await cache.resolve('pkg', fetch), response);
    assert.equal(cache.get('pkg', 0), undefined);
    now += 119_999;
    assert.equal(cache.get('pkg', 120_000), response);
    now += 1;
    assert.equal(cache.get('pkg', 120_000), undefined);
    assert.equal(cache.get('other', 120_000), undefined);
    await cache.resolve('pkg', fetch);
    assert.equal(cache.get('pkg', 120_000), response);
    assert.equal(fetch.mock.callCount(), 2);
  });
}

for (const ttl of [30_000, 120_000]) {
  test(`audit failures expire after the shorter of ${ttl}ms and one minute`, async (t) => {
    let now = 1000;
    t.mock.method(Date, 'now', () => now);
    const cache = new AuditCache();
    const failure: AuditResponse = { status: 'failed', error: 'offline' };
    await cache.resolve('returned', async () => failure);
    await cache.resolve('rejected', async () => { throw new Error('offline'); });
    await cache.resolve('thrown', () => { throw 'offline'; });
    now += Math.min(ttl, 60_000) - 1;
    for (const key of ['returned', 'rejected', 'thrown']) assert.deepEqual(cache.get(key, ttl), failure);
    now += 1;
    for (const key of ['returned', 'rejected', 'thrown']) assert.equal(cache.get(key, ttl), undefined);
  });
}

test('clearing the audit cache removes entries and prevents in-flight work from repopulating it', async () => {
  const cache = new AuditCache();
  await cache.resolve('cached', async () => clean);
  let finish!: (result: AuditResponse) => void;
  const response = new Promise<AuditResponse>((resolve) => { finish = resolve; });
  const pending = cache.resolve('pkg', () => response);
  await Promise.resolve();
  cache.clear();
  assert.equal(cache.get('cached', 60_000), undefined);
  finish(vulnerable);
  assert.equal(await pending, vulnerable);
  assert.equal(cache.get('pkg', 60_000), undefined);
});

test('an old in-flight audit cannot overwrite or remove a replacement after clear', async (t) => {
  const cache = new AuditCache();
  let finishOld!: (result: AuditResponse) => void;
  let finishNew!: (result: AuditResponse) => void;
  const oldResponse = new Promise<AuditResponse>((resolve) => { finishOld = resolve; });
  const newResponse = new Promise<AuditResponse>((resolve) => { finishNew = resolve; });
  const old = cache.resolve('pkg', () => oldResponse);
  await Promise.resolve();
  cache.clear();
  const replacement = cache.resolve('pkg', () => newResponse);
  finishOld(vulnerable);
  await old;
  assert.equal(cache.get('pkg', 60_000), undefined);
  const redundantFetch = t.mock.fn(async () => vulnerable);
  const joined = cache.resolve('pkg', redundantFetch);
  finishNew(clean);
  assert.equal(await replacement, clean);
  assert.equal(await joined, clean);
  assert.equal(redundantFetch.mock.callCount(), 0);
  assert.equal(cache.get('pkg', 60_000), clean);
});
