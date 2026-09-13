import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, type AnalyzeRequest } from '../src/analyzer';
import { checkAvailability } from '../src/availability';
import { VersionCache } from '../src/cache';
import { AuditCache } from '../src/audit';
import { schemeFor, semverScheme } from '../src/schemes';
import type { DependencyRef, Ecosystem, RegistryVersions } from '../src/types';
import { createSettings } from './settings';
import { versionsOf } from '../src/registries/crates';
import { pubVersions } from '../src/registries/pub';
import { jsrVersions } from '../src/registries/jsr';
import { bazelVersions } from '../src/registries/bazel';
import { helmVersions } from '../src/registries/helm';
import { vcpkgVersions } from '../src/registries/vcpkg';
import { PyPiClient } from '../src/registries/pypi';
import { SwiftClient } from '../src/registries/swift';
import { RuntimeClient } from '../src/registries/runtime';
import { githubActionVersions, actionRuntimeVersions } from '../src/registries/githubActions';
import { dockerVersions } from '../src/registries/docker';
import { computeUpdate } from '../src/versions';
import { GoClient } from '../src/registries/go';
import { CondaClient } from '../src/registries/conda';
import { versionsFromMetadata } from '../src/registries/maven';
import { manifests } from '../src/manifests';

const releases = ['1.0.0', '2.0.0'];
const metadata = `<metadata><versioning><versions>${releases.map((v) => `<version>${v}</version>`).join('')}</versions></versioning></metadata>`;
const versions = releases.map((version) => ({ version }));
const baseline = 'a'.repeat(40);
const fixtures: { ecosystem: Ecosystem; file: string; text: string; body: unknown; raw?: boolean }[] = [
  { ecosystem: 'npm', file: 'package.json', text: '{"dependencies":{"pkg":"9.0.0"}}', body: { 'dist-tags': { latest: '2.0.0' }, versions: { '1.0.0': {}, '2.0.0': {} } } },
  { ecosystem: 'go', file: 'go.mod', text: 'module example.com/app\nrequire example.com/pkg v9.0.0', body: { Version: 'v2.0.0' } },
  { ecosystem: 'python', file: 'requirements.txt', text: 'pkg==9.0.0', body: { versions: releases, files: [] } },
  { ecosystem: 'rust', file: 'Cargo.toml', text: '[dependencies]\npkg = "=9.0.0"', body: { versions: releases.map((num) => ({ num })) } },
  { ecosystem: 'dotnet', file: 'app.csproj', text: '<Project><ItemGroup><PackageReference Include="Pkg" Version="[9.0.0]" /></ItemGroup></Project>', body: { versions: releases } },
  { ecosystem: 'java', file: 'pom.xml', text: '<project><dependencies><dependency><groupId>org.example</groupId><artifactId>pkg</artifactId><version>9.0.0</version></dependency></dependencies></project>', body: metadata, raw: true },
  { ecosystem: 'php', file: 'composer.json', text: '{"require":{"vendor/pkg":"9.0.0"}}', body: { packages: { 'vendor/pkg': versions } } },
  { ecosystem: 'dart', file: 'pubspec.yaml', text: 'dependencies:\n  pkg: "9.0.0"', body: { versions } },
  { ecosystem: 'gradle', file: 'build.gradle', text: 'dependencies { implementation("org.example:pkg:9.0.0") }', body: metadata, raw: true },
  { ecosystem: 'ruby', file: 'Gemfile', text: 'gem "pkg", "= 9.0.0"', body: releases.map((number) => ({ number })) },
  { ecosystem: 'terraform', file: 'main.tf', text: 'terraform { required_providers { pkg = { source = "hashicorp/pkg", version = "9.0.0" } } }', body: { versions } },
  { ecosystem: 'elixir', file: 'mix.exs', text: 'defp deps do\n[{:pkg, "9.0.0"}]\nend', body: { releases: versions } },
  { ecosystem: 'deno', file: 'deno.json', text: '{"imports":{"pkg":"jsr:@std/pkg@9.0.0"}}', body: { latest: '2.0.0', versions: { '1.0.0': {}, '2.0.0': {} } } },
  { ecosystem: 'githubActions', file: '.github/workflows/ci.yml', text: 'jobs:\n  build:\n    steps:\n      - uses: owner/pkg@v9', body: [{ name: 'v1' }, { name: 'v2' }] },
  { ecosystem: 'docker', file: 'Dockerfile', text: 'FROM pkg:9.0.0', body: { tags: releases } },
  { ecosystem: 'helm', file: 'Chart.yaml', text: 'dependencies:\n  - name: pkg\n    version: "9.0.0"\n    repository: https://charts.example', body: 'entries:\n  pkg:\n    - version: 1.0.0\n    - version: 2.0.0', raw: true },
  { ecosystem: 'swift', file: 'Package.swift', text: '.package(url: "https://github.com/owner/pkg.git", exact: "9.0.0")', body: releases.map((name) => ({ name })) },
  { ecosystem: 'conan', file: 'conanfile.txt', text: '[requires]\npkg/9.0.0', body: 'versions:\n  "1.0.0":\n    folder: all\n  "2.0.0":\n    folder: all', raw: true },
  { ecosystem: 'scala', file: 'build.sbt', text: 'libraryDependencies += "org.example" % "pkg" % "9.0.0"', body: metadata, raw: true },
  { ecosystem: 'conda', file: 'environment.yml', text: 'channels: [conda-forge]\ndependencies: ["pkg==9.0.0"]', body: { files: releases.map((version) => ({ version, attrs: { subdir: 'linux-64' } })) } },
  { ecosystem: 'clojure', file: 'deps.edn', text: '{:deps {org.example/pkg {:mvn/version "9.0.0"}}}', body: metadata, raw: true },
  { ecosystem: 'ansible', file: 'requirements.yml', text: 'collections: [{name: owner.pkg, version: "9.0.0"}]', body: { data: versions, links: { next: null } } },
  { ecosystem: 'bazel', file: 'MODULE.bazel', text: 'bazel_dep(name="pkg", version="9.0.0")', body: { versions: releases } },
  { ecosystem: 'vcpkg', file: 'vcpkg.json', text: JSON.stringify({ 'builtin-baseline': baseline, overrides: [{ name: 'pkg', 'version-semver': '9.0.0' }] }), body: { versions: releases.map((v) => ({ 'version-semver': v })) } },
];

for (const fixture of fixtures) {
  test(`${fixture.ecosystem} reports missing declarations and reuses availability evidence offline`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      calls++;
      if (fixture.ecosystem === 'npm' && url.endsWith('/latest')) return Response.json({ version: '2.0.0' });
      if (fixture.ecosystem === 'go' && url.endsWith('.info')) return new Response('', { status: 404 });
      if (fixture.ecosystem === 'dotnet' && url === 'https://api.nuget.org/v3/index.json') return Response.json({ resources: [{ '@id': 'https://nuget.example/flat', '@type': 'PackageBaseAddress/3.0.0' }] });
      if (fixture.ecosystem === 'docker' && url.startsWith('https://auth.docker.io')) return Response.json({ token: 'test' });
      return fixture.raw ? new Response(fixture.body as string) : Response.json(fixture.body);
    });
    const request: AnalyzeRequest = {
      fsPath: `/project/${fixture.file}`, text: fixture.text,
      settings: createSettings({ go: { proxy: 'https://proxy.example', checkMajorVersions: false }, conda: { subdir: 'linux-64' } }),
      cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: false,
    };
    assert.equal((await analyze(request))?.incomplete, true);
    assert.equal(calls, 0);
    const result = await analyze({ ...request, allowNetwork: true });
    assert.equal(result?.statuses?.length, 1, JSON.stringify(result));
    assert.equal(result?.statuses?.[0].status, 'version-missing', JSON.stringify(result?.statuses));
    assert.equal(result?.incomplete, false);
    const count = calls;
    assert.deepEqual((await analyze(request))?.statuses, result?.statuses);
    assert.equal(calls, count);
  });
}

test('every supported ecosystem has an end-to-end availability fixture', () => {
  assert.deepEqual(new Set(fixtures.map((fixture) => fixture.ecosystem)), new Set(manifests.map((manifest) => manifest.ecosystem)));
});

const dep: DependencyRef = { name: 'pkg', spec: '3.0.0', section: 'dependencies', line: 0 };
const opts = { scheme: semverScheme, includePrerelease: false, showSatisfyingUpdates: true };

test('yanked, retracted, and removed metadata remains existence evidence, not an update target', () => {
  const examples: [Ecosystem, RegistryVersions, string][] = [
    ['rust', versionsOf({ versions: [{ num: '1.0.0' }, { num: '3.0.0', yanked: true }] }), '=3.0.0'],
    ['dart', pubVersions({ versions: [{ version: '1.0.0' }, { version: '3.0.0', retracted: true }] }), '3.0.0'],
    ['deno', jsrVersions({ versions: { '1.0.0': {}, '3.0.0': { yanked: true } } }), '3.0.0'],
    ['bazel', bazelVersions({ versions: ['1.0.0', '3.0.0'], yanked_versions: { '3.0.0': 'broken' } }), '3.0.0'],
    ['helm', helmVersions('entries:\n  pkg:\n    - version: 1.0.0\n    - version: 3.0.0\n      removed: true', 'pkg'), '3.0.0'],
  ];
  for (const [ecosystem, versions, spec] of examples) {
    const options = { ...opts, scheme: schemeFor(ecosystem) };
    assert.equal(checkAvailability({ ...dep, spec }, versions, options).status, 'ahead', ecosystem);
    assert.equal(versions.latest, '1.0.0');
    assert.ok(!versions.all?.includes('3.0.0'));
    assert.equal(computeUpdate({ ...dep, spec }, versions, options), undefined);
  }
});

test('Python and Swift retain withdrawn releases for existence checks', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(url.includes('/simple/')
    ? { versions: ['1.0.0', '3.0.0'], files: [{ filename: 'pkg-1.0.0.tar.gz' }, { filename: 'pkg-3.0.0.tar.gz', yanked: true }] }
    : { releases: { '1.0.0': {}, '3.0.0': { problem: { status: 410 } } } }));
  const python = await new PyPiClient({ indexOverride: 'https://index.example/simple', timeoutMs: 1000 }).fetchVersions('pkg');
  assert.equal(checkAvailability({ ...dep, spec: '==3.0.0' }, python, { ...opts, scheme: schemeFor('python') }).status, 'ahead');
  const swift = await new SwiftClient(1000).fetchVersions('owner.pkg', 'https://swift.example');
  assert.equal(checkAvailability(dep, swift, opts).status, 'ahead');
});

test('tag precision, suffixes, and matrix selectors are checked independently', () => {
  const actionOpts = { ...opts, scheme: schemeFor('githubActions') };
  const tags = githubActionVersions(['v1.0.0', 'v2.0.0'], 'v1');
  assert.equal(checkAvailability({ ...dep, spec: 'v1' }, tags, actionOpts).status, 'version-missing');
  const docker = dockerVersions(['1.0.0-alpine', '3.0.0-bookworm'], '3.0.0-alpine');
  assert.equal(checkAvailability({ ...dep, spec: '3.0.0-alpine' }, docker, { ...opts, scheme: schemeFor('docker') }).status, 'version-missing');
  const runtime = actionRuntimeVersions(['20.19.5', '22.18.0'], '0.0.0');
  const matrix = { ...dep, actionRuntime: 'node' as const, matrixVersions: ['20', '22.18.0', '99'] };
  const result = checkAvailability(matrix, runtime, actionOpts);
  assert.equal(result.status, 'version-missing');
  assert.match(result.message, /99/);
  assert.ok(!result.message.includes('20,'));
  assert.equal(checkAvailability({ ...matrix, matrixVersions: ['20', '22.18.0'] }, runtime, actionOpts).status, 'available');
});

test('vcpkg validates minimum entries and baselines without crossing version schemes', () => {
  const versions = vcpkgVersions({ versions: [{ version: '1.0.0' }, { version: '2.0.0' }] }, '>=1.5.0');
  assert.equal(checkAvailability({ ...dep, spec: '>=1.5.0' }, versions, { ...opts, scheme: schemeFor('vcpkg') }).status, 'version-missing');
  const resolved = { ...vcpkgVersions({ versions: [{ version: '1.0.0' }] }, '>=1.0.0'), baseline: '1.0.0' };
  assert.equal(checkAvailability({ ...dep, spec: '@baseline' }, resolved, { ...opts, scheme: schemeFor('vcpkg') }).status, 'available');
});

test('runtime manifests validate pins while retaining broken or prerelease existence evidence', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(url.includes('gradle')
    ? [{ version: '8.0' }, { version: '9.0', broken: true }]
    : [{ version: 'go1.23.0', stable: true }, { version: 'go1.24rc1', stable: false }]));
  const client = new RuntimeClient(1000);
  const gradle = await client.fetch('gradle');
  assert.equal(checkAvailability({ ...dep, spec: '9.0.0' }, gradle, opts).status, 'ahead');
  const go = await client.fetch('go');
  assert.equal(checkAvailability({ ...dep, spec: '1.24.0-rc.1' }, go, opts).status, 'ahead');
});

test('Go validates pseudo-versions in their own module path and caches each declaration independently', async (t) => {
  const pseudo = 'v1.3.0-0.20260901000000-abcdef123456';
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    if (url.endsWith(`${pseudo}.info`)) return Response.json({ Version: pseudo });
    if (url.endsWith('.info')) return new Response('', { status: 404 });
    if (url.endsWith('/pkg/@latest')) return Response.json({ Version: 'v1.2.0' });
    if (url.endsWith('/pkg/v2/@latest')) return Response.json({ Version: 'v2.0.0' });
    return new Response('', { status: 404 });
  });
  const request: AnalyzeRequest = {
    fsPath: '/project/go.mod', text: `module example.com/app\nrequire (\nexample.com/pkg ${pseudo}\nexample.com/pkg v1.1.1\n)`,
    settings: createSettings({ go: { proxy: 'https://proxy.example', checkMajorVersions: true } }),
    cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true,
  };
  const result = await analyze(request);
  assert.deepEqual(result?.statuses?.map((s) => [s.dep.spec, s.status, s.latest]), [
    [pseudo, 'ahead', '1.2.0'], ['v1.1.1', 'version-missing', '1.2.0'],
  ]);
  assert.equal(result?.updates.length, 2);
  assert.ok(result?.updates.every((update) => update.latest === '2.0.0' && update.alternatePath === 'example.com/pkg/v2'));
  const count = calls.length;
  assert.deepEqual((await analyze({ ...request, allowNetwork: false }))?.statuses, result?.statuses);
  assert.equal(calls.length, count);
  assert.equal(calls.filter((url) => url.endsWith('.info')).length, 2);
});

test('Go availability probes honor proxy exclusions before making a request', async (t) => {
  const original = process.env.GONOPROXY;
  process.env.GONOPROXY = 'private.example/*';
  t.after(() => { if (original === undefined) delete process.env.GONOPROXY; else process.env.GONOPROXY = original; });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
  const client = new GoClient({ proxyOverride: 'https://proxy.example', checkMajorVersions: false, timeoutMs: 1000 });
  assert.match((await client.fetchAvailability('private.example/pkg', '1.0.0')).error!, /excluded/);
});

test('Deno npm and JSR declarations both receive availability statuses', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(url.endsWith('/latest')
    ? { version: '1.0.0' } : { latest: '1.0.0', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} } }));
  const result = await analyze({ fsPath: '/project/deno.json',
    text: '{"imports":{"a":"npm:pkg@9.0.0","b":"jsr:@std/pkg@9.0.0"}}', settings: createSettings(),
    cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true });
  assert.deepEqual(result?.statuses?.map((s) => [s.dep.name, s.status]).sort(), [
    ['jsr:@std/pkg', 'version-missing'], ['npm:pkg', 'version-missing'],
  ]);
});

test('ecosystem-specific ranges do not require their lower bounds to exist', () => {
  const cases: [Ecosystem, string][] = [
    ['npm', '^1.0.0'], ['rust', '1.0.0'], ['python', '>=1.0.0,<2.0.0'], ['dotnet', '1.0.0'],
    ['java', '[1.0.0,2.0.0)'], ['gradle', '[1.0.0,2.0.0)'], ['scala', '[1.0.0,2.0.0)'], ['clojure', '[1.0.0,2.0.0)'],
    ['php', '^1.0.0'], ['dart', '^1.0.0'], ['ruby', '~> 1.0'], ['terraform', '~> 1.0'], ['elixir', '~> 1.0'],
    ['deno', '^1.0.0'], ['helm', '^1.0.0'], ['swift', '^1.0.0'], ['conan', '>=1.0.0 <2.0.0'],
    ['conda', '>=1.0.0,<2.0.0'], ['ansible', '>=1.0.0,<2.0.0'],
  ];
  for (const [ecosystem, spec] of cases) {
    const options = { ...opts, scheme: schemeFor(ecosystem) };
    const declaration = { ...dep, spec };
    assert.equal(checkAvailability(declaration, { all: ['1.5.0'], allComplete: true }, options).status, 'available', ecosystem);
    assert.equal(checkAvailability(declaration, { all: ['0.5.0'], allComplete: true }, options).status, 'range-missing', ecosystem);
  }
});

test('partial metadata cannot prove a missing version', async (t) => {
  for (const [ecosystem, versions] of [
    ['rust', versionsOf({ versions: [{ num: '1.0.0' }, {}] })],
    ['dart', pubVersions({ versions: [{ version: '1.0.0' }, {}] })],
    ['bazel', bazelVersions({ versions: ['1.0.0', null] })],
    ['java', versionsFromMetadata('<metadata><release>1.0.0</release></metadata>')],
  ] as [Ecosystem, RegistryVersions][]) {
    const spec = ecosystem === 'rust' ? '=3.0.0' : '3.0.0';
    assert.equal(checkAvailability({ ...dep, spec }, versions, { ...opts, scheme: schemeFor(ecosystem) }).status, 'unknown', ecosystem);
  }
  t.mock.method(globalThis, 'fetch', async (url: string) => url.includes('/noarch/') ? new Response('', { status: 404 })
    : Response.json({ packages: { pkg: { name: 'pkg', version: '1.0.0' } } }));
  const conda = await new CondaClient(1000, 'linux-64').fetchVersions('pkg', 'https://conda.example');
  assert.equal(conda.allComplete, false);
  assert.equal(checkAvailability({ ...dep, spec: '==3.0.0' }, conda, { ...opts, scheme: schemeFor('conda') }).status, 'unknown');
});

test('short Bitbucket pages with a next link are not treated as complete', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    return Response.json(url.endsWith('page=1') ? { values: [{ name: '1.0.0' }], next: 'https://api.bitbucket.org/2.0/repositories/owner/pkg/refs/tags?pagelen=100&page=2' }
      : { values: [{ name: '3.0.0' }] });
  });
  const result = await new SwiftClient(1000).fetchVersions('owner/pkg', 'bitbucket.org');
  assert.equal(calls.length, 2);
  assert.equal(checkAvailability(dep, result, opts).status, 'available');
});

for (const ecosystem of ['gradle', 'bazel'] as const) {
  test(`${ecosystem} checks other configured sources before reporting a missing pin`, async (t) => {
    let unavailable = false;
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      const second = url.startsWith('https://second.example');
      if (second && unavailable) throw new Error('Source unavailable');
      const available = second ? ['3.0.0'] : ['1.0.0'];
      return ecosystem === 'bazel' ? Response.json({ versions: available })
        : new Response(`<metadata><versions>${available.map((v) => `<version>${v}</version>`).join('')}</versions></metadata>`);
    });
    // Bazel source routing also occurs through the public Lookup interface.
    const { lookupFor } = await import('../src/analyzer');
    const settings = createSettings({ gradle: { repositories: ['https://first.example', 'https://second.example'] } });
    const lookup = lookupFor(ecosystem, '/project/build.gradle', settings)!;
    const declaration = { ...dep, name: ecosystem === 'bazel' ? 'pkg' : 'org.example:pkg',
      ...(ecosystem === 'bazel' ? { source: 'https://first.example|https://second.example' } : {}) };
    const known = await lookup.fetch(declaration);
    assert.equal(checkAvailability(declaration, known, { ...opts, scheme: schemeFor(ecosystem) }).status, 'version-missing');
    const evidence = await lookup.fetchAvailability!(declaration, known);
    assert.equal(checkAvailability(declaration, { ...known, ...evidence }, { ...opts, scheme: schemeFor(ecosystem) }).status, 'ahead');
    unavailable = true;
    const partial = await lookup.fetchAvailability!(declaration, known);
    assert.equal(checkAvailability(declaration, { ...known, ...partial }, { ...opts, scheme: schemeFor(ecosystem) }).status, 'unknown');
  });
}
