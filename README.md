![Fresh Deps](https://raw.githubusercontent.com/koltyakov/fresh-deps/main/assets/banner.jpg)

# Fresh Deps

See available dependency updates directly in your VS Code manifest files.

Fresh Deps adds inline version hints for **npm, Go, Python, Rust, Java, .NET, PHP, Dart / Flutter,
Ruby, Terraform / OpenTofu, Elixir, Deno / JSR, GitHub Actions, Docker, Helm, Swift,
Conan, Scala, Conda, Clojure, Ansible, Bazel, and vcpkg**.
Compare the newest version your range allows with the latest release, then hover for details and a
link to the package registry. Hints are editor decorations, so your files stay untouched.

[Install from the Marketplace](https://marketplace.visualstudio.com/items?itemName=koltyakov.fresh-deps) · [Source code](https://github.com/koltyakov/fresh-deps) · [Report an issue](https://github.com/koltyakov/fresh-deps/issues)

## What you get

- Available versions beside each outdated dependency, aligned within each block.
- In-range and out-of-range updates shown together, with theme-aware colors for update types.
- Go major-version discovery, including new `/v2`, `/v3`, and `gopkg.in` import paths.
- Support for scoped npm registries, Go proxies, and custom Python, Maven, and NuGet sources.
- Optional security warnings for npm and public PyPI packages.
- Cached lookups across window reloads. Typing never triggers a network request.

## Get started

1. Install **Fresh Deps** from the VS Code Extensions view. Requires VS Code 1.120.0 or later.
2. Open a supported manifest, such as `package.json`, `go.mod`, or `pyproject.toml`.
3. Look for version hints at the end of dependency lines. Hover a hint to inspect the update.

Checks run when you open or save a manifest. To force a fresh check, use the refresh button in the
editor title bar or run `Fresh Deps: Check for Updates` from the Command Palette.

## Supported files

| Ecosystem | Manifests | Package source |
|---|---|---|
| JavaScript / TypeScript | `package.json`, including Volta tool pins; `pnpm-workspace.yaml` and `.yarnrc.yml` catalogs | npm registry |
| Go | `go.mod` | Go module proxy |
| Python | `pyproject.toml`, `Pipfile`, requirements and constraints files | PyPI or a custom index |
| Rust | `Cargo.toml` | crates.io |
| Java / Kotlin / Android | Maven `pom.xml`; Gradle `*.versions.toml`, `build.gradle`, `build.gradle.kts` | Maven Central or a custom repository; Gradle also checks Google Maven and the Gradle Plugin Portal by default |
| .NET | `*.csproj`, `*.fsproj`, `*.vbproj`, `Directory.Packages.props`, `Directory.Build.props`, `packages.config`, `dotnet-tools.json`, `global.json` | NuGet V3 feed; .NET release metadata for SDKs |
| PHP / Composer | `composer.json` | Packagist |
| Dart / Flutter | `pubspec.yaml` | pub.dev |
| Ruby | `Gemfile` | RubyGems.org |
| Terraform / OpenTofu | `*.tf`, `*.tofu` provider and registry module requirements; `.tflint.hcl` plugins | Terraform Registry, OpenTofu Registry, GitHub releases |
| Elixir | `mix.exs` | Hex.pm |
| Deno / JSR | `deno.json`, `deno.jsonc`, `import_map.json`, `import-map.json`, and JSONC variants of the import maps | JSR and the configured npm registry |
| GitHub Actions | `.github/workflows/*.yml`, `*.yaml`; composite `action.yml`, `action.yaml` | Public GitHub tags API |
| Docker / Compose | `Dockerfile`, `Containerfile`, and their variants; `compose.yml`, `compose.yaml`, `docker-compose.yml`, `docker-compose.yaml`, including suffixed files | Public Docker Hub tags API |
| Kubernetes / Helm | `Chart.yaml` dependencies | Explicit HTTPS chart repository `index.yaml` |
| Swift | `Package.swift` | Public GitHub tags API |
| C / C++ / Conan | `conanfile.txt`, `conanfile.py` | Conan Center recipe index |
| Scala / sbt | `build.sbt`, `project/plugins.sbt` | Configurable Maven repositories |
| Conda | `environment.yml`, `environment.yaml` | Explicit anaconda.org channels |
| Clojure | `deps.edn` | Maven Central and Clojars, or configured Maven repositories |
| Ansible | `requirements.yml`, `requirements.yaml` collections and roles | Public Ansible Galaxy |
| Bazel / Bzlmod | `MODULE.bazel` | Bazel Central Registry |
| C / C++ / vcpkg | `vcpkg.json` explicit minimums and overrides | Builtin Microsoft vcpkg version database |

## Inline hints

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
The second is the latest release and requires changing that range. A single version shows the
available update; hover to check whether it satisfies your range.

Hover details include the declared range, latest version, range compatibility, and a link to npm,
pkg.go.dev, PyPI, crates.io, Maven Central, NuGet, Packagist, pub.dev, RubyGems.org, the Terraform
Registry, Hex.pm, JSR, GitHub, or a Gradle package listing.

Hints follow the manifest's comment syntax and appear after any trailing comma or existing comment.
Major updates use the theme's warning color, minor updates use its info color, and patch updates
use a muted color.

Customize the colors through `workbench.colorCustomizations` using `freshDeps.commentForeground`,
`freshDeps.majorForeground`, `freshDeps.minorForeground`, `freshDeps.patchForeground`, and
`freshDeps.prereleaseForeground`.

## Ecosystem details

### npm and Volta

- Checks `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies` in `package.json`.
- Reads `.npmrc`, including scoped registries and authentication tokens.
- The `volta` block in `package.json` checks `node`, `npm`, `yarn`, and `pnpm` pins using their npm registry versions.
- `extends` paths are not followed. Only pins declared in the current file are checked.
- If you have customized `freshDeps.npm.sections`, add `"volta"` to enable these hints. Remove it to disable them.
- Reads the default `catalog` and named `catalogs` in `pnpm-workspace.yaml`, including npm aliases.
  These use the same registry configuration, cache, and audit provider as `package.json`.
  `freshDeps.npm.sections` applies only to `package.json`; `freshDeps.npm.enabled` also controls npm-backed catalogs.

### Go

- Reads single-line and block `require` declarations, using the `GOPROXY` environment variable unless you configure a proxy override.
- Modules covered by a `replace` directive are skipped because their version no longer comes from the proxy.
- Modules excluded by the extension process's `GONOPROXY` environment variable, or `GOPRIVATE`
  when `GONOPROXY` is unset or empty, are never sent to a proxy. These modules are skipped rather
  than fetched directly. Settings persisted only through `go env -w` are not read.
- `// indirect` modules are hidden by default (`freshDeps.go.includeIndirect`).
- New major versions live under a new import path, so `/v2`, `/v3`, … and the `gopkg.in` `.vN` form are
  probed and reported with the path you would have to import.

### Python

- Reads PEP 621 `[project]`, PEP 735 `[dependency-groups]`, and Poetry tables in `pyproject.toml`, plus `Pipfile` and requirements files.
- Resolves the package index from `PIP_INDEX_URL`, `UV_INDEX_URL`, or `pip.conf` unless you configure an override.
- Versions use PEP 440 ordering. Epochs like `1!2.0`, post-releases like `1.0.post1`, dev
  releases and calendar versions all order the way pip orders them.
- Poetry's `^` and `~` constraints are expanded into the bounds they stand for, so `^0.2.3` is read
  as `>=0.2.3,<0.3.0` rather than as a caret range from another ecosystem.
- Yanked releases are ignored: a version counts as withdrawn only when every one of its files is
  yanked, which is the rule pip applies.
- Requirements with nothing to measure against are skipped before making a request. These include a bare
  `requests`, a `!=` or `<` only, a `@` direct reference, and `-e` or `-r` lines.
- Recognised requirements files are `requirements.txt` and its `-`, `.` or `_` suffixed variants,
  `constraints.txt`, `*-requirements.txt`, and any `.txt` inside a `requirements/` directory.

### Rust

- Reads dependency, dev-dependency, build-dependency, workspace, and target-specific tables.
- Cargo's own requirement semantics are used, including implicit caret requirements and comma-separated bounds.
- Renamed dependencies query the crate named by `package`; path, git, inherited workspace and custom-registry
  dependencies are skipped because their versions do not come from crates.io.
- Yanked releases are ignored.

### .NET

- `PackageReference`, central `PackageVersion`, `VersionOverride`, and legacy `packages.config` declarations are read.
- NuGet interval ranges such as `[1.0,2.0)` and floating ranges such as `1.*` use NuGet version ordering,
  including legacy four-part versions.
- Versions containing MSBuild properties are skipped because checking them would require evaluating the project.
- Reads exact tool pins in `dotnet-tools.json`, including `.config/dotnet-tools.json`, using the same NuGet settings and cache.
- Reads `sdk.version` in `global.json` using Microsoft's .NET release index and each channel's SDK releases.
  `rollForward` determines which newer versions are in range. `patch` and `latestPatch` stay in the feature band,
  `feature` and `latestFeature` stay in the major/minor release, `minor` and `latestMinor` stay in the major release,
  and `major` and `latestMajor` allow newer major releases. `disable` is an exact pin. The default is `patch`.
- SDK hints report available updates, not which SDK the resolver would select from installed versions.
  `allowPrerelease: false` excludes SDK previews even when extension prereleases are enabled.
  These two JSON manifests require valid JSON; comments and computed versions are skipped.

### Java / Kotlin / Android

#### Maven

- Reads dependencies and dependency management in Maven `pom.xml` files.
- Maven versions use Maven qualifier ordering, including `alpha`, `beta`, `milestone`, `rc`, `snapshot`, `final`, and `sp`.
- Maven interval ranges such as `[1.0,2.0)` and unions such as `(,1.0],[1.2,)` are supported.
- Versions declared through properties in the same POM are resolved. Dependencies with inherited or otherwise unresolved versions are skipped.

#### Gradle catalogs

- Reads libraries and plugins in `*.versions.toml`, including `gradle/libs.versions.toml`.
- Supports `group:artifact:version` strings, module or group/name declarations, literal versions, and references to string values in `[versions]`.
  Plugin IDs resolve through their Maven plugin marker coordinates.
- Hints appear on each library or plugin declaration, including when several declarations share a version reference.
- Queries `freshDeps.gradle.repositories` in order, using the first repository where the artifact exists.
  Defaults are Maven Central, Google Maven, and the Gradle Plugin Portal. Authentication and repository declarations in build scripts are not read.
- Rich constraints, dynamic versions, and bundles are not checked.

#### Gradle build scripts

- Reads literal dependency coordinates in `dependencies` blocks in `build.gradle` and `build.gradle.kts`.
  Supports Groovy calls such as `implementation 'org.example:core:1.0.0'` and Kotlin calls such as
  `implementation("org.example:core:1.0.0")`, including multiline calls and `platform`, `enforcedPlatform`, and `testFixtures` wrappers.
- Reads literal plugin IDs and versions in `plugins` blocks, including Kotlin's `kotlin("jvm")` shorthand.
- Uses the same configured repositories and cache as Gradle catalogs. Build scripts are never executed.
  Variables, interpolation, map-style declarations, dynamic versions, classifier notation, and versionless dependencies are skipped.
  Build-script repository declarations and authentication are not read.

### PHP / Composer

- Reads `require` and `require-dev` in `composer.json`. Platform requirements such as `php` and `ext-json` are skipped.
- Supports numeric exact versions, comparisons, caret, Composer tilde, wildcard, hyphen, and OR constraints.
  For example, `~1.2` allows versions below `2.0.0`, while `~1.2.3` stops below `1.3.0`.
- Branch constraints, aliases, stability flags, exclusion constraints, and unconstrained `*` declarations are skipped.
  Composer's `minimum-stability` and `prefer-stable` settings are not evaluated; prerelease visibility follows `freshDeps.includePrerelease`.
  Four-part versions with a nonzero fourth component and patch-level suffixes are not compared.
- Uses public Packagist. Manifests with nonempty `repositories` declarations are skipped because custom repositories can shadow public package names.

### Dart / Flutter

- Reads `dependencies`, `dev_dependencies`, and `dependency_overrides` in `pubspec.yaml`.
- Supports exact versions, comparison bounds, and Dart caret constraints. `^0.0.3` allows updates below `0.1.0`.
- Build suffixes participate in version ordering, so `1.0.0+2` can show an update to `1.0.0+3`. Retracted releases are ignored.
- Checks default pub.dev dependencies and explicitly declared pub.dev hosted dependencies. Git, path, SDK, private hosted sources, YAML aliases, and `any` requirements are skipped.
  If `PUB_HOSTED_URL` selects a different host, only explicitly declared pub.dev dependencies are checked.
  SDK compatibility and `pubspec_overrides.yaml` are not evaluated.

### Ruby

- Reads literal `gem` calls in `Gemfile`, including multiple constraints.
- Uses RubyGems version ordering and requirement operators, including pessimistic `~>` constraints.
  For example, `~> 2.1` stays below `3.0`, while `~> 2.1.4` stays below `2.2`.
- Git, GitHub, path, custom-source, unconstrained, and interpolated dependencies are skipped.
  If a Gemfile declares a source other than `https://rubygems.org`, the whole file is skipped so private gem names are not sent to RubyGems.org.
  Gemfiles containing git or path source blocks are skipped for the same reason.
- The Gemfile is not executed. Declarations assembled through variables or method calls are not checked, and gemspec files are not read because they do not identify the dependency source.

### Terraform / OpenTofu

- Reads literal `version` constraints inside `terraform.required_providers` blocks in `*.tf` and `*.tofu` files.
- Reads pinned plugin versions in `.tflint.hcl` with `github.com/owner/repo` sources and checks published, non-prerelease GitHub releases. Disabled plugins, bundled plugins without a source/version, and computed values are skipped.
- Supports full public provider addresses, implied `hashicorp/<local-name>` addresses, comparison constraints,
  exclusions, and Terraform's `~>` operator. Local aliases are shown in hover details.
- Providers on `registry.terraform.io` and `registry.opentofu.org` are checked against their respective registries. Custom registry hosts, computed constraints,
   provider blocks, and `.terraform.lock.hcl` are skipped.
- Two-part sources in `.tf` files default to the Terraform Registry, while `.tofu` files default to the OpenTofu Registry.
  Set `freshDeps.terraform.defaultRegistry` when an OpenTofu project uses `.tf` files.
- Lock-file selections and cross-module constraint resolution are not evaluated.
- Reads literal `source` and `version` attributes in top-level `module` blocks. Public registry sources use
  `namespace/name/provider` or an explicit Terraform/OpenTofu registry host. Module aliases appear in hover details.
  Local paths, Git sources, custom registry hosts, and computed module declarations are skipped.

### Elixir

- Reads literal dependency tuples returned by `deps` in `mix.exs`, including `hex:` package aliases.
- Supports exact versions, comparisons, `and`, `or`, and Hex's `~>` constraints. Stable releases come from Hex.pm;
  retired releases remain comparable because Hex can still resolve them.
- Git, GitHub, path, umbrella, private organization, and custom repository dependencies are skipped.
- `mix.exs` is not executed. Dynamically assembled dependency lists and requirements are not checked.

### Deno / JSR

- Reads `imports` and `scopes` in `deno.json`, `deno.jsonc`, and conventional `import_map.json` / `import-map.json` files, including their `.jsonc` variants.
- Checks explicitly versioned `jsr:` and `npm:` specifiers, including scoped packages, aliases, ranges, and subpaths such as `npm:react@^18.0.0/jsx-runtime`.
- JSR lookups exclude yanked versions. npm lookups reuse `.npmrc`, the npm registry override, cached versions, and optional npm audits.
- URL imports, local paths, unversioned imports, and npm dist-tags are skipped. Referenced import map files and workspace members are not followed;
  each supported file is checked when opened. Arbitrarily named import maps and source-code imports are not checked.

### GitHub Actions

- Reads literal `uses` references in workflow steps, reusable workflow jobs, and composite action steps.
- Compares version tags with the same precision and `v` prefix. For example, `v4` is compared with other major tags,
  while `v4.1.0` is compared with full version tags. Patch releases within a moving major tag do not produce an update hint.
- Local actions, Docker references, branches, commit-SHA pins, expressions, and YAML aliases are skipped.
- Checks literal `with` inputs for common setup actions using their public runtime manifests:
  - `actions/setup-node`: `node-version`
  - `actions/setup-python`: `python-version`
  - `actions/setup-go`: `go-version`
- Runtime hints keep the declared precision. For example, `node-version: 20` can suggest `22`,
  while `python-version: '3.10'` can suggest `3.13`. These are examples, not fixed update targets.
  Quoted and unquoted numeric values work, including `3.10`. Setup inputs are checked even when the action uses a branch or SHA pin.
  Expressions, matrix references, version files, multiline lists, ranges, wildcards, and moving aliases such as `lts/*` are skipped.
- Uses the public GitHub tags API without authentication. GitHub rate-limit failures appear in the output channel.
  Lookups read at most ten pages of 100 tags; reaching that limit reports a failed lookup rather than comparing a partial list.
  Private repositories and GitHub Enterprise are not supported.

### Docker / Compose

- Recognizes dot, hyphen, and underscore suffixes, such as `docker-compose-db.yml`, `compose_test.yaml`,
  `Dockerfile.prod`, and `Containerfile-dev`, plus prefixed names such as `prod.Containerfile` and `prod.Dockerfile`.

- Reads literal `FROM` images, including platform flags and build stages, and `services.*.image` in Compose.
- Checks Docker Hub images, including unqualified official images and `docker.io` references.
  Other registries, digests, variables, unversioned images, and moving tags such as `latest` are skipped.
- Tags must start with one to three numeric components. Updates preserve the `v` prefix, component count,
  and exact suffix. `20-alpine` compares with `22-alpine`, while `20.1-bookworm` compares only with other
  two-component `-bookworm` tags. A suffix identifies a variant, not a newer distribution release.
- Multi-line `FROM` hints appear on the last line of the instruction. Dockerfile heredoc bodies are skipped.
  Uses Docker Hub's Distribution tag listing with an anonymous pull token. Pagination is bounded at
  100 pages of up to 10,000 tag names. A truncated listing reports a failed lookup.

### Helm

- Reads chart `dependencies` with literal names, semver requirements, and explicit HTTPS repository URLs.
  Hints appear on the version field and preserve chart aliases in hover details.
- Each repository's `index.yaml` is shared across chart lookups during a check.
  OCI repositories, repository aliases, local charts, YAML aliases, and repository authentication are not supported.

### Swift Package Manager

- Reads literal `.package(url: ..., from: ...)`, `exact:`, `.exact(...)`, `.upToNextMajor(from: ...)`,
  `.upToNextMinor(from: ...)`, and closed or half-open version ranges in `Package.swift`.
- `from:` and next-major requirements allow versions below the next major even for `0.x` packages.
  Requirements use Swift's bounds rather than npm caret rules.
- Only public `https://github.com/owner/repository` sources are checked. GitHub tag reads stop at 1,000 tags
  and report an error if the listing is truncated. Branches, revisions, registries, local paths, interpolation,
  and dynamically assembled requirements are skipped. Swift code is never executed.

### Conan

- Reads requirements in `conanfile.txt`, literal `requires` assignments in `conanfile.py`, and literal
  `self.requires(...)`, `self.tool_requires(...)`, `self.build_requires(...)`, and `self.test_requires(...)` calls.
- Looks up recipe versions in the public `conan-io/conan-center-index` repository.
  This reports available recipes, not binary availability for a Conan profile.
- Supports dotted numeric versions and numeric comparison ranges such as `[>=1.0 <2.0]`.
  Nonnumeric releases, users/channels, revisions, custom remotes, and dynamic Python expressions are skipped.
  Local Conan remote configuration is not read, so this support is intended for Conan Center dependencies.

### Scala / sbt

- Reads literal `"group" % "artifact" % "version"` Maven coordinates in `build.sbt` and `project/plugins.sbt`.
  Uses Maven version ordering and checks configured repositories in order.
- `addSbtPlugin` requires both `freshDeps.scala.scalaBinaryVersion` and `freshDeps.scala.sbtBinaryVersion`.
  For sbt 1.x plugins these are commonly `2.12` and `1.0`, producing the `_2.12_1.0` artifact suffix.
  Set them to the binary versions used by your build. Empty settings skip plugin declarations.
- `%%`, `%%%`, custom cross-version modifiers, interpolated strings, and computed versions are skipped.
  Build scripts, `project/build.properties`, and custom resolvers are not evaluated.

### Conda

- Reads versioned string dependencies in `environment.yml` and `environment.yaml`.
  Supports numeric exact pins, `=` prefix requirements, dotted wildcards, comparisons, comma intersections,
  and `|` alternatives. Build selectors and nonnumeric versions are skipped.
- Requires explicit named anaconda.org channels, such as `channels: [conda-forge]`, or a per-dependency
  prefix such as `conda-forge::numpy=1.26`. Checks channels in declaration order with strict priority.
  `nodefaults` is ignored; implicit channels, `defaults`, local channels, channel URLs, and labels are unsupported.
  A channel list containing unsupported entries skips unqualified dependencies.
- Filters package files to the configured `freshDeps.conda.subdir` and `noarch`, using only the main label.
  The default target is the extension host platform. This does not solve Python compatibility or dependencies.
  Nested `pip` requirements are skipped.

### Yarn catalogs

- Reads default `catalog` and named `catalogs` in `.yarnrc.yml`, including npm aliases.
  Uses npm registry lookups, caching, and optional audits.
- Literal `npmRegistryServer` and per-scope registry URLs are respected. An explicit `freshDeps.npm.registry`
  overrides them. Without Yarn registry declarations, the usual npm configuration applies.
- Yarn credentials and parent Yarn configuration files are not read. Catalogs declaring global Yarn auth or
  `npmRegistries` are skipped; scoped credentials skip the affected scope. Environment-expanded URLs are skipped.

### Clojure

- Reads `:mvn/version` coordinates in `:deps`, `:extra-deps`, `:override-deps`, and `:replace-deps`, including aliases.
  Uses Maven ordering, with Maven Central and Clojars as the default repositories.
- Git and local dependencies are skipped. Files with reader macros or `:mvn/repos` are skipped rather than
  guessing reader behavior or querying a different source. User-level `deps.edn` configuration is not read.

### Ansible

- Reads versioned collections and roles in `requirements.yml` and `requirements.yaml`, including legacy top-level role lists.
  Hints appear on the version field. Role `src` names take precedence over local `name` aliases.
- Collections support full semver pins and comma-separated `>=`, `>`, `<=`, `<`, `==`, `=`, and `!=` constraints with a lower bound.
  Roles support exact semver tags, including a `v` prefix.
- Checks public Galaxy names such as `ansible.posix` and `geerlingguy.docker`. Explicit collection sources must be
  `https://galaxy.ansible.com`. Git sources, URLs, local paths, custom sources, YAML aliases, templates, and unversioned entries are skipped.
- Collection and role versions use separate Galaxy APIs. Pagination stops at 100 pages; incomplete lists report a lookup failure.
  Ansible configuration, authentication, and `requires_ansible` compatibility are not evaluated.

### Bazel / Bzlmod

- Reads literal `bazel_dep(name = "rules_cc", version = "0.1.0")` declarations in `MODULE.bazel`, including multiline calls
  and development dependencies. Hints appear on the version field.
- Uses Bazel's relaxed version ordering, including releases such as `20240116.2.bcr.1`. Yanked versions are excluded.
- Dependencies with module overrides are skipped. Files with computed override names or `include()` calls are skipped because
  the effective overrides cannot be determined from that file alone. Starlark is never executed.
- Uses the public Bazel Central Registry. `.bazelrc`, custom registries, compatibility levels, extension-generated repositories,
  and minimum-version selection across the dependency graph are not evaluated. Hints report newer registry versions.

### C / C++ / vcpkg

- Reads explicit `version>=` minimums in dependencies and feature dependencies, plus exact `overrides` in `vcpkg.json`.
  Overrides suppress hints on the corresponding minimum declarations. Bare dependency names are skipped.
- Requires a literal 40-character `builtin-baseline` commit. Embedded `vcpkg-configuration` and sibling
  `vcpkg-configuration.json` files skip the manifest because they can select different registries or overlay ports.
- Checks the current public `microsoft/vcpkg` version database. Supports dotted numeric `version`, `version-semver`,
  and `version-date` entries, including `#port-version` minimums and override `port-version` fields.
  A port revision increase counts as a patch update. `version-string` entries and comparisons across versioning schemes are skipped.
- Hints compare explicit declarations, not the versions selected by `builtin-baseline` or installed locally. Updating may require
  refreshing the baseline and local vcpkg checkout. Triplets, platform compatibility, command-line overlays, and transitive resolution
  are not evaluated. JSON comments and computed declarations are unsupported.

## Security audits

Enable `freshDeps.audit.enabled` to show security warnings alongside update hints, including
dependencies that already use the latest version. Hover the declaration or hint for advisory
details, severity and links where provided. The status bar reports how many declarations were
checked and how many have warnings. Failed checks are logged in the Fresh Deps output channel.

- npm uses the configured registry's bulk advisory endpoint, respecting scoped registries and
  authentication. Registries without that endpoint are marked unsupported.
- Python uses public PyPI's release vulnerability data. Custom Python indexes are not supported.
- Other ecosystems do not include security audits. Their version checks still work.

Audit checks are off by default. Enabling them sends package names and checked versions to the
configured npm registry or public PyPI, with no fallback to another service. Exact pins check the
declared version; ranges check the baseline version and label warnings `at baseline`. This does
not determine the installed version, inspect lockfiles, check transitive dependencies, or prove
that an available update fixes an advisory. Declarations the parser skips are not audited.

Audit results use the configured cache duration but are not persisted across window reloads.
Typing only reads cached results. Saving, opening a manifest or running Check for Updates can
query the audit provider. Both refresh and Clear Version Cache discard audit results too.

## Commands

| Command | Action |
|---|---|
| `Fresh Deps: Check for Updates` | Drops the cache and re-queries for the current file |
| `Fresh Deps: Toggle Inline Hints` | Turns the annotations off and on |
| `Fresh Deps: Clear Version Cache` | Forgets every resolved version |

## Settings

| Setting | Default | Description |
|---|---|---|
| `freshDeps.enabled` | `true` | Show inline hints |
| `freshDeps.audit.enabled` | `false` | Show security warnings for npm and public PyPI declarations |
| `freshDeps.cacheDurationMinutes` | `60` | How long resolved versions are reused |
| `freshDeps.concurrency` | `8` | Parallel registry requests |
| `freshDeps.requestTimeoutMs` | `10000` | Per-request timeout |
| `freshDeps.showSatisfyingUpdates` | `true` | Also report the newest in-range version |
| `freshDeps.includePrerelease` | `false` | Treat prereleases as updates |
| `freshDeps.npm.enabled` | `true` | Check `package.json`, pnpm catalogs, and Yarn catalogs |
| `freshDeps.npm.registry` | `""` | Registry override; empty reads `.npmrc` |
| `freshDeps.npm.sections` | the four dependency sections plus `volta` | Which sections to inspect |
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
