import test from 'node:test';
import assert from 'node:assert/strict';
import type { AnalyzeResult } from '../src/analyzer';
import type { DependencyAudit, DependencyRef } from '../src/types';
import { statusDetails } from '../src/statusDetails';

const dep: DependencyRef = { name: 'pkg', spec: '1.0.0', line: 1, section: 'dependencies' };
const result = (): AnalyzeResult => ({
  ecosystem: 'npm',
  updates: [],
  suppressedUpdates: [
    { dep, current: '1.0.0', latest: '2.0.0', kind: 'major', inRange: false, reason: 'updates' },
  ],
  audits: [],
  failures: new Map(),
  incomplete: false,
});

test('ignored update details distinguish manifest sections and audit baselines', () => {
  const checked = result();
  const dev = { ...dep, section: 'devDependencies', spec: '1.5.0' };
  checked.suppressedUpdates!.push({
    dep: dev,
    current: '1.5.0',
    latest: '2.0.0',
    kind: 'major',
    inRange: false,
    reason: 'major',
  });
  checked.audits = [
    { dep: dev, version: '1.5.0', baseline: false, result: { status: 'checked', advisories: [] } },
    {
      dep,
      version: '1.0.0',
      baseline: false,
      result: {
        status: 'checked',
        advisories: [{ id: 'TEST', title: 'Vulnerable', severity: 'high' }],
      },
    },
  ];
  const details = statusDetails(checked);
  assert.match(details, /dependencies: 1\.0\.0 → 2\.0\.0\. Updates ignored\. Audit: 1 warning/);
  assert.match(
    details,
    /devDependencies: 1\.5\.0 → 2\.0\.0\. Major updates ignored\. Audit: no known vulnerabilities/
  );
  assert.match(details, /dependencies at 1\.0\.0: TEST, high\. Vulnerable/);
  assert.doesNotMatch(details, /devDependencies at 1\.5\.0: TEST/);
});

test('audit warnings remain detailed even without a confirmed update', () => {
  const checked = result();
  checked.suppressedUpdates = [];
  checked.audits = [
    {
      dep,
      version: '1.0.0',
      baseline: false,
      result: { status: 'checked', advisories: [{ id: 'TEST', title: 'Still vulnerable' }] },
    },
  ];
  const details = statusDetails(checked);
  assert.doesNotMatch(details, /Ignored updates/);
  assert.match(details, /Audit warnings/);
  assert.match(details, /pkg\*\*, dependencies at 1\.0\.0: TEST\. Still vulnerable/);
  checked.audits = [{ dep, baseline: false, result: { status: 'failed', error: 'offline' } }];
  assert.match(statusDetails(checked), /Audit failures:\n- \*\*pkg\*\*, dependencies: offline/);
});

for (const [auditResult, expected] of [
  [{ status: 'failed', error: 'offline' }, 'Audit failed: offline.'],
  [{ status: 'unsupported' }, 'Audit unsupported.'],
  [{ status: 'pending' }, 'Audit not checked.'],
  [{ status: 'unchecked' }, 'Audit not checked.'],
] satisfies [DependencyAudit['result'], string][]) {
  test(`ignored dependencies do not claim a clean audit when ${auditResult.status}`, () => {
    const checked = result();
    checked.audits = [{ dep, version: '1.0.0', baseline: false, result: auditResult }];
    const details = statusDetails(checked);
    assert.ok(details.includes(expected));
    assert.doesNotMatch(details, /no known vulnerabilities/);
  });
}

test('audit-disabled and empty details do not fabricate checks or updates', () => {
  const checked = result();
  assert.match(statusDetails(checked), /Audit not enabled/);
  checked.suppressedUpdates = [];
  assert.equal(statusDetails(checked), '');
});

test('status details escape Markdown, icons and registry credentials', () => {
  const checked = result();
  checked.suppressedUpdates![0].dep = { ...dep, alias: '[alias](command:bad)' };
  checked.audits = [
    {
      dep: checked.suppressedUpdates![0].dep,
      baseline: false,
      result: {
        status: 'checked',
        advisories: [
          {
            id: 'TEST',
            title: '$(check) <img> [run](command:bad) https://user:pass@example.test/?token=secret',
          },
        ],
      },
    },
  ];
  const details = statusDetails(checked);
  assert.ok(details.includes('\\[alias\\](command:bad)'));
  assert.ok(details.includes('\\$(check) \\<img\\> \\[run\\](command:bad)'));
  assert.doesNotMatch(details, /user:pass|token=secret/);
});
