import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../package.json';
import { readSettingsFrom } from '../src/settings';
import { configurationProperties, createSettings } from './settings';
import type { Uri } from 'vscode';

test('VS Code settings reads retain the requested resource scope and effective values', () => {
  const Module = require('node:module') as {
    _load: (id: string, parent: NodeModule | null | undefined, isMain?: boolean) => unknown;
  };
  const load = Module._load;
  const scope = { scheme: 'file', fsPath: '/workspace/package.json' } as Uri;
  const scopes: unknown[] = [];
  Module._load = function (id, ...args) {
    if (id !== 'vscode') return load.call(this, id, ...args);
    return { workspace: { getConfiguration: (section: string, resource: unknown) => {
      assert.equal(section, 'freshDeps');
      scopes.push(resource);
      return { get: (key: string) => key === 'npm.registry' && resource === scope
        ? 'https://workspace.example' : configurationProperties[`freshDeps.${key}`]?.default };
    } } };
  };
  const modulePath = require.resolve('../src/config');
  try {
    const { readSettings } = require('../src/config') as typeof import('../src/config');
    assert.equal(readSettings(scope).npm.registry, 'https://workspace.example');
    assert.equal(readSettings().npm.registry, '');
    assert.deepEqual(scopes, [scope, null]);
  } finally {
    Module._load = load;
    delete require.cache[modulePath];
  }
});

test('the reader covers every registered setting and maps its default to the matching field', () => {
  const entries = manifest.contributes.configuration.flatMap((group) => Object.entries(group.properties));
  assert.equal(new Set(entries.map(([key]) => key)).size, entries.length, 'setting keys must be unique');
  const reads: string[] = [];
  const settings = readSettingsFrom(<T>(key: string) => {
    reads.push(`freshDeps.${key}`);
    return configurationProperties[`freshDeps.${key}`]?.default as T | undefined;
  });
  assert.deepEqual(reads.sort(), entries.map(([key]) => key).sort());

  const actual: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key === 'auditEnabled') actual['freshDeps.audit.enabled'] = value;
    else if (typeof value !== 'object') actual[`freshDeps.${key}`] = value;
    else for (const [option, setting] of Object.entries(value)) actual[`freshDeps.${key}.${option}`] = setting;
  }
  assert.deepEqual(actual, Object.fromEntries(entries.map(([key, property]) => [key, property.default])));
});

test('effective values preserve false, zero, empty strings and empty arrays', () => {
  const overrides: Record<string, unknown> = {
    enabled: false, 'audit.enabled': true, cacheDurationMinutes: 0,
    'npm.registry': '', 'npm.sections': [], 'go.includeIndirect': true,
  };
  const settings = readSettingsFrom(<T>(key: string) =>
    (Object.hasOwn(overrides, key) ? overrides[key] : configurationProperties[`freshDeps.${key}`]?.default) as T);
  assert.equal(settings.enabled, false);
  assert.equal(settings.auditEnabled, true);
  assert.equal(settings.cacheDurationMinutes, 0);
  assert.equal(settings.npm.registry, '');
  assert.deepEqual(settings.npm.sections, []);
  assert.equal(settings.go.includeIndirect, true);
});

test('a missing registered value names the setting instead of silently using another default', () => {
  assert.throws(() => readSettingsFrom(() => undefined), /Missing registered setting: freshDeps.enabled/);
});

test('test settings merge ecosystem overrides and own their nested arrays', () => {
  const sections = ['dependencies'];
  const first = createSettings({ npm: { sections }, go: { includeIndirect: true } });
  const second = createSettings();
  first.npm.sections.push('devDependencies');
  first.gradle.repositories.length = 0;
  assert.deepEqual(sections, ['dependencies']);
  assert.equal(first.npm.enabled, true);
  assert.equal(first.go.includeIndirect, true);
  assert.equal(second.go.includeIndirect, false);
  assert.ok(second.gradle.repositories.length > 0);
  assert.deepEqual(second.npm.sections, configurationProperties['freshDeps.npm.sections'].default);
});
