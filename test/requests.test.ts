import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { SharedRequests } from '../src/requests';
import { fetchJson } from '../src/http';
import { VersionCache } from '../src/cache';
import { AuditCache } from '../src/audit';
import { analyze } from '../src/analyzer';
import { createSettings } from './settings';
import { OciClient } from '../src/registries/oci';
import { githubTags } from '../src/registries/github';
import npmrc = require('../src/npmrc');

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function delayedFetch(t: TestContext) {
  const calls: { url: string; signal: AbortSignal; resolve(response: Response): void }[] = [];
  t.mock.method(globalThis, 'fetch', (url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = options.signal!;
    signal.throwIfAborted();
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    calls.push({ url, signal, resolve: (response) => { signal.removeEventListener('abort', abort); resolve(response); } });
  }));
  return calls;
}

test('shared HTTP requests survive one subscriber cancellation and abort after the last leaves', async (t) => {
  const calls = delayedFetch(t);
  const requests = new SharedRequests<unknown>();
  const first = new AbortController(), second = new AbortController();
  const fetch = () => fetchJson('https://cancel.example/package', { timeoutMs: 10_000 });
  const a = requests.resolve('pkg', fetch, first.signal);
  const b = requests.resolve('pkg', fetch, second.signal);
  await flush();
  assert.equal(calls.length, 1);
  first.abort();
  await assert.rejects(a, { name: 'AbortError' });
  assert.equal(calls[0].signal.aborted, false);
  second.abort();
  await assert.rejects(b, { name: 'AbortError' });
  assert.equal(calls[0].signal.aborted, true);
  const replacement = requests.resolve('pkg', fetch);
  await flush();
  assert.equal(calls.length, 2);
  calls[1].resolve(Response.json({ version: '2.0.0' }));
  assert.deepEqual(await replacement, { version: '2.0.0' });
});

test('an uncancellable subscriber keeps shared work alive', async (t) => {
  const calls = delayedFetch(t);
  const requests = new SharedRequests<unknown>();
  const controller = new AbortController();
  const fetch = () => fetchJson('https://cancel.example/mixed', { timeoutMs: 10_000 });
  const a = requests.resolve('pkg', fetch, controller.signal);
  const b = requests.resolve('pkg', fetch);
  await flush();
  controller.abort();
  await assert.rejects(a, { name: 'AbortError' });
  assert.equal(calls[0].signal.aborted, false);
  calls[0].resolve(Response.json({}));
  assert.deepEqual(await b, {});
});

test('pre-cancelled work never starts and explicit HTTP signals abort active requests', async (t) => {
  const calls = delayedFetch(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(new SharedRequests().resolve('pkg', async () => assert.fail('Must not run'), controller.signal), { name: 'AbortError' });
  assert.equal(calls.length, 0);
  const active = new AbortController();
  const work = fetchJson('https://cancel.example/explicit', { timeoutMs: 10_000, signal: active.signal });
  active.abort();
  await assert.rejects(work, { name: 'AbortError' });
  assert.equal(calls[0].signal.aborted, true);
});

test('cancelled audits abort HTTP work without caching a failed or unsupported audit', async (t) => {
  const calls = delayedFetch(t);
  const cache = new AuditCache();
  const controller = new AbortController();
  const work = cache.resolve('pkg', async () => {
    await fetchJson('https://cancel.example/audit', { timeoutMs: 10_000 });
    return { status: 'checked', advisories: [] };
  }, controller.signal);
  await flush();
  controller.abort();
  await assert.rejects(work, { name: 'AbortError' });
  await flush();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(cache.get('pkg', 60_000), undefined);
});

test('cancelling one analysis preserves the request and cache for another editor', async (t) => {
  t.mock.method(npmrc, 'readNpmConfig', () => new Map());
  const calls = delayedFetch(t);
  const first = new AbortController(), second = new AbortController();
  const base = { fsPath: '/one/package.json', text: '{"dependencies":{"example":"1.0.0"}}',
    settings: createSettings({ npm: { registry: 'https://registry.npmjs.org' } }),
    cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true };
  const a = analyze({ ...base, signal: first.signal });
  const b = analyze({ ...base, fsPath: '/two/package.json', signal: second.signal });
  await flush();
  first.abort();
  await a;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, false);
  calls[0].resolve(Response.json({ version: '2.0.0' }));
  await flush();
  calls[1].resolve(Response.json({ versions: { '1.0.0': {}, '2.0.0': {} } }));
  const result = await b;
  assert.equal(result?.updates[0].latest, '2.0.0');
  assert.equal(base.cache.get('npm|https://registry.npmjs.org|example')?.latest, '2.0.0');
});

test('cancelling the only analysis aborts HTTP and does not cache cancellation errors', async (t) => {
  t.mock.method(npmrc, 'readNpmConfig', () => new Map());
  const calls = delayedFetch(t);
  const controller = new AbortController();
  const cache = new VersionCache(60_000);
  const work = analyze({ fsPath: '/project/package.json', text: '{"dependencies":{"example":"1.0.0"}}',
    settings: createSettings({ npm: { registry: 'https://registry.npmjs.org' } }),
    cache, auditCache: new AuditCache(), allowNetwork: true, signal: controller.signal });
  await flush();
  controller.abort();
  const result = await work;
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls.length, 1);
  assert.equal(result?.failures.size, 0);
  assert.equal(cache.get('npm|https://registry.npmjs.org|example'), undefined);
});

test('OCI requests inherit cancellation, including bearer-token requests', async (t) => {
  const calls = delayedFetch(t);
  const controller = new AbortController();
  const work = new SharedRequests().resolve('oci', () => new OciClient(10_000).tags('cancel.example', 'example'), controller.signal);
  await flush();
  calls[0].resolve(new Response('', { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://auth.cancel.example/token",scope="repository:example:pull"' } }));
  await flush();
  assert.equal(calls.length, 2);
  controller.abort();
  await assert.rejects(work, { name: 'AbortError' });
  assert.equal(calls[1].signal.aborted, true);
});

test('GitHub tag sharing retains independent cancellation across callers', async (t) => {
  const calls = delayedFetch(t);
  const requests = new SharedRequests<string[] | undefined>();
  const a = new AbortController(), b = new AbortController();
  const first = requests.resolve('actions', () => githubTags('cancellation/shared-tags', 10_000), a.signal);
  const second = requests.resolve('swift', () => githubTags('cancellation/shared-tags', 10_000), b.signal);
  await flush();
  a.abort();
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, false);
  calls[0].resolve(Response.json([{ name: 'v1.0.0' }]));
  assert.deepEqual(await second, ['v1.0.0']);
});
