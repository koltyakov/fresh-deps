import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedLockfile, clearLockfileCache } from '../src/lockfiles/cache';
import { clearManifestCache } from '../src/projectFiles';

test('lockfile parse caching is content-sensitive, bounded and cleared with manifest state', () => {
  clearLockfileCache();
  let count = 0;
  const parse = () => ({ generation: ++count });
  const first = cachedLockfile('pnpm|/repo/pnpm-lock.yaml', 'first', parse);
  assert.equal(cachedLockfile('pnpm|/repo/pnpm-lock.yaml', 'first', parse), first);
  assert.equal(count, 1);
  assert.notEqual(cachedLockfile('pnpm|/repo/pnpm-lock.yaml', 'changed', parse), first);
  assert.equal(count, 2);
  clearManifestCache();
  cachedLockfile('pnpm|/repo/pnpm-lock.yaml', 'changed', parse);
  assert.equal(count, 3);
  for (let index = 0; index < 8; index++) cachedLockfile(`yarn|${index}`, 'text', parse);
  const before = count;
  cachedLockfile('pnpm|/repo/pnpm-lock.yaml', 'changed', parse);
  assert.equal(count, before + 1, 'Old entries are evicted rather than retained indefinitely');
});
