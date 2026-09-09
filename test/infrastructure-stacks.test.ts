import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesGlob, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import manifest from '../package.json';
import { analyze, lookupFor, manifestOf, type AnalyzeRequest } from '../src/analyzer';
import { VersionCache } from '../src/cache';
import { AuditCache } from '../src/audit';
import { ansibleScheme } from '../src/schemes';
import { bazelScheme } from '../src/bazel';
import { vcpkgScheme } from '../src/vcpkg';
import { parseAnsible } from '../src/parsers/ansible';
import { parseBazel } from '../src/parsers/bazel';
import { parseVcpkg } from '../src/parsers/vcpkg';
import { AnsibleClient } from '../src/registries/ansible';
import { bazelVersions } from '../src/registries/bazel';
import { vcpkgVersions } from '../src/registries/vcpkg';
import { createSettings } from './settings';

const opts = { includePrerelease: false };
const baseline = 'a'.repeat(40);
const vcpkgManifest = (extra: object) => JSON.stringify({ 'builtin-baseline': baseline, ...extra }, null, 2);
const collectionUrl = 'https://galaxy.ansible.com/api/v3/plugin/ansible/content/published/collections/index/ansible/posix/versions/?limit=100';

test('Ansible, Bazel and vcpkg manifests activate with independent settings', () => {
  for (const [file, ecosystem] of [['requirements.yml', 'ansible'], ['roles/requirements.yaml', 'ansible'],
    ['MODULE.bazel', 'bazel'], ['vcpkg.json', 'vcpkg']] as const) {
    assert.equal(manifestOf(`/workspace/${file}`)?.ecosystem, ecosystem);
    assert.equal(createSettings()[ecosystem].enabled, true);
    assert.ok(manifest.activationEvents.some((event) => event.startsWith('workspaceContains:')
      && matchesGlob(`/workspace/${file}`, event.slice('workspaceContains:'.length))), file);
  }
  for (const file of ['requirements.json', 'MODULE.bazel.lock', 'BUILD.bazel', 'vcpkg-configuration.json']) {
    assert.equal(manifestOf(`/workspace/${file}`), undefined);
  }
});

test('Ansible parses collections and role pins with exact line anchors', () => {
  const deps = parseAnsible(`collections:
  - name: ansible.posix
    version: ">=1.0.0,<2.0.0,!=1.4.0"
    source: https://galaxy.ansible.com/
roles:
  - src: geerlingguy.docker
    name: docker_alias
    version: "7.0.0"
`);
  assert.deepEqual(deps.map(({ name, line, section, semver }) => [name, line, section, semver]), [
    ['ansible.posix', 2, 'collections', undefined], ['geerlingguy.docker', 7, 'roles', true],
  ]);
  assert.equal(parseAnsible('- src: geerlingguy.docker\n  version: v7.0.0')[0]?.section, 'roles');
  assert.equal(parseAnsible('collections: [{name: ansible.posix, version: 1.0.0}]')[0]?.line, 0);
});

test('Ansible skips custom sources, dynamic values, aliases and unrelated YAML', () => {
  for (const entry of [
    '{name: private.pkg, version: 1.0.0, source: https://private.example}',
    '{name: private.pkg, version: 1.0.0, source: null}',
    '{name: private.pkg, version: 1.0.0, type: git}',
    '{name: https://github.com/owner/repo, version: 1.0.0}',
    '{name: ansible.posix, version: "{{ pin }}"}',
    '{name: ansible.posix, version: "*"}',
    '{name: ansible.posix, version: "<2.0.0"}',
    '{name: ansible.posix, version: "!=2.0.0"}',
    '{name: ansible.posix, version: 1.0.0, <<: {source: https://private.example}}',
  ]) assert.deepEqual(parseAnsible(`collections: [${entry}]`), [], entry);
  assert.deepEqual(parseAnsible('roles: [{src: https://github.com/a/b, version: 1.0.0}, {name: a.b, scm: git, version: 1.0.0}]'), []);
  assert.deepEqual(parseAnsible('base: &pin 1.0.0\ncollections: [{name: ansible.posix, version: *pin}]'), []);
  assert.deepEqual(parseAnsible('collections: [\n'), []);
  assert.deepEqual(parseAnsible('dependencies: [numpy]'), []);
});

test('Ansible comma constraints support exclusions without npm caret semantics', () => {
  const spec = '>=1.0.0,<2.0.0,!=1.4.0';
  assert.equal(ansibleScheme.baseline(spec), '1.0.0');
  assert.equal(ansibleScheme.satisfies('1.4.0', spec, opts), false);
  assert.equal(ansibleScheme.satisfies('1.5.0', spec, opts), true);
  assert.equal(ansibleScheme.satisfies('2.0.0', spec, opts), false);
  assert.equal(ansibleScheme.maxSatisfying(['1.3.0', '1.4.0', '1.5.0', '2.0.0'], spec, opts), '1.5.0');
  assert.equal(ansibleScheme.isPinned('==1.0.0'), true);
  assert.equal(ansibleScheme.isRange('^1.0.0'), false);
  assert.equal(ansibleScheme.baseline('>=2.0.0,<1.0.0'), undefined);
});

test('Galaxy collection pagination collects complete version lists', async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url);
    return Response.json(urls.length === 1
      ? { meta: { count: 3 }, data: [{ version: '1.5.0' }], links: { next: '?limit=100&offset=1' } }
      : { meta: { count: 3 }, data: [{ version: '2.0.0' }, { version: '3.0.0-rc.1' }], links: { next: null } });
  });
  const result = await new AnsibleClient(1000).fetchVersions('ansible.posix', false);
  assert.equal(result.latest, '2.0.0');
  assert.equal(result.all?.length, 3);
  assert.deepEqual(urls, [collectionUrl, collectionUrl + '&offset=1']);
});

test('Galaxy roles use the full versions endpoint rather than the truncated summary', async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url);
    return Response.json(urls.length === 1
      ? { results: [{ id: 10923, name: 'docker', username: 'geerlingguy', summary_fields: { versions: [{ name: '1.0.0' }] } }] }
      : { count: 2, results: [{ name: '7.0.0' }, { name: '8.0.0' }], next: null });
  });
  assert.equal((await new AnsibleClient(1000).fetchVersions('geerlingguy.docker', true)).latest, '8.0.0');
  assert.deepEqual(urls, ['https://galaxy.ansible.com/api/v1/roles/?owner__username=geerlingguy&name=docker',
    'https://galaxy.ansible.com/api/v1/roles/10923/versions/?page_size=100']);
});

test('Galaxy rejects incomplete listings, pagination loops and off-host links', async (t) => {
  for (const body of [
    { meta: { count: 2 }, data: [{ version: '1.0.0' }], links: { next: null } },
    { data: [{ version: '1.0.0' }], links: { next: collectionUrl } },
    { data: [{ version: '1.0.0' }], links: { next: 'https://other.example/api/versions' } },
    { data: null },
  ]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(body));
    const result = await new AnsibleClient(1000).fetchVersions('ansible.posix', false);
    assert.ok(result.error);
    assert.equal(result.all, undefined);
  }
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ data: [{ version: '1.0.0' }], links: { next: `?offset=${calls}` } });
  });
  assert.match((await new AnsibleClient(1000).fetchVersions('ansible.posix', false)).error!, /100 pages/);
  assert.equal(calls, 100);
});

test('Bazel reads literal multiline calls and filters overridden modules', () => {
  const text = `# bazel_dep(name = "comment", version = "1.0")
module(name = "local", version = "1.0")
bazel_dep(
  name = "rules_cc",
  version = "0.1.0",
  dev_dependency = True,
)
bazel_dep(name = 'abseil-cpp', version = '20240116.2.bcr.1', repo_name = 'absl')
bazel_dep(name = "patched", version = "1.0")
archive_override(module_name = "patched", urls = ["https://example.org/source"])
`;
  assert.deepEqual(parseBazel(text).map(({ name, spec, line }) => [name, spec, line]), [
    ['rules_cc', '0.1.0', 4], ['abseil-cpp', '20240116.2.bcr.1', 7],
  ]);
  for (const override of ['git_override', 'local_path_override', 'single_version_override', 'multiple_version_override']) {
    assert.deepEqual(parseBazel(`bazel_dep(name="rules_cc", version="1.0")\n${override}(module_name="rules_cc")`), []);
  }
});

test('Bazel skips expressions, includes, computed overrides and malformed declarations', () => {
  for (const text of [
    'bazel_dep(name="rules_cc", version=VERSION)',
    'bazel_dep(name="rules_cc", version="1." + "0")',
    'bazel_dep(name="rules_cc", version="1.0", version="2.0")',
    'bazel_dep(name="rules_cc", version="1.0"',
    'bazel_dep(name="rules_cc", version="1.0")\ninclude("//:more.MODULE.bazel")',
    'bazel_dep(name="rules_cc", version="1.0")\ngit_override(module_name=NAME)',
    '"""bazel_dep(name="rules_cc", version="1.0")"""',
    'something.bazel_dep(name="rules_cc", version="1.0")',
  ]) assert.deepEqual(parseBazel(text), [], text);
});

test('Bazel ordering handles relaxed releases, prereleases and numeric identifiers', () => {
  for (const [a, b] of [['1.9', '1.10'], ['1.0', '1.0.0'], ['1.0.0', '1.0.0.bcr.1'],
    ['1.0.0.bcr.2', '1.0.0.bcr.10'], ['1.0-rc.2', '1.0-rc.10'], ['1.0-rc.1', '1.0'], ['1.0.2', '1.0.a']]) {
    assert.equal(bazelScheme.compare(a, b), -1, `${a} < ${b}`);
  }
  assert.equal(bazelScheme.compare('1.0+build', '1.0'), 0);
  assert.equal(bazelScheme.compare('1.01', '1.1'), -1);
  assert.equal(bazelScheme.isVersion('1.18446744073709551616'), false);
  assert.equal(bazelScheme.isVersion('1..0'), false);
  assert.equal(bazelScheme.max(['1.0', '2.0-rc.1'], opts), '1.0');
  assert.equal(bazelScheme.max(['1.0', '2.0-rc.1'], { includePrerelease: true }), '2.0-rc.1');
  assert.equal(bazelScheme.classify('1.0.0', '1.0.0.bcr.1'), 'patch');
  assert.equal(bazelScheme.baseline('1.0+build'), '1.0');
});

test('BCR metadata excludes yanked versions and preserves prereleases for opt-in', () => {
  const result = bazelVersions({ versions: ['1.0', '2.0', '1.0.bcr.1', '3.0-rc.1', null], yanked_versions: { '2.0': 'broken' } });
  assert.equal(result.latest, '1.0.bcr.1');
  assert.deepEqual(result.all, ['1.0', '1.0.bcr.1', '3.0-rc.1']);
  assert.ok(bazelVersions({ versions: '1.0' }).error);
  assert.ok(bazelVersions({ versions: ['1.0'], yanked_versions: [] }).error);
});

test('vcpkg parses minimums, feature dependencies and overrides with port revisions', () => {
  const text = vcpkgManifest({
    dependencies: ['bare', { name: 'fmt', 'version>=': '10.0.0#1', features: ['header-only'] }, { name: 'zlib', 'version>=': '1.0' }],
    overrides: [{ name: 'zlib', version: '1.2.13', 'port-version': 2 }],
    features: { test: { dependencies: [{ name: 'catch2', 'version>=': '3.0.0' }] } },
  });
  const deps = parseVcpkg(text);
  assert.deepEqual(deps.map(({ name, spec, section }) => [name, spec, section]), [
    ['zlib', '1.2.13#2', 'overrides'], ['fmt', '>=10.0.0#1', 'dependencies'], ['catch2', '>=3.0.0', 'features'],
  ]);
  for (const dep of deps) {
    assert.equal(dep.source, baseline);
    assert.ok(text.split('\n')[dep.line].includes(dep.specRaw!.split('#')[0]));
  }
  assert.equal(deps[0].vcpkgVersionField, 'version');
});

test('vcpkg requires a builtin baseline and skips custom configurations and unsupported versions', () => {
  assert.deepEqual(parseVcpkg('{"dependencies":[{"name":"fmt","version>=":"1.0"}]}'), []);
  assert.deepEqual(parseVcpkg(vcpkgManifest({ 'builtin-baseline': 'master', dependencies: [{ name: 'fmt', 'version>=': '1.0' }] })), []);
  assert.deepEqual(parseVcpkg(vcpkgManifest({ 'vcpkg-configuration': {}, dependencies: [{ name: 'fmt', 'version>=': '1.0' }] })), []);
  assert.deepEqual(parseVcpkg(vcpkgManifest({ overrides: [
    { name: 'one', 'version-string': '1.0' }, { name: 'two', version: '1.0', 'port-version': -1 },
    { name: 'three', version: '1.0', 'version-date': '2024-01-01' }, { name: 'four', 'version-date': '1.0' },
    { name: 'five', version: '1.0#2', 'port-version': 1 }, { name: 'six', 'version-semver': '1.0' },
  ] })), []);
  assert.deepEqual(parseVcpkg('{"builtin-baseline": "abc", // comment\n}'), []);
});

test('vcpkg compares revisions after upstream versions and supports dates', () => {
  assert.equal(vcpkgScheme.compare('1.0#2', '1.0#10'), -1);
  assert.equal(vcpkgScheme.compare('1.0#10', '1.1'), -1);
  assert.equal(vcpkgScheme.compare('1.0', '1.0#0'), 0);
  assert.equal(vcpkgScheme.compare('2024-01-01.2', '2024-01-01.10'), -1);
  assert.equal(vcpkgScheme.compare('1.0.0-rc.1', '1.0.0'), -1);
  assert.equal(vcpkgScheme.satisfies('1.0#3', '>=1.0#2', opts), true);
  assert.equal(vcpkgScheme.satisfies('1.0#1', '>=1.0#2', opts), false);
  assert.equal(vcpkgScheme.satisfies('1.0#3', '1.0#2', opts), false);
  assert.equal(vcpkgScheme.classify('1.0#2', '1.0#3'), 'patch');
  assert.equal(vcpkgScheme.isVersion('1.0#-1'), false);
});

test('vcpkg registry comparison stays within the current versioning scheme', () => {
  const data = { versions: [
    { version: '1.0', 'port-version': 0 }, { version: '1.0', 'port-version': 3 }, { version: '1.1', 'port-version': 0 },
    { 'version-string': '9999', 'port-version': 0 }, { 'version-date': '2025-01-01', 'port-version': 0 },
    { 'version-semver': '9.0.0', 'port-version': 0 }, { version: '1.2', 'port-version': -1 },
  ] };
  assert.deepEqual(vcpkgVersions(data, '>=1.0#0').all, ['1.0', '1.0#3', '1.1']);
  assert.equal(vcpkgVersions(data, '>=1.0').latest, '1.1');
  assert.ok(vcpkgVersions(data, '0.1').error);
  assert.ok(vcpkgVersions(data, '9999').error);
  assert.ok(vcpkgVersions(data, '1.0', 'version-semver').error);
  assert.ok(vcpkgVersions({ versions: null }, '1.0').error);
});

const fixtures = [
  { ecosystem: 'ansible', file: 'requirements.yml', text: 'collections: [{name: ansible.posix, version: ">=1.0.0,<2.0.0"}]',
    url: collectionUrl, body: { data: [{ version: '1.5.0' }, { version: '2.0.0' }], links: { next: null } }, latest: '2.0.0', satisfying: '1.5.0' },
  { ecosystem: 'bazel', file: 'MODULE.bazel', text: 'bazel_dep(name="rules_cc", version="1.0")',
    url: 'https://bcr.bazel.build/modules/rules_cc/metadata.json', body: { versions: ['1.0', '1.0.bcr.1'] }, latest: '1.0.bcr.1', satisfying: undefined },
  { ecosystem: 'vcpkg', file: 'vcpkg.json', text: vcpkgManifest({ dependencies: [{ name: 'fmt', 'version>=': '1.0#1' }] }),
    url: 'https://raw.githubusercontent.com/microsoft/vcpkg/master/versions/f-/fmt.json',
    body: { versions: [{ version: '1.0', 'port-version': 1 }, { version: '1.0', 'port-version': 2 }] }, latest: '1.0#2', satisfying: undefined },
] as const;

for (const fixture of fixtures) test(`${fixture.ecosystem} integrates updates, offline cache, settings and failures`, async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls++;
    assert.equal(url, fixture.url);
    return Response.json(fixture.body);
  });
  const request: AnalyzeRequest = { fsPath: `/project/${fixture.file}`, text: fixture.text,
    settings: createSettings({ auditEnabled: true }), cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: false };
  assert.equal((await analyze(request))?.incomplete, true);
  assert.equal(calls, 0);
  const result = await analyze({ ...request, allowNetwork: true });
  assert.equal(result?.failures.size, 0);
  assert.equal(result?.updates[0]?.latest, fixture.latest);
  assert.equal(result?.updates[0]?.satisfying, fixture.satisfying);
  assert.equal(result?.audits[0]?.result.status, 'unsupported');
  assert.deepEqual((await analyze(request))?.updates, result?.updates);
  assert.equal(calls, 1);
  const disabled = createSettings({ [fixture.ecosystem]: { enabled: false } });
  assert.equal(await analyze({ ...request, settings: disabled }), undefined);
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  assert.equal((await analyze({ ...request, cache: new VersionCache(60_000), allowNetwork: true }))?.failures.size, 1);
});

test('cache keys isolate Galaxy roles and collections and vcpkg declarations', () => {
  const settings = createSettings();
  const ansible = lookupFor('ansible', '/project/requirements.yml', settings)!;
  const dep = { name: 'a.b', spec: '1.0.0', line: 0, section: 'roles' };
  assert.notEqual(ansible.key(dep), ansible.key({ ...dep, section: 'collections' }));
  const vcpkg = lookupFor('vcpkg', '/project/vcpkg.json', settings)!;
  const port = parseVcpkg(fixtures[2].text)[0];
  assert.notEqual(vcpkg.key(port), vcpkg.key({ ...port, spec: '>=2.0' }));
  assert.notEqual(vcpkg.key(port), vcpkg.key({ ...port, source: 'b'.repeat(40) }));
  assert.notEqual(vcpkg.key(port), vcpkg.key({ ...port, vcpkgVersionField: 'version-semver' }));
});

test('vcpkg skips sibling registry configuration before any network access', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'fresh-deps-vcpkg-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'vcpkg-configuration.json'), '{}');
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('custom registry names must not be queried'); });
  const result = await analyze({ fsPath: join(directory, 'vcpkg.json'), text: fixtures[2].text, settings: createSettings(),
    cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true });
  assert.deepEqual(result?.updates, []);
  assert.equal(result?.incomplete, false);
});
