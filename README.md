![Fresh Deps](https://raw.githubusercontent.com/koltyakov/fresh-deps/main/assets/banner.jpg)

# Dependency Update Checker

See available dependency updates directly in your VS Code manifest files.

Fresh Deps adds inline version hints for **npm, Go, Python, Rust, Java, .NET, PHP, Dart, Flutter,
Ruby, Terraform, OpenTofu, Elixir, Deno, JSR, GitHub Actions, Docker, Helm, Swift,
Conan, Scala, Conda, Clojure, Ansible, Bazel, and vcpkg**.
Compare the newest version your range allows with the latest release, then hover for details and a
link to the package registry. Hints are editor decorations, so your files stay untouched.

[Install from the Marketplace](https://marketplace.visualstudio.com/items?itemName=koltyakov.fresh-deps) · [Source code](https://github.com/koltyakov/fresh-deps) · [Report an issue](https://github.com/koltyakov/fresh-deps/issues)

## What you get

- Available versions beside each outdated dependency, aligned within each block.
- In-range and out-of-range updates shown together, with theme-aware colors for update types.
- Go major-version discovery, including new `/v2`, `/v3`, and `gopkg.in` import paths.
- Support for scoped npm registries, Go proxies, and custom Python, Maven, and NuGet sources.
- Optional registry audits for npm and public PyPI packages, or OSV audits for supported public ecosystems.
- Optional lockfile baselines and runtime-compatible release information.
- Release, changelog, and documentation links where metadata identifies them.
- Per-package update policies and workspace-relative scan exclusions.
- Read-only Markdown and versioned JSON workspace reports.
- Cached lookups across window reloads. Typing never triggers a network request.

## Get started

1. Install **Fresh Deps** from the VS Code Extensions view. Requires VS Code 1.107.0 or later.
2. Open a supported manifest, such as `package.json`, `go.mod`, or `pyproject.toml`.
3. Look for version hints at the end of dependency lines. Hover a hint to inspect the update.

Checks run when you open or save a manifest. To force a fresh check, use the refresh button in the
editor title bar or run `Fresh Deps: Check for Updates` from the Command Palette.

## Supported files

| Ecosystem | Manifests | Package source |
|---|---|---|
| JavaScript, TypeScript | `package.json`, including Volta, `packageManager`, overrides and resolutions; pnpm catalogs and overrides; Yarn catalogs | npm registry |
| Go | `go.mod`, `go.work` runtime directives | Go module proxy and Go release metadata |
| Python | `pyproject.toml`, `Pipfile`, requirements and constraints files, PEP 723 script blocks | PyPI or a source-selected custom index |
| Rust | `Cargo.toml`, including inherited workspace dependencies | crates.io or configured HTTPS sparse registries |
| Java, Kotlin, Android | Maven `pom.xml`; Gradle catalogs, build/settings scripts, and `gradle-wrapper.properties` | Maven repositories and Gradle release metadata |
| .NET | `*.csproj`, `*.fsproj`, `*.vbproj`, `Directory.Packages.props`, `Directory.Build.props`, `packages.config`, `dotnet-tools.json`, `global.json` | NuGet V3 feed; .NET release metadata for SDKs |
| PHP, Composer | `composer.json` | Packagist or Composer repositories |
| Dart, Flutter | `pubspec.yaml`, `pubspec_overrides.yaml` | pub.dev or HTTPS hosted registries |
| Ruby | `Gemfile`, source-resolvable `*.gemspec` declarations | RubyGems-compatible registries |
| Terraform, OpenTofu | `*.tf`, `*.tofu` provider and registry module requirements; `.tflint.hcl` plugins | Terraform Registry, OpenTofu Registry, GitHub releases |
| Elixir | `mix.exs` | Hex.pm |
| Deno, JSR | Deno configs, conventional import maps, and referenced local import maps | JSR and the configured npm registry |
| GitHub Actions | `.github/workflows/*.yml`, `*.yaml`; composite `action.yml`, `action.yaml` | Public GitHub tags API |
| Docker, Compose | Dockerfiles, Containerfiles, and Compose files, including suffix variants | Docker Hub and HTTPS OCI registries |
| Kubernetes, Helm | `Chart.yaml` dependencies | HTTPS chart indexes and OCI registries |
| Swift | `Package.swift` | GitHub, GitLab, Bitbucket, and configured Swift registries |
| C, C++, Conan | `conanfile.txt`, `conanfile.py` | Configured Conan remotes or Conan Center recipe index |
| Scala, sbt | `build.sbt`, `project/plugins.sbt` | Configurable Maven repositories |
| Conda | `environment.yml`, `environment.yaml`, including nested pip requirements | Named channels, labels, HTTPS channels, and `defaults` |
| Clojure | `deps.edn`, `project.clj` | Maven Central and Clojars, or declared/configured Maven repositories |
| Ansible | `requirements.yml`, `requirements.yaml` collections and roles | Ansible Galaxy and explicit compatible collection sources |
| Bazel, Bzlmod | `MODULE.bazel`, including literal local includes | Bazel Central Registry or configured HTTPS registries |
| C, C++, vcpkg | `vcpkg.json` minimums, overrides, and baseline-selected bare dependencies | Builtin database, filesystem registries, and GitHub-hosted Git registries |

## Inline hints

### Version availability

Fresh Deps checks version availability in all supported ecosystems, including Deno's npm and
JSR imports and supported runtime declarations. Checks use each ecosystem's version rules and
the configured registry, repository, channel, or release manifest.

| Hint | Meaning |
|---|---|
| `Ahead of latest` | The selected version exists but is newer than the source's selected latest release. No downgrade is suggested. |
| `Version not found` | A complete listing or a direct version lookup confirms the pin is absent from the selected source. |
| `No matching version` | No listed release satisfies the declared range. |
| `Package not found` | The public npm registry did not return an unscoped package. |
| `Unable to check` | A lookup failed. Hover for the reason. A missing package response may also mean the package is inaccessible. |

Missing-version warnings appear alongside any update suggestion. Prereleases and listed yanked
or retracted releases count as existence evidence, even when excluded from update suggestions.
A range's lower bound need not exist if another listed release satisfies the range.

Some declarations need additional handling:

- Go checks the declared module path directly, including pseudo-versions. Discovering a new major
  module path does not change the source used to validate the current version.
- Docker keeps tag suffixes and precision separate. Actions checks moving tags and each runtime
  matrix selector at its declared precision.
- vcpkg checks the selected baseline or minimum entry and preserves its versioning scheme.
- Maven-based multi-repository lookups and Bazel check other configured sources before reporting
  a pin missing from the update source. Scala cross-build checks require matching artifact variants.
- Conda checks the selected channel and platform metadata. Conan Center checks its recipe index;
  configured Conan remotes use their recipe listings. Runtime checks use their release manifests.

Incomplete metadata produces an explanation on hover rather than a missing-version warning.
The status bar reports version issues and incomplete checks. These checks describe what the
selected source lists or serves, rather than whether a version was ever published elsewhere.

These examples illustrate the annotations you see in the editor. The comments are visual hints,
not text added to your manifest, and the versions are examples rather than a live registry listing.

### npm

```jsonc
{
  "dependencies": {
    "lodash": "^4.17.0",     // ↑ 4.18.1
    "@types/node": "^18.0.0" // ↑ 18.19.130 → 26.5.0
  }
}
```

### Go

```go
require (
	github.com/Masterminds/semver v1.5.0 // ↑ v3.5.0 (/v3)
	github.com/stretchr/testify v1.8.0   // ↑ v1.12.1
	gopkg.in/yaml.v2 v2.4.0              // ↑ v3.0.1 (.v3)
)
```

### Python

```toml
[project]
dependencies = [
  "requests>=2.20",   # ↑ 2.34.2
  "django>=4.2,<5",   # ↑ 4.2.30 → 6.1.1
]
```

### Reading an update

In `↑ 18.19.130 → 26.5.0`, the first version is the newest your declared range allows.
The second requires widening the range. For a single-version hint, hover to check compatibility.

Hovers show version details and package links, plus releases, changelogs, and documentation where
known. Direct GitHub Go modules checked through the public proxy also get comparisons when both
tags are verified. Verification runs only on hover.

Hints appear after trailing commas or comments. Major updates use warning colors, minor updates
use info colors, and patches are muted.

Customize the colors through `workbench.colorCustomizations` using `freshDeps.commentForeground`,
`freshDeps.majorForeground`, `freshDeps.minorForeground`, `freshDeps.patchForeground`, and
`freshDeps.prereleaseForeground`.

## Ecosystem details

### npm

- Checks `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `packageManager`,
  nested npm/pnpm overrides, and Yarn resolutions. `freshDeps.npm.sections` applies only to `package.json`.
- Volta checks local `node`, `npm`, `yarn`, and `pnpm` pins against npm; `extends` is not followed.
  Add `"volta"` to customized section lists to enable it, or remove it to disable it.
- Reads `.npmrc` scoped registries and tokens. Default/named catalogs and npm aliases in
  `pnpm-workspace.yaml` and `.yarnrc.yml` share npm lookups, cache, and audits; pnpm overrides are also checked.
- Yarn catalogs honor literal `npmRegistryServer` and per-scope URLs, overridden by `freshDeps.npm.registry`;
  absent Yarn declarations use npm configuration. Yarn credentials and parent configs are not read.
  Global auth/`npmRegistries` skip catalogs; scoped credentials skip that scope. Environment-expanded URLs are skipped.
- `github:owner/repo#<SHA>` pins accept full SHAs or abbreviations of at least seven characters. Updates require
  the pin to be an ancestor of the default-branch tip; tip or unrelated commits produce none.
  Hovers show the full target SHA and comparison link.

### Go

- Reads single-line/block `require` declarations through `GOPROXY` or a configured override; skips
  replaced modules. Indirect modules are hidden unless `freshDeps.go.includeIndirect` is enabled.
- Honors `GONOPROXY`, falling back to `GOPRIVATE` when unset or empty. Excluded modules are neither
  proxied nor fetched directly. Process environment takes precedence over Go's persisted environment.
- Checks `go`/`toolchain` directives in `go.mod` and `go.work` against official releases; probes newer
  `/vN` and `gopkg.in` `.vN` major paths and shows the required import path.

### Python

- Reads PEP 621/735, Poetry, `tool.uv.dev-dependencies`, `Pipfile`, and PEP 723 script blocks;
  ignores duplicate/unclosed blocks. Recognizes `requirements.txt` and `-`/`.`/`_` variants,
  `constraints.txt`, `*-requirements.txt`, and `requirements/*.txt`.
- Uses configured/environment/pip indexes, explicit uv/Poetry/Pipfile sources, and `--index-url`.
  Skips workspace/path/Git dependencies, unresolved conditional or multi-index sources, and local links.
- Supports JSON/HTML Simple APIs, `requires-python`, PEP 440 ordering, and Poetry `^`/`~` bounds.
  Updates exclude fully yanked releases. Bare names, `!=`/`<`-only constraints, direct references,
  and `-e`/`-r` lines have no comparison baseline and are skipped.

### Rust

- Reads dependency, dev/build, workspace, and target-specific tables using Cargo's implicit caret
  and comma-separated bounds. Renames use `package`; inherited requirements resolve through the workspace.
- Honors HTTPS sparse registries and Cargo source replacement; skips path, Git, unresolved sources,
  and yanked releases. Hovers show the latest release's minimum Rust version when available.

### .NET

- Reads `PackageReference`, central `PackageVersion`, `VersionOverride`, and `packages.config`;
  supports four-part versions, interval/floating ranges, and unconditional same-file MSBuild properties.
  Honors V3 `NuGet.Config` sources, disabled feeds, and mappings; tool pins share settings/cache.
- Checks `dotnet-tools.json`, `.config/dotnet-tools.json`, and `global.json`. SDK `rollForward` maps
  `patch` to feature band, `feature` to major/minor, `minor` to major, and `major` to newer majors,
  including `latest*` variants. Default is `patch`; `disable` pins exactly.
- SDK hints show available updates, not installed SDK selection. `allowPrerelease: false` excludes
  previews. Tool/SDK manifests require valid JSON; comments and computed versions are skipped.

### Java, Kotlin, Android

#### Maven

- Reads dependencies/management, parents, build/reporting plugins, plugin management, and extensions
  in `pom.xml`. Resolves same-POM properties; skips inherited or unresolved versions.
- Uses Maven qualifier ordering, including `alpha`, `beta`, `milestone`, `rc`, `snapshot`, `final`,
  and `sp`, with interval ranges such as `[1.0,2.0)` and unions such as `(,1.0],[1.2,)`.

#### Gradle catalogs

- Reads libraries/plugins in `*.versions.toml`: `group:artifact:version`, module or group/name forms,
  literal versions, and string `[versions]` references. Plugin IDs use Maven marker coordinates.
  Each declaration gets a hint, including shared references.
- Supports `require`, `strictly`, `prefer`, and rejected versions; skips dynamic versions and bundles.
  Searches `freshDeps.gradle.repositories` in order, defaulting to Maven Central, Google Maven, and
  Gradle Plugin Portal. Build-script repository declarations and authentication are not read.

#### Gradle build scripts

- Reads literal Groovy/Kotlin dependency calls in `build.gradle{,.kts}`, including multiline calls
  and `platform`, `enforcedPlatform`, and `testFixtures` wrappers. Checks plugin IDs/versions,
  Kotlin's `kotlin("jvm")`, and plugins/published catalogs in `settings.gradle{,.kts}`.
- Checks `gradle-wrapper.properties` against Gradle releases. Shares catalog repositories/cache;
  never executes scripts or reads their repositories/authentication. Variables, interpolation,
  map-style declarations, dynamic versions, classifier notation, and versionless dependencies are skipped.

### PHP, Composer

- Reads `require`/`require-dev`; skips platform requirements such as `php` and `ext-json`.
  Supports numeric pins, comparisons/exclusions, caret, wildcard, hyphen, OR, and Composer tilde:
  `~1.2` stays below `2.0.0`, `~1.2.3` below `1.3.0`.
- Honors stability flags, `minimum-stability`, `prefer-stable`, and explicit repositories through
  `packages.json`/`metadata-url`. Unsupported repository types/filters produce skip reasons.
  Branches, aliases, `*`, nonzero fourth version components, and patch-level suffixes are skipped.

### Dart, Flutter

- Reads dependencies, dev dependencies, and overrides in `pubspec.yaml` and `pubspec_overrides.yaml`;
  overrides suppress original declarations. Supports exact/comparison/Dart caret bounds:
  `^0.0.3` stays below `0.1.0`. Build suffixes affect ordering; retracted releases are excluded.
- Uses default or explicit HTTPS hosted registries, including `PUB_HOSTED_URL`; skips Git, path,
  SDK, YAML aliases, and `any`. SDK metadata supports optional runtime-compatibility hints.

### Ruby

- Reads literal `gem` calls with multiple constraints and gemspec dependencies with one unambiguous
  source in a sibling Gemfile. Uses RubyGems ordering and operators: `~> 2.1` stays below `3.0`,
  `~> 2.1.4` below `2.2`.
- Literal HTTPS source blocks select RubyGems-compatible APIs. Git, path, dynamic-source,
  unconstrained, and interpolated dependencies are skipped; Ruby code is never executed.

### Terraform, OpenTofu

- Reads literal provider constraints, module `source`/`version` pairs, and runtime `required_version`.
  Supports full/implied `hashicorp/<local-name>` provider addresses, registry modules, comparisons,
  exclusions, and `~>`; hovers retain aliases. Local/Git modules and computed declarations are skipped.
- Custom services use `/.well-known/terraform.json`. Two-part sources default to Terraform for `.tf`,
  OpenTofu for `.tofu`; override with `freshDeps.terraform.defaultRegistry`. Optional provider baselines
  use `.terraform.lock.hcl`; no cross-module solving.
- `.tflint.hcl` checks GitHub-source plugin pins against stable releases; skips disabled plugins,
  bundled plugins without source/version, and computed values.

### Elixir

- Reads literal `deps` tuples in `mix.exs`, including `hex:` aliases, exact versions, comparisons,
  `and`/`or`, and Hex `~>`. Uses Hex.pm and organization APIs; retired releases remain comparable.
- Named repositories use `FRESH_DEPS_HEX_REPO_<NAME>`. Git/GitHub, path, umbrella, computed repositories,
  and dynamic lists/requirements are skipped; `mix.exs` is never executed.

### Deno, JSR

- Reads `imports`/`scopes` in `deno.json{,c}`, conventional `import_map.json`/`import-map.json` and
  `.jsonc` variants, plus referenced local maps with custom names. Checks versioned `jsr:`/`npm:`
  specifiers with scopes, aliases, ranges, and subpaths such as `npm:react@^18.0.0/jsx-runtime`.
- Excludes yanked JSR releases; npm shares `.npmrc`, registry overrides, cache, and optional audits.
  Skips URLs, local paths, unversioned imports, and dist-tags. Workspace files are checked when
  opened; source-code imports are not scanned.

### GitHub Actions

- Reads literal `uses` in workflows, reusable jobs, and composite steps, preserving tag precision
  and `v`. Moving-tag patches stay quiet; SHA comments require verified tags. Local/Docker actions,
  branches, unidentified SHAs, and YAML aliases are skipped for action-version checks.
- Checks `actions/setup-node`, `setup-python`, and `setup-go` runtime inputs, exact `actions/setup-dotnet`
  SDK pins, and `hashicorp/setup-terraform`. Preserves numeric precision, including quoted/unquoted
  `3.10`, even on branch/SHA-pinned actions. Supports literal matrices/local version files; skips other
  expressions, multiline lists, ranges, wildcards, and moving aliases.
- Supports [GitHub tokens](#registry-credentials), conditional requests, rate-limit backoff, and private
  github.com repositories, not Enterprise hosts. Reaching ten pages of 100 tags fails rather than
  comparing partial data.

### Docker, Compose

- Reads literal `FROM` images with platform flags/stages and Compose `services.*.image`, including
  dot/hyphen/underscore filename suffixes and Dockerfile/Containerfile prefixes. Multiline hints anchor
  to the last instruction line; heredocs are skipped.
- Checks Docker Hub and explicit HTTPS OCI registries, including GHCR/Quay. Preserves numeric tag
  precision, `v`, and exact variants, e.g. `20-alpine` to `22-alpine`. Tag-plus-digest pins detect digest
  changes; digest-only pins, variables, unversioned images, and moving tags are skipped.
- Docker Hub uses Distribution listings and anonymous pull tokens. Limits are 100 pages of up to
  10,000 names; truncated lists fail. Variant suffixes are not distro upgrades.

### Helm

- Reads literal chart dependencies, semver requirements, and explicit HTTPS/OCI repositories.
  Hints anchor to versions; hovers retain aliases. HTTPS `index.yaml` reads are shared per check;
  OCI uses bearer challenges and Docker-config inline credentials. Repository aliases, local charts,
  YAML aliases, and HTTPS-index authentication are unsupported.

### Swift Package Manager

- Reads literal `.package` requirements using `from:`, `exact:`, `.exact(...)`, `.upToNextMajor`,
  `.upToNextMinor`, and closed/half-open ranges. Swift next-major bounds apply even to `0.x` packages.
- Checks GitHub/GitLab.com/Bitbucket.org URLs and IDs selected by `.swiftpm/configuration/registries.json`.
  Bounded tag reads reject incomplete lists. Branches, revisions, local paths, interpolation, and
  computed requirements are skipped; Swift code is never executed.

### Conan

- Reads `conanfile.txt`, literal Python `requires` assignments, and `self.requires`, `tool_requires`,
  `build_requires`, and `test_requires` calls. Supports Conan ordering, alphanumeric releases,
  comparison ranges, users/channels, and recipe revisions; skips dynamic Python expressions.
- Uses enabled Conan 2 `remotes.json` remotes, otherwise Conan Center's recipe index. User/channel
  recipes require a remote. Results describe recipes, not profile-specific binary availability.

### Scala, sbt

- Reads literal `"group" % "artifact" % "version"` coordinates in `build.sbt` and `project/plugins.sbt`,
  using Maven ordering and configured repository order. `%%` uses configured or literal
  `scalaVersion`/`crossScalaVersions` binary versions; releases must exist for every selected suffix.
- `addSbtPlugin` requires `freshDeps.scala.scalaBinaryVersion` and `freshDeps.scala.sbtBinaryVersion`;
  typical sbt 1.x values `2.12`/`1.0` produce `_2.12_1.0`. Empty settings skip plugins.
  `%%%` also requires `freshDeps.scala.platformSuffix`, e.g. `sjs1` or `native0.5`.
- Custom cross-version modifiers, interpolation, and computed versions are skipped; builds are not executed.

### Conda

- Reads versioned strings in `environment.yml`/`.yaml`: numeric pins, `=` prefixes, dotted wildcards,
  comparisons, comma intersections, and `|` alternatives. Skips build selectors and nonnumeric versions.
- Explicit named/labelled/HTTPS channels, `defaults`, and prefixes such as `conda-forge::numpy=1.26`
  use strict declaration-order priority. `nodefaults` is ignored; implicit/local channels are unsupported.
  Unsupported channel entries skip unqualified dependencies.
- Filters to `freshDeps.conda.subdir` or the extension-host platform, plus `noarch`, using only the
  main label. No Python/dependency solving. Nested pip requirements share Python parsing, sources, and audits.

### Clojure

- Reads `:mvn/version` in `:deps`, `:extra-deps`, `:override-deps`, and `:replace-deps`, including aliases,
  plus literal dependency/plugin vectors in `project.clj`. Uses Maven ordering and Central/Clojars
  defaults; literal `:mvn/repos` selects other sources.
- Skips Git/local dependencies, reader macros, and Leiningen files declaring repositories.
  User-level `deps.edn` configuration is not read.

### Ansible

- Reads collections/roles in `requirements.yml`/`.yaml`, including legacy role lists. Hints anchor
  to versions; role `src` overrides local `name`. Collections support semver pins and lower-bounded,
  comma-separated `>=`, `>`, `<=`, `<`, `==`, `=`, `!=`; roles use exact semver tags with optional `v`.
- Uses separate Galaxy APIs for roles/collections and explicit HTTPS Galaxy-compatible collection
  sources. Pagination stops at 100 pages; incomplete lists fail. Git/local sources, YAML aliases,
  templates, and unversioned entries are skipped. Config/authentication are not read;
  `requires_ansible` metadata supports optional runtime-compatibility hints.

### Bazel, Bzlmod

- Reads literal `bazel_dep` calls in `MODULE.bazel`, including multiline/dev dependencies, with
  version-field hints. Uses relaxed ordering such as `20240116.2.bcr.1`; excludes yanked versions.
- Expands local literal `include()` files with cycle/path checks and cross-file overrides; skips
  computed override names. Starlark is never executed.
- Honors literal HTTPS `--registry` flags in `.bazelrc` `common`/`build` entries; defaults to BCR.
  Hovers can fetch compatibility levels. Generated repositories and graph-wide minimum-version
  selection are not evaluated.

### C, C++, vcpkg

- Reads `version>=`, bare/feature dependencies, and exact overrides, which suppress matching hints.
  Builtin registries require a 40-character baseline commit; bare names resolve against it.
- Uses `microsoft/vcpkg` or package-matched filesystem/GitHub Git registries from embedded/sibling
  configs. Supports numeric `version`, `version-semver`, `version-date`, and port revisions as patch
  updates; skips `version-string` and cross-scheme comparisons.
- Upgrades may require refreshing the baseline/local checkout. No triplet, platform, or transitive
  solving; overlays, other transports, JSON comments, and computed declarations are unsupported.

## Resolved versions and runtime compatibility

Enable `freshDeps.useLockfiles` for source-matched update/audit baselines satisfying your requirements.
Supports npm shrinkwrap/package-lock, pnpm 6/9, Yarn Classic/Berry metadata 4/5/6/8, Bun text formats
0 through 3, Cargo, uv/Poetry, Composer, pub, Swift, Terraform, and Mix. This does not inspect installed
packages or solve dependencies.

Ancestor npm/pnpm/Yarn/Bun locks require verified workspace membership; `packageManager` resolves conflicts.
Selections match direct locations, importers, or descriptors. Reads are capped at 4 MiB; invalid or
ambiguous entries fall back to declarations. Private sources require evidence. Hovers/reports show
provenance, and lockfile changes refresh visible manifests. Cache-duration changes invalidate entries;
zero prevents persisted reuse.

Bun `bun.lock` supports JSONC, aliases, and workspace-local/hoisted selections. Binary `bun.lockb`
is detected but not decoded; [migrate it to text](https://bun.com/docs/pm/lockfile#text-based-lockfile)
to use resolved baselines. Fresh Deps never runs Bun or converts lockfiles.

Set `freshDeps.runtimeVersions` to show runtime-compatible releases alongside the latest:

```json
{
  "freshDeps.runtimeVersions": {
    "python": "3.11.0",
    "npm": "20.0.0",
    "rust": "1.75.0",
    "dart": "3.4.0",
    "ansible": "2.15.0"
  }
}
```

Compatibility uses registry metadata, not platform or transitive solving. Missing metadata means
unknown compatibility. Unresolved sources are logged; incomplete/empty checks appear in the status bar.

## Registry credentials

- GitHub reads `FRESH_DEPS_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`. Tokens apply only to api.github.com.
- OCI reads inline `auth` entries from Docker's `config.json`, respecting `DOCKER_CONFIG`. Credential helper programs are not executed.
- Custom Terraform provider and module services on the registry host can use `TF_TOKEN_<HOST>` environment variables with Terraform's hostname encoding.
- Hex organization APIs can use `HEX_API_KEY`. Custom Hex API URLs use `FRESH_DEPS_HEX_REPO_<NAME>`.
- Conan remote bearer tokens can use `FRESH_DEPS_CONAN_TOKEN_<REMOTE_NAME>`. Names use uppercase letters and underscores.

## Security audits

Enable `freshDeps.audit.enabled` for advisory hovers and status summaries. Defaults use configured
npm endpoints or public PyPI; select `freshDeps.audit.provider: "osv"` for supported public ecosystems.
Custom/private sources never go to OSV; unsupported audits do not trigger provider fallback.

Providers receive package names and pins, range baselines, or lockfile selections, not an installed
or transitive dependency scan. OSV includes severity, CVSS evidence, and affected ranges; missing
severity is unknown, and fixed boundaries are branch-specific. Results are cached without persistence;
typing never queries providers. Refresh and Clear Version Cache discard audits.

`Fresh Deps: Audit an Update Version` checks a selected target under the same restrictions without
editing or installing. Auditing must be enabled. "No advisories reported" is not a safety guarantee.

## Package policies and exclusions

```json
{
  "freshDeps.exclude": ["**/fixtures/**", "examples/legacy/**"],
  "freshDeps.packageRules": [
    { "ecosystem": "npm", "name": "@types/*", "ignoreUpdates": true },
    { "ecosystem": "npm", "name": "node", "section": "volta", "ignoreMajorUpdates": true },
    { "ecosystem": "python", "name": "django", "prereleasePolicy": "if-current-prerelease" }
  ],
  "freshDeps.prereleasePolicy": "inherit"
}
```

- Exclusions skip all checks, including audits. Globs are workspace-relative, or manifest-relative
  without a workspace. Use `/` and `**`; hidden paths match, negation is unsupported. Excluded
  directory contents are neither scanned nor counted.
- Rules match canonical names and effective ecosystems, not aliases. JSR uses `deno` without `jsr:`.
  Later rules override specified fields; `ignoreUpdates` retains availability/security warnings.
- Optional `section` globs restrict a rule to manifest sections such as `volta` or `devDependencies`.
  `ignoreMajorUpdates` works for libraries and runtimes across ecosystems. It keeps suggestions
  within the current major, so a library on 1.x still receives minor and patch updates, and a Volta Node 24 pin still
  receives 24.x updates without suggesting Node 25 or later. Availability checks and audits remain enabled.
- Policies are `inherit`, `never`, `if-current-prerelease`, or `always`. Inherit keeps existing
  prerelease/stability settings; conditional mode uses the lockfile/declaration baseline. Source and
  ecosystem restrictions still apply. Settings can differ per workspace folder.

## Commands

Reports scan supported manifests across all workspace folders with fresh lookups and existing
settings, even with inline hints disabled. Markdown previews link updates/warnings to declarations;
versioned JSON also includes clean entries, summaries, and workspace-relative locations. Both explain
baselines, policies, audit states, and incomplete checks.

Scans include hidden manifests, apply package rules and `freshDeps.exclude`, and skip common
dependency/build/cache/version-control directories. Editor search exclusions do not apply.
Cancellation is supported. Reports are read-only; save or copy them explicitly. Credentials are redacted, but paths
and package names may reveal private details. Review before sharing.

| Command | Action |
|---|---|
| `Fresh Deps: Check for Updates` | Drops the cache and re-queries for the current file |
| `Fresh Deps: Generate Outdated Dependencies Report` | Checks workspace manifests and opens a Markdown report |
| `Fresh Deps: Generate Dependencies JSON Report` | Checks workspace manifests and opens a read-only JSON report |
| `Fresh Deps: Audit an Update Version` | Audits a selected exact update target without applying it |
| `Fresh Deps: Toggle Inline Hints` | Turns the annotations off and on |
| `Fresh Deps: Clear Version Cache` | Forgets every resolved version |

## Settings

| Setting | Default | Description |
|---|---|---|
| `freshDeps.enabled` | `true` | Show inline hints |
| `freshDeps.audit.enabled` | `false` | Show security warnings for npm and public PyPI declarations |
| `freshDeps.audit.provider` | `registry` | Select registry-native audits or optional public-package OSV audits |
| `freshDeps.useLockfiles` | `false` | Use unambiguous adjacent or verified npm workspace lockfile selections as baselines |
| `freshDeps.exclude` | `[]` | Workspace-relative globs excluded from all checks, including audits |
| `freshDeps.packageRules` | `[]` | Ordered package-name rules for update suppression and prerelease policy |
| `freshDeps.prereleasePolicy` | `inherit` | Preserve legacy behavior, exclude prereleases, allow them conditionally, or always consider them |
| `freshDeps.runtimeVersions` | `{}` | Concrete interpreter versions for runtime-compatible release hints |
| `freshDeps.cacheDurationMinutes` | `60` | How long resolved versions are reused |
| `freshDeps.concurrency` | `8` | Parallel registry requests |
| `freshDeps.requestTimeoutMs` | `10000` | Per-request timeout |
| `freshDeps.showSatisfyingUpdates` | `true` | Show the newest same-major update before the latest major, including exact pins, and report in-range updates |
| `freshDeps.includePrerelease` | `false` | Treat prereleases as updates |
| `freshDeps.npm.enabled` | `true` | Check `package.json`, pnpm catalogs, and Yarn catalogs |
| `freshDeps.npm.registry` | `""` | Registry override; empty reads `.npmrc` |
| `freshDeps.npm.sections` | the four dependency sections, `volta`, `packageManager`, `overrides`, `resolutions` | Which sections to inspect |
| `freshDeps.go.enabled` | `true` | Check `go.mod` |
| `freshDeps.go.proxy` | `""` | Proxy override; empty reads `GOPROXY` |
| `freshDeps.go.includeIndirect` | `false` | Also check `// indirect` modules |
| `freshDeps.go.checkMajorVersions` | `true` | Probe for `/v2`, `/v3`, … |
| `freshDeps.python.enabled` | `true` | Check `pyproject.toml`, `Pipfile` and requirements files |
| `freshDeps.python.indexUrl` | `""` | Index override; empty reads `PIP_INDEX_URL`, `UV_INDEX_URL` and `pip.conf` |
| `freshDeps.python.includeBuildRequires` | `false` | Also check `[build-system]` requires |
| `freshDeps.rust.enabled` | `true` | Check crates in `Cargo.toml` |
| `freshDeps.java.enabled` | `true` | Check Maven dependencies in `pom.xml` |
| `freshDeps.java.repository` | `""` | Repository override; empty uses Maven Central |
| `freshDeps.dotnet.enabled` | `true` | Check NuGet packages, .NET tools, and SDK pins |
| `freshDeps.dotnet.indexUrl` | `""` | NuGet V3 service index; empty uses nuget.org |
| `freshDeps.php.enabled` | `true` | Check `composer.json` using Packagist |
| `freshDeps.dart.enabled` | `true` | Check `pubspec.yaml` using pub.dev |
| `freshDeps.gradle.enabled` | `true` | Check Gradle catalogs and literal build-script declarations |
| `freshDeps.gradle.repositories` | Maven Central, Google Maven, Gradle Plugin Portal | Ordered Maven repository URLs for Gradle catalogs |
| `freshDeps.ruby.enabled` | `true` | Check `Gemfile` using RubyGems.org |
| `freshDeps.terraform.enabled` | `true` | Check public provider and registry module requirements in `*.tf` and `*.tofu`, and GitHub-hosted plugins in `.tflint.hcl` |
| `freshDeps.terraform.defaultRegistry` | `""` | Registry for two-part sources; empty selects one from the file extension |
| `freshDeps.elixir.enabled` | `true` | Check literal dependencies in `mix.exs` using Hex.pm |
| `freshDeps.deno.enabled` | `true` | Check npm and JSR imports in Deno configs and conventional import maps |
| `freshDeps.githubActions.enabled` | `true` | Check action tags and Node.js, Python and Go setup inputs in workflows and composite actions |

Version results are cached for an hour by default and persisted across window reloads. Change
`freshDeps.cacheDurationMinutes` to adjust the duration.

Additional ecosystem settings:

| Setting | Default | Description |
|---|---|---|
| `freshDeps.docker.enabled` | `true` | Check Docker Hub image tags in Dockerfiles and Compose |
| `freshDeps.helm.enabled` | `true` | Check Helm chart dependencies using HTTPS indexes |
| `freshDeps.swift.enabled` | `true` | Check GitHub-hosted Swift package tags |
| `freshDeps.conan.enabled` | `true` | Check numeric Conan Center recipe versions |
| `freshDeps.scala.enabled` | `true` | Check explicit Maven coordinates in sbt files |
| `freshDeps.scala.repositories` | Maven Central | Ordered Maven repositories for sbt |
| `freshDeps.scala.scalaBinaryVersion` | `""` | Scala binary suffix for sbt plugins; empty skips plugins |
| `freshDeps.scala.sbtBinaryVersion` | `""` | sbt binary suffix for plugins; empty skips plugins |
| `freshDeps.scala.platformSuffix` | `""` | Platform suffix for `%%%`, such as `sjs1` or `native0.5` |
| `freshDeps.conda.enabled` | `true` | Check numeric Conda dependencies from explicit channels |
| `freshDeps.conda.subdir` | `""` | Target platform such as `linux-64`; empty uses the extension host |
| `freshDeps.clojure.enabled` | `true` | Check Maven dependencies in `deps.edn` |
| `freshDeps.clojure.repositories` | Maven Central, Clojars | Ordered Maven repositories for Clojure |
| `freshDeps.ansible.enabled` | `true` | Check public Galaxy collections and role pins in Ansible requirements YAML |
| `freshDeps.bazel.enabled` | `true` | Check literal Bzlmod dependencies using the Bazel Central Registry |
| `freshDeps.vcpkg.enabled` | `true` | Check explicit builtin-registry vcpkg minimums and overrides, including port revisions |

## Development

```bash
npm install
npm test        # compile and run unit tests
npm run watch   # then F5 in VS Code to launch the extension host
npm run package # build a .vsix
```

To try the packaged build in your own editor, `npm run vscode:install` builds the `.vsix` and
installs it with `code --install-extension --force`; reload the window afterwards. Set
`FRESH_DEPS_VSCODE_CLI` to target another CLI (`code-insiders`, `cursor`, an absolute path).

Registry lookups are network-dependent, so the test suite covers the pure parts: manifest parsing,
position anchoring, version comparison, Cargo, Maven, Composer, Dart, RubyGems, Terraform, Hex, and PEP 440 requirement matching, `.npmrc` and
`pip.conf` resolution, Go path handling, and registry response handling.

## License

[MIT](https://github.com/koltyakov/fresh-deps/blob/main/LICENSE)
