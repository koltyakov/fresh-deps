import { githubTags } from './github';
import { semverScheme } from '../schemes';
import type { RegistryVersions } from '../types';
import { fetchJson } from '../http';

export class SwiftClient {
  constructor(private readonly timeoutMs: number) {}
  async fetchVersions(name: string, source?: string): Promise<RegistryVersions> {
    if (source?.startsWith('https://')) {
      const doc = await fetchJson<{ releases?: Record<string, { problem?: unknown }> }>(`${source}/${name.replace('.', '/')}`, { timeoutMs: this.timeoutMs, headers: { accept: 'application/vnd.swift.registry.v1+json' } });
      if (!doc?.releases) return { error: 'not found' };
      const all = Object.keys(doc.releases).filter((version) => !doc.releases![version].problem && semverScheme.isVersion(version));
      return { all, latest: semverScheme.max(all, { includePrerelease: false }) };
    }
    if (source === 'gitlab.com' || source === 'bitbucket.org') {
      const all: string[] = [];
      for (let page = 1; page <= 10; page++) {
        const url = source === 'gitlab.com' ? `https://gitlab.com/api/v4/projects/${encodeURIComponent(name)}/repository/tags?per_page=100&page=${page}`
          : `https://api.bitbucket.org/2.0/repositories/${name}/refs/tags?pagelen=100&page=${page}`;
        const doc = await fetchJson<{ name: string }[] | { values: { name: string }[]; next?: string }>(url, { timeoutMs: this.timeoutMs });
        if (!doc) return { error: 'not found' };
        const values = Array.isArray(doc) ? doc : doc.values;
        if (!Array.isArray(values)) return { error: 'Invalid Git tag response' };
        all.push(...values.map((tag) => tag.name).filter((tag) => semverScheme.isVersion(tag)));
        if (values.length < 100 || !Array.isArray(doc) && !doc.next) return { all, latest: semverScheme.max(all, { includePrerelease: false }) };
      }
      return { error: 'Git tag pagination limit reached' };
    }
    if (source) return { error: 'Swift registry is not configured' };
    const tags = await githubTags(name, this.timeoutMs);
    if (!tags) return { error: 'not found' };
    const all = tags.filter((tag) => semverScheme.isVersion(tag));
    return all.length ? { all, latest: semverScheme.max(all, { includePrerelease: false }) }
      : { error: 'no comparable package tags found' };
  }
}
