import { fetchJson } from '../http';
import { actionTagStyle, actionVersion, githubActionsScheme } from '../githubActions';
import type { RegistryVersions } from '../types';

export function githubActionVersions(tags: string[], spec: string): RegistryVersions {
  const all = tags.filter((tag) => actionVersion(tag) && actionTagStyle(tag) === actionTagStyle(spec));
  return all.length ? { all, latest: githubActionsScheme.max(all, { includePrerelease: false }) }
    : { error: 'no comparable tags found' };
}

export class GithubActionsClient {
  private readonly pending = new Map<string, Promise<string[] | undefined>>();
  constructor(private readonly timeoutMs: number) {}

  async fetchVersions(name: string, spec: string): Promise<RegistryVersions> {
    const key = name.toLowerCase();
    let promise = this.pending.get(key);
    if (!promise) {
      promise = this.tags(key);
      this.pending.set(key, promise);
    }
    const tags = await promise;
    return tags ? githubActionVersions(tags, spec) : { error: 'not found' };
  }

  private async tags(name: string): Promise<string[] | undefined> {
    const tags: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const result = await fetchJson<{ name: string }[]>(`https://api.github.com/repos/${name}/tags?per_page=100&page=${page}`,
        { timeoutMs: this.timeoutMs, headers: { 'X-GitHub-Api-Version': '2022-11-28' } });
      if (!result) return undefined;
      if (!Array.isArray(result) || result.some((tag) => typeof tag.name !== 'string')) throw new Error('invalid GitHub tags response');
      tags.push(...result.map((tag) => tag.name));
      if (result.length < 100) return tags;
    }
    throw new Error('GitHub tag pagination limit reached');
  }
}
