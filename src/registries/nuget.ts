import { fetchJson } from '../http';
import { nugetScheme } from '../nuget';
import type { RegistryVersions } from '../types';

const DEFAULT_INDEX = 'https://api.nuget.org/v3/index.json';

interface ServiceIndex {
  resources?: { '@id'?: string; '@type'?: string | string[] }[];
}

interface VersionIndex {
  versions?: string[];
}

export class NugetClient {
  readonly index: string;
  private packageBaseAddress?: Promise<string>;

  constructor(indexOverride: string, private readonly timeoutMs: number) {
    this.index = (indexOverride || DEFAULT_INDEX).replace(/\/+$/, '');
  }

  async fetchVersions(name: string): Promise<RegistryVersions> {
    const base = await this.baseAddress();
    const id = name.toLowerCase();
    const body = await fetchJson<VersionIndex>(`${base}/${encodeURIComponent(id)}/index.json`, {
      timeoutMs: this.timeoutMs,
    });
    if (!body?.versions?.length) return { error: 'not found' };
    const all = body.versions.filter(nugetScheme.isVersion);
    const latest = nugetScheme.max(all, { includePrerelease: false });
    return latest ? { latest, all } : { error: 'no stable versions found' };
  }

  private baseAddress(): Promise<string> {
    this.packageBaseAddress ??= this.resolveBaseAddress();
    return this.packageBaseAddress;
  }

  private async resolveBaseAddress(): Promise<string> {
    const body = await fetchJson<ServiceIndex>(this.index, { timeoutMs: this.timeoutMs });
    const resource = body?.resources?.find((candidate) => {
      const types = Array.isArray(candidate['@type']) ? candidate['@type'] : [candidate['@type']];
      return types.some((type) => type?.startsWith('PackageBaseAddress/'));
    });
    if (!resource?.['@id']) throw new Error('NuGet source has no PackageBaseAddress resource');
    return resource['@id'].replace(/\/+$/, '');
  }
}
