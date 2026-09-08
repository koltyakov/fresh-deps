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
};

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
