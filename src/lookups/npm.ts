import { dirname } from 'path';
import type { Settings } from '../settings';
import type { DependencyRef } from '../types';
import { NpmClient } from '../registries/npm';
import { githubCommitVersions } from '../registries/githubCommit';
import type { Lookup } from './types';

export function npmLookup(fsPath: string, settings: Settings): Lookup {
  const client = new NpmClient({
    ...(settings.npm.registry ? { registryOverride: settings.npm.registry } : {}),
    cwd: dirname(fsPath),
    timeoutMs: settings.requestTimeoutMs,
  });
  const clients = new Map<string, NpmClient>();
  const clientFor = (dep: DependencyRef) => {
    if (!dep.source || settings.npm.registry) return client;
    let scoped = clients.get(dep.source);
    if (!scoped) {
      scoped = new NpmClient({ registryOverride: dep.source, cwd: dirname(fsPath), timeoutMs: settings.requestTimeoutMs });
      clients.set(dep.source, scoped);
    }
    return scoped;
  };
  return {
    key: (dep) => dep.githubRepository ? `npm|github.com|${dep.githubRepository.toLowerCase()}|${dep.spec}` : `npm|${clientFor(dep).registryFor(dep.name)}|${dep.name}`,
    availabilitySource: (dep) => dep.githubRepository ? `https://github.com/${dep.githubRepository}` : clientFor(dep).registryFor(dep.name),
    fetch: (dep) => dep.githubRepository ? githubCommitVersions(dep.githubRepository, dep.spec, settings.requestTimeoutMs) : clientFor(dep).fetchLatest(dep.name),
    fetchAll: (dep) => dep.githubRepository ? githubCommitVersions(dep.githubRepository, dep.spec, settings.requestTimeoutMs) : clientFor(dep).fetchAll(dep.name),
    fetchAudit: (dep, version) => dep.githubRepository ? Promise.resolve({ status: 'unsupported' }) : clientFor(dep).fetchAudit(dep.name, version),
    async fetchDetails(dep, versions) {
      if (dep.githubRepository) return {};
      const dates = await clientFor(dep).fetchPublishDates(dep.name, [versions.current, versions.latest, ...(versions.sameMajor ? [versions.sameMajor] : [])]);
      return {
        currentPublishedAt: dates.get(versions.current),
        latestPublishedAt: dates.get(versions.latest),
        sameMajorPublishedAt: versions.sameMajor ? dates.get(versions.sameMajor) : undefined,
      };
    },
  };
}
