import type { Settings } from '../settings';
import type { DependencyRef, Ecosystem, RegistryVersions } from '../types';
import { schemeFor } from '../schemes';
import { dockerTag } from '../docker';
import { actionTagStyle } from '../githubActions';
import { AnsibleClient } from '../registries/ansible';
import { BazelClient } from '../registries/bazel';
import { VcpkgClient } from '../registries/vcpkg';
import { DockerClient } from '../registries/docker';
import { HelmClient } from '../registries/helm';
import { SwiftClient } from '../registries/swift';
import { ConanClient } from '../registries/conan';
import { CondaClient, condaSubdir } from '../registries/conda';
import { DotnetSdkClient } from '../registries/dotnetSdk';
import { JsrClient } from '../registries/jsr';
import { GithubActionsClient } from '../registries/githubActions';
import { CratesClient } from '../registries/crates';
import { NugetClient } from '../registries/nuget';
import { MavenClient } from '../registries/maven';
import { PackagistClient } from '../registries/packagist';
import { PubClient } from '../registries/pub';
import { RubyGemsClient } from '../registries/rubygems';
import { TerraformClient } from '../registries/terraform';
import { HexClient } from '../registries/hex';
import { npmLookup } from './npm';
import { goLookup } from './go';
import { pythonLookup } from './python';
import type { Lookup } from './types';

/** Shared by analysis and hovers. Adapters do not depend on editor state. */
export function lookupFor(
  ecosystem: Ecosystem,
  fsPath: string,
  settings: Settings
): Lookup | undefined {
  switch (ecosystem) {
    case 'ansible': {
      const client = new AnsibleClient(settings.requestTimeoutMs);
      return {
        key: (dep) => `ansible|${dep.source ?? 'galaxy.ansible.com'}|${dep.section}|${dep.name}`,
        fetch: (dep) => client.fetchVersions(dep.name, dep.section === 'roles', dep.source),
      };
    }
    case 'bazel': {
      const client = new BazelClient(settings.requestTimeoutMs);
      return {
        key: (dep) => `bazel|${dep.source ?? 'bcr.bazel.build'}|${dep.name}`,
        fetch: (dep) => client.fetchVersions(dep.name, dep.source),
        fetchAvailability: (dep, known) =>
          sourceAvailability(
            known,
            (dep.source ?? 'https://bcr.bazel.build')
              .split('|')
              .map((source) => ({ source, fetch: () => client.fetchVersions(dep.name, source) }))
          ),
        fetchDetails: async (dep, versions) => ({
          meta: {
            compatibilityLevel: await client.compatibility(dep.name, versions.latest, dep.source),
          },
        }),
      };
    }
    case 'vcpkg': {
      const client = new VcpkgClient(settings.requestTimeoutMs);
      return {
        key: (dep) =>
          `vcpkg|microsoft/vcpkg|${dep.name}|${dep.spec}|${dep.source}|${dep.vcpkgVersionField ?? ''}`,
        fetch: (dep) => client.fetchVersions(dep.name, dep.spec, dep.vcpkgVersionField, dep.source),
      };
    }
    case 'docker': {
      const client = new DockerClient(settings.requestTimeoutMs);
      return {
        key: (dep) =>
          `docker|${dep.source ?? 'hub.docker.com'}|${dep.name}|${dockerTag(dep.spec)?.style}|${dep.revision ?? ''}`,
        fetch: (dep) => client.fetchVersions(dep.name, dep.spec, dep.source, dep.revision),
      };
    }
    case 'helm': {
      const client = new HelmClient(settings.requestTimeoutMs);
      return {
        key: (dep) => `helm|${dep.source}|${dep.name}`,
        fetch: (dep) => client.fetchVersions(dep.name, dep.source!),
      };
    }
    case 'swift': {
      const client = new SwiftClient(settings.requestTimeoutMs);
      return {
        key: (dep) => `swift|${dep.source ?? 'github.com'}|${dep.name.toLowerCase()}`,
        fetch: (dep) => client.fetchVersions(dep.name, dep.source),
      };
    }
    case 'conan': {
      const client = new ConanClient(settings.requestTimeoutMs);
      return {
        key: (dep) =>
          `conan|${client.remotes.map((remote) => remote.url).join('|') || 'conan-center-index'}|${dep.name}|${dep.revision ?? ''}`,
        fetch: (dep) => client.fetchVersions(dep.name, dep.revision),
      };
    }
    case 'conda': {
      const client = new CondaClient(
        settings.requestTimeoutMs,
        settings.conda.subdir || condaSubdir()
      );
      return {
        key: (dep) => `conda|${dep.source}|${client.subdir}|${dep.name}`,
        fetch: (dep) => client.fetchVersions(dep.name, dep.source!),
      };
    }
    case 'scala': {
      const lookup = mavenRepositoriesLookup(
        ecosystem,
        settings.scala.repositories,
        settings.requestTimeoutMs
      );
      return {
        ...lookup,
        key: (dep) => `${lookup.key(dep)}|${dep.variants?.join(',') ?? ''}`,
        async fetchAvailability(dep, known) {
          if (!dep.variants?.length) return lookup.fetchAvailability!(dep, known);
          const results = await Promise.all(
            dep.variants.map(async (name) => {
              const variant = { ...dep, name, variants: undefined };
              return lookup.fetchAvailability!(variant, await lookup.fetch(variant));
            })
          );
          const published =
            results[0].published?.filter((version) =>
              results.every((result) => result.published?.includes(version))
            ) ?? [];
          return {
            published,
            allComplete: results.every((result) => result.allComplete),
            source: results[0].source,
          };
        },
        async fetch(dep) {
          if (!dep.variants?.length) return lookup.fetch(dep);
          const results = await Promise.all(
            dep.variants.map((name) => lookup.fetch({ ...dep, name }))
          );
          const failure = results.find((result) => result.error);
          if (failure) return failure;
          const all =
            results[0].all?.filter((version) =>
              results.every((result) => result.all?.includes(version))
            ) ?? [];
          return {
            all,
            allComplete: results.every((result) => result.allComplete),
            source: results[0].source,
            latest: schemeFor('scala').max(all, { includePrerelease: false }),
          };
        },
      };
    }
    case 'clojure':
      return mavenRepositoriesLookup(
        ecosystem,
        settings.clojure.repositories,
        settings.requestTimeoutMs
      );
    case 'deno': {
      const npm = npmLookup(fsPath, settings);
      const jsr = new JsrClient(settings.requestTimeoutMs);
      const unprefixed = (dep: DependencyRef): DependencyRef => ({
        ...dep,
        name: dep.name.slice(4),
      });
      return {
        key: (dep) =>
          dep.name.startsWith('npm:') ? npm.key(unprefixed(dep)) : `deno|jsr.io|${dep.name}`,
        availabilitySource: (dep) =>
          dep.name.startsWith('npm:') ? npm.availabilitySource!(unprefixed(dep)) : 'https://jsr.io',
        fetch: (dep) =>
          dep.name.startsWith('npm:')
            ? npm.fetch(unprefixed(dep))
            : jsr.fetchVersions(dep.name.slice(4)),
        fetchAll: (dep) =>
          dep.name.startsWith('npm:')
            ? npm.fetchAll!(unprefixed(dep))
            : jsr.fetchVersions(dep.name.slice(4)),
        fetchAudit: (dep, version) =>
          dep.name.startsWith('npm:')
            ? npm.fetchAudit!(unprefixed(dep), version)
            : Promise.resolve({ status: 'unsupported' }),
        fetchDetails: (dep, versions) =>
          dep.name.startsWith('npm:')
            ? npm.fetchDetails!(unprefixed(dep), versions)
            : Promise.resolve({}),
      };
    }
    case 'githubActions': {
      const client = new GithubActionsClient(settings.requestTimeoutMs);
      return {
        availabilitySource: (dep) =>
          dep.actionRuntime
            ? `GitHub Actions ${dep.actionRuntime} release manifest`
            : `https://github.com/${dep.name}`,
        key: (dep) =>
          dep.actionRuntime
            ? `githubActions|runtime|${dep.actionRuntime}|${dep.matrixVersions ? '3' : actionTagStyle(dep.spec)}`
            : `githubActions|github.com|${dep.name.toLowerCase()}|${actionTagStyle(dep.spec)}${dep.revision ? `|${dep.revision}` : ''}`,
        fetch: (dep) =>
          dep.actionRuntime
            ? client.fetchRuntimeVersions(
                dep.actionRuntime,
                dep.matrixVersions ? '0.0.0' : dep.spec
              )
            : client.fetchVersions(dep.name, dep.spec, dep.revision),
      };
    }
    case 'npm':
      return npmLookup(fsPath, settings);
    case 'go':
      return goLookup(settings);
    case 'python':
      return pythonLookup(settings);
    case 'rust': {
      const client = new CratesClient(settings.requestTimeoutMs);
      return {
        key: (dep) =>
          `rust|${dep.source ?? 'crates.io'}|${dep.name.toLowerCase().replace(/_/g, '-')}`,
        fetch: (dep) => client.fetchVersions(dep.name, dep.source),
      };
    }
    case 'dotnet':
      return dotnetLookup(settings);
    case 'java': {
      const client = new MavenClient(settings.java.repository, settings.requestTimeoutMs);
      return {
        key: (dep) => `maven|${client.repository}|${dep.name}`,
        fetch: (dep) => client.fetchVersions(dep.name),
      };
    }
    case 'gradle':
      return mavenRepositoriesLookup(
        'gradle',
        settings.gradle.repositories,
        settings.requestTimeoutMs
      );
    case 'php': {
      const client = new PackagistClient(settings.requestTimeoutMs);
      return {
        key: (dep) => `php|${dep.source ?? 'packagist.org'}|${dep.name}`,
        fetch: (dep) => client.fetchVersions(dep.name, dep.source),
      };
    }
    case 'dart': {
      const client = new PubClient(settings.requestTimeoutMs);
      return {
        key: (dep) => `dart|${dep.source ?? 'pub.dev'}|${dep.name}`,
        fetch: (dep) => client.fetchVersions(dep.name, dep.source),
      };
    }
    case 'ruby': {
      const client = new RubyGemsClient(settings.requestTimeoutMs);
      return {
        key: (dep) => `ruby|${dep.source ?? 'rubygems.org'}|${dep.name}`,
        fetch: (dep) => client.fetchVersions(dep.name, dep.source),
      };
    }
    case 'terraform': {
      const client = new TerraformClient(settings.requestTimeoutMs);
      return {
        key: (dep) => `terraform|${dep.name.toLowerCase()}`,
        fetch: (dep) => client.fetchVersions(dep.name),
      };
    }
    case 'elixir': {
      const client = new HexClient(settings.requestTimeoutMs);
      return {
        key: (dep) => `elixir|${dep.source ?? 'hex.pm'}|${dep.name.toLowerCase()}`,
        fetch: (dep) => client.fetchVersions(dep.name, dep.source),
      };
    }
  }
}

function dotnetLookup(settings: Settings): Lookup {
  const client = new NugetClient(settings.dotnet.indexUrl, settings.requestTimeoutMs);
  const sdk = new DotnetSdkClient(settings.requestTimeoutMs);
  return {
    key: (dep) =>
      dep.section === 'sdk'
        ? 'dotnet|sdk|release-metadata'
        : `dotnet|${settings.dotnet.indexUrl || dep.source || client.index}|${dep.name.toLowerCase()}`,
    availabilitySource: (dep) =>
      dep.section === 'sdk'
        ? '.NET SDK release metadata'
        : settings.dotnet.indexUrl || dep.source || client.index,
    async fetch(dep) {
      if (dep.section === 'sdk') return sdk.fetchVersions();
      if (!dep.source || settings.dotnet.indexUrl) return client.fetchVersions(dep.name);
      const all: string[] = [];
      let allComplete = true;
      for (const url of dep.source.split('|')) {
        const result = await new NugetClient(url, settings.requestTimeoutMs).fetchVersions(
          dep.name
        );
        if (result.error && result.error !== 'not found') return result;
        if (!result.allComplete) allComplete = false;
        all.push(...(result.all ?? []));
      }
      return all.length
        ? {
            all: [...new Set(all)],
            allComplete,
            latest: schemeFor('dotnet').max(all, { includePrerelease: false }),
          }
        : { error: 'not found' };
    },
  };
}

function mavenRepositoriesLookup(
  ecosystem: string,
  repositories: string[],
  timeoutMs: number
): Lookup {
  const clients = repositories.map((repository) => new MavenClient(repository, timeoutMs));
  const forDependency = (dep: DependencyRef) =>
    dep.source ? dep.source.split('|').map((url) => new MavenClient(url, timeoutMs)) : clients;
  return {
    key: (dep) =>
      `${ecosystem}|${forDependency(dep)
        .map((client) => client.repository)
        .join('|')}|${dep.name}`,
    fetchAvailability: (dep, known) =>
      sourceAvailability(
        known,
        forDependency(dep).map((client) => ({
          source: client.repository,
          fetch: () => client.fetchVersions(dep.name),
        }))
      ),
    async fetch(dep) {
      for (const client of forDependency(dep)) {
        const result = await client.fetchVersions(dep.name);
        if (result.error !== 'not found') return result;
      }
      return { error: 'not found' };
    },
  };
}

/** Another configured source may contain a pin missing from the update source. */
async function sourceAvailability(
  known: RegistryVersions,
  sources: { source: string; fetch(): Promise<RegistryVersions> }[]
): Promise<RegistryVersions> {
  const results = await Promise.all(
    sources.map(async (entry) => {
      if (entry.source === known.source) return known;
      try {
        return await entry.fetch();
      } catch {
        return { allComplete: false };
      }
    })
  );
  return {
    published: [...new Set(results.flatMap((result) => result.published ?? result.all ?? []))],
    allComplete: results.every((result) => result.allComplete),
    source: sources.map((entry) => entry.source).join(', '),
  };
}
