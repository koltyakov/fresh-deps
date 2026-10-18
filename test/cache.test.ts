import test from 'node:test';
import assert from 'node:assert/strict';
import { VersionCache } from '../src/cache';

test('changing the cache duration invalidates existing entries, including restored ones', () => {
  const cache = new VersionCache(60_000);
  cache.set('pkg', { latest: '1.0.0' });
  const restored = new VersionCache(60_000);
  restored.restore(cache.serialize());
  restored.setTtl(0);
  assert.equal(restored.get('pkg'), undefined);
  assert.deepEqual(restored.serialize(), []);
  cache.setTtl(1_000);
  assert.equal(cache.get('pkg'), undefined);
});

test('setting the same cache duration preserves entries and in-flight work', async () => {
  const cache = new VersionCache(60_000);
  cache.set('pkg', { latest: '1.0.0' });
  const pending = cache.resolve('other', async () => ({ latest: '2.0.0' }));
  cache.setTtl(60_000);
  assert.equal(cache.get('pkg')?.latest, '1.0.0');
  assert.equal(
    cache.resolve('other', async () => {
      throw new Error('Duplicate request');
    }),
    pending
  );
  assert.equal((await pending).latest, '2.0.0');
});

test('restoring a snapshot honors the current shorter cache duration', (t) => {
  let now = 1_000;
  t.mock.method(Date, 'now', () => now);
  const cache = new VersionCache(60_000);
  cache.set('pkg', { latest: '1.0.0' });
  const snapshot = cache.serialize();
  const disabled = new VersionCache(0);
  disabled.restore(snapshot);
  assert.equal(disabled.get('pkg'), undefined);
  now += 2_000;
  const shortened = new VersionCache(1_000);
  shortened.restore(snapshot);
  assert.equal(shortened.get('pkg'), undefined);
});
