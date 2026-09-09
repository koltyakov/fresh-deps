import * as vscode from 'vscode';

export interface Settings {
  enabled: boolean;
  auditEnabled: boolean;
  cacheDurationMinutes: number;
  concurrency: number;
  requestTimeoutMs: number;
  showSatisfyingUpdates: boolean;
  includePrerelease: boolean;
  npm: {
    enabled: boolean;
    registry: string;
    sections: string[];
  };
  go: {
    enabled: boolean;
    proxy: string;
    includeIndirect: boolean;
    checkMajorVersions: boolean;
  };
  python: {
    enabled: boolean;
    indexUrl: string;
    includeBuildRequires: boolean;
  };
  rust: {
    enabled: boolean;
  };
  dotnet: {
    enabled: boolean;
    indexUrl: string;
  };
  java: {
    enabled: boolean;
    repository: string;
  };
  php: { enabled: boolean };
  dart: { enabled: boolean };
  gradle: { enabled: boolean; repositories: string[] };
  ruby: { enabled: boolean };
  terraform: { enabled: boolean };
  elixir: { enabled: boolean };
}

export function readSettings(scope?: vscode.Uri): Settings {
  const cfg = vscode.workspace.getConfiguration('freshDeps', scope ?? null);
  return {
    enabled: cfg.get('enabled', true),
    auditEnabled: cfg.get('audit.enabled', false),
    cacheDurationMinutes: cfg.get('cacheDurationMinutes', 60),
    concurrency: cfg.get('concurrency', 8),
    requestTimeoutMs: cfg.get('requestTimeoutMs', 10000),
    showSatisfyingUpdates: cfg.get('showSatisfyingUpdates', true),
    includePrerelease: cfg.get('includePrerelease', false),
    npm: {
      enabled: cfg.get('npm.enabled', true),
      registry: cfg.get('npm.registry', ''),
      sections: cfg.get('npm.sections', ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'volta']),
    },
    go: {
      enabled: cfg.get('go.enabled', true),
      proxy: cfg.get('go.proxy', ''),
      includeIndirect: cfg.get('go.includeIndirect', false),
      checkMajorVersions: cfg.get('go.checkMajorVersions', true),
    },
    python: {
      enabled: cfg.get('python.enabled', true),
      indexUrl: cfg.get('python.indexUrl', ''),
      includeBuildRequires: cfg.get('python.includeBuildRequires', false),
    },
    rust: {
      enabled: cfg.get('rust.enabled', true),
    },
    dotnet: {
      enabled: cfg.get('dotnet.enabled', true),
      indexUrl: cfg.get('dotnet.indexUrl', ''),
    },
    java: {
      enabled: cfg.get('java.enabled', true),
      repository: cfg.get('java.repository', ''),
    },
    php: { enabled: cfg.get('php.enabled', true) },
    dart: { enabled: cfg.get('dart.enabled', true) },
    gradle: {
      enabled: cfg.get('gradle.enabled', true),
      repositories: cfg.get('gradle.repositories', [
        'https://repo.maven.apache.org/maven2', 'https://dl.google.com/dl/android/maven2', 'https://plugins.gradle.org/m2',
      ]),
    },
    ruby: { enabled: cfg.get('ruby.enabled', true) },
    terraform: { enabled: cfg.get('terraform.enabled', true) },
    elixir: { enabled: cfg.get('elixir.enabled', true) },
  };
}
