<img src="https://raw.githubusercontent.com/koltyakov/fresh-deps/main/assets/logo.png" alt="Fresh Deps" width="128" align="right">

# Fresh Deps

VSCode extension that highlights, inline, which of your dependencies have newer versions available.

Open a supported JavaScript, Go, Rust, Python, Java, or .NET manifest and every dependency that is behind gets an
annotation at the end of its line:

```jsonc
{
  "dependencies": {
    "lodash": "^4.17.0",     // ↑ 4.18.1
    "@types/node": "^18.0.0" // ↑ 18.19.130 → 26.5.0
  }
}
```

```go-mod
require (
	github.com/Masterminds/semver v1.5.0 // ↑ v3.5.0 (/v3)
	github.com/stretchr/testify v1.8.0   // ↑ v1.12.1
	gopkg.in/yaml.v2 v2.4.0              // ↑ v3.0.1 (.v3)
)
```

```toml
[project]
dependencies = [
  "requests>=2.20",   # ↑ 2.34.2
  "django>=4.2,<5",   # ↑ 4.2.30 → 6.1.1
]
```

Hovering an annotation shows the declared range, the latest version, whether it still satisfies the
range, and a link to npm, pkg.go.dev, crates.io, PyPI, Maven Central, or NuGet.

## What it reads

| Ecosystem | File | Source of truth |
|---|---|---|
| npm | `package.json` — `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies` | the npm registry (`.npmrc`-aware, including scoped registries and auth tokens) |
| Go | `go.mod` — `require`, single-line and block form | the Go module proxy (`GOPROXY`-aware) |
| Rust | `Cargo.toml` — dependency, dev-dependency, build-dependency, workspace and target-specific tables | crates.io |
| Python | `pyproject.toml` — PEP 621 `[project]`, PEP 735 `[dependency-groups]` and the Poetry tables; `Pipfile`; `requirements.txt` and its conventional variants | the PyPI simple index (`PIP_INDEX_URL`/`UV_INDEX_URL`- and `pip.conf`-aware) |
| Java | Maven `pom.xml` dependencies and dependency management | Maven Central, or a configured Maven repository |
| .NET | `*.csproj`, `*.fsproj`, `*.vbproj`, `Directory.Packages.props`, `Directory.Build.props`, and `packages.config` | a NuGet V3 feed (nuget.org by default) |

Hints are drawn at the end of the line — after any trailing comma or existing comment — in the
manifest's own comment syntax, and lined up on a common column within each block. They should read
as a note about the code, never as part of it.

Colour separates the two kinds of move, both kept muted. A major update, the kind that needs the
range widened or in Go a new import path, takes the theme's warning colour; drop-in minor and patch
updates stay neutral. The comment token itself is always the plain grey of a real comment. All five
colours are themeable: `freshDeps.commentForeground`, `freshDeps.majorForeground`,
`freshDeps.minorForeground`, `freshDeps.patchForeground` and `freshDeps.prereleaseForeground`.

### Two numbers, not one

When the latest version falls outside the declared range, both are shown: `↑ 18.19.130 → 26.5.0`
means the newest version your range already allows is `18.19.130`, while `26.5.0` needs the range
widened. A single number means the update is a straight upgrade.

### Go specifics

- Modules covered by a `replace` directive are skipped — their version no longer comes from the proxy.
- `// indirect` modules are hidden by default (`freshDeps.go.includeIndirect`).
- New major versions live under a new import path, so `/v2`, `/v3`, … and the `gopkg.in` `.vN` form are
  probed and reported with the path you would have to import.

### Python specifics

- Versions are compared by PEP 440, not semver — epochs (`1!2.0`), post-releases (`1.0.post1`), dev
  releases and calendar versions all order the way pip orders them.
- Poetry's `^` and `~` constraints are expanded into the bounds they stand for, so `^0.2.3` is read
  as `>=0.2.3,<0.3.0` rather than as a caret range from another ecosystem.
- Yanked releases are ignored: a version counts as withdrawn only when every one of its files is
  yanked, which is the rule pip applies.
- Requirements with nothing to measure against — a bare `requests`, a `!=` or `<` only, a `@` direct
  reference, an `-e` or `-r` line — are skipped before they cost a request.
- Recognised requirements files are `requirements.txt` and its `-`, `.` or `_` suffixed variants,
  `constraints.txt`, `*-requirements.txt`, and any `.txt` inside a `requirements/` directory.

### Rust specifics

- Cargo's own requirement semantics are used, including implicit caret requirements and comma-separated bounds.
- Renamed dependencies query the crate named by `package`; path, git, inherited workspace and custom-registry
  dependencies are skipped because their versions do not come from crates.io.
- Yanked releases are ignored.

### .NET specifics

- `PackageReference`, central `PackageVersion`, `VersionOverride`, and legacy `packages.config` declarations are read.
- NuGet interval ranges such as `[1.0,2.0)` and floating ranges such as `1.*` use NuGet version ordering,
  including legacy four-part versions.
- Versions containing MSBuild properties are skipped because checking them would require evaluating the project.

### Java specifics

- Maven versions use Maven qualifier ordering, including `alpha`, `beta`, `milestone`, `rc`, `snapshot`, `final`, and `sp`.
- Maven interval ranges such as `[1.0,2.0)` and unions such as `(,1.0],[1.2,)` are supported.
- Versions declared through properties in the same POM are resolved. Dependencies with inherited or otherwise unresolved versions are skipped.

## Commands

| Command | Does |
|---|---|
| `Fresh Deps: Check for Updates` | Drops the cache and re-queries for the current file |
| `Fresh Deps: Toggle Inline Hints` | Turns the annotations off and on |
| `Fresh Deps: Clear Version Cache` | Forgets every resolved version |

## Settings

| Setting | Default | Does |
|---|---|---|
| `freshDeps.enabled` | `true` | Show inline hints |
| `freshDeps.cacheDurationMinutes` | `60` | How long resolved versions are reused |
| `freshDeps.concurrency` | `8` | Parallel registry requests |
| `freshDeps.requestTimeoutMs` | `10000` | Per-request timeout |
| `freshDeps.showSatisfyingUpdates` | `true` | Also report the newest in-range version |
| `freshDeps.includePrerelease` | `false` | Treat prereleases as updates |
| `freshDeps.npm.enabled` | `true` | Check `package.json` |
| `freshDeps.npm.registry` | `""` | Registry override; empty reads `.npmrc` |
| `freshDeps.npm.sections` | the four dependency sections | Which sections to inspect |
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

Requests are cached for an hour and persisted across window reloads, and typing never triggers a
lookup — only opening, saving, or an explicit check does.

## Development

```bash
npm install
npm test        # typecheck + unit tests
npm run watch   # then F5 in VSCode to launch the extension host
npm run package # build a .vsix
```

To try the packaged build in your own editor, `npm run vscode:install` builds the `.vsix` and
installs it with `code --install-extension --force`; reload the window afterwards. Set
`FRESH_DEPS_VSCODE_CLI` to target another CLI (`code-insiders`, `cursor`, an absolute path).

Registry lookups are network-dependent, so the test suite covers the pure parts: manifest parsing,
position anchoring, version comparison, Cargo, Maven, and PEP 440 requirement matching, `.npmrc` and
`pip.conf` resolution, Go path handling, and registry response handling.

## License

MIT
