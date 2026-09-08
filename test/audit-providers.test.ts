import test, { type Mock } from 'node:test';
import assert from 'node:assert/strict';
import { NpmClient } from '../src/registries/npm';
import { PyPiClient } from '../src/registries/pypi';
import { fetchJson, HttpError } from '../src/http';
import npmrc = require('../src/npmrc');

type FetchOptions = RequestInit & { headers: Record<string, string>; body?: string };
let network: Mock<typeof fetch>;

test.beforeEach((t) => {
  assert.ok('mock' in t);
  network = t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected network request'));
  t.mock.method(npmrc, 'readNpmConfig', () => new Map<string, string>());
});

const npm = () => new NpmClient({ cwd: '/', registryOverride: 'https://private.example/npm/', timeoutMs: 1000 });
const pypi = () => new PyPiClient({ indexOverride: 'https://pypi.org/simple/', timeoutMs: 1000 });
const npmEntry = { id: 123, title: 'Unsafe input', severity: 'high', url: 'https://example.com/advisory', vulnerable_versions: '<2.0.0' };
const pyEntry = { id: 'PYSEC-2026-1', summary: 'Unsafe input', details: 'Long description', link: 'https://example.com/advisory', fixed_in: ['2.0.0'], withdrawn: null };

test('npm audit posts to the scoped registry with its existing auth', async (t) => {
  const config = new Map([
    ['registry', 'https://registry.npmjs.org'],
    ['@private:registry', 'https://private.example/npm/'],
    ['//private.example/npm/:_auth', 'dXNlcjpwYXNz'],
  ]);
  t.mock.method(npmrc, 'readNpmConfig', () => config);
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string, options: FetchOptions) => {
    assert.equal(url, 'https://private.example/npm/-/npm/v1/security/advisories/bulk');
    assert.equal(options.method, 'POST');
    assert.ok(typeof options.body === 'string');
    assert.deepEqual(JSON.parse(options.body), { '@private/pkg': ['1.0.0'] });
    assert.equal(options.headers.authorization, 'Basic dXNlcjpwYXNz');
    assert.equal(options.headers['content-type'], 'application/json');
    assert.equal(options.headers.accept, 'application/json');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ '@private/pkg': [npmEntry] });
  });
  const client = new NpmClient({ cwd: '/', timeoutMs: 1000 });
  assert.deepEqual(await client.fetchAudit('@private/pkg', '1.0.0'), {
    status: 'checked', advisories: [{ id: '123', title: npmEntry.title, severity: 'high', url: npmEntry.url }],
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test('npm filters unaffected ranges and includes affected prereleases', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ pkg: [
    npmEntry, { ...npmEntry, id: 456, vulnerable_versions: '>=3.0.0' },
  ] }));
  const result = await npm().fetchAudit('pkg', '1.5.0-beta.1');
  assert.equal(result.status, 'checked');
  assert.deepEqual(result.advisories.map(a => a.id), ['123']);
  assert.deepEqual(await npm().fetchAudit('pkg', '2.5.0'), { status: 'checked', advisories: [] });
});

test('PyPI reads release vulnerabilities and excludes withdrawn advisories', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, options: FetchOptions) => {
    assert.equal(url, 'https://pypi.org/pypi/my-package/1.0%2Blocal/json');
    assert.equal(options.method, undefined);
    assert.equal(options.body, undefined);
    assert.equal(options.headers.accept, 'application/json');
    return Response.json({ vulnerabilities: [pyEntry, { ...pyEntry, id: 'withdrawn', withdrawn: '2026-01-01T00:00:00Z' }] });
  });
  assert.deepEqual(await pypi().fetchAudit('My_Package', '1.0+local'), {
    status: 'checked', advisories: [{ id: pyEntry.id, title: pyEntry.summary, url: pyEntry.link, fixedVersions: ['2.0.0'] }],
  });
});

test('PyPI titles fall back to details or ID when summary is absent', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ vulnerabilities: [
    { id: 'one', summary: null, details: 'Description' }, { id: 'two' },
  ] }));
  const result = await pypi().fetchAudit('pkg', '1.0');
  assert.equal(result.status, 'checked');
  assert.deepEqual(result.advisories, [
    { id: 'one', title: 'Description' }, { id: 'two', title: 'two' },
  ]);
});

for (const index of ['https://private.example/simple', 'https://pypi.org.evil/simple', 'http://pypi.org/simple']) {
  test(`PyPI does not send private package names from ${index} to public PyPI`, async () => {
    const client = new PyPiClient({ indexOverride: index, timeoutMs: 1000 });
    assert.deepEqual(await client.fetchAudit('private-package', '1.0'), { status: 'unsupported' });
    assert.equal(network.mock.callCount(), 0);
  });
}

for (const [provider, client, clean, malformed] of [
  ['npm', npm, {}, [null, [], 'oops', { error: 'denied' }, { pkg: null }, { pkg: [null] },
    ...[{ id: null }, { title: '' }, { vulnerable_versions: 'invalid' }, { vulnerable_versions: '' },
      { severity: 1 }, { url: false }].map(fields => ({ pkg: [{ ...npmEntry, ...fields }] }))]],
  ['PyPI', pypi, { vulnerabilities: [] }, [null, [], {}, { vulnerabilities: null }, { vulnerabilities: [null] },
    ...[{ id: 1 }, { summary: {} }, { details: [] }, { withdrawn: false }, { fixed_in: '2.0' },
      { fixed_in: [2] }, { link: {} }].map(fields => ({ vulnerabilities: [{ ...pyEntry, ...fields }] }))]],
] satisfies [string, () => NpmClient | PyPiClient, unknown, unknown[]][]) {
  test(`${provider} accepts an explicitly clean response`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json(clean));
    assert.deepEqual(await client().fetchAudit('pkg', '1.0.0'), { status: 'checked', advisories: [] });
  });

  test(`${provider} rejects malformed responses rather than reporting clean`, async (t) => {
    for (const body of malformed) {
      t.mock.method(globalThis, 'fetch', async () => Response.json(body));
      await assert.rejects(client().fetchAudit('pkg', '1.0.0'), /Malformed/);
    }
    t.mock.method(globalThis, 'fetch', async () => new Response('not JSON'));
    await assert.rejects(client().fetchAudit('pkg', '1.0.0'), SyntaxError);
  });

  for (const status of [404, 410, 405, 501]) {
    test(`${provider} treats HTTP ${status} as unsupported without fallback`, async (t) => {
      const fetch = t.mock.method(globalThis, 'fetch', async (url: string) => {
        assert.ok(url.startsWith(provider === 'npm' ? 'https://private.example/npm/' : 'https://pypi.org/'));
        return new Response('', { status });
      });
      assert.deepEqual(await client().fetchAudit('pkg', '1.0.0'), { status: 'unsupported' });
      assert.equal(fetch.mock.callCount(), 1);
    });
  }

  test(`${provider} propagates HTTP and network failures without fallback`, async (t) => {
    for (const status of [401, 403, 429, 500]) {
      const mock = t.mock.method(globalThis, 'fetch', async () => new Response('', { status }));
      await assert.rejects(client().fetchAudit('pkg', '1.0.0'), error => error instanceof HttpError && error.status === status);
      assert.equal(mock.mock.callCount(), 1);
    }
    const failure = new Error('network unavailable');
    const mock = t.mock.method(globalThis, 'fetch', async () => { throw failure; });
    await assert.rejects(client().fetchAudit('pkg', '1.0.0'), error => error === failure);
    assert.equal(mock.mock.callCount(), 1);
  });
}

test('fetchJson preserves existing GET request options', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, options: FetchOptions) => {
    assert.equal(url, 'https://example.com/metadata');
    assert.equal(Object.hasOwn(options, 'method'), false);
    assert.equal(Object.hasOwn(options, 'body'), false);
    assert.equal(options.headers.authorization, 'Bearer token');
    assert.equal(options.headers['user-agent'], 'vscode-fresh-deps');
    return Response.json({ version: '1.0.0' });
  });
  assert.deepEqual(await fetchJson('https://example.com/metadata', {
    timeoutMs: 1000, headers: { authorization: 'Bearer token' },
  }), { version: '1.0.0' });
});
