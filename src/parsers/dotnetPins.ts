import { isMap, isScalar } from 'yaml';
import * as semver from 'semver';
import { nugetScheme } from '../nuget';
import type { DependencyRef } from '../types';
import { yamlDocument, yamlString } from './yaml';

export function sdkRange(version: string, policy: string): string | undefined {
  if (!semver.valid(version)) return undefined;
  const { major, minor, patch } = new semver.SemVer(version);
  switch (policy) {
    case 'disable': return version;
    case 'patch': case 'latestPatch': return `>=${version} <${major}.${minor}.${Math.floor(patch / 100) * 100 + 100}`;
    case 'feature': case 'latestFeature': return `>=${version} <${major}.${minor + 1}.0`;
    case 'minor': case 'latestMinor': return `>=${version} <${major + 1}.0.0`;
    case 'major': case 'latestMajor': return `>=${version}`;
    default: return undefined;
  }
}

export function parseDotnetPins(text: string, sdk: boolean): DependencyRef[] {
  // JSON is a YAML subset; requiring valid JSON prevents YAML-only constructs here.
  try { JSON.parse(text); } catch { return []; }
  const doc = yamlDocument(text);
  if (!doc) return [];
  if (sdk) {
    const node = doc.root.get('sdk', true);
    if (!isMap(node)) return [];
    const versionNode = node.get('version', true);
    const version = yamlString(versionNode);
    const policyNode = node.get('rollForward', true);
    const policy = policyNode === undefined ? 'patch' : yamlString(policyNode);
    const allow = node.get('allowPrerelease', true);
    if (allow !== undefined && (!isScalar(allow) || typeof allow.value !== 'boolean')) return [];
    const spec = version && policy && sdkRange(version, policy);
    return spec ? [{ name: 'dotnet-sdk', spec, specRaw: version, semver: true,
      allowPrerelease: allow === undefined || (isScalar(allow) && allow.value === true), line: doc.line(versionNode), section: 'sdk' }] : [];
  }
  const tools = doc.root.get('tools', true);
  if (!isMap(tools)) return [];
  return tools.items.flatMap((tool) => {
    const name = yamlString(tool.key);
    if (!name || !/^[\w.-]+$/.test(name) || !isMap(tool.value)) return [];
    const node = tool.value.get('version', true);
    const spec = yamlString(node);
    return spec && nugetScheme.isVersion(spec) ? [{ name, spec: `[${spec}]`, specRaw: spec, line: doc.line(node), section: 'tools' }] : [];
  });
}
