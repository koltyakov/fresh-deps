import type { Settings } from '../settings';
import type { DependencyRef } from '../types';
import { normalizeName, PyPiClient } from '../registries/pypi';
import type { Lookup } from './types';

export function pythonLookup(settings: Settings): Lookup {
  const client = new PyPiClient({
    ...(settings.python.indexUrl ? { indexOverride: settings.python.indexUrl } : {}),
    timeoutMs: settings.requestTimeoutMs,
  });
  const clients = new Map<string, PyPiClient>();
  const clientFor = (dep: DependencyRef): PyPiClient => {
    if (!dep.source || settings.python.indexUrl) return client;
    let scoped = clients.get(dep.source);
    if (!scoped) {
      scoped = new PyPiClient({ indexOverride: dep.source, timeoutMs: settings.requestTimeoutMs });
      clients.set(dep.source, scoped);
    }
    return scoped;
  };
  return {
    key: (dep) => `python|${clientFor(dep).index}|${normalizeName(dep.name)}`,
    availabilitySource: (dep) => clientFor(dep).index,
    fetch: (dep) => clientFor(dep).fetchVersions(dep.name),
    fetchAudit: (dep, version) => clientFor(dep).fetchAudit(dep.name, version),
    async fetchDetails(dep, versions) {
      const [dates, meta] = await Promise.all([
        clientFor(dep).fetchPublishDates(dep.name, [versions.current, versions.latest, ...(versions.sameMajor ? [versions.sameMajor] : [])]),
        clientFor(dep).fetchInfo(dep.name, versions.latest),
      ]);
      return {
        currentPublishedAt: dates.get(versions.current),
        latestPublishedAt: dates.get(versions.latest),
        sameMajorPublishedAt: versions.sameMajor ? dates.get(versions.sameMajor) : undefined,
        ...(meta ? { meta } : {}),
      };
    },
  };
}
