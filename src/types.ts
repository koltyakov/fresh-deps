import type { VersionScheme } from './schemes';

export type Ecosystem = 'npm' | 'go' | 'python' | 'rust' | 'dotnet' | 'java' | 'php' | 'dart' | 'gradle'
  | 'ruby' | 'terraform' | 'elixir' | 'deno' | 'githubActions'
  | 'docker' | 'helm' | 'swift' | 'conan' | 'scala' | 'conda' | 'clojure' | 'ansible' | 'bazel' | 'vcpkg';

/** A dependency declaration found in a manifest, with its position in the document. */
export interface DependencyRef {
  /** Package name as it must be requested from the registry. */
  name: string;
  /** Version requirement used for comparison. */
  spec: string;
  /** Original declaration when its comparison requirement was rewritten. */
  specRaw?: string;
  /** Explicit registry or channel selected by the manifest. */
  source?: string;
  /** A declaration routed through another ecosystem, such as Conda's pip entries. */
  ecosystem?: Ecosystem;
  /** Source or syntax cannot be resolved without guessing. Never fetch this reference. */
  skipReason?: string;
  /** A uniquely resolved version read from a lockfile. */
  resolvedVersion?: string;
  revision?: string;
  variants?: string[];
  minimumStability?: 'dev' | 'alpha' | 'beta' | 'rc' | 'stable';
  preferStable?: boolean;
  runtime?: 'node' | 'python' | 'go' | 'terraform' | 'opentofu' | 'gradle' | 'dotnet';
  runtimeVersion?: string;
  versionScheme?: VersionScheme;
  /** An explicit vcpkg override must retain its declared versioning scheme. */
  vcpkgVersionField?: 'version' | 'version-semver' | 'version-date';
  /** Declarations such as SDK roll-forward ranges and Ansible role tags use semver. */
  semver?: boolean;
  allowPrerelease?: boolean;
  /** Zero-based line of the declaration, where the hint is anchored. */
  line: number;
  /** `dependencies`, `devDependencies`, `require`, `project.dependencies`, ... */
  section: string;
  /** Go modules flagged with `// indirect`. */
  indirect?: boolean;
  /** Original text when the name was rewritten (npm aliases). */
  alias?: string;
  /** Runtime selected by a supported GitHub Actions setup input. */
  actionRuntime?: 'node' | 'python' | 'go';
  /** Runtime matrix selectors, kept together as one declaration. */
  matrixVersions?: string[];
}

/**
 * Registry metadata, optionally extended by a lazy hover-detail lookup.
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
  runtimeRequirement?: string;
  compatibilityLevel?: number;
}

export interface RegistryVersions {
  baseline?: string;
  revision?: string;
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
  /** Runtime requirements keyed by release; absent metadata means unknown compatibility. */
  requirements?: Record<string, string[]>;
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
  compatible?: string;
  matrixUpdate?: { versions: string[]; newer?: string };
}

export interface ResolveOptions {
  includePrerelease: boolean;
  showSatisfyingUpdates: boolean;
  /** Version arithmetic of the ecosystem the declaration came from. */
  scheme: VersionScheme;
}
