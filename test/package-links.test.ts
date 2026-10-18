import test from 'node:test';
import assert from 'node:assert/strict';
import { githubRepository, goRepository, packageLinks } from '../src/packageLinks';
import { safeUrl, redact } from '../src/sanitize';
import type { DependencyUpdate } from '../src/types';

const update: DependencyUpdate = { dep: { name: 'serde', spec: '=1.0.0', line: 0, section: 'dependencies' },
  current: '1.0.0', latest: '2.0.0', kind: 'major', inRange: false };

test('pure release and versioned documentation links need no requests', (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Constructing links made a request'));
  assert.deepEqual(packageLinks(update, 'rust', { repository: 'https://github.com/serde-rs/serde.git' }), [
    { label: 'Releases', url: 'https://github.com/serde-rs/serde/releases' },
    { label: 'Documentation', url: 'https://docs.rs/serde/2.0.0' },
  ]);
  assert.deepEqual(packageLinks({ ...update, dep: { ...update.dep, source: 'sparse+https://private.example/index' } }, 'rust', {}), []);
  assert.deepEqual(packageLinks({ ...update, source: 'https://private.example/index' }, 'rust', {}), []);
  assert.deepEqual(packageLinks(update, 'npm', {}), []);
});

test('links reject unsafe schemes and remove credentials and sensitive query parameters', () => {
  const links = packageLinks(update, 'npm', { documentation: 'command:unsafe', changelog: 'https://user:secret@example.com/changes?token=secret&version=2' });
  assert.deepEqual(links, [{ label: 'Changelog', url: 'https://example.com/changes?version=2' }]);
  assert.equal(githubRepository('https://github.com.evil/org/repo'), undefined);
  assert.equal(githubRepository('https://github.com/org/repo/tree/main'), undefined);
  assert.equal(safeUrl('javascript:alert(1)'), undefined);
  assert.doesNotMatch(redact('Failed https://user:pass@example.test/index?access_token=secret token=abc'), /user:pass|secret|abc/);
});

test('Go tag mappings are limited to direct GitHub modules and major-path suffixes', () => {
  const go = { ...update, dep: { ...update.dep, name: 'github.com/org/repo/v2' } };
  assert.equal(goRepository(go), 'org/repo');
  assert.deepEqual(packageLinks(go, 'go', {}), [{ label: 'Releases', url: 'https://github.com/org/repo/releases' }]);
  assert.equal(goRepository({ ...go, dep: { ...go.dep, name: 'github.com/org/repo/submodule/v2' } }), undefined);
  assert.equal(goRepository({ ...go, dep: { ...go.dep, name: 'example.com/vanity' } }), undefined);
  assert.equal(goRepository({ ...go, alternatePath: 'github.com/other/repo/v3' }), undefined);
  assert.equal(goRepository({ ...go, dep: { ...go.dep, name: 'github.com/org/repo/v10' } }), 'org/repo');
  assert.equal(goRepository({ ...go, meta: { repository: 'https://github.com/other/repo' } }), undefined);
});
