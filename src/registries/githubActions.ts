import { fetchJson } from '../http';
import { actionRuntimes, actionTagStyle, actionVersion, githubActionsScheme } from '../githubActions';
import type { DependencyRef, RegistryVersions } from '../types';

/** Runtime selectors resolve full releases, but updates keep the selector's precision. */
export function actionRuntimeVersions(versions: string[], spec: string): RegistryVersions {
  const precision = spec.replace(/^v/, '').split('-')[0].split('.').length;
  const prefix = spec.startsWith('v') ? 'v' : '';
  const all = [...new Set(versions.flatMap((version) => {
    const normalized = actionVersion(version);
    if (!normalized) return [];
    // A prerelease cannot be represented by a moving major/minor selector.
    if (precision < 3 && githubActionsScheme.isPrerelease(normalized)) return [];
    return [prefix + (precision === 3 ? normalized : normalized.split('.').slice(0, precision).join('.'))];
  }))];
  return all.length ? { all, latest: githubActionsScheme.max(all, { includePrerelease: false }) }
    : { error: 'no comparable runtime versions found' };
}

export function githubActionVersions(tags: string[], spec: string): RegistryVersions {
  const all = tags.filter((tag) => actionVersion(tag) && actionTagStyle(tag) === actionTagStyle(spec));
  return all.length ? { all, latest: githubActionsScheme.max(all, { includePrerelease: false }) }
    : { error: 'no comparable tags found' };
}

export class GithubActionsClient {
  private readonly pending = new Map<string, Promise<string[] | undefined>>();
  private readonly runtimes = new Map<string, Promise<string[] | undefined>>();
  constructor(private readonly timeoutMs: number) {}

  async fetchRuntimeVersions(runtime: NonNullable<DependencyRef['actionRuntime']>, spec: string): Promise<RegistryVersions> {
    let promise = this.runtimes.get(runtime);
    if (!promise) {
      promise = this.runtimeVersions(runtime);
      this.runtimes.set(runtime, promise);
    }
    const versions = await promise;
    return versions ? actionRuntimeVersions(versions, spec) : { error: 'not found' };
  }

  private async runtimeVersions(runtime: NonNullable<DependencyRef['actionRuntime']>): Promise<string[] | undefined> {
    const result = await fetchJson<{ version: string }[]>(
      `https://raw.githubusercontent.com/${actionRuntimes[runtime].repository}/main/versions-manifest.json`,
      { timeoutMs: this.timeoutMs });
    if (!result) return undefined;
    if (!Array.isArray(result) || result.some((release) => !release || typeof release.version !== 'string')) {
      throw new Error('invalid GitHub runtime manifest response');
    }
    return result.map((release) => release.version);
  }

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
