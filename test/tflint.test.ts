import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesGlob } from 'node:path';
import { analyze, manifestOf } from '../src/analyzer';
import { AuditCache } from '../src/audit';
import { VersionCache } from '../src/cache';
import { parseTflint } from '../src/parsers/terraform';
import { TerraformClient } from '../src/registries/terraform';
import { createSettings } from './settings';
import manifest from '../package.json';

const text = `plugin "azurerm" {
  enabled = true
  version = "0.21.0"
  source = "github.com/terraform-linters/tflint-ruleset-azurerm"
}`;

test('TFLint reads the plugin version line and ignores nonliteral or inactive declarations', () => {
  assert.deepEqual(parseTflint(text), [{ name: 'tflint:terraform-linters/tflint-ruleset-azurerm',
    spec: '0.21.0', alias: 'azurerm', line: 2, section: 'plugins', semver: true }]);
  assert.equal(parseTflint(text.replace('  enabled = true\n', '')).length, 1);
  for (const skipped of [
    text.replace('enabled = true', 'enabled = false'),
    text.replace('"0.21.0"', 'var.version'),
    text.replace('"0.21.0"', '"${var.version}"'),
    text.replace('"0.21.0"', '"0.21.0" + suffix'),
    text.replace('github.com/', 'gitlab.com/'),
    text.replace('source = "github.com/terraform-linters/tflint-ruleset-azurerm"', 'source = var.source'),
    `/* ${text} */`, text.split('\n').map((line) => `# ${line}`).join('\n'),
    `config {\n${text}\n}`, `config {\n text = <<EOF\n${text}\nEOF\n}`,
    'plugin "terraform" { enabled = true }',
  ]) assert.deepEqual(parseTflint(skipped), [], skipped);
  assert.equal(parseTflint(`// comment\n${text}`).at(0)?.line, 3);
});

test('TFLint activates and resolves GitHub releases with a shared cache and Terraform toggle', async (t) => {
  const fsPath = '/workspace/infra/.tflint.hcl';
  assert.deepEqual(manifestOf(fsPath), { ecosystem: 'terraform', kind: 'tflint' });
  assert.equal(manifestOf('/workspace/.terraform.lock.hcl'), undefined);
  assert.equal(manifestOf('/workspace/other.hcl'), undefined);
  assert.ok(manifest.activationEvents.some((event) => event.startsWith('workspaceContains:')
    && matchesGlob(fsPath, event.slice('workspaceContains:'.length))));
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/terraform-linters/tflint-ruleset-azurerm/releases?per_page=100&page=1');
    return Response.json([{ tag_name: 'v0.21.0' }, { tag_name: 'v0.30.0' },
      { tag_name: 'v0.40.0', draft: true }, { tag_name: 'v0.50.0', prerelease: true }, { tag_name: 'nightly' }]);
  });
  const settings = createSettings();
  const request = { fsPath, text, settings, cache: new VersionCache(60_000), auditCache: new AuditCache(), allowNetwork: true };
  const result = await analyze(request);
  assert.equal(result?.updates[0]?.latest, '0.30.0');
  assert.equal(result?.updates[0]?.dep.line, 2);
  assert.equal(result?.failures.size, 0);
  assert.deepEqual(await analyze({ ...request, allowNetwork: false }), result);
  assert.equal(calls, 1);
  assert.equal(await analyze({ ...request, settings: createSettings({ terraform: { enabled: false } }) }), undefined);
});

test('TFLint follows release pagination and reports missing or malformed responses', async (t) => {
  const client = new TerraformClient(1000);
  let calls = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls++;
    assert.ok(url.endsWith(`page=${calls}`));
    return Response.json(calls === 1 ? Array.from({ length: 100 }, () => ({ tag_name: 'v0.21.0' })) : [{ tag_name: 'v0.30.0' }]);
  });
  assert.equal((await client.fetchVersions('tflint:owner/repo')).latest, '0.30.0');
  assert.equal(calls, 2);
  fetch.mock.mockImplementation(async () => new Response(null, { status: 404 }));
  assert.equal((await client.fetchVersions('tflint:owner/repo')).error, 'not found');
  fetch.mock.mockImplementation(async () => Response.json({ unexpected: true }));
  await assert.rejects(client.fetchVersions('tflint:owner/repo'), /invalid GitHub releases response/);
});
