import { fetchJson } from '../http';
import { actionRuntimes, actionTagStyle, actionVersion, githubActionsScheme } from '../githubActions';
import type { DependencyRef, RegistryVersions } from '../types';
import { githubTags, githubTagCommit } from './github';

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

  async fetchVersions(name: string, spec: string, revision?: string): Promise<RegistryVersions> {
    if (revision && (await githubTagCommit(name, spec, this.timeoutMs))?.toLowerCase() !== revision.toLowerCase()) return { error: 'SHA pin does not match the release tag in its comment' };
    const key = name.toLowerCase();
    let promise = this.pending.get(key);
    if (!promise) {
      promise = githubTags(key, this.timeoutMs);
      this.pending.set(key, promise);
    }
    const tags = await promise;
    const result = tags ? githubActionVersions(tags, spec) : { error: 'not found' };
    if (revision && result.latest) {
      const commit = await githubTagCommit(name, result.latest, this.timeoutMs);
      if (commit) return { ...result, revision: commit, latestRaw: `${result.latest} @ ${commit}` };
    }
    return result;
  }

}
