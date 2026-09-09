import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePyProject } from '../src/parsers/pyproject';
import { parsePipfile } from '../src/parsers/pipfile';
import { parseRequirementsTxt } from '../src/parsers/requirementsTxt';
import { parsePythonScript } from '../src/parsers/pythonScript';
import { parsePomXml } from '../src/parsers/pomXml';
import { parseSbt } from '../src/parsers/scala';
import { parsePackageJson } from '../src/parsers/packageJson';
import { analyze } from '../src/analyzer';
import { VersionCache } from '../src/cache';
import { AuditCache } from '../src/audit';
import { createSettings } from './settings';
import { OciClient } from '../src/registries/oci';

test('Python retains explicit indexes and prevents registry lookups for uv workspace sources', () => {
  const options = { includeBuildRequires: false };
  const workspace = parsePyProject('[project]\ndependencies = ["internal-lib==1.0.0"]\n[tool.uv.sources]\ninternal-lib = { workspace = true }', options);
  assert.match(workspace[0].skipReason!, /workspace/);
  const uv = parsePyProject('[project]\ndependencies = ["torch==2.0"]\n[tool.uv.sources]\ntorch = { index = "cpu" }\n[[tool.uv.index]]\nname = "cpu"\nurl = "https://cpu.example/simple"\nexplicit = true', options);
  assert.equal(uv[0].source, 'https://cpu.example/simple');
  const pipfile = parsePipfile('[[source]]\nname = "private"\nurl = "https://private.example/simple"\n[packages]\ninternal = { version = "==1.0", index = "private" }');
  assert.equal(pipfile[0].source, 'https://private.example/simple');
  assert.equal(parseRequirementsTxt('--index-url https://private.example/simple\ninternal==1.0')[0].source, 'https://private.example/simple');
});

test('Maven checks parent and plugin pins with local properties and default plugin group', () => {
  const deps = parsePomXml('<project><properties><plugin.version>3.0</plugin.version></properties><parent><groupId>org.example</groupId><artifactId>parent</artifactId><version>1.0</version></parent><build><pluginManagement><plugins><plugin><artifactId>maven-compiler-plugin</artifactId><version>${plugin.version}</version></plugin></plugins></pluginManagement></build></project>');
  assert.deepEqual(deps.map(({ name, spec }) => [name, spec]), [['org.example:parent', '1.0'], ['org.apache.maven.plugins:maven-compiler-plugin', '3.0']]);
});

test('Scala cross versions use configured or unambiguous literal binary versions', () => {
  const dep = 'libraryDependencies += "org.typelevel" %% "cats-core" % "2.10.0"';
  assert.equal(parseSbt(dep, { scalaBinaryVersion: '2.13' })[0].name, 'org.typelevel:cats-core_2.13');
  assert.equal(parseSbt(`scalaVersion := "3.3.1"\n${dep}`)[0].name, 'org.typelevel:cats-core_3');
  assert.deepEqual(parseSbt(dep), []);
});

test('PEP 723 dependency anchors point to the original script and duplicate blocks are ignored', () => {
  const text = '#!/usr/bin/env python\n# /// script\n# dependencies = [\n#   "requests==2.0"\n# ]\n# ///\nprint("hello")';
  assert.equal(parsePythonScript(text)[0].line, 3);
  assert.deepEqual(parsePythonScript(`${text}\n${text}`), []);
});

test('npm parses package-manager hashes and nested overrides', () => {
  const deps = parsePackageJson('{"packageManager":"pnpm@9.0.0+sha512.abc","overrides":{"parent@1":{"child":"^2.0.0",".":"1.1.0"}}}', ['packageManager', 'overrides']);
  assert.deepEqual(deps.map(({ name, spec }) => [name, spec]), [['pnpm', '9.0.0'], ['child', '^2.0.0'], ['parent', '1.1.0']]);
});

test('duplicate dependency declarations share a lookup, while keeping separate hints', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ version: '1.1.0' }); });
  const result = await analyze({ fsPath: '/virtual/package.json', text: '{"dependencies":{"example":"^1.0.0"},"devDependencies":{"example":"^1.0.0"}}',
    settings: createSettings({ npm: { registry: 'https://registry.example' } }), cache: new VersionCache(60000), auditCache: new AuditCache(), allowNetwork: true });
  assert.equal(calls, 1);
  assert.equal(result?.updates.length, 2);
});

test('OCI handles bearer challenges and keeps pagination on the original registry', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    if (url.startsWith('https://auth.example/')) return Response.json({ token: 'anonymous' });
    if (!(init?.headers as Record<string, string>).authorization) return new Response('', { status: 401,
      headers: { 'www-authenticate': 'Bearer realm="https://auth.example/token",service="registry.example",scope="repository:team/image:pull"' } });
    return Response.json({ tags: ['1.0.0', '2.0.0'] });
  });
  assert.deepEqual(await new OciClient(1000).tags('registry.example', 'team/image'), ['1.0.0', '2.0.0']);
  assert.equal(calls.length, 3);
});
