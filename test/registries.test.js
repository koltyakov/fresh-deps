const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { escapeModulePath, majorLayout, resolveProxy } = require('../out/registries/go');
const { readNpmConfig, authTokenFor } = require('../out/npmrc');

test('escapeModulePath escapes uppercase letters for the module proxy', () => {
  assert.strictEqual(escapeModulePath('github.com/Masterminds/semver'), 'github.com/!masterminds/semver');
  assert.strictEqual(escapeModulePath('golang.org/x/sync'), 'golang.org/x/sync');
});

test('majorLayout understands both major-version conventions', () => {
  const slash = majorLayout('github.com/foo/bar/v2');
  assert.strictEqual(slash.major, 2);
  assert.strictEqual(slash.pathFor(3), 'github.com/foo/bar/v3');

  const gopkg = majorLayout('gopkg.in/yaml.v2');
  assert.strictEqual(gopkg.major, 2);
  assert.strictEqual(gopkg.pathFor(3), 'gopkg.in/yaml.v3');

  const plain = majorLayout('github.com/foo/bar');
  assert.strictEqual(plain.major, 0);
  assert.strictEqual(plain.pathFor(2), 'github.com/foo/bar/v2');
});

test('resolveProxy honours GOPROXY lists and off', () => {
  assert.strictEqual(resolveProxy('https://custom/proxy/'), 'https://custom/proxy');
  assert.strictEqual(resolveProxy('https://a.example,direct'), 'https://a.example');
  assert.strictEqual(resolveProxy('off'), undefined);
  assert.strictEqual(resolveProxy(''), 'https://proxy.golang.org');
});

test('npmrc: nearest file wins and ${VAR} is expanded', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-deps-'));
  const nested = path.join(root, 'packages', 'app');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(root, '.npmrc'), 'registry=https://outer.example/\n@acme:registry=https://acme.example/\n');
  fs.writeFileSync(path.join(nested, '.npmrc'), 'registry=https://inner.example/\n//inner.example/:_authToken=${DEMO_TOKEN}\n');

  process.env.DEMO_TOKEN = 'secret-value';
  const config = readNpmConfig(nested);

  assert.strictEqual(config.get('registry'), 'https://inner.example/');
  assert.strictEqual(config.get('@acme:registry'), 'https://acme.example/');
  assert.strictEqual(authTokenFor(config, 'https://inner.example'), 'secret-value');
  assert.strictEqual(authTokenFor(config, 'https://other.example'), undefined);

  delete process.env.DEMO_TOKEN;
  fs.rmSync(root, { recursive: true, force: true });
});
