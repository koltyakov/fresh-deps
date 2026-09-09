import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestOf } from '../src/analyzer';
import { parseGemfile, parseGemspec } from '../src/parsers/gemfile';
import { parseMixExs } from '../src/parsers/mixExs';
import { parseTerraform } from '../src/parsers/terraform';
import { compareRubyVersions, rubyScheme } from '../src/ruby';
import { hexScheme, terraformScheme } from '../src/schemes';
import { rubyGemsVersions } from '../src/registries/rubygems';
import { hexVersions } from '../src/registries/hex';
import { terraformVersions } from '../src/registries/terraform';
import manifest from '../package.json';

const stable = { includePrerelease: false };

test('Ruby, Terraform and Elixir manifests are recognized and activate the extension', () => {
  for (const [file, ecosystem, activation] of [
    ['Gemfile', 'ruby', 'Gemfile'], ['demo.gemspec', 'ruby', '*.gemspec'],
    ['mix.exs', 'elixir', 'mix.exs'], ['providers.tf', 'terraform', '*.tf'],
  ]) {
    assert.equal(manifestOf(`/project/${file}`)?.ecosystem, ecosystem);
    assert.ok(manifest.activationEvents.includes(`workspaceContains:**/${activation}`));
  }
});

test('Gemfile parses literal public gems and skips non-registry declarations', () => {
  const text = [
    'source "https://rubygems.org"',
    'gem "rails", "~> 7.1", ">= 7.1.2" # app',
    'gem(',
    '  "rspec",',
    '  "~> 3.12"',
    ')',
    'gem "local", "1.0", path: "../local"',
    'gem "git_gem", "1.0", github: "org/repo"',
    'gem "unconstrained"',
    'gem "dynamic", "#{ENV[\"VERSION\"]}"',
  ].join('\n');
  assert.deepEqual(parseGemfile(text), [
    { name: 'rails', spec: '~> 7.1, >= 7.1.2', line: 1, section: 'gems' },
    { name: 'rspec', spec: '~> 3.12', line: 4, section: 'gems' },
  ]);
  assert.deepEqual(parseGemfile('source "https://gems.example" do\n  gem "private", "1.0"\nend'), []);
  assert.deepEqual(parseGemfile('source ENV.fetch("GEM_SOURCE")\ngem "private", "1.0"'), []);
  assert.deepEqual(parseGemspec('spec.add_dependency "rack", "~> 3.0"\nspec.add_development_dependency "rspec", "~> 3.12"'), [
    { name: 'rack', spec: '~> 3.0', line: 0, section: 'gems' },
    { name: 'rspec', spec: '~> 3.12', line: 1, section: 'development_dependencies' },
  ]);
});

test('RubyGems version rules handle pessimistic bounds and prereleases', () => {
  assert.ok(compareRubyVersions('1.0', '1.0.pre') > 0);
  assert.equal(compareRubyVersions('1.0.0', '1.0'), 0);
  assert.equal(rubyScheme.baseline('~> 2.1, >= 2.1.4'), '2.1.4');
  assert.equal(rubyScheme.satisfies('2.9.0', '~> 2.1', stable), true);
  assert.equal(rubyScheme.satisfies('3.0.0', '~> 2.1', stable), false);
  assert.equal(rubyScheme.satisfies('2.2.0', '~> 2.1.4', stable), false);
  assert.equal(rubyScheme.satisfies('2.1.5.pre', '~> 2.1.4', stable), false);
});

test('Terraform reads required providers, aliases, defaults and literal constraints', () => {
  const text = [
    'terraform {',
    '  required_providers {',
    '    aws = {',
    '      source = "hashicorp/aws"',
    '      version = "~> 5.0"',
    '    }',
    '    google-beta = { source = "hashicorp/google-beta", version = ">= 6.0, < 7.0" }',
    '    random = "3.6.0"',
    '    custom = { source = "private.example/acme/custom", version = "1.0.0" }',
    '  }',
    '}',
    'resource "x" "y" { version = "9.0.0" }',
  ].join('\n');
  assert.deepEqual(parseTerraform(text), [
    { name: 'hashicorp/aws', spec: '~> 5.0', line: 4, section: 'required_providers' },
    { name: 'hashicorp/google-beta', spec: '>= 6.0, < 7.0', line: 6, section: 'required_providers' },
    { name: 'hashicorp/random', spec: '3.6.0', line: 7, section: 'required_providers' },
  ]);
  assert.deepEqual(parseTerraform(`# terraform { required_providers { bad = "1.0.0" } }\n${text}`), [
    { name: 'hashicorp/aws', spec: '~> 5.0', line: 5, section: 'required_providers' },
    { name: 'hashicorp/google-beta', spec: '>= 6.0, < 7.0', line: 7, section: 'required_providers' },
    { name: 'hashicorp/random', spec: '3.6.0', line: 8, section: 'required_providers' },
  ]);
});

test('Terraform and Hex translate their pessimistic constraints', () => {
  assert.equal(terraformScheme.baseline('~> 5.0, >= 5.2.0'), '5.2.0');
  assert.equal(terraformScheme.satisfies('5.9.0', '~> 5.0', stable), true);
  assert.equal(terraformScheme.satisfies('6.0.0', '~> 5.0', stable), false);
  assert.equal(terraformScheme.satisfies('1.2.9', '1.2', stable), false);
  assert.equal(terraformScheme.satisfies('1.5.0', '>= 1.0, != 1.5.0, < 2.0', stable), false);
  assert.equal(terraformScheme.satisfies('1.6.0', '>= 1.0, != 1.5.0, < 2.0', stable), true);
  assert.equal(hexScheme.satisfies('1.9.0', '~> 1.2', stable), true);
  assert.equal(hexScheme.satisfies('2.0.0', '~> 1.2', stable), false);
  assert.equal(hexScheme.satisfies('1.5.0', '>= 1.2 and < 2.0', stable), true);
  assert.equal(hexScheme.satisfies('2.5.0', '~> 1.0 or ~> 2.0', stable), true);
});

test('mix.exs parses literal Hex dependencies and aliases', () => {
  const text = [
    'defmodule Demo.MixProject do',
    '  defp deps do',
    '    [',
    '      {:phoenix, "~> 1.7.0"},',
    '      {:json, ">= 1.0 and < 2.0", hex: :jason},',
    '      {:local, "~> 1.0", path: "../local"},',
    '      {:git_dep, "~> 1.0", git: "https://example/repo"}',
    '    ]',
    '  end',
    'end',
  ].join('\n');
  assert.deepEqual(parseMixExs(text), [
    { name: 'phoenix', spec: '~> 1.7.0', line: 3, section: 'deps' },
    { name: 'jason', spec: '>= 1.0 and < 2.0', line: 4, section: 'deps', alias: 'json' },
  ]);
});

test('new registries select stable versions and preserve full version lists', () => {
  const gems = rubyGemsVersions([
    { number: '1.9.0', created_at: '2026-01-01', licenses: ['MIT'] },
    { number: '2.0.0.pre' }, { number: 'invalid version' },
  ]);
  assert.equal(gems.latest, '1.9.0');
  assert.deepEqual(gems.all, ['1.9.0', '2.0.0.pre']);
  assert.equal(gems.meta?.license, 'MIT');

  const hex = hexVersions({ latest_stable_version: '1.8.0', releases: [
    { version: '1.8.0', inserted_at: '2026-01-01' }, { version: '2.0.0-rc.1' },
  ], meta: { description: 'Web framework', licenses: ['MIT'] } });
  assert.equal(hex.latest, '1.8.0');
  assert.deepEqual(hex.all, ['1.8.0', '2.0.0-rc.1']);

  const providers = terraformVersions({ versions: [
    { version: '5.0.0' }, { version: '6.0.0-beta.1' }, { version: 'bad' },
  ] });
  assert.equal(providers.latest, '5.0.0');
  assert.deepEqual(providers.all, ['5.0.0', '6.0.0-beta.1']);
});
