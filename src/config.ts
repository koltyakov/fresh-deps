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
  };
}
