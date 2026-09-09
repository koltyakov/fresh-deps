import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesGlob } from 'node:path';
import { analyze, manifestOf, lookupFor, type AnalyzeRequest } from '../src/analyzer';
import { AuditCache } from '../src/audit';
import { VersionCache } from '../src/cache';
import { createSettings, configurationProperties } from './settings';
import { parseDockerfile, parseCompose, imageDependency } from '../src/parsers/docker';
import { parseHelm } from '../src/parsers/helm';
import { parseSwift } from '../src/parsers/swift';
import { parseConan } from '../src/parsers/conan';
import { parseSbt } from '../src/parsers/scala';
import { parseConda } from '../src/parsers/conda';
import { parseClojure } from '../src/parsers/clojure';
import { parseDotnetPins, sdkRange } from '../src/parsers/dotnetPins';
import { parseYarnCatalog } from '../src/parsers/yarnCatalog';
import { parseTerraform } from '../src/parsers/terraform';
import { dockerScheme } from '../src/docker';
import { conanScheme, condaScheme } from '../src/numericVersion';
import { semverScheme } from '../src/schemes';
import { DockerClient, dockerVersions } from '../src/registries/docker';
import { HelmClient, helmVersions } from '../src/registries/helm';
import { conanVersions } from '../src/registries/conan';
import { CondaClient, condaVersions } from '../src/registries/conda';
import { SwiftClient } from '../src/registries/swift';
import { sdkVersions } from '../src/registries/dotnetSdk';
import manifest from '../package.json';

const settings = createSettings({
  concurrency: 4, requestTimeoutMs: 1000,
  npm: { registry: 'https://registry.npmjs.org', sections: ['dependencies'] },
  gradle: { repositories: [] },
  conda: { subdir: 'linux-64' },
});

test('new manifest names select ecosystems without claiming unrelated files', () => {
  for (const [file, ecosystem] of [
    ['Dockerfile', 'docker'], ['Dockerfile.dev', 'docker'], ['prod.Dockerfile', 'docker'],
    ['compose.yml', 'docker'], ['compose.override.yaml', 'docker'], ['docker-compose.prod.yml', 'docker'],
    ['Chart.yaml', 'helm'], ['Package.swift', 'swift'], ['conanfile.txt', 'conan'], ['conanfile.py', 'conan'],
    ['build.sbt', 'scala'], ['project/plugins.sbt', 'scala'], ['environment.yml', 'conda'],
    ['environment.yaml', 'conda'], ['deps.edn', 'clojure'], ['.config/dotnet-tools.json', 'dotnet'],
    ['global.json', 'dotnet'], ['.yarnrc.yml', 'npm'],
  ]) assert.equal(manifestOf(`/project/${file}`)?.ecosystem, ecosystem, file);
  for (const file of ['main.swift', 'values.yaml', 'plugins.sbt', 'Dockerfilex', 'environment.json', 'random.edn', 'conan.lock']) {
    assert.equal(manifestOf(`/workspace/${file}`), undefined, file);
  }
  for (const ecosystem of ['docker', 'helm', 'swift', 'conan', 'scala', 'conda', 'clojure']) {
    assert.equal(configurationProperties[`freshDeps.${ecosystem}.enabled`]?.default, true);
  }
});

test('Docker parses literal images and skips stages, heredocs, digests, variables and other registries', () => {
  const text = '# FROM fake:1\nFROM --platform=$BUILDPLATFORM node:20-alpine AS build\nFROM build\nRUN <<EOF\nFROM fake:1\nEOF\nFROM \\\n  nginx:1.25-bookworm\n';
  assert.deepEqual(parseDockerfile(text).map(({ name, spec, line }) => [name, spec, line]), [
    ['library/node', '20-alpine', 1], ['library/nginx', '1.25-bookworm', 7],
  ]);
  for (const image of ['node:latest', 'node', 'node:20@sha256:abc', '${IMAGE}:20']) {
    assert.equal(imageDependency(image, 0, 'image'), undefined, image);
  }
  assert.equal(imageDependency('ghcr.io/org/image:1', 0, 'image')?.source, 'ghcr.io');
  assert.equal(imageDependency('localhost:5000/image:1', 0, 'image')?.source, 'localhost:5000');
  assert.equal(imageDependency('docker.io/library/node:20', 0, 'image')?.name, 'library/node');
  const compose = 'x-image: fake:1\nservices:\n  api:\n    image: docker.io/owner/api:1.0\n  local:\n    image: ${IMAGE}:1\n';
  assert.deepEqual(parseCompose(compose).map(({ name, line }) => [name, line]), [['owner/api', 3]]);
  assert.equal(parseCompose('services:\n  api:\n    image: &image node:20\n  copy:\n    image: *image').length, 1);
  assert.deepEqual(parseDockerfile('RUN \\\n cat <<ONE <<TWO\nFROM fake:1\nONE\nFROM fake:2\nTWO\nFROM node:20')
    .map((dep) => dep.name), ['library/node']);
});

test('Compose suffixes and Containerfiles activate and analyze image updates', async (t) => {
  const compose = ['docker-compose-db.yml', 'docker-compose-dev.yml', 'docker-compose-otel.yml',
    'docker-compose_test.yaml', 'compose-prod.yaml', 'compose_test.yml', 'compose.override.yaml'];
  const containers = ['Containerfile', 'Containerfile.dev', 'Containerfile-prod', 'Containerfile_test',
    'production.Containerfile', 'Dockerfile-prod', 'Dockerfile_test', 'production.Dockerfile'];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls++;
    if (url.startsWith('https://auth.docker.io/')) return Response.json({ token: 'anonymous' });
    assert.equal(url, 'https://registry-1.docker.io/v2/library/postgres/tags/list?n=10000');
    return Response.json({ tags: ['15.3-alpine', '15.4-alpine', '16.1-alpine', '17-alpine', '17.1-bookworm'] });
  });
  const cache = new VersionCache(60_000);
  for (const file of [...compose, ...containers]) {
    const fsPath = `/workspace/nested/${file}`;
    const isCompose = compose.includes(file);
    assert.equal(manifestOf(fsPath)?.kind, isCompose ? 'compose' : 'dockerfile', file);
    assert.ok(manifest.activationEvents.some((event) => event.startsWith('workspaceContains:')
      && matchesGlob(fsPath, event.slice('workspaceContains:'.length))), `activation: ${file}`);
    const text = isCompose ? 'services:\n  db:\n    image: postgres:15.3-alpine\n    ports:\n      - 5432:5432'
      : 'FROM postgres:15.3-alpine';
    const result = await analyze({ fsPath, text, settings, cache, auditCache: new AuditCache(), allowNetwork: true });
    assert.equal(result?.updates[0]?.latest, '16.1-alpine', file);
    assert.equal(result?.updates[0]?.dep.line, isCompose ? 2 : 0, file);
  }
  assert.equal(calls, 2, 'all filenames share the image tag cache');
  for (const file of ['Containerfilex', 'docker-composefoo.yml', 'composefoo.yaml', 'my-compose.yml', 'Containerfile.json.bak~']) {
    assert.equal(manifestOf(`/workspace/${file}`), undefined, file);
  }
});

test('Docker tags keep precision and suffix instead of confusing variants with prereleases', () => {
  const tags = ['20-alpine', '22-alpine', '22.1-alpine', '24-bookworm', 'v24-alpine', 'latest', '99-rc1'];
  assert.deepEqual(dockerVersions(tags, '20-alpine').all, ['20-alpine', '22-alpine']);
  assert.equal(dockerVersions(tags, '20-alpine').latest, '22-alpine');
  assert.equal(dockerScheme.isPrerelease('22-alpine'), false);
  assert.equal(dockerScheme.isPrerelease('22-rc1'), true);
  assert.equal(dockerScheme.classify('20.1.0-alpine', '20.2.0-alpine'), 'minor');
});

test('Helm scopes dependencies, anchors version fields and rejects unresolved repositories', () => {
  const text = 'apiVersion: v2\nversion: 1.0.0\ndependencies:\n  - name: redis\n    alias: cache\n    version: "~1.0.0"\n    repository: https://charts.example/stable/\n';
  assert.deepEqual(parseHelm(text), [{ name: 'redis', spec: '~1.0.0', source: 'https://charts.example/stable', alias: 'cache', line: 5, section: 'dependencies' }]);
  assert.equal(parseHelm('dependencies: [{name: redis, version: 1.0.0, repository: "oci://registry.example/charts"}]')[0]?.source, 'oci://registry.example/charts');
  for (const repository of ['@stable', 'alias:stable', 'file://../local', 'https://user:pass@example.org']) {
    assert.deepEqual(parseHelm(`dependencies:\n  - name: redis\n    version: 1.0.0\n    repository: ${repository === '@stable' ? '"@stable"' : repository}`), []);
  }
});

test('Swift reads literal requirement forms and uses next-major bounds below 1.0', () => {
  for (const [requirement, expected] of [
    ['from: "0.2.0"', '>=0.2.0 <1.0.0'], ['exact: "1.2.3"', '1.2.3'],
    ['.exact("1.2.3")', '1.2.3'], ['.upToNextMajor(from: "1.2.3")', '>=1.2.3 <2.0.0'],
    ['.upToNextMinor(from: "1.2.3")', '>=1.2.3 <1.3.0'],
    ['"1.0.0"..<"2.0.0"', '>=1.0.0 <2.0.0'], ['"1.0.0"..."2.0.0"', '>=1.0.0 <=2.0.0'],
  ]) {
    const result = parseSwift(`let package = Package(dependencies: [\n.package(url: "https://github.com/apple/example.git", ${requirement})\n])`);
    assert.equal(result.length, 1, requirement);
    assert.equal(result[0].name, 'apple/example');
    assert.equal(result[0].spec, expected);
    assert.equal(result[0].line, 1);
  }
  for (const req of ['branch: "main"', 'revision: "abc"', 'from: version', 'from: "1.0.0" + suffix']) {
    assert.deepEqual(parseSwift(`.package(url: "https://github.com/apple/example", ${req})`), []);
  }
  assert.deepEqual(parseSwift('// .package(url: "https://github.com/a/b", from: "1.0.0")'), []);
  assert.deepEqual(parseSwift('let example = """.package(url: "https://github.com/a/b", from: "1.0.0")"""'), []);
});

test('Conan reads literal assignments and calls without extracting strings from expressions', () => {
  assert.deepEqual(parseConan('[requires]\nfmt/10.0.0\nzlib/[>=1.0 <2.0]\nprivate/1.0@user/channel\n[generators]\nCMakeDeps', false)
    .map(({ name, spec, line }) => [name, spec, line]), [['fmt', '10.0.0', 1], ['zlib', '>=1.0 <2.0', 2], ['private@user/channel', '1.0', 3]]);
  const python = 'class Recipe:\n  requires = ("fmt/10.0", "zlib/1.2")\n  def requirements(self):\n    self.requires("openssl/3.0", transitive_headers=True)\n    self.tool_requires("cmake/3.20")\n';
  assert.deepEqual(parseConan(python, true).map((dep) => dep.name), ['fmt', 'zlib', 'openssl', 'cmake']);
  for (const text of ['requires = "fmt/10.0" + suffix', 'requires = f"fmt/10.0"', 'self.requires("fmt/10.0" + suffix)',
    '# self.requires("fmt/10.0")', '"""self.requires("fmt/10.0")"""']) assert.deepEqual(parseConan(text, true), [], text);
});

test('sbt checks explicit coordinates and only resolves plugin suffixes when configured', () => {
  const text = 'libraryDependencies ++= Seq(\n "org.example" % "core" % "1.0",\n "org.example" %% "scala-core" % "1.0")';
  assert.deepEqual(parseSbt(text).map(({ name, line }) => [name, line]), [['org.example:core', 1]]);
  const plugin = 'addSbtPlugin("org.example" % "plugin" % "1.0")';
  assert.deepEqual(parseSbt(plugin), []);
  assert.equal(parseSbt(plugin, { scalaBinaryVersion: '2.12', sbtBinaryVersion: '1.0' })[0].name, 'org.example:plugin_2.12_1.0');
  for (const text of ['// "a" % "b" % "1.0"', 's"a" % "b" % "1.0"', '"a" % "b" % "1.0" + suffix',
    '"a" % "b" % "1.0" cross CrossVersion.full', '"a" % "b" % "1.+"', '"a" % "b" % "latest.integration"']) assert.deepEqual(parseSbt(text), [], text);
});

test('Conda keeps channel order, handles explicit overrides and skips unsupported build constraints', () => {
  const text = 'channels: [conda-forge, bioconda, nodefaults]\ndependencies:\n  - numpy=1.26\n  - bioconda::samtools>=1.0,<2.0\n  - python=3.11=build_0\n  - pip:\n      - requests==2.0\n';
  assert.deepEqual(parseConda(text).map(({ name, source, line }) => [name, source, line]), [
    ['numpy', 'conda-forge|bioconda', 2], ['samtools', 'bioconda', 3], ['requests', undefined, 6],
  ]);
  assert.deepEqual(parseConda('dependencies: [numpy=1.26]'), []);
  assert.equal(parseConda('channels: [defaults]\ndependencies: [numpy=1.26]')[0]?.source, 'defaults');
  assert.equal(parseConda('channels: [defaults]\ndependencies: [conda-forge::numpy=1.26]').length, 1);
  assert.deepEqual(parseConda('channels: [conda-forge]\ndependencies: ["numpy>=1.0rc1"]'), []);
});

test('numeric schemes distinguish Conda prefix pins from Conan exact pins', () => {
  const opts = { includePrerelease: false };
  assert.equal(condaScheme.satisfies('1.26.4', '=1.26', opts), true);
  assert.equal(condaScheme.satisfies('1.260.0', '=1.26', opts), false);
  assert.equal(condaScheme.satisfies('1.26.4', '==1.26', opts), false);
  assert.equal(condaScheme.satisfies('2.1', '>=1.0,<2.0|==2.1', opts), true);
  assert.equal(condaScheme.baseline('>=1.0,>=1.5,<2.0'), '1.5');
  assert.equal(condaScheme.baseline('<2.0'), undefined);
  assert.equal(conanScheme.satisfies('1.2.4', '1.2', opts), false);
  assert.equal(conanScheme.satisfies('1.2.4', '>=1.0 <2.0', opts), true);
  assert.equal(conanScheme.max(['1.9', '1.10', '2.0-rc1'], opts), '1.10');
  assert.equal(condaScheme.compare('1.0', '1.0.0'), 0);
});

test('Clojure parses nested alias maps and skips Git coordinates, reader macros and custom repositories', () => {
  const text = '{:deps {org.clojure/clojure {:mvn/version "1.10.0"}\n git/pkg {:git/url "https://example.org/pkg" :git/sha "abc"}}\n :aliases {:test {:extra-deps {cheshire/cheshire {:mvn/version "5.0.0"}}}}}';
  assert.deepEqual(parseClojure(text).map(({ name, line, section }) => [name, line, section]), [
    ['org.clojure:clojure', 0, 'deps'], ['cheshire:cheshire', 2, 'extra-deps'],
  ]);
  assert.equal(parseClojure('{:deps {cheshire {:mvn/version "5.0.0"}}}')[0].name, 'cheshire:cheshire');
  assert.equal(parseClojure('{:deps {a/b {:mvn/version "1.0"}} :mvn/repos {}}')[0].source, 'https://repo.maven.apache.org/maven2|https://repo.clojars.org');
  for (const text of ['{:deps {#_a/b {:mvn/version "1.0"}}}',
    '; {:deps {a/b {:mvn/version "1.0"}}}', '{:deps {a/b {:mvn/version version}}}']) assert.deepEqual(parseClojure(text), [], text);
});

test('Terraform modules use their own registry API and retain aliases and positions', () => {
  const text = 'module "vpc" {\n source = "terraform-aws-modules/vpc/aws"\n version = "~> 5.0"\n}\nmodule "local" {\n source = "./local"\n version = "1.0"\n}';
  assert.deepEqual(parseTerraform(text), [{ name: 'module:registry.terraform.io/terraform-aws-modules/vpc/aws', spec: '~> 5.0', alias: 'vpc', line: 2, section: 'modules' }]);
  assert.equal(parseTerraform(text, 'registry.opentofu.org')[0].name, 'module:registry.opentofu.org/terraform-aws-modules/vpc/aws');
  assert.deepEqual(parseTerraform('# module "fake" { source = "a/b/c", version = "1.0" }'), []);
  assert.deepEqual(parseTerraform('locals { module "fake" { source = "a/b/c", version = "1.0" } }'), []);
});

test('.NET tools anchor exact pins and SDK ranges model all roll-forward policies', () => {
  assert.deepEqual(parseDotnetPins('{"version":1,"tools":{\n"dotnet-ef":{"version":"8.0.0","commands":["dotnet-ef"]}}}', false),
    [{ name: 'dotnet-ef', spec: '[8.0.0]', specRaw: '8.0.0', line: 1, section: 'tools' }]);
  assert.deepEqual(parseDotnetPins('{"tools":{"tool":{"version":"8.*"}}}', false), []);
  const opts = { includePrerelease: false };
  for (const policy of ['patch', 'latestPatch']) {
    assert.equal(semverScheme.satisfies('8.0.199', sdkRange('8.0.100', policy)!, opts), true);
    assert.equal(semverScheme.satisfies('8.0.200', sdkRange('8.0.100', policy)!, opts), false);
  }
  for (const policy of ['feature', 'latestFeature']) {
    assert.equal(semverScheme.satisfies('8.0.400', sdkRange('8.0.100', policy)!, opts), true);
    assert.equal(semverScheme.satisfies('8.1.100', sdkRange('8.0.100', policy)!, opts), false);
  }
  for (const policy of ['minor', 'latestMinor']) assert.equal(semverScheme.satisfies('9.0.100', sdkRange('8.0.100', policy)!, opts), false);
  for (const policy of ['major', 'latestMajor']) assert.equal(semverScheme.satisfies('9.0.100', sdkRange('8.0.100', policy)!, opts), true);
  assert.equal(sdkRange('8.0.100', 'disable'), '8.0.100');
  assert.equal(sdkRange('8.0.100', 'unknown'), undefined);
  const sdk = parseDotnetPins('{"sdk":{"version":"8.0.100","allowPrerelease":false}}', true)[0];
  assert.equal(sdk.spec, '>=8.0.100 <8.0.200');
  assert.equal(sdk.allowPrerelease, false);
});

test('Yarn catalogs preserve npm aliases and explicit registry selection', () => {
  const text = 'npmRegistryServer: https://registry.example\nnpmScopes:\n  org:\n    npmRegistryServer: https://scoped.example\ncatalog:\n  react: ^18.0.0\n  "@org/pkg": ^1.0.0\ncatalogs:\n  legacy:\n    compat: npm:react@^17.0.0';
  assert.deepEqual(parseYarnCatalog(text).map(({ name, source, line }) => [name, source, line]), [
    ['react', 'https://registry.example', 5], ['@org/pkg', 'https://scoped.example', 6], ['react', 'https://registry.example', 9],
  ]);
  assert.deepEqual(parseYarnCatalog('npmAuthToken: token\ncatalog: {react: ^18.0.0}'), []);
  assert.deepEqual(parseYarnCatalog('npmRegistryServer: https://${HOST}\ncatalog: {react: ^18.0.0}'), []);
});

test('registry response adapters exclude incompatible releases and preserve full lists', () => {
  assert.deepEqual(helmVersions('entries:\n  redis:\n    - version: 1.0.0\n    - version: 2.0.0\n    - version: 3.0.0-rc1', 'redis').all,
    ['1.0.0', '2.0.0', '3.0.0-rc1']);
  assert.deepEqual(conanVersions('versions:\n  "1.9": {folder: all}\n  "1.10": {folder: all}\n  "2.0-rc1": {folder: all}').all, ['1.9', '1.10', '2.0-rc1']);
  assert.deepEqual(condaVersions({ files: [
    { version: '1.0', attrs: { subdir: 'linux-64' }, labels: ['main'] },
    { version: '1.5', basename: 'noarch/pkg.tar.bz2' },
    { version: '2.0', attrs: { subdir: 'osx-arm64' } },
    { version: '3.0', attrs: { subdir: 'linux-64' }, labels: ['broken'] },
  ] }, 'linux-64').all, ['1.0', '1.5']);
  assert.deepEqual(sdkVersions({ releases: [{ sdk: { version: '8.0.100' }, sdks: [{ version: '8.0.101' }] }] }), ['8.0.100', '8.0.101']);
});

test('Docker follows bounded same-repository pagination and shares tag lists', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls++;
    if (url.startsWith('https://auth.docker.io/')) return Response.json({ token: 'anonymous' });
    return url.includes('last=20') ? Response.json({ tags: ['22', '22-alpine'] })
      : Response.json({ tags: ['20'] }, { headers: { link: '</v2/library/node/tags/list?n=10000&last=20>; rel="next"' } });
  });
  const client = new DockerClient(1000);
  assert.equal((await client.fetchVersions('library/node', '20')).latest, '22');
  assert.equal((await client.fetchVersions('library/node', '20-alpine')).latest, '22-alpine');
  assert.equal(calls, 3);
  t.mock.method(globalThis, 'fetch', async (url: string) => url.startsWith('https://auth.docker.io/') ? Response.json({ token: 'anonymous' })
    : Response.json({ tags: [] }, { headers: { link: '<https://other.example/tags>; rel="next"' } }));
  await assert.rejects(new DockerClient(1000).fetchVersions('library/node', '20'), /pagination URL/);
});

test('Helm shares indexes, and Conda falls through only when a channel lacks platform builds', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('entries:\n  redis: [{version: 2.0.0}]\n  nginx: [{version: 3.0.0}]');
  });
  const helm = new HelmClient(1000);
  await Promise.all([helm.fetchVersions('redis', 'https://charts.example'), helm.fetchVersions('nginx', 'https://charts.example')]);
  assert.equal(calls, 1);
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url);
    return Response.json({ files: [{ version: '2.0', attrs: { subdir: url.includes('/first/') ? 'osx-arm64' : 'linux-64' } }] });
  });
  assert.equal((await new CondaClient(1000, 'linux-64').fetchVersions('numpy', 'first|second')).latest, '2.0');
  assert.equal(urls.length, 2);
});

test('Swift fails rather than comparing a truncated tag listing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(Array.from({ length: 100 }, (_, i) => ({ name: `1.0.${i}` }))));
  await assert.rejects(new SwiftClient(1000).fetchVersions('owner/pkg'), /pagination limit/);
});

const fixtures = [
  { file: 'Dockerfile', text: 'FROM node:20-alpine', latest: '22-alpine', url: 'https://registry-1.docker.io/v2/library/node/tags/list?n=10000', body: { tags: ['22-alpine'] } },
  { file: 'Chart.yaml', text: 'dependencies:\n  - name: redis\n    version: ^1.0.0\n    repository: https://charts.example', latest: '2.0.0', url: 'https://charts.example/index.yaml', body: 'entries:\n  redis: [{version: 1.5.0}, {version: 2.0.0}]' },
  { file: 'Package.swift', text: '.package(url: "https://github.com/owner/pkg", from: "1.0.0")', latest: '2.0.0', url: 'https://api.github.com/repos/owner/pkg/tags?per_page=100&page=1', body: [{ name: '1.5.0' }, { name: '2.0.0' }] },
  { file: 'conanfile.txt', text: '[requires]\nfmt/[>=1.0 <2.0]', latest: '2.0', url: 'https://raw.githubusercontent.com/conan-io/conan-center-index/master/recipes/fmt/config.yml', body: 'versions:\n  "1.5": {folder: all}\n  "2.0": {folder: all}' },
  { file: 'build.sbt', text: 'libraryDependencies += "org.example" % "core" % "1.0"', latest: '2.0', url: 'https://repo.maven.apache.org/maven2/org/example/core/maven-metadata.xml', body: '<metadata><versioning><versions><version>2.0</version></versions></versioning></metadata>' },
  { file: 'environment.yml', text: 'channels: [conda-forge]\ndependencies: [numpy=1.0]', latest: '2.0', url: 'https://api.anaconda.org/package/conda-forge/numpy', body: { files: [{ version: '2.0', attrs: { subdir: 'linux-64' } }] } },
  { file: 'deps.edn', text: '{:deps {org.clojure/clojure {:mvn/version "1.0"}}}', latest: '2.0', url: 'https://repo.maven.apache.org/maven2/org/clojure/clojure/maven-metadata.xml', body: '<metadata><versioning><versions><version>2.0</version></versions></versioning></metadata>' },
  { file: 'main.tf', text: 'module "vpc" {\n source = "a/b/c"\n version = "~> 1.0"\n}', latest: '2.0.0', url: 'https://registry.terraform.io/v1/modules/a/b/c/versions', body: { modules: [{ versions: [{ version: '1.5.0' }, { version: '2.0.0' }] }] } },
  { file: '.yarnrc.yml', text: 'catalog: {react: 1.0.0}', latest: '2.0.0', url: 'https://registry.npmjs.org/react/latest', body: { version: '2.0.0' } },
] as const;

for (const fixture of fixtures) test(`${fixture.file} integrates lookups, offline cache, failure reporting and enable settings`, async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (fixture.file === 'Dockerfile' && url.startsWith('https://auth.docker.io/')) return Response.json({ token: 'anonymous' });
    calls++; assert.equal(url, fixture.url);
    return typeof fixture.body === 'string' ? new Response(fixture.body) : Response.json(fixture.body);
  });
  const request: AnalyzeRequest = { fsPath: `/project/${fixture.file}`, text: fixture.text, settings: { ...settings, auditEnabled: true },
    cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: false };
  assert.equal((await analyze(request))?.incomplete, true);
  assert.equal(calls, 0);
  // npm audits use another endpoint, covered by the existing npm audit tests.
  request.settings = settings;
  const result = await analyze({ ...request, allowNetwork: true });
  assert.equal(result?.failures.size, 0);
  assert.equal(result?.updates[0]?.latest, fixture.latest);
  assert.deepEqual((await analyze(request))?.updates, result?.updates);
  assert.equal(calls, 1);
  const ecosystem = manifestOf(request.fsPath)!.ecosystem;
  assert.equal(await analyze({ ...request, settings: { ...settings, [ecosystem]: { ...settings[ecosystem], enabled: false } } }), undefined);
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  const failed = await analyze({ ...request, cache: new VersionCache(60_000), allowNetwork: true });
  assert.equal(failed?.failures.size, 1);
});

test('.NET tool pins share NuGet cache keys; SDK channels use semver roll-forward and preview filters', async (t) => {
  const tool = parseDotnetPins('{"tools":{"dotnet-ef":{"version":"8.0.0"}}}', false)[0];
  assert.equal(lookupFor('dotnet', '/project/dotnet-tools.json', settings)!.key(tool),
    lookupFor('dotnet', '/project/app.csproj', settings)!.key({ ...tool, section: 'PackageReference' }));
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url);
    if (url.endsWith('releases-index.json')) return Response.json({ 'releases-index': [{ 'channel-version': '8.0' }, { 'channel-version': '9.0' }] });
    return Response.json({ releases: [{ sdks: url.includes('/8.0/') ? [{ version: '8.0.101' }, { version: '8.0.200' }]
      : [{ version: '9.0.100' }, { version: '10.0.100-preview.1' }] }] });
  });
  const request: AnalyzeRequest = { fsPath: '/project/global.json', text: '{"sdk":{"version":"8.0.100","allowPrerelease":false}}',
    settings: { ...settings, includePrerelease: true }, cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true };
  const result = await analyze(request);
  assert.equal(result?.updates[0].latest, '9.0.100');
  assert.equal(result?.updates[0].satisfying, '8.0.101');
  assert.equal(urls.length, 3);
  assert.deepEqual((await analyze({ ...request, allowNetwork: false }))?.updates, result?.updates);
});

test('.NET tools resolve exact pins through NuGet and reuse project version lookups', async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url);
    return Response.json(url === 'https://api.nuget.org/v3/index.json'
      ? { resources: [{ '@type': 'PackageBaseAddress/3.0.0', '@id': 'https://api.nuget.org/v3-flatcontainer/' }] }
      : { versions: ['8.0.0', '8.0.1', '9.0.0'] });
  });
  const request: AnalyzeRequest = { fsPath: '/project/.config/dotnet-tools.json', text: '{"tools":{"dotnet-ef":{"version":"8.0.0"}}}',
    settings, cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true };
  const result = await analyze(request);
  assert.equal(result?.updates[0].latest, '9.0.0');
  assert.equal(result?.updates[0].inRange, false);
  assert.equal(result?.updates[0].satisfying, undefined);
  assert.deepEqual(urls, ['https://api.nuget.org/v3/index.json', 'https://api.nuget.org/v3-flatcontainer/dotnet-ef/index.json']);
  assert.deepEqual((await analyze({ ...request, allowNetwork: false }))?.updates, result?.updates);
});
