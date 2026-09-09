# Changelog

## 0.3.0

- Composer update hints in `composer.json` using public Packagist, with Composer-specific numeric constraint handling.
- Dart and Flutter update hints in `pubspec.yaml` using pub.dev, including Dart caret bounds, build suffix ordering, and retracted-release filtering.
- Gradle library and plugin hints in `*.versions.toml`, with shared version references and configurable Maven repository order.
- pnpm default and named catalog hints in `pnpm-workspace.yaml`, using existing npm registry configuration and audits.
- Ruby update hints in `Gemfile` using RubyGems.org, with RubyGems version and pessimistic constraint handling.
- Terraform and OpenTofu provider hints in `*.tf` and `*.tofu` files using their public registries.
- Elixir dependency hints in `mix.exs` using Hex.pm, including package aliases and Hex constraints.

## 0.2.0

- Volta support: inline update hints for `node`, `npm`, `yarn`, and `pnpm` pins in the
  `package.json` `volta` block, enabled by default through `freshDeps.npm.sections`.
- Java support: inline Maven update hints for dependencies and dependency management in `pom.xml`,
  including POM properties, Maven version ordering, interval ranges, and configurable repositories.
- .NET support: inline NuGet update hints in SDK project files, `Directory.Packages.props`,
  `Directory.Build.props`, and legacy `packages.config`, including NuGet interval and floating ranges.
- NuGet V3 feeds can be selected with `freshDeps.dotnet.indexUrl`.
- Rust support: inline update hints for crates in `Cargo.toml`, including workspace and target-specific
  dependency tables, renamed crates, Cargo requirement semantics, and yanked-release filtering.
- Python support: inline update hints in `pyproject.toml` (PEP 621 `[project]`, PEP 735
  `[dependency-groups]`, `[build-system]` requires and the Poetry tables), `Pipfile`, and
  `requirements.txt` and its conventional variants.
- Versions are compared by PEP 440 rather than semver, so epochs, post-releases, dev releases and
  calendar versions order the way pip orders them.
- Poetry's `^` and `~` constraints are expanded into the PEP 440 bounds they stand for.
- Yanked PyPI releases are ignored unless every file of a version is yanked.
- PyPI index resolution honours `freshDeps.python.indexUrl`, `PIP_INDEX_URL`, `UV_INDEX_URL` and
  pip's own configuration files, including credentials embedded in the index URL.

## 0.1.0

First release.

- Inline update hints in `package.json` for `dependencies`, `devDependencies`, `peerDependencies`
  and `optionalDependencies`, including `npm:` aliases.
- Inline update hints in `go.mod`, honouring `replace`, `// indirect` and the `/vN` and `.vN`
  major-version conventions.
- `.npmrc` support: scoped registries, registry overrides and auth tokens.
- `GOPROXY` support, including proxy lists and `off`.
- Reports both the newest in-range version and the latest version when a range needs widening.
- Hourly version cache, persisted across window reloads.
- Hints render as trailing comments in the manifest's own comment syntax, aligned on a common
  column per block, muted, with major updates set apart by colour from drop-in ones.
