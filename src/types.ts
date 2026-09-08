export type Ecosystem = 'npm' | 'go';

/** A dependency declaration found in a manifest, with its position in the document. */
export interface DependencyRef {
  /** Package name as it must be requested from the registry. */
  name: string;
  /** Version range exactly as written in the manifest. */
  spec: string;
  /** Zero-based line of the declaration, where the hint is anchored. */
  line: number;
  /** `dependencies`, `devDependencies`, `require`, ... */
  section: string;
  /** Go modules flagged with `// indirect`. */
  indirect?: boolean;
  /** Original text when the name was rewritten (npm aliases). */
  alias?: string;
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
  error?: string;
}

export type UpdateKind = 'major' | 'minor' | 'patch' | 'prerelease';

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
}

export interface ResolveOptions {
  includePrerelease: boolean;
  showSatisfyingUpdates: boolean;
}
