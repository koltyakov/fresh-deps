import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, type AnalyzeRequest } from '../src/analyzer';
import { AuditCache } from '../src/audit';
import { VersionCache } from '../src/cache';
import type { Settings } from '../src/config';
import npmrc = require('../src/npmrc');
import manifest from '../package.json';

const settings: Settings = {
  enabled: true, auditEnabled: false, cacheDurationMinutes: 60,
  concurrency: 8, requestTimeoutMs: 1000, includePrerelease: false, showSatisfyingUpdates: true,
  npm: { enabled: true, registry: 'https://registry.example', sections: ['dependencies'] },
  go: { enabled: true, proxy: '', includeIndirect: false, checkMajorVersions: true },
  python: { enabled: true, indexUrl: '', includeBuildRequires: false },
  rust: { enabled: true },
  dotnet: { enabled: true, indexUrl: '' },
  java: { enabled: true, repository: '' },
  php: { enabled: true },
  dart: { enabled: true },
  gradle: { enabled: true, repositories: ['https://repo.maven.apache.org/maven2'] },
  ruby: { enabled: true }, terraform: { enabled: true, defaultRegistry: '' }, elixir: { enabled: true },
  deno: { enabled: true }, githubActions: { enabled: true },
  docker: { enabled: true }, helm: { enabled: true }, swift: { enabled: true }, conan: { enabled: true },
  scala: { enabled: true, repositories: ['https://repo.maven.apache.org/maven2'], scalaBinaryVersion: '', sbtBinaryVersion: '' },
  conda: { enabled: true, subdir: 'linux-64' }, clojure: { enabled: true, repositories: ['https://repo.clojars.org'] },
};

test('Actions analyzes and caches setup inputs independently from action tags', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    return Response.json(url.includes('raw.githubusercontent.com')
      ? [{ version: '22.1.0' }] : [{ name: 'v5' }]);
  });
  const request: AnalyzeRequest = {
    fsPath: '/project/.github/workflows/ci.yml',
    text: 'jobs:\n  build:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20',
    settings, cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: false,
  };
  assert.equal((await analyze(request))?.incomplete, true);
  assert.equal(calls.length, 0);
  const result = await analyze({ ...request, allowNetwork: true });
  assert.deepEqual(result?.updates.map((update) => [update.dep.name, update.dep.line, update.latest]), [
    ['actions/setup-node', 3, 'v5'], ['node', 5, '22'],
  ]);
  assert.deepEqual((await analyze(request))?.updates, result?.updates);
  assert.equal(calls.length, 2);
  assert.equal(await analyze({ ...request, settings: { ...settings, githubActions: { enabled: false } } }), undefined);
});

for (const fixture of [
  {
    file: 'composer.json', ecosystem: 'php',
    text: '{"require":{"vendor/pkg":"^1.0"}}',
    url: 'https://repo.packagist.org/p2/vendor/pkg.json',
    response: { packages: { 'vendor/pkg': [{ version: '1.5.0' }, { version: '2.0.0' }] } },
  },
  {
    file: 'pubspec.yaml', ecosystem: 'dart', text: 'dependencies:\n  http: ^1.0.0',
    url: 'https://pub.dev/api/packages/http', response: { versions: [{ version: '1.5.0' }, { version: '2.0.0' }] },
  },
  {
    file: 'Gemfile', ecosystem: 'ruby', text: 'gem "rails", "~> 1.0"',
    url: 'https://rubygems.org/api/v1/versions/rails.json', response: [{ number: '1.5.0' }, { number: '2.0.0' }],
  },
  {
    file: 'providers.tf', ecosystem: 'terraform', text: 'terraform { required_providers { aws = { source = "hashicorp/aws", version = "~> 1.0" } } }',
    url: 'https://registry.terraform.io/v1/providers/hashicorp/aws/versions', response: { versions: [{ version: '1.5.0' }, { version: '2.0.0' }] },
  },
  {
    file: 'mix.exs', ecosystem: 'elixir', text: 'defp deps do\n[{:phoenix, "~> 1.0"}]\nend',
    url: 'https://hex.pm/api/packages/phoenix', response: { latest_stable_version: '2.0.0', releases: [{ version: '1.5.0' }, { version: '2.0.0' }] },
  },
  {
    file: 'deno.jsonc', ecosystem: 'deno', text: '{"imports":{"assert":"jsr:@std/assert@^1.0.0"}}',
    url: 'https://jsr.io/@std/assert/meta.json', response: { latest: '2.0.0', versions: { '1.5.0': {}, '2.0.0': {} } },
  },
] as const) {
  test(`${fixture.ecosystem} analyzes updates, caches lookups and respects disabled settings`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      calls++;
      assert.equal(url, fixture.url);
      return Response.json(fixture.response);
    });
    const request: AnalyzeRequest = {
      fsPath: `/project/${fixture.file}`, text: fixture.text, settings: { ...settings, auditEnabled: true },
      cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: false,
    };
    assert.equal((await analyze(request))?.incomplete, true);
    assert.equal(calls, 0);
    const result = await analyze({ ...request, allowNetwork: true });
    assert.equal(result?.updates[0].latest, '2.0.0');
    assert.equal(result?.updates[0].satisfying, '1.5.0');
    assert.equal(result?.audits[0].result.status, 'unsupported');
    assert.deepEqual((await analyze(request))?.updates, result?.updates);
    assert.equal(calls, 1);
    assert.equal(await analyze({ ...request, settings: { ...settings, [fixture.ecosystem]: { enabled: false } } }), undefined);
  });
}

test('Gradle queries configured repositories in order and only falls through on missing artifacts', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    return url.startsWith('https://first.example') ? new Response('', { status: 404 })
      : new Response('<metadata><versioning><versions><version>1.0</version><version>2.0</version></versions></versioning></metadata>');
  });
  const request: AnalyzeRequest = {
    fsPath: '/project/gradle/libs.versions.toml', text: '[libraries]\ncore = "org.example:core:1.0"',
    settings: { ...settings, gradle: { enabled: true, repositories: ['https://first.example', 'https://second.example'] } },
    cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true,
  };
  assert.equal((await analyze(request))?.updates[0].latest, '2.0');
  assert.deepEqual(calls, [
    'https://first.example/org/example/core/maven-metadata.xml',
    'https://second.example/org/example/core/maven-metadata.xml',
  ]);
  await analyze({ ...request, allowNetwork: false });
  assert.equal(calls.length, 2);
  const build = await analyze({ ...request, fsPath: '/project/build.gradle.kts', text: 'dependencies { implementation("org.example:core:1.0") }', allowNetwork: false });
  assert.equal(build?.updates[0].latest, '2.0');
  assert.equal(calls.length, 2);
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }));
  const failed = await analyze({ ...request, cache: new VersionCache(60_000) });
  assert.match(failed?.failures.get('org.example:core') ?? '', /403/);
});

test('Deno routes mixed imports to JSR and configured npm registries and reuses npm cache', async (t) => {
  t.mock.method(npmrc, 'readNpmConfig', () => new Map());
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    if (url === 'https://jsr.io/@std/assert/meta.json') return Response.json({ latest: '2.0.0', versions: { '2.0.0': {} } });
    assert.equal(url, 'https://registry.example/react/latest');
    return Response.json({ version: '2.0.0' });
  });
  const request: AnalyzeRequest = {
    fsPath: '/project/deno.json', text: '{"imports":{"react":"npm:react@1.0.0","assert":"jsr:@std/assert@1.0.0"}}',
    settings, cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true,
  };
  const result = await analyze(request);
  assert.equal(result?.updates.length, 2);
  assert.equal(result?.failures.size, 0);
  const npm = await analyze({ ...request, fsPath: '/project/package.json', text: '{"dependencies":{"react":"1.0.0"}}', allowNetwork: false });
  assert.equal(npm?.updates[0].latest, '2.0.0');
  assert.equal(npm?.incomplete, false);
  assert.equal(calls.length, 2);
});

test('Actions caches tag styles separately, avoids network while typing and respects disablement', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/actions/checkout/tags?per_page=100&page=1');
    return Response.json([{ name: 'v5' }, { name: 'v5.1.0' }]);
  });
  const request: AnalyzeRequest = {
    fsPath: '/project/.github/workflows/ci.yml', text: 'jobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/checkout@v4.0.0',
    settings: { ...settings, auditEnabled: true }, cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: false,
  };
  assert.equal((await analyze(request))?.incomplete, true);
  assert.equal(calls, 0);
  const result = await analyze({ ...request, allowNetwork: true });
  assert.deepEqual(result?.updates.map((update) => update.latest), ['v5', 'v5.1.0']);
  assert.ok(result?.audits.every((audit) => audit.result.status === 'unsupported'));
  assert.deepEqual((await analyze(request))?.updates, result?.updates);
  assert.equal(calls, 1);
  assert.equal(await analyze({ ...request, settings: { ...settings, githubActions: { enabled: false } } }), undefined);
});

test('pnpm catalogs reuse npm registry resolution and cache keys', async (t) => {
  t.mock.method(npmrc, 'readNpmConfig', () => new Map());
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls++;
    assert.equal(url, 'https://registry.example/react/latest');
    return Response.json({ version: '19.0.0' });
  });
  const request: AnalyzeRequest = {
    fsPath: '/project/pnpm-workspace.yaml', text: 'catalog:\n  react: 18.0.0', settings,
    cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true,
  };
  assert.equal((await analyze(request))?.updates[0].latest, '19.0.0');
  assert.equal((await analyze({ ...request, fsPath: '/project/package.json', text: '{"dependencies":{"react":"18.0.0"}}', allowNetwork: false }))?.updates[0].latest, '19.0.0');
  assert.equal(calls, 1);
});

test('npm checks Volta pins through the configured registry and reuses cached updates', async (t) => {
  t.mock.method(npmrc, 'readNpmConfig', () => new Map());
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    assert.equal(url, 'https://registry.example/node/latest');
    return Response.json({ version: '22.0.0' });
  });
  const request: AnalyzeRequest = {
    fsPath: '/review/package.json',
    text: '{\n  "volta": {\n    "node": "20.5.0",\n    "extends": "../package.json"\n  }\n}',
    settings: {
      ...settings,
      concurrency: 8, requestTimeoutMs: 1000, includePrerelease: false, showSatisfyingUpdates: true,
      npm: {
        enabled: true, registry: 'https://registry.example',
        sections: manifest.contributes.configuration.properties['freshDeps.npm.sections'].default,
      },
    },
    cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true,
  };
  const result = await analyze(request);
  assert.ok(result);
  assert.equal(result.failures.size, 0);
  assert.equal(result.incomplete, false);
  assert.equal(result.updates.length, 1);
  const [update] = result.updates;
  assert.deepEqual(update.dep, { name: 'node', spec: '20.5.0', section: 'volta', line: 2 });
  assert.equal(update.current, '20.5.0');
  assert.equal(update.latest, '22.0.0');
  assert.equal(update.kind, 'major');
  assert.equal(update.inRange, false);
  assert.equal(update.satisfying, undefined);
  const cachedResult = await analyze({ ...request, allowNetwork: false });
  assert.ok(cachedResult);
  assert.deepEqual(cachedResult.updates, result.updates);
  assert.equal(calls.length, 1);
});

for (const cached of [false, true]) {
  for (const spec of ['1.0.0', '^1.0.0']) {
    test(`npm discovers prereleases for ${spec} with latest-only cache ${cached}`, async (t) => {
      t.mock.method(npmrc, 'readNpmConfig', () => new Map());
      const calls: string[] = [];
      t.mock.method(globalThis, 'fetch', async (url: string) => {
        calls.push(url);
        if (url === 'https://registry.example/pkg/latest') return Response.json({ version: '1.0.0' });
        assert.equal(url, 'https://registry.example/pkg');
        return Response.json({
          'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': {}, '2.0.0-beta.1': {} },
        });
      });
      const cache = new VersionCache(60_000);
      if (cached) cache.set('npm|https://registry.example|pkg', { latest: '1.0.0' });
      const request: AnalyzeRequest = {
        fsPath: '/review/package.json',
        text: JSON.stringify({ dependencies: { pkg: spec } }),
        settings: {
          ...settings,
          concurrency: 8, requestTimeoutMs: 1000, includePrerelease: true, showSatisfyingUpdates: false,
          npm: { enabled: true, registry: 'https://registry.example', sections: ['dependencies'] },
        },
        cache, auditCache: new AuditCache(), allowNetwork: false,
      };
      const pending = await analyze(request);
      assert.ok(pending);
      assert.equal(pending.incomplete, true);
      assert.equal(calls.length, 0);
      const result = await analyze({ ...request, allowNetwork: true });
      assert.ok(result);
      assert.equal(result.updates[0].latest, '2.0.0-beta.1');
      assert.equal(result.incomplete, false);
      assert.equal(calls.length, cached ? 1 : 2);
      const cachedResult = await analyze(request);
      assert.ok(cachedResult);
      assert.equal(cachedResult.updates[0].latest, '2.0.0-beta.1');
      assert.equal(calls.length, cached ? 1 : 2);
    });
  }
}
