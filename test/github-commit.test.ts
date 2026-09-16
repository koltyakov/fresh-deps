import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, lookupFor, type AnalyzeRequest } from '../src/analyzer';
import { VersionCache } from '../src/cache';
import { AuditCache } from '../src/audit';
import { parsePackageJson } from '../src/parsers/packageJson';
import { githubCommitVersions } from '../src/registries/githubCommit';
import { createSettings } from './settings';

const current = 'a'.repeat(40);
const latest = 'b'.repeat(40);
const base = 'https://api.github.com/repos/owner/repo';
const settings = createSettings({ auditEnabled: true, runtimeVersions: { npm: '22.0.0' } });
const text = (sha = current) => JSON.stringify({ dependencies: { plugin: `github:owner/repo#${sha}` } });

test('GitHub pins retain their repository, declaration and SHA in dependency sections and overrides', () => {
  const sections = ['dependencies', 'devDependencies', 'overrides', 'resolutions'];
  for (const section of sections) {
    const [dep] = parsePackageJson(JSON.stringify({ [section]: { plugin: `github:owner/repo#${current.toUpperCase()}` } }), sections);
    assert.equal(dep.name, 'plugin');
    assert.equal(dep.spec, current);
    assert.equal(dep.githubRepository, 'owner/repo');
    assert.equal(dep.specRaw, `github:owner/repo#${current.toUpperCase()}`);
  }
  for (const ref of ['main', 'v1.2.3', 'abcdef', 'semver:^1.0.0', '']) {
    assert.deepEqual(parsePackageJson(text(ref), sections), []);
  }
});

test('GitHub ancestor updates use the default branch, remain cached, and bypass npm lookups', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    if (url === base) return Response.json({ default_branch: 'release/current' });
    if (url === `${base}/commits/release%2Fcurrent`) return Response.json({ sha: latest });
    assert.equal(url, `${base}/compare/${current}...${latest}`);
    return Response.json({ status: 'ahead', base_commit: { sha: current } });
  });
  const request: AnalyzeRequest = { fsPath: '/project/package.json', text: text(), settings,
    cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: false };
  assert.equal((await analyze(request))?.incomplete, true);
  assert.equal(calls.length, 0);
  const result = await analyze({ ...request, allowNetwork: true });
  assert.equal(result?.updates.length, 1);
  assert.equal(result?.updates[0].latest, latest);
  assert.equal(result?.updates[0].current, current);
  assert.equal(result?.updates[0].githubDefaultBranch, 'release/current');
  assert.equal(result?.statuses?.[0].status, 'available');
  assert.equal(result?.incomplete, false);
  assert.equal(result?.audits[0].result.status, 'unsupported');
  assert.deepEqual((await analyze(request))?.updates, result?.updates);
  const lookup = lookupFor('npm', request.fsPath, settings)!;
  assert.deepEqual(await lookup.fetchDetails!(result!.updates[0].dep, { current, latest }), {});
  assert.equal(calls.length, 3);
  const changed = await analyze({ ...request, text: text('c'.repeat(40)) });
  assert.equal(changed?.incomplete, true);
  assert.equal(changed?.updates.length, 0);
});

for (const status of ['behind', 'diverged', 'identical']) {
  test(`GitHub ${status} comparisons do not suggest an update`, async (t) => {
    t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(
      url === base ? { default_branch: 'main' } : url.includes('/commits/') ? { sha: latest }
        : { status, base_commit: { sha: current } }));
    const result = await analyze({ fsPath: '/project/package.json', text: text(), settings,
      cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true });
    assert.equal(result?.updates.length, 0);
    assert.equal(result?.statuses?.[0].status, 'available');
    assert.equal(result?.incomplete, false);
  });
}

test('GitHub pins at the tip need no comparison, including abbreviated and uppercase SHAs', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    assert.ok(url === base || url === `${base}/commits/main`);
    return Response.json(url === base ? { default_branch: 'main' } : { sha: current });
  });
  for (const sha of [current, current.slice(0, 7).toUpperCase()]) {
    const result = await githubCommitVersions('owner/repo', sha, 1000);
    assert.equal(result.latest, undefined);
    assert.deepEqual(result.published, [sha]);
  }
  assert.equal(calls.length, 4);
});

test('GitHub abbreviated ancestors resolve to full target SHAs', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(
    url === base ? { default_branch: 'main' } : url.includes('/commits/') ? { sha: latest }
      : { status: 'ahead', base_commit: { sha: current } }));
  assert.equal((await githubCommitVersions('owner/repo', current.slice(0, 7), 1000)).latest, latest);
});

test('GitHub missing or unrelated commits do not produce an update', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string) => url.includes('/compare/')
    ? new Response('', { status: 404 })
    : Response.json(url === base ? { default_branch: 'main' } : { sha: latest }));
  const result = await githubCommitVersions('owner/repo', current, 1000);
  assert.equal(result.latest, undefined);
  assert.match(result.error!, /Unable to compare/);
});

test('GitHub malformed or mismatched comparisons cannot authorize an update', async (t) => {
  for (const comparison of [{}, { status: 'ahead' }, { status: 'ahead', base_commit: { sha: latest } }]) {
    const mock = t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(
      url === base ? { default_branch: 'main' } : url.includes('/commits/') ? { sha: latest } : comparison));
    await assert.rejects(githubCommitVersions('owner/repo', current, 1000), /Invalid GitHub commit comparison/);
    mock.mock.restore();
  }
});
