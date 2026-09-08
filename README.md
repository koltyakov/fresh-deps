<img src="assets/logo.png" alt="Fresh Deps" width="128" align="right">

# Fresh Deps

VSCode extension that highlights, inline, which of your dependencies have newer versions available.

Open a `package.json` or a `go.mod` and every dependency that is behind gets an annotation at the end of its line:

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

Hovering an annotation shows the declared range, the latest version, whether it still satisfies the
range, and a link to npm or pkg.go.dev.

## What it reads

| Ecosystem | File | Source of truth |
|---|---|---|
| npm | `package.json` — `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies` | the npm registry (`.npmrc`-aware, including scoped registries and auth tokens) |
| Go | `go.mod` — `require`, single-line and block form | the Go module proxy (`GOPROXY`-aware) |

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
position anchoring, version comparison, `.npmrc` resolution and Go path handling.

## Roadmap

Cargo, Maven, and PyPI; a code action to apply an update in place.

## License

MIT
