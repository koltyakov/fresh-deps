import { fetchJson } from '../http';
import { semverScheme } from '../schemes';
import type { RegistryVersions } from '../types';

export class SwiftClient {
  constructor(private readonly timeoutMs: number) {}
  async fetchVersions(name: string): Promise<RegistryVersions> {
    const all: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const doc = await fetchJson<{ name: string }[]>(`https://api.github.com/repos/${name}/tags?per_page=100&page=${page}`,
        { timeoutMs: this.timeoutMs, headers: { 'X-GitHub-Api-Version': '2022-11-28' } });
      if (!doc) return { error: 'not found' };
      if (!Array.isArray(doc) || doc.some((tag) => typeof tag.name !== 'string')) throw new Error('invalid GitHub tags response');
      all.push(...doc.map((tag) => tag.name).filter((tag) => semverScheme.isVersion(tag)));
      if (doc.length < 100) return all.length ? { all, latest: semverScheme.max(all, { includePrerelease: false }) }
        : { error: 'no comparable package tags found' };
    }
    throw new Error('GitHub tag pagination limit reached');
  }
}
