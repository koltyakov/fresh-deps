import { fetchJson } from '../http';
import { semverScheme } from '../schemes';
import type { RegistryVersions } from '../types';

const BASE = 'https://builds.dotnet.microsoft.com/dotnet/release-metadata';
export interface SdkReleases { releases?: { sdk?: { version?: string }; sdks?: { version?: string }[] }[] }
export function sdkVersions(doc: SdkReleases): string[] {
  return (doc.releases ?? []).flatMap((release) => [release.sdk, ...(release.sdks ?? [])])
    .flatMap((sdk) => sdk?.version && semverScheme.isVersion(sdk.version) ? [sdk.version] : []);
}

export class DotnetSdkClient {
  constructor(private readonly timeoutMs: number) {}
  async fetchVersions(): Promise<RegistryVersions> {
    const opts = { timeoutMs: this.timeoutMs };
    const index = await fetchJson<{ 'releases-index'?: { 'channel-version'?: string }[] }>(`${BASE}/releases-index.json`, opts);
    if (!Array.isArray(index?.['releases-index'])) return { error: 'invalid .NET release index' };
    const channels = index['releases-index'].map((entry) => entry['channel-version']).filter((channel): channel is string => !!channel && /^\d+\.\d+$/.test(channel));
    const all: string[] = [];
    // Bound fan-out independently of the number of channels in the index.
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(channels.length, 4) }, async () => {
      while (cursor < channels.length) {
        const channel = channels[cursor++];
        const doc = await fetchJson<SdkReleases>(`${BASE}/${channel}/releases.json`, opts);
        if (!Array.isArray(doc?.releases)) throw new Error(`missing .NET ${channel} releases`);
        all.push(...sdkVersions(doc));
      }
    }));
    return all.length ? { all: [...new Set(all)], latest: semverScheme.max(all, { includePrerelease: false }) }
      : { error: 'no comparable SDK versions found' };
  }
}
