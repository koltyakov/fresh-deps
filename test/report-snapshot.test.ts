import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportSnapshot, renderJsonReport } from '../src/reportSnapshot';
import { renderReportSnapshot, type ReportFile } from '../src/report';
import type { AnalyzeResult } from '../src/analyzer';

const dep = {
  name: 'example',
  spec: '^1.0.0',
  line: 3,
  section: 'dependencies',
  resolvedVersion: '1.5.0',
  baselineOrigin: {
    lockfile: '/repo/pnpm-lock.yaml',
    importer: 'packages/web',
    descriptor: '^1.0.0',
  },
};

function result(): AnalyzeResult {
  return {
    ecosystem: 'npm',
    dependencies: [dep],
    declarations: 1,
    updates: [{ dep, current: '1.5.0', latest: '2.0.0', kind: 'major', inRange: false }],
    statuses: [
      {
        dep,
        status: 'available',
        source: 'https://user:secret@registry.example/npm?token=secret',
        message: 'Exists',
      },
    ],
    audits: [
      {
        dep,
        version: '1.5.0',
        baseline: false,
        provider: 'osv',
        result: { status: 'unsupported' },
      },
    ],
    failures: new Map(),
    incomplete: false,
    runtimeVersions: { npm: '20.0.0' },
  };
}

test('JSON and Markdown use one deterministic snapshot with baseline provenance and matching counts', () => {
  const files: ReportFile[] = [
    {
      path: 'packages/web/package.json',
      workspace: 'repo',
      uri: 'file:///repo/packages/web/package.json',
      result: result(),
    },
  ];
  const snapshot = createReportSnapshot(files, ['repo'], new Date('2026-01-01T00:00:00Z'));
  const parsed = JSON.parse(renderJsonReport(snapshot));
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.summary.manifestsAnalyzed, 1);
  assert.equal(parsed.summary.outdatedDeclarations, 1);
  const item = parsed.files[0].declarations[0];
  assert.equal(item.line, 4);
  assert.equal(item.ecosystem, 'npm');
  assert.deepEqual(item.baseline, {
    version: '1.5.0',
    kind: 'lockfile',
    lockfile: 'pnpm-lock.yaml',
    importer: 'packages/web',
    descriptor: '^1.0.0',
  });
  assert.equal(item.source, 'https://registry.example/npm');
  assert.equal(item.audit.result.status, 'unsupported');
  const markdown = renderReportSnapshot(snapshot);
  assert.match(markdown, /Outdated declarations \| 1/);
  assert.match(markdown, /baseline: lockfile 1.5.0, pnpm-lock.yaml, importer packages\/web/);
  assert.match(markdown, /Runtime assumptions/);
  assert.doesNotMatch(renderJsonReport(snapshot), /secret|user:|file:\/\/|\/repo\//);
  assert.equal(
    renderJsonReport(snapshot),
    renderJsonReport(createReportSnapshot(files, ['repo'], new Date('2026-01-01T00:00:00Z')))
  );
});

test('snapshot preserves distinct declarations on the same line and serializes failures without Map loss', () => {
  const analysis = result();
  analysis.dependencies = [dep, { ...dep, section: 'devDependencies', ecosystem: 'python' }];
  analysis.declarations = 2;
  analysis.failures.set(
    'example',
    'Request https://user:pass@example.test/path?api_key=secret failed in /repo/packages/web'
  );
  analysis.policies = [
    {
      name: dep.name,
      line: dep.line,
      section: 'devDependencies',
      ignoreUpdates: true,
      prereleasePolicy: 'never',
    },
  ];
  const snapshot = createReportSnapshot(
    [
      {
        path: 'packages/web/package.json',
        uri: 'file:///repo/packages/web/package.json',
        result: analysis,
      },
    ],
    ['repo']
  );
  assert.equal(snapshot.files[0].declarations.length, 2);
  assert.equal(snapshot.files[0].declarations[1].policy?.ignoreUpdates, true);
  assert.equal(snapshot.files[0].declarations[1].ecosystem, 'python');
  assert.equal(snapshot.summary.incomplete, true);
  const json = renderJsonReport(snapshot);
  assert.doesNotMatch(json, /user:pass|api_key|secret|\/repo\//);
  assert.match(json, /failure/);
});

test('excluded directories do not fabricate contained-file counts or incomplete checks', () => {
  const snapshot = createReportSnapshot(
    [
      { path: 'fixtures', uri: 'file:///repo/fixtures', directory: true, excluded: 'fixtures' },
      { path: 'package.json', uri: 'file:///repo/package.json', excluded: 'package.json' },
    ],
    ['repo']
  );
  assert.equal(snapshot.summary.excludedDirectories, 1);
  assert.equal(snapshot.summary.excludedFiles, 1);
  assert.equal(snapshot.summary.manifestsAnalyzed, 0);
  assert.equal(snapshot.summary.incomplete, false);
  assert.match(snapshot.scope, /contained file count is unknown/);
});

test('same-line aliases retain distinct declaration identities in JSON', () => {
  const analysis = result();
  analysis.dependencies = [
    { ...dep, alias: 'first' },
    { ...dep, alias: 'second' },
  ];
  analysis.updates = [];
  analysis.statuses = [];
  analysis.audits = [];
  analysis.declarations = 2;
  const snapshot = createReportSnapshot(
    [{ path: 'package.json', uri: 'file:///repo/package.json', result: analysis }],
    ['repo']
  );
  assert.deepEqual(
    snapshot.files[0].declarations.map((entry) => entry.alias),
    ['first', 'second']
  );
  assert.equal(snapshot.files[0].declarations[0].declared, 'npm:example@^1.0.0');
});

test('pending, failed, unsupported and checked audits remain distinct', () => {
  for (const status of ['pending', 'unchecked', 'unsupported', 'failed', 'checked'] as const) {
    const analysis = result();
    analysis.audits[0].result =
      status === 'failed'
        ? { status, error: 'Unavailable' }
        : status === 'checked'
          ? { status, advisories: [] }
          : { status };
    const snapshot = createReportSnapshot(
      [{ path: 'package.json', uri: 'file:///repo/package.json', result: analysis }],
      ['repo']
    );
    assert.equal(snapshot.files[0].declarations[0].audit?.result.status, status);
    assert.equal(snapshot.summary.incomplete, ['pending', 'unchecked', 'failed'].includes(status));
  }
});
