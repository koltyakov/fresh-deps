import test from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import type { AnalyzeResult } from '../src/analyzer';
import { renderReport } from '../src/report';

function result(): AnalyzeResult {
  return { ecosystem: 'npm', declarations: 2, incomplete: false, failures: new Map(), audits: [],
    updates: [{ dep: { name: 'example', spec: '^1.0.0', line: 3, section: 'dependencies' },
      current: '1.0.0', latest: '2.0.0', kind: 'major', inRange: false, sameMajor: '1.9.0', satisfying: '1.9.0' }] };
}

test('report counts declarations across files and preserves update baselines and locations', () => {
  const report = renderReport([
    { path: 'root/package.json', uri: 'file:///root/package.json', result: result() },
    { path: 'root/app/package.json', uri: 'file:///root/app/package.json', result: result() },
  ], ['root'], new Date('2026-01-01T00:00:00Z'));
  assert.match(report, /Manifests analyzed \| 2/);
  assert.match(report, /Declarations found \| 4/);
  assert.match(report, /Outdated declarations \| 2/);
  assert.match(report, /major updates \| 2/);
  assert.ok(report.includes('[example](vscode://file/root/app/package.json:4 "root/app/package.json:4")'));
  assert.ok(report.includes('| ^1.0.0 | 1.9.0 | 2.0.0 |'));
});

test('empty and failed checks never claim all dependencies are up to date', () => {
  const analysis = result();
  analysis.updates = [];
  analysis.failures.set('example', 'registry unavailable');
  analysis.skipped = [{ name: 'local', line: 0, reason: 'local source' }];
  const report = renderReport([
    { path: 'package.json', uri: 'file:///package.json', result: analysis },
    { path: 'Cargo.toml', uri: 'file:///Cargo.toml', error: 'Permission denied' },
  ], ['root']);
  assert.match(report, /Some checks were incomplete/);
  assert.match(report, /No updates found among checked declarations/);
  assert.match(report, /registry unavailable/);
  assert.match(report, /Line 1, local: skipped, local source/);
  assert.match(report, /Permission denied/);
  assert.doesNotMatch(report, /up to date/);
});

test('manifest names and registry messages cannot inject Markdown links, HTML, or table rows', () => {
  const analysis = result();
  analysis.updates[0].dep.name = '<img src=x>|[run](command:bad)\n# injected';
  analysis.failures.set('example', '[run](command:bad)<script>');
  const report = renderReport([{ path: '# heading', uri: 'file:///package.json', result: analysis }], ['root']);
  assert.doesNotMatch(report, /<img|<script>|\[run\]\(command:bad\)|\n# injected/);
  assert.ok(report.includes('&lt;img src=x&gt;\\|'));
});

test('hides current and skipped declarations while retaining failed checks as warnings', () => {
  const dependencies = [
    { name: 'current', spec: '1.0.0', line: 1, section: 'dependencies' },
    { name: 'local', spec: 'workspace:*', line: 2, section: 'devDependencies', skipReason: 'local source' },
    { name: 'failed', spec: '^2.0.0', line: 3, section: 'optionalDependencies' },
  ];
  const analysis: AnalyzeResult = { ecosystem: 'npm', dependencies, declarations: 3, updates: [],
    incomplete: false, failures: new Map([['failed', 'offline']]),
    skipped: [{ name: 'local', line: 2, reason: 'local source' }],
    audits: [{ dep: dependencies[0], baseline: false, result: { status: 'unsupported' } },
      { dep: dependencies[2], baseline: true, result: { status: 'failed', error: 'offline' } }] };
  const report = renderReport([{ path: 'apps/web/package.json', uri: 'file:///apps/web/package.json', result: analysis }], ['root']);
  assert.match(report, /### \[apps\/web\/package.json\]/);
  assert.doesNotMatch(report, /\| dependencies \| \[current\]/);
  assert.doesNotMatch(report, /\| devDependencies \| \[local\]/);
  assert.match(report, /\| optionalDependencies \| \[failed\].*\| Failed: offline \|/);
  assert.doesNotMatch(report, /Excluded patterns/);
  analysis.audits = [];
  const disabled = renderReport([{ path: 'package.json', uri: 'file:///package.json', result: analysis }], ['root']);
  assert.doesNotMatch(disabled, /Audit warning|\| Disabled \||\| Unsupported \|/);
});

test('omits empty and clean manifest sections and retains advisory-only dependencies', () => {
  const clean: AnalyzeResult = { ecosystem: 'npm', dependencies: [{ name: 'clean', spec: '1.0.0', line: 0, section: 'dependencies' }],
    declarations: 1, updates: [], audits: [], failures: new Map(), incomplete: false };
  const vulnerable: AnalyzeResult = { ...clean, audits: [{ dep: clean.dependencies![0], baseline: false,
    result: { status: 'checked', advisories: [{ id: 'TEST-1', title: 'Fix needed', severity: 'high' }] } }] };
  const report = renderReport([
    { path: 'clean/package.json', uri: 'file:///clean/package.json', result: clean },
    { path: 'empty/package.json', uri: 'file:///empty/package.json', result: { ...clean, dependencies: [], declarations: 0 } },
    { path: 'vulnerable/package.json', uri: 'file:///vulnerable/package.json', result: vulnerable },
  ], ['root']);
  assert.doesNotMatch(report, /clean\/package.json|empty\/package.json|No supported dependency declarations/);
  assert.match(report, /\| dependencies \| \[clean\].*\| 1.0.0 \| - \| - \| high: TEST-1 Fix needed \|/);
});

test('audit column is omitted for unsupported ecosystems and unsupported mixed rows stay blank', () => {
  const actions = result();
  actions.ecosystem = 'githubActions';
  actions.audits = [{ dep: actions.updates[0].dep, baseline: false, result: { status: 'unsupported' } }];
  const report = renderReport([{ path: '.github/workflows/build.yml', uri: 'file:///root/.github/workflows/build.yml', result: actions }], ['root']);
  assert.match(report, /\| Type \| Name \| Version \| Minor\/patch \| Major \|\n/);
  assert.doesNotMatch(report, /Audit warning|Unsupported/);
  const mixed = result();
  const dep = { name: 'audited', spec: '1.0.0', section: 'dependencies', line: 9 };
  mixed.audits = [...actions.audits, { dep, baseline: false, result: { status: 'checked', advisories: [{ id: 'TEST', title: 'Warning' }] } }];
  const mixedReport = renderReport([{ path: 'package.json', uri: 'file:///root/package.json', result: mixed }], ['root']);
  assert.match(mixedReport, /Major \| Audit warning/);
  assert.match(mixedReport, /\| dependencies \| \[example\].*\| 1.9.0 \| 2.0.0 \|  \|/);
  assert.doesNotMatch(mixedReport, /Unsupported/);
});

test('Markdown preview renders file headings and declaration links, including encoded paths', () => {
  const md = new MarkdownIt({ html: true });
  // This is the default validator used by VS Code's Markdown preview too.
  assert.equal(md.validateLink('file:///root/package.json'), false);
  const report = renderReport([{ path: 'a b/(app)/package.json',
    uri: 'file:///root/a%20b/(app)/package.json', result: result() }], ['root']);
  const html = md.render(report);
  assert.ok(html.includes('<a href="vscode://file/root/a%20b/%28app%29/package.json" title="a b/(app)/package.json">a b/(app)/package.json</a>'));
  assert.ok(html.includes('<a href="vscode://file/root/a%20b/%28app%29/package.json:4" title="a b/(app)/package.json:4">example</a>'));
  assert.ok(html.includes('<th>Minor/patch</th>'));
  assert.doesNotMatch(html, /\[example\]|file:\/\/\/|&lt;file:/);
});
