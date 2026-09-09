import { fetchJson } from '../http';
import { semverScheme, terraformScheme } from '../schemes';
import type { RegistryVersions } from '../types';

export interface TerraformVersions {
  versions?: { version?: string }[];
}

export class TerraformClient {
  private readonly services = new Map<string, Promise<Record<string, string> | undefined>>();
  constructor(private readonly timeoutMs: number) {}

  private async service(host: string, kind: 'providers' | 'modules'): Promise<string | undefined> {
    if (['registry.terraform.io', 'registry.opentofu.org'].includes(host)) return `https://${host}/v1/${kind}/`;
    let promise = this.services.get(host);
    if (!promise) {
      promise = fetchJson<Record<string, string>>(`https://${host}/.well-known/terraform.json`, { timeoutMs: this.timeoutMs });
      this.services.set(host, promise);
    }
    const value = (await promise)?.[`${kind}.v1`];
    if (!value) return undefined;
    const url = new URL(value, `https://${host}`);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href.replace(/\/?$/, '/') : undefined;
  }

  async fetchVersions(address: string): Promise<RegistryVersions> {
    if (address.startsWith('tflint:')) return this.fetchPluginVersions(address.slice(7));
    if (address.startsWith('module:')) {
      const match = /^module:([\w.-]+)\/([\w-]+\/[\w-]+\/[\w-]+)$/.exec(address);
      if (!match) return { error: 'invalid module address' };
      const base = await this.service(match[1], 'modules');
      if (!base) return { error: 'Registry does not advertise a modules service' };
      const token = process.env[`TF_TOKEN_${match[1].replace(/\./g, '_').replace(/-/g, '__')}`];
      const doc = await fetchJson<{ modules?: TerraformVersions[] }>(`${base}${match[2]}/versions`, { timeoutMs: this.timeoutMs,
        headers: token && new URL(base).hostname === match[1] ? { authorization: `Bearer ${token}` } : undefined });
      return doc ? terraformVersions({ versions: doc.modules?.flatMap((module) => module.versions ?? []) }) : { error: 'not found' };
    }
    const parts = address.toLowerCase().split('/');
    const host = parts.length === 3 ? parts.shift()! : 'registry.terraform.io';
    const [namespace, type] = parts;
    if (!namespace || !type) return { error: 'invalid provider address' };
    if (!/^[\w.-]+$/.test(host)) return { error: 'invalid provider registry' };
    const base = await this.service(host, 'providers');
    if (!base) return { error: 'Registry does not advertise a providers service' };
    const token = process.env[`TF_TOKEN_${host.replace(/\./g, '_').replace(/-/g, '__')}`];
    const doc = await fetchJson<TerraformVersions>(`${base}${encodeURIComponent(namespace)}/${encodeURIComponent(type)}/versions`, { timeoutMs: this.timeoutMs,
      headers: token && new URL(base).hostname === host ? { authorization: `Bearer ${token}` } : undefined });
    return doc ? terraformVersions(doc) : { error: 'not found' };
  }
  private async fetchPluginVersions(repository: string): Promise<RegistryVersions> {
    if (!/^[\w-]+\/[\w.-]+$/.test(repository)) return { error: 'invalid TFLint plugin source' };
    const all: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const releases = await fetchJson<{ tag_name: string; draft?: boolean; prerelease?: boolean }[]>(
        `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`,
        { timeoutMs: this.timeoutMs, headers: { 'X-GitHub-Api-Version': '2022-11-28' } });
      if (!releases) return { error: 'not found' };
      if (!Array.isArray(releases) || releases.some((release) => typeof release.tag_name !== 'string')) {
        throw new Error('invalid GitHub releases response');
      }
      for (const release of releases) {
        const version = release.tag_name.replace(/^v/, '');
        if (!release.draft && !release.prerelease && semverScheme.isVersion(version)) all.push(version);
      }
      if (releases.length < 100) return all.length
        ? { all, latest: semverScheme.max(all, { includePrerelease: false }) }
        : { error: 'no comparable plugin releases found' };
    }
    throw new Error('GitHub release pagination limit reached');
  }
}

export function terraformVersions(doc: TerraformVersions): RegistryVersions {
  const all = (doc.versions ?? []).flatMap((release) => release.version && terraformScheme.isVersion(release.version) ? [release.version] : []);
  const latest = terraformScheme.max(all, { includePrerelease: false });
  return all.length ? { latest, all } : { error: 'no comparable versions found' };
}
