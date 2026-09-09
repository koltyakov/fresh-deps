import type { Ecosystem } from './types';

type EcosystemSettings = Record<Ecosystem, { enabled: boolean }> & {
  npm: { registry: string; sections: string[] };
  go: { proxy: string; includeIndirect: boolean; checkMajorVersions: boolean };
  python: { indexUrl: string; includeBuildRequires: boolean };
  dotnet: { indexUrl: string };
  java: { repository: string };
  gradle: { repositories: string[] };
  terraform: { defaultRegistry: string };
  scala: { repositories: string[]; scalaBinaryVersion: string; sbtBinaryVersion: string };
  conda: { subdir: string };
  clojure: { repositories: string[] };
};

export type Settings = EcosystemSettings & {
  enabled: boolean;
  auditEnabled: boolean;
  cacheDurationMinutes: number;
  concurrency: number;
  requestTimeoutMs: number;
  showSatisfyingUpdates: boolean;
  includePrerelease: boolean;
};

/** Read effective values, including the defaults registered in package.json. */
export function readSettingsFrom(read: <T>(key: string) => T | undefined): Settings {
  function get<T>(key: string): T {
    const value = read<T>(key);
    if (value === undefined) throw new Error(`Missing registered setting: freshDeps.${key}`);
    return value;
  }

  return {
    enabled: get('enabled'),
    auditEnabled: get('audit.enabled'),
    cacheDurationMinutes: get('cacheDurationMinutes'),
    concurrency: get('concurrency'),
    requestTimeoutMs: get('requestTimeoutMs'),
    showSatisfyingUpdates: get('showSatisfyingUpdates'),
    includePrerelease: get('includePrerelease'),
    npm: {
      enabled: get('npm.enabled'),
      registry: get('npm.registry'),
      sections: get('npm.sections'),
    },
    go: {
      enabled: get('go.enabled'),
      proxy: get('go.proxy'),
      includeIndirect: get('go.includeIndirect'),
      checkMajorVersions: get('go.checkMajorVersions'),
    },
    python: {
      enabled: get('python.enabled'),
      indexUrl: get('python.indexUrl'),
      includeBuildRequires: get('python.includeBuildRequires'),
    },
    rust: { enabled: get('rust.enabled') },
    dotnet: { enabled: get('dotnet.enabled'), indexUrl: get('dotnet.indexUrl') },
    java: { enabled: get('java.enabled'), repository: get('java.repository') },
    php: { enabled: get('php.enabled') },
    dart: { enabled: get('dart.enabled') },
    gradle: { enabled: get('gradle.enabled'), repositories: get('gradle.repositories') },
    ruby: { enabled: get('ruby.enabled') },
    terraform: { enabled: get('terraform.enabled'), defaultRegistry: get('terraform.defaultRegistry') },
    elixir: { enabled: get('elixir.enabled') },
    deno: { enabled: get('deno.enabled') },
    githubActions: { enabled: get('githubActions.enabled') },
    docker: { enabled: get('docker.enabled') },
    helm: { enabled: get('helm.enabled') },
    swift: { enabled: get('swift.enabled') },
    conan: { enabled: get('conan.enabled') },
    ansible: { enabled: get('ansible.enabled') },
    bazel: { enabled: get('bazel.enabled') },
    vcpkg: { enabled: get('vcpkg.enabled') },
    scala: {
      enabled: get('scala.enabled'),
      repositories: get('scala.repositories'),
      scalaBinaryVersion: get('scala.scalaBinaryVersion'),
      sbtBinaryVersion: get('scala.sbtBinaryVersion'),
    },
    conda: { enabled: get('conda.enabled'), subdir: get('conda.subdir') },
    clojure: { enabled: get('clojure.enabled'), repositories: get('clojure.repositories') },
  };
}
