const test = require('node:test');
const assert = require('node:assert');
const { parseNugetManifest } = require('../out/parsers/nuget');
const { compareNuget, nugetScheme } = require('../out/nuget');
const { computeUpdate } = require('../out/versions');

const summary = (deps) => deps.map((dep) => [dep.name, dep.spec, dep.section, dep.line]);
const opts = { includePrerelease: false, showSatisfyingUpdates: true, scheme: nugetScheme };

test('NuGet parser reads project package references and central versions', () => {
  const text = [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '  <ItemGroup>',
    '    <PackageReference Include="Newtonsoft.Json" Version="13.0.1" />',
    '    <PackageReference Include="Serilog">',
    '      <Version>[2.10.0,3.0.0)</Version>',
    '    </PackageReference>',
    '    <PackageVersion Include="FluentAssertions" Version="6.12.*" />',
    '    <PackageReference Include="FromProperty" Version="$(FromPropertyVersion)" />',
    '  </ItemGroup>',
    '</Project>',
  ].join('\n');

  assert.deepStrictEqual(summary(parseNugetManifest(text)), [
    ['Newtonsoft.Json', '13.0.1', 'PackageReference', 2],
    ['Serilog', '[2.10.0,3.0.0)', 'PackageReference', 3],
    ['FluentAssertions', '6.12.*', 'PackageVersion', 6],
  ]);
});

test('NuGet parser reads VersionOverride, Update, and packages.config', () => {
  const project = '<PackageReference Update="Xunit" Version="2.0.0" VersionOverride="2.8.1" />';
  assert.deepStrictEqual(summary(parseNugetManifest(project)), [['Xunit', '2.8.1', 'PackageReference', 0]]);

  const legacy = '<packages>\n  <package id="NUnit" version="3.13.3" targetFramework="net48" />\n</packages>';
  assert.deepStrictEqual(summary(parseNugetManifest(legacy)), [['NUnit', '[3.13.3]', 'packages', 1]]);
  assert.strictEqual(parseNugetManifest(legacy)[0].specRaw, '3.13.3');
});

test('NuGet versions support four-part versions and prerelease ordering', () => {
  assert.ok(compareNuget('1.2.3.4', '1.2.3') > 0);
  assert.ok(compareNuget('2.0.0-beta.10', '2.0.0-beta.2') > 0);
  assert.ok(compareNuget('2.0.0', '2.0.0-rc.1') > 0);
});

test('NuGet bare versions are inclusive minimums; brackets are exact', () => {
  assert.strictEqual(nugetScheme.baseline('2.10.0'), '2.10.0');
  assert.strictEqual(nugetScheme.isPinned('2.10.0'), false);
  assert.strictEqual(nugetScheme.isRange('2.10.0'), true);
  assert.strictEqual(nugetScheme.satisfies('2.9.0', '2.10.0', opts), false);
  assert.strictEqual(nugetScheme.satisfies('2.10.0', '2.10.0', opts), true);
  assert.strictEqual(nugetScheme.satisfies('3.1.0', '2.10.0', opts), true);
  assert.strictEqual(nugetScheme.isPinned('[2.10.0]'), true);
  assert.strictEqual(nugetScheme.satisfies('2.10.0', '[2.10.0]', opts), true);
  assert.strictEqual(nugetScheme.satisfies('3.1.0', '[2.10.0]', opts), false);
  for (const spec of ['(2.10.0)', '[2.10.0)', '(2.10.0]', '[]']) {
    assert.strictEqual(nugetScheme.isRange(spec), false, spec);
  }
});

test('NuGet project minimums and installed packages.config versions produce distinct updates', () => {
  const versions = { latest: '3.1.0', all: ['2.10.0', '2.12.0', '3.1.0'] };
  for (const tag of ['PackageReference', 'PackageVersion']) {
    const [dep] = parseNugetManifest(`<${tag} Include="Package" Version="2.10.0" />`);
    const update = computeUpdate(dep, versions, opts);
    assert.strictEqual(update.current, '2.10.0');
    assert.strictEqual(update.inRange, true);
  }
  for (const manifest of [
    '<PackageReference Include="Package" Version="[2.10.0]" />',
    '<packages><package id="Package" version=" 2.10.0 " /></packages>',
  ]) {
    const [dep] = parseNugetManifest(manifest);
    const update = computeUpdate(dep, versions, opts);
    assert.strictEqual(update.current, '2.10.0');
    assert.strictEqual(update.inRange, false);
    assert.strictEqual(update.satisfying, undefined);
    assert.strictEqual(nugetScheme.isPinned(dep.spec), true);
  }
});

test('NuGet interval and floating ranges report compatible updates', () => {
  const dep = (spec) => ({ name: 'Package', spec, section: 'PackageReference', line: 0 });
  const versions = { latest: '3.1.0', all: ['2.10.0', '2.12.0', '3.1.0'] };
  const ranged = computeUpdate(dep('[2.10.0,3.0.0)'), versions, opts);
  assert.strictEqual(ranged.inRange, false);
  assert.strictEqual(ranged.satisfying, '2.12.0');

  const floating = computeUpdate(dep('2.*'), versions, opts);
  assert.strictEqual(floating.satisfying, '2.12.0');
});
