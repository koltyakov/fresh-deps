import { fetchJson } from '../http';
import { semverScheme } from '../schemes';
import { githubTags } from './github';
import type { DependencyRef, RegistryVersions } from '../types';
import { DotnetSdkClient } from './dotnetSdk';

export class RuntimeClient {
  constructor(private readonly timeoutMs: number) {}
  async fetch(runtime: NonNullable<DependencyRef['runtime']>): Promise<RegistryVersions> {
    if (runtime === 'dotnet') return new DotnetSdkClient(this.timeoutMs).fetchVersions();
    let all: string[] = [];
    if (runtime === 'go') {
      const doc = await fetchJson<{ version: string; stable: boolean }[]>('https://go.dev/dl/?mode=json&include=all', { timeoutMs: this.timeoutMs });
      all = (doc ?? []).filter((item) => item.stable).map((item) => item.version.replace(/^go/, '')).map((v) => /^\d+\.\d+$/.test(v) ? `${v}.0` : v);
    } else if (runtime === 'gradle') {
      const doc = await fetchJson<{ version: string; snapshot?: boolean; broken?: boolean }[]>('https://services.gradle.org/versions/all', { timeoutMs: this.timeoutMs });
      all = (doc ?? []).filter((item) => !item.snapshot && !item.broken).map((item) => /^\d+\.\d+$/.test(item.version) ? `${item.version}.0` : item.version);
    } else if (runtime === 'terraform') {
      const doc = await fetchJson<{ versions?: Record<string, unknown> }>('https://releases.hashicorp.com/terraform/index.json', { timeoutMs: this.timeoutMs });
      all = Object.keys(doc?.versions ?? {});
    } else if (runtime === 'opentofu') {
      all = (await githubTags('opentofu/opentofu', this.timeoutMs) ?? []).map((tag) => tag.replace(/^v/, ''));
    } else {
      const repository = runtime === 'node' ? 'actions/node-versions' : 'actions/python-versions';
      const doc = await fetchJson<{ version: string }[]>(`https://raw.githubusercontent.com/${repository}/main/versions-manifest.json`, { timeoutMs: this.timeoutMs });
      all = (doc ?? []).map((item) => item.version);
    }
    all = all.filter((version) => semverScheme.isVersion(version));
    return all.length ? { all, latest: semverScheme.max(all, { includePrerelease: false }) } : { error: 'No runtime releases found' };
  }
}
