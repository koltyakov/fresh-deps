const test = require('node:test');
const assert = require('node:assert');
const { computeUpdate, needsFullVersionList, normalizeNpmSpec, normalizePythonSpec } = require('../out/versions');
const { baselineOf, classifyUpdate, isPinned, schemeFor } = require('../out/schemes');

const OPTS = { includePrerelease: false, showSatisfyingUpdates: true, scheme: schemeFor('npm') };
const PY_OPTS = { includePrerelease: false, showSatisfyingUpdates: true, scheme: schemeFor('python') };
const dep = (spec, name = 'pkg') => ({ name, spec, line: 0, section: 'dependencies' });

test('baselineOf takes the floor of a range', () => {
  assert.strictEqual(baselineOf('^1.2.3'), '1.2.3');
  assert.strictEqual(baselineOf('~2.0'), '2.0.0');
  assert.strictEqual(baselineOf('>=3.1.0 <4'), '3.1.0');
  assert.strictEqual(baselineOf('v1.4.0'), '1.4.0');
  assert.strictEqual(baselineOf('*'), undefined);
});

test('isPinned distinguishes exact versions from ranges', () => {
  assert.ok(isPinned('1.2.3'));
  assert.ok(isPinned('v1.2.3'));
  assert.ok(!isPinned('^1.2.3'));
  assert.ok(!isPinned('1.x'));
});

test('classifyUpdate reports the semver step', () => {
  assert.strictEqual(classifyUpdate('1.2.3', '2.0.0'), 'major');
  assert.strictEqual(classifyUpdate('1.2.3', '1.3.0'), 'minor');
  assert.strictEqual(classifyUpdate('1.2.3', '1.2.4'), 'patch');
  assert.strictEqual(classifyUpdate('1.0.0-beta.1', '1.0.0-beta.2'), 'prerelease');
});

test('computeUpdate stays quiet when the floor is already the latest', () => {
  assert.strictEqual(computeUpdate(dep('^4.17.21'), { latest: '4.17.21' }, OPTS), undefined);
});

test('computeUpdate reports an in-range update', () => {
  const update = computeUpdate(dep('^4.17.0'), { latest: '4.17.21' }, OPTS);
  assert.strictEqual(update.latest, '4.17.21');
  assert.strictEqual(update.kind, 'patch');
  assert.strictEqual(update.inRange, true);
});

test('computeUpdate flags a major update as out of range', () => {
  const update = computeUpdate(dep('^4.17.0'), { latest: '5.0.0' }, OPTS);
  assert.strictEqual(update.kind, 'major');
  assert.strictEqual(update.inRange, false);
});

test('computeUpdate reports the newest in-range version alongside the latest', () => {
  const versions = { latest: '5.0.0', all: ['4.17.0', '4.17.21', '4.18.0', '5.0.0'] };
  const update = computeUpdate(dep('^4.17.0'), versions, OPTS);
  assert.strictEqual(update.satisfying, '4.18.0');
  assert.strictEqual(update.latest, '5.0.0');
});

test('computeUpdate leaves prereleases alone unless asked', () => {
  const versions = { latest: '1.0.0', all: ['1.0.0', '2.0.0-beta.1'] };
  assert.strictEqual(computeUpdate(dep('^1.0.0'), versions, OPTS), undefined);

  const opted = computeUpdate(dep('^1.0.0'), versions, { ...OPTS, includePrerelease: true });
  assert.strictEqual(opted.latest, '2.0.0-beta.1');
});

test('computeUpdate treats a newer prerelease as an update for prerelease users', () => {
  const update = computeUpdate(dep('2.0.0-beta.1'), { latest: '2.0.0-beta.5' }, OPTS);
  assert.strictEqual(update.latest, '2.0.0-beta.5');
  assert.strictEqual(update.kind, 'prerelease');
});

test('computeUpdate carries a moved Go import path', () => {
  const update = computeUpdate(
    { ...dep('v1.2.0', 'github.com/foo/bar'), section: 'require' },
    { latest: '3.1.0', path: 'github.com/foo/bar/v3' },
    OPTS,
  );
  assert.strictEqual(update.alternatePath, 'github.com/foo/bar/v3');
  assert.strictEqual(update.kind, 'major');
});

test('needsFullVersionList only asks for the full list when it can add something', () => {
  assert.ok(needsFullVersionList('^4.17.0', '5.0.0', OPTS));
  assert.ok(!needsFullVersionList('^4.17.0', '4.18.0', OPTS));
  assert.ok(!needsFullVersionList('v1.2.3', '2.0.0', OPTS));
  assert.ok(!needsFullVersionList('^4.17.0', '5.0.0', { ...OPTS, showSatisfyingUpdates: false }));
});

test('normalizeNpmSpec rejects non-registry specs', () => {
  assert.strictEqual(normalizeNpmSpec('a', 'file:../a'), undefined);
  assert.strictEqual(normalizeNpmSpec('a', 'https://example.com/a.tgz'), undefined);
  assert.strictEqual(normalizeNpmSpec('a', 'not a version'), undefined);
  assert.deepStrictEqual(normalizeNpmSpec('a', ' ^1.0.0 '), { name: 'a', spec: '^1.0.0' });
});

test('normalizePythonSpec keeps only specifiers with a floor to measure from', () => {
  assert.strictEqual(normalizePythonSpec('requests', ''), undefined);
  assert.strictEqual(normalizePythonSpec('requests', '*'), undefined);
  assert.strictEqual(normalizePythonSpec('requests', '!=2.0'), undefined);
  assert.strictEqual(normalizePythonSpec('requests', '<3'), undefined);
  assert.deepStrictEqual(normalizePythonSpec('requests', ' >=2.28,<3 '), { name: 'requests', spec: '>=2.28,<3' });
});

test('computeUpdate compares Python declarations by PEP 440 rules', () => {
  const dep = (spec) => ({ name: 'requests', spec, line: 0, section: 'project.dependencies' });

  const inRange = computeUpdate(dep('>=2.28'), { latest: '2.32.3', all: ['2.28.0', '2.32.3'] }, PY_OPTS);
  assert.strictEqual(inRange.latest, '2.32.3');
  assert.strictEqual(inRange.kind, 'minor');
  assert.strictEqual(inRange.inRange, true);

  const capped = computeUpdate(dep('>=2.28,<3'), { latest: '3.1.0', all: ['2.28.0', '2.32.3', '3.1.0'] }, PY_OPTS);
  assert.strictEqual(capped.inRange, false);
  assert.strictEqual(capped.kind, 'major');
  assert.strictEqual(capped.satisfying, '2.32.3');
});

test('computeUpdate treats a Python post-release as a patch move', () => {
  const dep = { name: 'pkg', spec: '==1.0', line: 0, section: 'requirements' };
  const update = computeUpdate(dep, { latest: '1.0.post1', all: ['1.0', '1.0.post1'] }, PY_OPTS);
  assert.strictEqual(update.latest, '1.0.post1');
  assert.strictEqual(update.kind, 'patch');
});

test('computeUpdate hides Python prereleases unless asked', () => {
  const dep = { name: 'pkg', spec: '>=1.0', line: 0, section: 'requirements' };
  const versions = { latest: '1.0', all: ['1.0', '2.0b1'] };
  assert.strictEqual(computeUpdate(dep, versions, PY_OPTS), undefined);
  assert.strictEqual(computeUpdate(dep, versions, { ...PY_OPTS, includePrerelease: true }).latest, '2.0b1');
});
