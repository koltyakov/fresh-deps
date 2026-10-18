import type { Settings } from '../settings';
import { GoClient } from '../registries/go';
import type { Lookup } from './types';

export function goLookup(settings: Settings): Lookup | undefined {
  const client = new GoClient({
    ...(settings.go.proxy ? { proxyOverride: settings.go.proxy } : {}),
    checkMajorVersions: settings.go.checkMajorVersions,
    timeoutMs: settings.requestTimeoutMs,
  });
  if (!client.proxy) return undefined;
  return {
    key: (dep) => `go|${client.proxy}|${dep.name}|${settings.go.checkMajorVersions ? 'major' : 'base'}`,
    fetch: (dep) => client.fetchLatest(dep.name),
    availabilitySource: () => client.proxy!,
    fetchAvailability: (dep) => client.fetchAvailability(dep.name, dep.spec),
    async fetchDetails(dep, versions) {
      const [currentPublishedAt, sameMajorPublishedAt] = await Promise.all([
        client.fetchPublishDate(dep.name, versions.current),
        versions.sameMajor ? client.fetchPublishDate(dep.name, versions.sameMajor) : undefined,
      ]);
      return { currentPublishedAt, sameMajorPublishedAt };
    },
  };
}
