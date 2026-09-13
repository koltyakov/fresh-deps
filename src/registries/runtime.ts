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
    let published: string[] | undefined;
    let allComplete = false;
    let source: string;
    if (runtime === 'go') {
      source = 'https://go.dev/dl/';
      const doc = await fetchJson<{ version: string; stable: boolean }[]>('https://go.dev/dl/?mode=json&include=all', { timeoutMs: this.timeoutMs });
      all = (doc ?? []).filter((item) => item.stable).map((item) => item.version.replace(/^go/, '')).map((v) => /^\d+\.\d+$/.test(v) ? `${v}.0` : v);
      published = (doc ?? []).map((item) => item.version.replace(/^go/, '').replace(/^(\d+\.\d+)(beta|rc)(\d+)$/, '$1.0-$2.$3')).map((v) => /^\d+\.\d+$/.test(v) ? `${v}.0` : v);
      allComplete = Array.isArray(doc);
    } else if (runtime === 'gradle') {
      source = 'https://services.gradle.org/versions/all';
      const doc = await fetchJson<{ version: string; snapshot?: boolean; broken?: boolean }[]>('https://services.gradle.org/versions/all', { timeoutMs: this.timeoutMs });
      all = (doc ?? []).filter((item) => !item.snapshot && !item.broken).map((item) => /^\d+\.\d+$/.test(item.version) ? `${item.version}.0` : item.version);
      published = (doc ?? []).map((item) => /^\d+\.\d+$/.test(item.version) ? `${item.version}.0` : item.version);
      allComplete = Array.isArray(doc);
    } else if (runtime === 'terraform') {
      source = 'https://releases.hashicorp.com/terraform/';
      const doc = await fetchJson<{ versions?: Record<string, unknown> }>('https://releases.hashicorp.com/terraform/index.json', { timeoutMs: this.timeoutMs });
      all = Object.keys(doc?.versions ?? {});
      allComplete = !!doc?.versions;
    } else if (runtime === 'opentofu') {
      source = 'https://github.com/opentofu/opentofu';
      const tags = await githubTags('opentofu/opentofu', this.timeoutMs);
      all = (tags ?? []).map((tag) => tag.replace(/^v/, ''));
      allComplete = !!tags;
    } else {
      const repository = runtime === 'node' ? 'actions/node-versions' : 'actions/python-versions';
      source = `https://github.com/${repository}`;
      const doc = await fetchJson<{ version: string }[]>(`https://raw.githubusercontent.com/${repository}/main/versions-manifest.json`, { timeoutMs: this.timeoutMs });
      all = (doc ?? []).map((item) => item.version);
      allComplete = Array.isArray(doc);
    }
    all = all.filter((version) => semverScheme.isVersion(version));
    return allComplete ? { all, published: published?.filter(semverScheme.isVersion), allComplete, source, latest: semverScheme.max(all, { includePrerelease: false }) } : { error: 'No runtime releases found' };
  }
}
