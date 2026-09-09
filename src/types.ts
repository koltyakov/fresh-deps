import type { VersionScheme } from './schemes';

export type Ecosystem = 'npm' | 'go' | 'python' | 'rust' | 'dotnet' | 'java' | 'php' | 'dart' | 'gradle'
  | 'ruby' | 'terraform' | 'elixir' | 'deno' | 'githubActions';

/** A dependency declaration found in a manifest, with its position in the document. */
export interface DependencyRef {
  /** Package name as it must be requested from the registry. */
  name: string;
  /** Version requirement used for comparison. */
  spec: string;
  /** Original declaration when its comparison requirement was rewritten. */
  specRaw?: string;
  /** Zero-based line of the declaration, where the hint is anchored. */
  line: number;
  /** `dependencies`, `devDependencies`, `require`, `project.dependencies`, ... */
  section: string;
  /** Go modules flagged with `// indirect`. */
  indirect?: boolean;
  /** Original text when the name was rewritten (npm aliases). */
  alias?: string;
}

/**
 * Descriptive detail about a package. Every field is optional and every one of
 * them rides along on a response the version lookup already makes, so gathering
 * them costs no extra request.
 */
export interface PackageMeta {
  description?: string;
  license?: string;
  /** Deprecation notice, when the registry marks the package as deprecated. */
  deprecated?: string;
  /** Whoever published the latest release. */
  publisher?: string;
  homepage?: string;
  repository?: string;
  /** Installed footprint of the latest release, in bytes. */
  unpackedSize?: number;
  fileCount?: number;
  /** When the latest version was published, ISO 8601. */
  latestPublishedAt?: string;
}

export interface RegistryVersions {
  /** Version tagged as latest by the registry, normalised for comparison. */
  latest?: string;
  /** Version exactly as the registry spells it, for display (Go `+incompatible`). */
  latestRaw?: string;
  /** Every published version, when the registry was asked for the full list. */
  all?: string[];
  /** Package path the versions came from, when it differs from the declared one
   *  (a Go module that moved to a /vN suffix). */
  path?: string;
  /** Whatever the lookup happened to learn about the package along the way. */
  meta?: PackageMeta;
  error?: string;
}

export type UpdateKind = 'major' | 'minor' | 'patch' | 'prerelease';

export interface SecurityAdvisory {
  id: string;
  title: string;
  severity?: string;
  url?: string;
  fixedVersions?: string[];
}

export type AuditResponse =
  | { status: 'checked'; advisories: SecurityAdvisory[] }
  | { status: 'unsupported' }
  | { status: 'failed'; error: string };

export interface DependencyAudit {
  dep: DependencyRef;
  version?: string;
  baseline: boolean;
  result: AuditResponse | { status: 'pending' | 'unchecked' };
}

export interface DependencyUpdate {
  dep: DependencyRef;
  /** Baseline the update is measured against (the floor of the declared range). */
  current: string;
  latest: string;
  /** Version as the registry spells it, when that differs from `latest`. */
  latestRaw?: string;
  kind: UpdateKind;
  /** True when `latest` still satisfies the declared range. */
  inRange: boolean;
  /** Newest version satisfying the range, when `latest` does not. */
  satisfying?: string;
  /** Import path the update lives under, when the package moved (Go major versions). */
  alternatePath?: string;
  meta?: PackageMeta;
}

export interface ResolveOptions {
  includePrerelease: boolean;
  showSatisfyingUpdates: boolean;
  /** Version arithmetic of the ecosystem the declaration came from. */
  scheme: VersionScheme;
}
