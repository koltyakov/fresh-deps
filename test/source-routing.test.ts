import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { analyze, manifestOf } from '../src/analyzer';
import { VersionCache } from '../src/cache';
import { AuditCache } from '../src/audit';
import { createSettings } from './settings';
import { PyPiClient } from '../src/registries/pypi';
import { HelmClient } from '../src/registries/helm';
import { CratesClient } from '../src/registries/crates';
import { TerraformClient } from '../src/registries/terraform';
import { VcpkgClient } from '../src/registries/vcpkg';
import { parseVcpkgProject } from '../src/parsers/vcpkgProject';
import { cargoProject, nugetProject } from '../src/projectSources';
import { parseCargoToml } from '../src/parsers/cargoToml';
import { parseNugetManifest } from '../src/parsers/nuget';
import { parseBazelProject } from '../src/parsers/bazelProject';
import { parseGradleCatalog } from '../src/parsers/gradleCatalog';
import { parseGithubActions } from '../src/parsers/githubActions';
import { parseGemfile } from '../src/parsers/gemfile';
import { computeUpdate } from '../src/versions';
import { schemeFor } from '../src/schemes';
import { applyLockfile } from '../src/lockfiles';
import { githubTags } from '../src/registries/github';
import { GithubActionsClient } from '../src/registries/githubActions';
import { OciClient } from '../src/registries/oci';
import { fetchJson } from '../src/http';
import { goEnv } from '../src/goenv';
import { manifests, manifestSelectors } from '../src/manifests';
import { matchesGlob } from 'node:path';
import { parseSbt } from '../src/parsers/scala';
import { conanScheme } from '../src/conan';
import { parseConan } from '../src/parsers/conan';
import { parseComposerJson } from '../src/parsers/composerJson';
import { PackagistClient } from '../src/registries/packagist';
import { SwiftClient } from '../src/registries/swift';
import { parseSwift } from '../src/parsers/swift';
import { DockerClient } from '../src/registries/docker';
import { imageDependency } from '../src/parsers/docker';
import { AnsibleClient } from '../src/registries/ansible';

function project(t: TestContext, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'fresh-deps-sources-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const file = join(root, name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content);
  }
  return root;
}
const dep = { name: 'example', spec: '^1.0.0', line: 0, section: 'dependencies' };
const request = (file: string, text: string) => ({ fsPath: file, text, settings: createSettings(), cache: new VersionCache(60000), auditCache: new AuditCache(), allowNetwork: true });

test('Python analysis skips workspace sources without a version or audit request', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('No request allowed'); });
  const result = await analyze({ ...request('/virtual/pyproject.toml', '[project]\ndependencies = ["example==1.0"]\n[tool.uv.sources]\nexample = { workspace = true }'), settings: createSettings({ auditEnabled: true }) });
  assert.equal(result?.skipped?.length, 1); assert.equal(result?.audits.length, 0); assert.equal(result?.failures.size, 0);
});

test('Python project indexes route both package lookup and audit policy to the selected source', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => { calls.push(url); return Response.json({ versions: ['1.0', '2.0'] }); });
  const text = '[project]\ndependencies = ["example==1.0"]\n[tool.uv.sources]\nexample = { index = "private" }\n[[tool.uv.index]]\nname = "private"\nurl = "https://private.example/simple"';
  const result = await analyze({ ...request('/virtual/pyproject.toml', text), settings: createSettings({ auditEnabled: true }) });
  assert.deepEqual(calls, ['https://private.example/simple/example/']);
  assert.equal(result?.audits[0].result.status, 'unsupported'); assert.equal(result?.updates[0].latest, '2.0');
});

test('HTML Python indexes preserve yanks and interpreter requirements', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<a href="one" data-requires-python="&gt;=3.10">example-1.0.tar.gz</a><a href="two" data-yanked="broken">example-2.0.tar.gz</a>', { headers: { 'content-type': 'text/html' } }));
  const result = await new PyPiClient({ indexOverride: 'https://html.example/simple', timeoutMs: 1000 }).fetchVersions('example');
  assert.equal(result.latest, '1.0'); assert.deepEqual(result.requirements?.['1.0'], ['>=3.10']);
});

test('Python compatibility reports an older installable release alongside latest', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ versions: ['1.0', '1.5', '2.0'], files: [
    { filename: 'example-1.0.tar.gz', 'requires-python': '>=3.8' }, { filename: 'example-1.5.tar.gz', 'requires-python': '>=3.8' }, { filename: 'example-2.0.tar.gz', 'requires-python': '>=3.12' },
  ] }));
  const result = await analyze({ ...request('/virtual/requirements.txt', 'example>=1.0'), settings: createSettings({ runtimeVersions: { python: '3.11.0' } }) });
  assert.equal(result?.updates[0].latest, '2.0'); assert.equal(result?.updates[0].compatible, '1.5');
});

test('Cargo workspace inheritance preserves the actual crate name and sparse source replacement', (t) => {
  const root = project(t, { 'Cargo.toml': '[workspace.dependencies]\njson = { package = "serde_json", version = "1.0" }', '.cargo/config.toml': '[source.crates-io]\nreplace-with = "mirror"\n[source.mirror]\nregistry = "sparse+https://mirror.example/index/"' });
  const text = '[dependencies]\njson = { workspace = true }';
  const deps = cargoProject(join(root, 'member/Cargo.toml'), text, parseCargoToml(text));
  assert.equal(deps[0].name, 'serde_json'); assert.equal(deps[0].line, 1); assert.equal(deps[0].source, 'sparse+https://mirror.example/index/');
});

test('Sparse Cargo registries use crate-index paths and exclude yanked releases', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, 'https://mirror.example/index/se/rd/serde');
    return new Response('{"vers":"1.0.0","rust_version":"1.60"}\n{"vers":"2.0.0","yanked":true}');
  });
  const result = await new CratesClient(1000).fetchVersions('serde', 'sparse+https://mirror.example/index/');
  assert.equal(result.latest, '1.0.0'); assert.deepEqual(result.requirements?.['1.0.0'], ['1.60']);
});

test('NuGet source mapping chooses the most specific package pattern', (t) => {
  const root = project(t, { 'NuGet.Config': '<configuration><packageSources><clear/><add key="public" value="https://api.nuget.org/v3/index.json"/><add key="private" value="https://private.example/v3/index.json"/></packageSources><packageSourceMapping><packageSource key="public"><package pattern="*"/></packageSource><packageSource key="private"><package pattern="Company.*"/></packageSource></packageSourceMapping></configuration>' });
  const deps = nugetProject(join(root, 'app.csproj'), [{ ...dep, name: 'Company.Core' }, dep]);
  assert.equal(deps[0].source, 'https://private.example/v3/index.json'); assert.equal(deps[1].source, 'https://api.nuget.org/v3/index.json');
  assert.equal(parseNugetManifest('<Project><PropertyGroup><Pin>1.2.3</Pin></PropertyGroup><ItemGroup><PackageReference Include="Example" Version="$(Pin)"/></ItemGroup></Project>')[0].spec, '1.2.3');
});

test('clearing NuGet sources does not silently restore the public feed', (t) => {
  const root = project(t, { 'NuGet.Config': '<configuration><packageSources><clear/></packageSources></configuration>' });
  assert.match(nugetProject(join(root, 'app.csproj'), [dep])[0].skipReason!, /No supported NuGet/);
});

test('Gradle rich constraints enforce strict bounds and rejected versions', () => {
  const [dep] = parseGradleCatalog('[libraries]\nexample = { module = "org.example:core", version = { strictly = "[1.0,2.0[", prefer = "1.1", reject = ["1.9"] } }');
  const update = computeUpdate(dep, { latest: '2.0', all: ['1.1', '1.8', '1.9', '2.0'] }, { scheme: dep.versionScheme!, includePrerelease: false, showSatisfyingUpdates: true });
  assert.equal(update?.current, '1.1'); assert.equal(update?.satisfying, '1.8'); assert.equal(update?.inRange, false);
  assert.deepEqual(parseGradleCatalog('[libraries]\nexample = { module = "org.example:core", version = { require = "1.0", reject = ["1.+"] } }'), []);
});

test('Bazel literal includes apply overrides across files while retaining root anchors', (t) => {
  const root = project(t, { 'more.MODULE.bazel': 'bazel_dep(name="rules_cc", version="1.0")\nlocal_path_override(module_name="rules_go", path="local")' });
  const deps = parseBazelProject('bazel_dep(name="rules_go", version="1.0")\ninclude("//:more.MODULE.bazel")', join(root, 'MODULE.bazel'));
  assert.deepEqual(deps.map(({ name, line }) => [name, line]), [['rules_cc', 1]]);
});

test('vcpkg bare dependencies resolve the selected builtin baseline', async (t) => {
  const baseline = 'a'.repeat(40);
  t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(url.includes('baseline.json')
    ? { default: { fmt: { baseline: '1.0.0', 'port-version': 1 } } }
    : { versions: [{ 'version-semver': '1.0.0', 'port-version': 1 }, { 'version-semver': '2.0.0' }] }));
  const versions = await new VcpkgClient(1000).fetchVersions('fmt', '@baseline', undefined, baseline);
  const update = computeUpdate({ ...dep, name: 'fmt', spec: '@baseline' }, versions, { scheme: schemeFor('vcpkg'), includePrerelease: false, showSatisfyingUpdates: true });
  assert.equal(update?.current, '1.0.0#1'); assert.equal(update?.latest, '2.0.0');
});

test('vcpkg filesystem registries preserve source identity and resolve local metadata', async (t) => {
  const root = project(t, { 'registry/versions/baseline.json': '{"default":{"fmt":{"baseline":"1.0.0","port-version":0}}}',
    'registry/versions/f-/fmt.json': '{"versions":[{"version-semver":"1.0.0"},{"version-semver":"2.0.0"}]}' });
  const text = JSON.stringify({ 'vcpkg-configuration': { 'default-registry': { kind: 'filesystem', path: 'registry' } }, dependencies: ['fmt'] }, null, 2);
  const [dep] = parseVcpkgProject(text, join(root, 'vcpkg.json'));
  assert.equal(text.split('\n')[dep.line].trim(), '"fmt"');
  const result = await new VcpkgClient(1000).fetchVersions(dep.name, dep.spec, undefined, dep.source);
  assert.equal(result.latest, '2.0.0'); assert.equal(result.baseline, '1.0.0');
});

test('Terraform discovers custom provider services instead of querying a public registry', async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => { urls.push(url); return Response.json(url.includes('.well-known') ? { 'providers.v1': '/providers/' } : { versions: [{ version: '1.0.0' }] }); });
  assert.equal((await new TerraformClient(1000).fetchVersions('private.example/acme/core')).latest, '1.0.0');
  assert.deepEqual(urls, ['https://private.example/.well-known/terraform.json', 'https://private.example/providers/acme/core/versions']);
});

test('Helm OCI maps build metadata tags back to semver', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string) => { assert.equal(url, 'https://registry.example/v2/charts/example/tags/list?n=1000'); return Response.json({ tags: ['1.0.0', '2.0.0_build.1', 'latest'] }); });
  assert.equal((await new HelmClient(1000).fetchVersions('example', 'oci://registry.example/charts')).latest, '2.0.0+build.1');
});

test('OCI refuses pagination to another origin', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ tags: ['1'] }, { headers: { link: '<https://other.example/v2/x/tags/list>; rel="next"' } }));
  await assert.rejects(new OciClient(1000).tags('registry.example', 'x'), /Unexpected OCI/);
});

test('GitHub conditional tag requests reuse a 304 response and optional credentials', async (t) => {
  const previous = process.env.FRESH_DEPS_GITHUB_TOKEN; process.env.FRESH_DEPS_GITHUB_TOKEN = 'test-token';
  t.after(() => { if (previous === undefined) delete process.env.FRESH_DEPS_GITHUB_TOKEN; else process.env.FRESH_DEPS_GITHUB_TOKEN = previous; });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    assert.equal((options.headers as Record<string, string>).authorization, 'Bearer test-token');
    if (++calls === 1) return Response.json([{ name: 'v1' }], { headers: { etag: '"example"' } });
    assert.equal((options.headers as Record<string, string>)['if-none-match'], '"example"');
    return new Response(null, { status: 304 });
  });
  assert.deepEqual(await githubTags('unique/conditional', 1000), ['v1']); assert.deepEqual(await githubTags('unique/conditional', 1000), ['v1']);
});

test('GitHub SHA release comments must match the actual tag commit', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ object: { type: 'commit', sha: 'b'.repeat(40) } }));
  assert.match((await new GithubActionsClient(1000).fetchVersions('org/action', 'v1', 'a'.repeat(40))).error!, /does not match/);
});

test('GitHub setup inputs resolve literal matrix values and version files', () => {
  const text = 'jobs:\n  test:\n    strategy:\n      matrix:\n        node: [18, 20]\n    steps:\n      - uses: actions/setup-node@main\n        with:\n          node-version: ${{ matrix.node }}\n      - uses: actions/setup-go@main\n        with:\n          go-version-file: go.mod';
  const deps = parseGithubActions(text, () => 'module test\ngo 1.22.0');
  assert.deepEqual(deps.map(({ name, spec, line }) => [name, spec, line]), [['node', '18', 4], ['node', '20', 4], ['go', '1.22.0', 11]]);
});

test('Ruby custom source blocks do not suppress unrelated public gems', () => {
  const deps = parseGemfile('source "https://rubygems.org"\nsource "https://gems.example" do\n gem "internal", "1.0"\nend\ngem "rails", "7.0"');
  assert.equal(deps[0].source, 'https://gems.example'); assert.equal(deps[1].source, undefined);
});

test('lockfiles use direct npm selections and decline conflicting Python versions', (t) => {
  const root = project(t, { 'package-lock.json': '{"packages":{"node_modules/example":{"version":"1.5.0"},"node_modules/other/node_modules/example":{"version":"2.0.0"}}}',
    'uv.lock': '[[package]]\nname="example"\nversion="1.0"\n[[package]]\nname="example"\nversion="2.0"' });
  assert.equal(applyLockfile(join(root, 'package.json'), 'npm', [dep])[0].resolvedVersion, '1.5.0');
  assert.equal(applyLockfile(join(root, 'pyproject.toml'), 'python', [{ ...dep, spec: '>=1.0' }])[0].resolvedVersion, undefined);
});

test('OSV is opt-in and does not receive custom-index package names', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => { calls.push(url); return Response.json(url.includes('osv.dev') ? { vulns: [{ id: 'EXAMPLE-1', summary: 'Issue' }] } : { version: '1.1.0' }); });
  const text = '{"dependencies":{"example":"1.0.0"}}';
  const publicResult = await analyze({ ...request('/virtual/package.json', text), settings: createSettings({ auditEnabled: true, auditProvider: 'osv', npm: { registry: 'https://registry.npmjs.org' } }) });
  assert.equal(publicResult?.audits[0].result.status, 'checked'); assert.ok(calls.includes('https://api.osv.dev/v1/query'));
  calls.length = 0;
  const privateResult = await analyze({ ...request('/virtual/package.json', text), settings: createSettings({ auditEnabled: true, auditProvider: 'osv', npm: { registry: 'https://private.example' } }) });
  assert.equal(privateResult?.audits[0].result.status, 'unsupported'); assert.ok(calls.every((url) => !url.includes('osv.dev')));
});

test('HTTP rate limits preserve reset information and suppress requests during cooldown', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '60' } }); });
  await assert.rejects(fetchJson('https://rate-limited.example/test', { timeoutMs: 1000 }), /retry after/);
  await assert.rejects(fetchJson('https://rate-limited.example/test', { timeoutMs: 1000 }), /rate limited/);
  assert.equal(calls, 1);
});

test('persisted Go environment is read without invoking the Go toolchain', (t) => {
  const root = project(t, { env: 'FRESH_DEPS_TEST_GO=private.example\n' });
  const previous = process.env.GOENV; process.env.GOENV = join(root, 'env');
  t.after(() => { if (previous === undefined) delete process.env.GOENV; else process.env.GOENV = previous; });
  assert.equal(goEnv('FRESH_DEPS_TEST_GO'), 'private.example');
});

test('referenced Deno import maps are detected and new manifests have editor selectors', (t) => {
  const root = project(t, { 'deno.jsonc': '// config\n{"importMap":"config/deps.json",}', 'config/deps.json': '{}' });
  assert.equal(manifestOf(join(root, 'config/deps.json'))?.ecosystem, 'deno');
  for (const file of ['go.work', 'gradle-wrapper.properties', 'settings.gradle.kts', 'pubspec_overrides.yaml', 'example.gemspec', 'project.clj', 'script.py']) {
    assert.ok(manifestOf(`/workspace/${file}`), file);
    assert.ok(manifestSelectors.some(({ pattern }) => matchesGlob(`/workspace/${file}`, pattern)), file);
  }
  assert.equal(new Set(manifests.map((entry) => entry.ecosystem)).size, 24);
});

test('Scala cross builds compare artifact variants and platform suffixes are explicit', () => {
  const text = 'crossScalaVersions := Seq("2.13.14", "3.3.1")\nlibraryDependencies += "org.example" %% "core" % "1.0"';
  assert.deepEqual(parseSbt(text)[0].variants, ['org.example:core_2.13', 'org.example:core_3']);
  const platform = 'scalaVersion := "3.3.1"\nlibraryDependencies += "org.example" %%% "core" % "1.0"';
  assert.equal(parseSbt(platform, { platformSuffix: 'sjs1' })[0].name, 'org.example:core_sjs1_3');
  assert.deepEqual(parseSbt(platform), []);
  assert.deepEqual(parseSbt('// scalaVersion := "3.3.1"\nlibraryDependencies += "org.example" %% "core" % "1.0"'), []);
});

test('Conan orders alphanumeric versions, prereleases, and builds independently of semver', () => {
  assert.ok(conanScheme.compare('1.1.1k', '1.1.1j') > 0);
  assert.ok(conanScheme.compare('1.0+2', '1.0+1') > 0);
  assert.ok(conanScheme.compare('1.0', '1.0-rc.1') > 0);
  assert.equal(conanScheme.compare('1.0.0', '1'), 0);
  assert.equal(conanScheme.satisfies('1.1.1k', '>=1.1.1j <2', { includePrerelease: false }), true);
  const [dep] = parseConan(`[requires]\nopenssl/1.1.1k#${'a'.repeat(32)} # comment`, false);
  assert.equal(dep.spec, '1.1.1k'); assert.equal(dep.revision, 'a'.repeat(32));
});

test('Composer source metadata templates are resolved relative to the repository', async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => { urls.push(url); return Response.json(url.endsWith('packages.json')
    ? { 'metadata-url': 'p2/%package%.json' } : { packages: { 'vendor/pkg': [{ version: '2.0.0' }] } }); });
  const deps = parseComposerJson('{"repositories":[{"type":"composer","url":"https://composer.example"}],"minimum-stability":"beta","prefer-stable":true,"require":{"vendor/pkg":"^1.0@RC"}}');
  assert.equal(deps[0].minimumStability, 'rc'); assert.equal(deps[0].preferStable, true);
  assert.equal((await new PackagistClient(1000).fetchVersions(deps[0].name, deps[0].source)).latest, '2.0.0');
  assert.deepEqual(urls, ['https://composer.example/packages.json', 'https://composer.example/p2/vendor/pkg.json']);
});

test('Swift registries and GitLab sources retain their distinct identities', async (t) => {
  assert.equal(parseSwift('.package(id: "scope.example", from: "1.0.0")')[0].source, 'swift-registry');
  assert.equal(parseSwift('.package(url: "https://gitlab.com/team/example.git", from: "1.0.0")')[0].source, 'gitlab.com');
  t.mock.method(globalThis, 'fetch', async (url: string) => { assert.equal(url, 'https://swift.example/scope/example'); return Response.json({ releases: { '1.0.0': {}, '2.0.0': {}, '3.0.0': { problem: {} } } }); });
  assert.equal((await new SwiftClient(1000).fetchVersions('scope.example', 'https://swift.example')).latest, '2.0.0');
});

test('Docker detects a changed digest even when the numeric tag stays the same', async (t) => {
  const old = `sha256:${'a'.repeat(64)}`, next = `sha256:${'b'.repeat(64)}`;
  t.mock.method(globalThis, 'fetch', async (url: string) => url.includes('/manifests/') ? new Response('{}', { headers: { 'docker-content-digest': next } }) : Response.json({ tags: ['1.0'] }));
  const dep = imageDependency(`ghcr.io/team/image:1.0@${old}`, 0, 'image')!;
  const versions = await new DockerClient(1000).fetchVersions(dep.name, dep.spec, dep.source, dep.revision);
  const update = computeUpdate(dep, versions, { scheme: schemeFor('docker'), showSatisfyingUpdates: true, includePrerelease: false });
  assert.equal(update?.kind, 'patch'); assert.equal(update?.latestRaw, `1.0@${next}`);
});

test('custom Galaxy sources keep pagination and interpreter metadata scoped to that server', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string) => { assert.ok(url.startsWith('https://galaxy.example/api/')); return Response.json({ data: [{ version: '1.0.0', requires_ansible: '>=2.15' }], links: { next: null } }); });
  const versions = await new AnsibleClient(1000).fetchVersions('example.collection', false, 'https://galaxy.example');
  assert.deepEqual(versions.requirements?.['1.0.0'], ['>=2.15']);
});

test('conditional MSBuild properties are not treated as a resolved project version', () => {
  const text = '<Project><PropertyGroup><Pin>1.0</Pin></PropertyGroup><PropertyGroup Condition="x"><Pin>2.0</Pin></PropertyGroup><PackageReference Include="Example" Version="$(Pin)"/></Project>';
  assert.deepEqual(parseNugetManifest(text), []);
});

test('Dart sibling path overrides prevent default-registry lookups', async (t) => {
  const root = project(t, { 'pubspec_overrides.yaml': 'dependency_overrides:\n  example:\n    path: ../local' });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('No request allowed'); });
  const result = await analyze(request(join(root, 'pubspec.yaml'), 'dependencies:\n  example: ^1.0.0'));
  assert.match(result?.skipped?.[0].reason ?? '', /overridden/); assert.equal(result?.failures.size, 0);
});
