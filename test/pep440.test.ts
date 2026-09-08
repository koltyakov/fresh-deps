import test from 'node:test';
import assert from 'node:assert';
import * as pep440 from '../src/pep440';
import { classifyPep440 } from '../src/schemes';

const sorted = (versions: string[]) => versions.slice().sort(pep440.compare);

test('parses every part of a PEP 440 version', () => {
  const version = pep440.parseVersion('1!2.3.4rc2.post5.dev6+ubuntu.1');
  assert.ok(version);
  assert.strictEqual(version.epoch, 1);
  assert.deepStrictEqual(version.release, [2, 3, 4]);
  assert.deepStrictEqual(version.pre, { letter: 'rc', num: 2 });
  assert.strictEqual(version.post, 5);
  assert.strictEqual(version.dev, 6);
  assert.strictEqual(version.text, '1!2.3.4rc2.post5.dev6+ubuntu.1');
});

test('normalises the spellings the spec allows', () => {
  assert.strictEqual(pep440.parseVersion('1.0ALPHA1')?.text, '1.0a1');
  assert.strictEqual(pep440.parseVersion('1.0-beta.2')?.text, '1.0b2');
  assert.strictEqual(pep440.parseVersion('1.0_preview_3')?.text, '1.0rc3');
  assert.strictEqual(pep440.parseVersion('1.0-1')?.text, '1.0.post1');
  assert.strictEqual(pep440.parseVersion('1.0.rev2')?.text, '1.0.post2');
  assert.strictEqual(pep440.parseVersion('v1.0')?.text, '1.0');
  assert.strictEqual(pep440.parseVersion('1.0.dev')?.text, '1.0.dev0');
  assert.strictEqual(pep440.parseVersion('not-a-version'), undefined);
});

test('orders dev, pre, final and post releases the way the spec does', () => {
  assert.deepStrictEqual(
    sorted(['1.0', '1.0.post1', '1.0rc1', '1.0a1', '1.0.dev1', '1.0b1', '0.9']),
    ['0.9', '1.0.dev1', '1.0a1', '1.0b1', '1.0rc1', '1.0', '1.0.post1'],
  );
});

test('an epoch outranks the release, and trailing zeros do not count', () => {
  assert.ok(pep440.compare('1!1.0', '2.0') > 0);
  assert.strictEqual(pep440.compare('1.0', '1.0.0'), 0);
  assert.ok(pep440.compare('2020.6.20', '2019.12.1') > 0);
});

test('a local label ranks above the release it builds on', () => {
  assert.ok(pep440.compare('1.0+local', '1.0') > 0);
  assert.ok(pep440.compare('1.0+2', '1.0+abc') > 0);
});

test('~= pins every component but the last', () => {
  const opts = { includePrerelease: false };
  assert.ok(pep440.satisfies('2.2.5', '~=2.2', opts));
  assert.ok(pep440.satisfies('2.9.0', '~=2.2', opts));
  assert.ok(!pep440.satisfies('3.0.0', '~=2.2', opts));
  assert.ok(pep440.satisfies('1.4.6', '~=1.4.5', opts));
  assert.ok(!pep440.satisfies('1.5.0', '~=1.4.5', opts));
  assert.ok(!pep440.satisfies('1.4.4', '~=1.4.5', opts));
});

test('== and != honour the .* wildcard', () => {
  const opts = { includePrerelease: false };
  assert.ok(pep440.satisfies('1.1.9', '==1.1.*', opts));
  assert.ok(!pep440.satisfies('1.10.0', '==1.1.*', opts));
  assert.ok(!pep440.satisfies('1.1.9', '!=1.1.*', opts));
});

test('an equality specifier ignores the local label unless it names one', () => {
  const opts = { includePrerelease: false };
  assert.ok(pep440.satisfies('1.0+ubuntu1', '==1.0', opts));
  assert.ok(!pep440.satisfies('1.0', '==1.0+ubuntu1', opts));
});

test('exclusive comparisons exclude the boundary release', () => {
  const opts = { includePrerelease: true };
  assert.ok(!pep440.satisfies('1.7rc1', '<1.7', opts));
  assert.ok(pep440.satisfies('1.7rc1', '<1.7rc2', opts));
  assert.ok(!pep440.satisfies('1.7.post1', '>1.7', opts));
  assert.ok(pep440.satisfies('1.8', '>1.7', opts));
});

test('prereleases stay hidden unless the specifier names one', () => {
  assert.ok(!pep440.satisfies('2.0b1', '>=1.0', { includePrerelease: false }));
  assert.ok(pep440.satisfies('2.0b1', '>=1.0', { includePrerelease: true }));
  assert.ok(pep440.satisfies('2.0b1', '>=1.0b1', { includePrerelease: false }));
});

test('baselineOf takes the floor a specifier states', () => {
  assert.strictEqual(pep440.baselineOf('>=2.28,<3'), '2.28');
  assert.strictEqual(pep440.baselineOf('==1.2.3'), '1.2.3');
  assert.strictEqual(pep440.baselineOf('~=1.4.5'), '1.4.5');
  assert.strictEqual(pep440.baselineOf('==1.4.*'), '1.4');
  assert.strictEqual(pep440.baselineOf('!=1.0'), undefined);
  assert.strictEqual(pep440.baselineOf('<3'), undefined);
  assert.strictEqual(pep440.baselineOf('nonsense'), undefined);
});

test('isPinned recognises the specifiers that admit one version', () => {
  assert.ok(pep440.isPinned('==1.2.3'));
  assert.ok(pep440.isPinned('===1.2.3'));
  assert.ok(!pep440.isPinned('==1.2.*'));
  assert.ok(!pep440.isPinned('>=1.2.3'));
  assert.ok(!pep440.isPinned('==1.2.3,!=1.2.3'));
});

test('max leaves prereleases out unless asked', () => {
  const all = ['1.0', '2.0b1', '1.9'];
  assert.strictEqual(pep440.max(all, { includePrerelease: false }), '1.9');
  assert.strictEqual(pep440.max(all, { includePrerelease: true }), '2.0b1');
  // A package that has only ever published prereleases still reports one.
  assert.strictEqual(pep440.max(['1.0a1', '1.0a2'], { includePrerelease: false }), '1.0a2');
});

test('classify reads the step off the release tuple', () => {
  assert.strictEqual(classifyPep440('1.2.3', '2.0.0'), 'major');
  assert.strictEqual(classifyPep440('1.2.3', '1.3.0'), 'minor');
  assert.strictEqual(classifyPep440('1.2.3', '1.2.4'), 'patch');
  assert.strictEqual(classifyPep440('1.0', '1!1.0'), 'major');
  assert.strictEqual(classifyPep440('1.0', '1.0.post1'), 'patch');
  assert.strictEqual(classifyPep440('1.0', '1.0b1'), 'prerelease');
});
