const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../out/analyzer');
const { VersionCache } = require('../out/cache');
const npmrc = require('../out/npmrc');

for (const cached of [false, true]) {
  for (const spec of ['1.0.0', '^1.0.0']) {
    test(`npm discovers prereleases for ${spec} with latest-only cache ${cached}`, async (t) => {
      t.mock.method(npmrc, 'readNpmConfig', () => new Map());
      const calls = [];
      t.mock.method(globalThis, 'fetch', async (url) => {
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
      const request = {
        fsPath: '/review/package.json',
        text: JSON.stringify({ dependencies: { pkg: spec } }),
        settings: {
          concurrency: 8, requestTimeoutMs: 1000, includePrerelease: true, showSatisfyingUpdates: false,
          npm: { enabled: true, registry: 'https://registry.example', sections: ['dependencies'] },
        },
        cache, allowNetwork: false,
      };
      assert.equal((await analyze(request)).incomplete, true);
      assert.equal(calls.length, 0);
      const result = await analyze({ ...request, allowNetwork: true });
      assert.equal(result.updates[0].latest, '2.0.0-beta.1');
      assert.equal(result.incomplete, false);
      assert.equal(calls.length, cached ? 1 : 2);
      assert.equal((await analyze(request)).updates[0].latest, '2.0.0-beta.1');
      assert.equal(calls.length, cached ? 1 : 2);
    });
  }
}
