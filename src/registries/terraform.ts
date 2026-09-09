import { fetchJson } from '../http';
import { terraformScheme } from '../schemes';
import type { RegistryVersions } from '../types';

export interface TerraformVersions {
  versions?: { version?: string }[];
}

export class TerraformClient {
  constructor(private readonly timeoutMs: number) {}

  async fetchVersions(address: string): Promise<RegistryVersions> {
    const [namespace, type] = address.toLowerCase().split('/');
    if (!namespace || !type) return { error: 'invalid provider address' };
    const doc = await fetchJson<TerraformVersions>(`https://registry.terraform.io/v1/providers/${encodeURIComponent(namespace)}/${encodeURIComponent(type)}/versions`, { timeoutMs: this.timeoutMs });
    return doc ? terraformVersions(doc) : { error: 'not found' };
  }
}

export function terraformVersions(doc: TerraformVersions): RegistryVersions {
  const all = (doc.versions ?? []).flatMap((release) => release.version && terraformScheme.isVersion(release.version) ? [release.version] : []);
  const latest = terraformScheme.max(all, { includePrerelease: false });
  return all.length ? { latest, all } : { error: 'no comparable versions found' };
}
