import { fetchJson } from '../http';
import { terraformScheme } from '../schemes';
import type { RegistryVersions } from '../types';

export interface TerraformVersions {
  versions?: { version?: string }[];
}

export class TerraformClient {
  constructor(private readonly timeoutMs: number) {}

  async fetchVersions(address: string): Promise<RegistryVersions> {
    const parts = address.toLowerCase().split('/');
    const host = parts.length === 3 ? parts.shift()! : 'registry.terraform.io';
    const [namespace, type] = parts;
    if (!namespace || !type) return { error: 'invalid provider address' };
    if (!['registry.terraform.io', 'registry.opentofu.org'].includes(host)) return { error: 'unsupported provider registry' };
    const doc = await fetchJson<TerraformVersions>(`https://${host}/v1/providers/${encodeURIComponent(namespace)}/${encodeURIComponent(type)}/versions`, { timeoutMs: this.timeoutMs });
    return doc ? terraformVersions(doc) : { error: 'not found' };
  }
}

export function terraformVersions(doc: TerraformVersions): RegistryVersions {
  const all = (doc.versions ?? []).flatMap((release) => release.version && terraformScheme.isVersion(release.version) ? [release.version] : []);
  const latest = terraformScheme.max(all, { includePrerelease: false });
  return all.length ? { latest, all } : { error: 'no comparable versions found' };
}
