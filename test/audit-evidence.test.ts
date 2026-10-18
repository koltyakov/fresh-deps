import test from 'node:test';
import assert from 'node:assert/strict';
import { osvAudit } from '../src/registries/osv';
import { auditCandidate, candidateVersions } from '../src/candidateAudit';
import { auditFetcher } from '../src/auditRouting';
import { AuditCache } from '../src/audit';
import { createSettings } from './settings';
import type { DependencyUpdate } from '../src/types';
import { NpmClient } from '../src/registries/npm';

const update: DependencyUpdate = { dep: { name: 'example', spec: '^1.0.0', line: 0, section: 'dependencies' },
  current: '1.0.0', latest: '2.0.0', sameMajor: '1.9.0', satisfying: '1.9.0', kind: 'major', inRange: false };

test('OSV preserves matching affected ranges, branch-specific fixed events and raw scores', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ vulns: [{ id: 'TEST', summary: 'Test advisory', database_specific: { severity: 'HIGH' },
    severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }], affected: [
      { package: { ecosystem: 'npm', name: 'other' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '99.0.0' }] }] },
      { package: { ecosystem: 'npm', name: 'example' }, ranges: [
        { type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '1.9.0' }] },
        { type: 'SEMVER', events: [{ introduced: '2.0.0' }, { fixed: '2.0.2' }] },
      ] },
    ] }] }));
  const result = await osvAudit('npm', 'example', '1.0.0', 1000);
  assert.equal(result.status, 'checked');
  assert.equal(result.advisories[0].severity, 'HIGH');
  assert.equal(result.advisories[0].scores?.[0].type, 'CVSS_V3');
  assert.equal(result.advisories[0].affected?.length, 2);
  assert.equal(result.advisories[0].affected?.[1].events[1].fixed, '2.0.2');
  assert.equal(result.advisories[0].fixedVersions, undefined, 'Branch boundaries are not universal fixes');
  assert.doesNotMatch(JSON.stringify(result), /99\.0\.0/);
});

test('OSV filters withdrawn and unrelated packages and canonicalizes Python names', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ vulns: [
    { id: 'withdrawn', withdrawn: '2026-01-01' },
    { id: 'unrelated', affected: [{ package: { ecosystem: 'npm', name: 'other' } }] },
    { id: 'matching', affected: [{ package: { ecosystem: 'PyPI', name: 'Some_Package' } }] },
  ] }));
  const result = await osvAudit('python', 'some-package', '1.0', 1000);
  assert.equal(result.status, 'checked');
  assert.deepEqual(result.advisories.map((advisory) => advisory.id), ['matching']);
  assert.equal(result.advisories[0].severity, undefined);
});

test('OSV malformed evidence fails rather than reporting a clean audit', async (t) => {
  for (const vuln of [null, { id: '' }, { id: 'T', affected: [{}] }, { id: 'T', severity: [{}] },
    { id: 'T', affected: [{ package: { ecosystem: 'npm', name: 'example' }, ranges: [{ type: 'SEMVER', events: [{ fixed: 3 }] }] }] }]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ vulns: [vuln] }));
    await assert.rejects(osvAudit('npm', 'example', '1.0.0', 1000), /Invalid OSV/);
  }
});

test('candidate audits are explicit, version-specific, deduplicated and never apply updates', async (t) => {
  const calls: string[] = [];
  t.mock.method(NpmClient.prototype, 'fetchAudit', async (_name: string, version: string) => {
    calls.push(version);
    return { status: 'checked' as const, advisories: version === '2.0.0' ? [{ id: 'STILL-AFFECTED', title: 'Not fixed' }] : [] };
  });
  const settings = createSettings({ auditEnabled: true });
  const cache = new AuditCache();
  assert.deepEqual(candidateVersions(update), ['1.9.0', '2.0.0']);
  const [first, shared] = await Promise.all([
    auditCandidate('/repo/package.json', 'npm', update, '2.0.0', settings, cache),
    auditCandidate('/repo/package.json', 'npm', update, '2.0.0', settings, cache),
  ]);
  assert.deepEqual(first, shared);
  assert.equal(first.target, 'candidate');
  assert.equal(first.result.status, 'checked');
  assert.equal(first.result.advisories[0].id, 'STILL-AFFECTED');
  await auditCandidate('/repo/package.json', 'npm', update, '2.0.0', settings, cache);
  const next = await auditCandidate('/repo/package.json', 'npm', update, '1.9.0', settings, cache);
  assert.equal(next.result.status, 'checked');
  assert.equal(next.result.advisories.length, 0);
  assert.deepEqual(calls, ['2.0.0', '1.9.0']);
  assert.equal(update.dep.spec, '^1.0.0');
});

test('candidate audits enforce opt-in, current targets and private-source restrictions', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected candidate audit request'));
  const cache = new AuditCache();
  await assert.rejects(auditCandidate('/repo/package.json', 'npm', update, '2.0.0', createSettings(), cache), /Enable/);
  await assert.rejects(auditCandidate('/repo/package.json', 'npm', update, '99.0.0', createSettings({ auditEnabled: true }), cache), /current update results/);
  const privateResult = await auditCandidate('/repo/package.json', 'npm', update, '2.0.0', createSettings({ auditEnabled: true, auditProvider: 'osv', npm: { registry: 'https://private.example' } }), cache);
  assert.equal(privateResult.result.status, 'unsupported');
  const settings = createSettings({ auditEnabled: true, auditProvider: 'osv' });
  const lookup = { key: () => 'npm|http://registry.npmjs.org|example', fetch: async () => ({}) };
  assert.equal(auditFetcher(update.dep, 'npm', lookup, settings), undefined);
});

test('Go major candidates audit the new module identity rather than the old path', async (t) => {
  const queries: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => { queries.push(JSON.parse(options.body as string)); return Response.json({}); });
  const go: DependencyUpdate = { ...update, dep: { ...update.dep, name: 'github.com/org/module', spec: 'v1.0.0', section: 'require' }, alternatePath: 'github.com/org/module/v2' };
  await auditCandidate('/repo/go.mod', 'go', go, '2.0.0', createSettings({ auditEnabled: true, auditProvider: 'osv', go: { proxy: 'https://proxy.golang.org' } }), new AuditCache());
  assert.deepEqual(queries, [{ package: { ecosystem: 'Go', name: 'github.com/org/module/v2' }, version: '2.0.0' }]);
});

test('pre-cancelled candidate checks reject even when the version is cached or unsupported', async (t) => {
  t.mock.method(NpmClient.prototype, 'fetchAudit', async () => ({ status: 'checked' as const, advisories: [] }));
  const cache = new AuditCache();
  const settings = createSettings({ auditEnabled: true });
  await auditCandidate('/repo/package.json', 'npm', update, '2.0.0', settings, cache);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(auditCandidate('/repo/package.json', 'npm', update, '2.0.0', settings, cache, controller.signal), { name: 'AbortError' });
  await assert.rejects(auditCandidate('/repo/Cargo.toml', 'rust', update, '2.0.0', settings, cache, controller.signal), { name: 'AbortError' });
});
