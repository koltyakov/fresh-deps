import test, { type Mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { GoClient, matchesPrefixPatterns } from '../src/registries/go';
import { NpmClient } from '../src/registries/npm';
import npmrc = require('../src/npmrc');
import { PyPiClient } from '../src/registries/pypi';
import { MavenClient } from '../src/registries/maven';
import { NugetClient } from '../src/registries/nuget';
import { schemeFor } from '../src/schemes';

let network: Mock<typeof fetch>;

test.beforeEach((t) => {
  assert.ok('mock' in t);
  network = t.mock.method(globalThis, 'fetch', () => {
    assert.fail('unexpected network request');
  });
});

function goEnvironment(t: TestContext, privatePatterns: string | undefined, noProxyPatterns: string | undefined) {
  for (const [key, value] of Object.entries({ GOPRIVATE: privatePatterns, GONOPROXY: noProxyPatterns })) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}

const goClient = () => new GoClient({
  proxyOverride: 'https://proxy.example', checkMajorVersions: true, timeoutMs: 1000,
});

test('Go privacy patterns use path-prefix glob semantics', () => {
  for (const [pattern, name, expected] of [
    ['corp.example', 'corp.example/team/module', true],
    ['corp.example', 'corp.example.evil/module', false],
    ['*.example', 'corp.example/team/module', true],
    ['example.com/*/private', 'example.com/team/private/module', true],
    ['example.com/*/private', 'example.com/team/nested/private', false],
    ['example.com/**/private', 'example.com/team/nested/private', false],
    ['example.com/team?', 'example.com/team1/module', true],
    ['example.com/team?', 'example.com/team12/module', false],
    ['example.com/[a-c]team', 'example.com/bteam/module', true],
    ['example.com/[^a-c]team', 'example.com/dteam/module', true],
    ['example.com/[!a]team', 'example.com/ateam/module', true],
    ['example.com/te\\am', 'example.com/team/module', true],
    ['example.com/team/', 'example.com/team/module', true],
    [',bad[,example.com/team,', 'example.com/team/module', true],
    ['example.com/[z-a]', 'example.com/x/module', false],
    ['example.com/[^z-a]', 'example.com/x/module', true],
    ['example.com/[]', 'example.com/x/module', false],
    ['example.com/team\\', 'example.com/team/module', false],
    ['none', 'example.com/team/module', false],
    ['', 'example.com/team/module', false],
  ] satisfies [string, string, boolean][]) {
    assert.equal(matchesPrefixPatterns(pattern, name), expected, `${pattern}: ${name}`);
  }
});

for (const noProxy of [undefined, '']) {
  test(`Go blocks all private module requests with GONOPROXY ${String(noProxy)}`, async (t) => {
    goEnvironment(t, 'corp.example/*', noProxy);
    const client = goClient();
    assert.match((await client.fetchLatest('corp.example/team/module')).error!, /skipped.*GOPRIVATE/);
    assert.equal(await client.fetchPublishDate('corp.example/team/module', '1.0.0'), undefined);
    assert.equal(network.mock.callCount(), 0);
  });
}

test('Go GONOPROXY overrides GOPRIVATE rather than adding to it', async (t) => {
  goEnvironment(t, 'private.example', 'excluded.example');
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    assert.ok(url.startsWith('https://proxy.example/private.example/module/'));
    return url.endsWith('/module/@latest')
      ? Response.json({ Version: 'v1.0.0' }) : new Response('', { status: 404 });
  });
  const client = goClient();
  assert.equal((await client.fetchLatest('private.example/module')).latest, '1.0.0');
  assert.match((await client.fetchLatest('excluded.example/module')).error!, /GONOPROXY/);
  assert.equal(await client.fetchPublishDate('excluded.example/module', 'v1.0.0'), undefined);
  assert.equal(calls.length, 3);
});

test('Go GONOPROXY=none permits private latest, major and date requests', async (t) => {
  goEnvironment(t, 'private.example', 'none');
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    if (url.endsWith('.info')) return Response.json({ Time: '2026-01-01T00:00:00Z' });
    if (url.endsWith('/module/@latest')) return Response.json({ Version: 'v1.0.0' });
    return new Response('', { status: 404 });
  });
  const client = goClient();
  assert.equal((await client.fetchLatest('private.example/module')).latest, '1.0.0');
  assert.equal(await client.fetchPublishDate('private.example/module', '1.0.0'), '2026-01-01T00:00:00Z');
  assert.equal(calls.length, 4);
});

test('Go checks privacy before each major-version probe', async (t) => {
  goEnvironment(t, 'gopkg.in/demo.v[3-9]', undefined);
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    assert.equal(url, 'https://proxy.example/gopkg.in/demo.v2/@latest');
    return Response.json({ Version: 'v2.0.0' });
  });
  assert.equal((await goClient().fetchLatest('gopkg.in/demo.v2')).latest, '2.0.0');
  assert.equal(calls.length, 1);
});

test('Go also excludes slash-major candidates via GONOPROXY', async (t) => {
  goEnvironment(t, undefined, 'example.com/module/v[2-9]');
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, 'https://proxy.example/example.com/module/@latest');
    return Response.json({ Version: 'v1.0.0' });
  });
  assert.equal((await goClient().fetchLatest('example.com/module')).latest, '1.0.0');
  assert.equal(fetch.mock.callCount(), 1);
});

test('npm auth keeps the scheme and longest registry prefix', () => {
  const config = new Map([
    ['//registry.example/:_authToken', 'host-token'],
    ['//registry.example/team/:_auth', 'dXNlcjpwYXNz'],
    ['//registry.example/team/special/:_authToken', 'scoped-token'],
    ['//registry.example/team/special/:_auth', 'ignored-basic'],
  ]);
  assert.equal(npmrc.authHeaderFor(config, 'https://registry.example/team'), 'Basic dXNlcjpwYXNz');
  assert.equal(npmrc.authHeaderFor(config, 'https://registry.example/team/special'), 'Bearer scoped-token');
  assert.equal(npmrc.authHeaderFor(config, 'https://registry.example/other'), 'Bearer host-token');
  assert.equal(npmrc.authHeaderFor(config, 'https://other.example/team'), undefined);
  assert.equal(npmrc.authHeaderFor(config, 'not a URL'), undefined);
});

for (const [key, value, header] of [
  ['_auth', 'dXNlcjpwYXNz', 'Basic dXNlcjpwYXNz'],
  ['_authToken', 'test-token', 'Bearer test-token'],
]) {
  test(`npm sends ${key} correctly on latest, full and publish-date requests`, async (t) => {
    t.mock.method(npmrc, 'readNpmConfig', () => new Map([[`//registry.example/team/:${key}`, value]]));
    const fetch = t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit & { headers: Record<string, string> }) => {
      assert.ok(url.startsWith('https://registry.example/team/package'));
      assert.equal(options.headers.authorization, header);
      return Response.json({ version: '1.0.0', versions: { '1.0.0': {} }, time: { '1.0.0': '2026-01-01' } });
    });
    const client = new NpmClient({ cwd: '/', registryOverride: 'https://registry.example/team', timeoutMs: 1000 });
    await client.fetchLatest('package');
    await client.fetchAll('package');
    await client.fetchPublishDates('package', ['1.0.0']);
    assert.equal(fetch.mock.callCount(), 3);
  });
}

for (const withVersions of [false, true]) {
  test(`PyPI excludes empty-string yanks with versions list ${withVersions}`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({
      ...(withVersions ? { versions: ['1.0', '2.0', '3.0', '4.0'] } : {}),
      files: [
        { filename: 'pkg-1.0.tar.gz', yanked: false },
        { filename: 'pkg-2.0.tar.gz', yanked: '' },
        { filename: 'pkg-3.0.tar.gz', yanked: '' },
        { filename: 'pkg-3.0-py3-none-any.whl' },
        { filename: 'pkg-4.0.tar.gz', yanked: true },
        { filename: 'pkg-4.0-py3-none-any.whl', yanked: 'broken' },
      ],
    }));
    const client = new PyPiClient({ indexOverride: 'https://index.example/simple', timeoutMs: 1000 });
    const result = await client.fetchVersions('pkg');
    assert.deepEqual(result.all, ['1.0', '3.0']);
    assert.equal(result.latest, '3.0');
  });
}

for (const ecosystem of ['java', 'dotnet'] as const) {
  test(`${ecosystem} preserves prerelease-only versions for downstream selection`, async (t) => {
    const versions = ['2.0.0-beta.1', '2.0.0-rc.1'];
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      if (ecosystem === 'java') {
        assert.ok(url.endsWith('/maven-metadata.xml'));
        return new Response(`<metadata><versions>${versions.map((v) => `<version>${v}</version>`).join('')}</versions></metadata>`);
      }
      if (url === 'https://nuget.example/v3/index.json') {
        return Response.json({ resources: [{ '@type': 'PackageBaseAddress/3.0.0', '@id': 'https://nuget.example/flat/' }] });
      }
      assert.equal(url, 'https://nuget.example/flat/pkg/index.json');
      return Response.json({ versions });
    });
    const client = ecosystem === 'java'
      ? new MavenClient('https://maven.example', 1000)
      : new NugetClient('https://nuget.example/v3/index.json', 1000);
    const result = await client.fetchVersions(ecosystem === 'java' ? 'org.example:pkg' : 'Pkg');
    assert.deepEqual(result, { all: versions });
    const scheme = schemeFor(ecosystem);
    assert.equal(scheme.max(result.all!, { includePrerelease: false }), undefined);
    assert.equal(scheme.max(result.all!, { includePrerelease: true }), '2.0.0-rc.1');
  });
}
