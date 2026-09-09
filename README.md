![Fresh Deps](https://raw.githubusercontent.com/koltyakov/fresh-deps/main/assets/banner.jpg)

# Fresh Deps

See available dependency updates directly in your VS Code manifest files.

Fresh Deps adds inline version hints for **npm, Go, Python, Rust, Java, .NET, PHP, and Dart / Flutter**.
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
| JavaScript / TypeScript | `package.json`, including Volta tool pins; `pnpm-workspace.yaml` catalogs | npm registry |
| Go | `go.mod` | Go module proxy |
| Python | `pyproject.toml`, `Pipfile`, requirements and constraints files | PyPI or a custom index |
| Rust | `Cargo.toml` | crates.io |
| Java / Kotlin / Android | Maven `pom.xml`; Gradle `*.versions.toml`, including `gradle/libs.versions.toml` | Maven Central or a custom repository; Gradle also checks Google Maven and the Gradle Plugin Portal by default |
| .NET | `*.csproj`, `*.fsproj`, `*.vbproj`, `Directory.Packages.props`, `Directory.Build.props`, `packages.config` | NuGet V3 feed |
| PHP / Composer | `composer.json` | Packagist |
| Dart / Flutter | `pubspec.yaml` | pub.dev |

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
pkg.go.dev, PyPI, crates.io, Maven Central, NuGet, Packagist, pub.dev, or a Gradle package listing.

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
  `freshDeps.npm.sections` applies only to `package.json`; `freshDeps.npm.enabled` controls both manifests.

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
- Rich constraints, dynamic versions, bundles, and executable `build.gradle` / `build.gradle.kts` files are not checked.

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

## Security audits

Enable `freshDeps.audit.enabled` to show security warnings alongside update hints, including
dependencies that already use the latest version. Hover the declaration or hint for advisory
details, severity and links where provided. The status bar reports how many declarations were
checked and how many have warnings. Failed checks are logged in the Fresh Deps output channel.

- npm uses the configured registry's bulk advisory endpoint, respecting scoped registries and
  authentication. Registries without that endpoint are marked unsupported.
- Python uses public PyPI's release vulnerability data. Custom Python indexes are not supported.
- Go, Rust, Java, .NET, PHP, and Dart audits are not implemented yet. Their version checks still work.

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
| `freshDeps.npm.enabled` | `true` | Check `package.json` and pnpm catalogs |
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
| `freshDeps.dotnet.enabled` | `true` | Check NuGet package declarations |
| `freshDeps.dotnet.indexUrl` | `""` | NuGet V3 service index; empty uses nuget.org |
| `freshDeps.php.enabled` | `true` | Check `composer.json` using Packagist |
| `freshDeps.dart.enabled` | `true` | Check `pubspec.yaml` using pub.dev |
| `freshDeps.gradle.enabled` | `true` | Check Gradle `*.versions.toml` catalogs |
| `freshDeps.gradle.repositories` | Maven Central, Google Maven, Gradle Plugin Portal | Ordered Maven repository URLs for Gradle catalogs |

Version results are cached for an hour by default and persisted across window reloads. Change
`freshDeps.cacheDurationMinutes` to adjust the duration.

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
position anchoring, version comparison, Cargo, Maven, Composer, Dart, and PEP 440 requirement matching, `.npmrc` and
`pip.conf` resolution, Go path handling, and registry response handling.

## License

[MIT](https://github.com/koltyakov/fresh-deps/blob/main/LICENSE)
