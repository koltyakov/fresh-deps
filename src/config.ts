import * as vscode from 'vscode';

export interface Settings {
  enabled: boolean;
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
}

export function readSettings(scope?: vscode.Uri): Settings {
  const cfg = vscode.workspace.getConfiguration('freshDeps', scope ?? null);
  return {
    enabled: cfg.get('enabled', true),
    cacheDurationMinutes: cfg.get('cacheDurationMinutes', 60),
    concurrency: cfg.get('concurrency', 8),
    requestTimeoutMs: cfg.get('requestTimeoutMs', 10000),
    showSatisfyingUpdates: cfg.get('showSatisfyingUpdates', true),
    includePrerelease: cfg.get('includePrerelease', false),
    npm: {
      enabled: cfg.get('npm.enabled', true),
      registry: cfg.get('npm.registry', ''),
      sections: cfg.get('npm.sections', ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']),
    },
    go: {
      enabled: cfg.get('go.enabled', true),
      proxy: cfg.get('go.proxy', ''),
      includeIndirect: cfg.get('go.includeIndirect', false),
      checkMajorVersions: cfg.get('go.checkMajorVersions', true),
    },
  };
}
