# Changelog

## Unreleased

- Show the newest available update within the current major before the latest major upgrade, including exact pins. Keep separate in-range details in hovers and preserve Go module path hints.

## 0.4.0

- Preserve Python dependency sources from uv, Poetry, Pipfile, and requirements files; report unresolved sources instead of querying a guessed index.
- Deduplicate concurrent version requests, retain GitHub ETags, support optional GitHub tokens, and honor registry rate-limit reset headers.
- Add Maven parent/plugin/extension checks, Scala cross-build and platform suffixes, Gradle settings/catalog constraints/wrapper checks, npm overrides/resolutions/package-manager pins, and PEP 723 scripts.
- Add OCI image and Helm lookups, tag-plus-digest updates, verified GitHub action SHA comments, literal setup matrices/version files, and more setup runtimes.
- Extend Cargo workspace/sparse registry handling, NuGet project configuration, Composer repositories/stability, Ruby sources/gemspecs, Terraform services/runtime pins, Hex organizations, Swift sources/registries, Conan remotes/revisions/version ordering, Conda channels/pip entries, and Clojure manifests/repositories.
- Add Bazel local includes/custom registries/compatibility details and vcpkg baseline selections/filesystem/GitHub registries.
- Add opt-in lockfile baselines, runtime-compatible release hints, and OSV audits for supported public packages.
- Centralize manifest detection and editor selectors; distinguish skipped or incomplete checks in the editor status.

## 0.3.0

- Add Ansible Galaxy collection and role hints in requirements YAML, with collection constraints and paginated version lookups.
- Add Bazel Central Registry hints for literal `bazel_dep` declarations in `MODULE.bazel`, with relaxed version ordering, override handling, and yanked-release filtering.
- Add C/C++ vcpkg hints for explicit minimums and overrides in `vcpkg.json`, including port revisions and version-scheme-aware comparisons.
- Docker Hub image hints in Dockerfiles, Containerfiles, and Compose, preserving tag precision and image variants. Recognizes hyphen- and underscore-suffixed Compose files.
- Dependency hints for Composer, Dart/Flutter, Ruby, Elixir, Helm, GitHub-hosted Swift packages, Conan Center, sbt, Conda, and Clojure.
- Terraform/OpenTofu provider and registry module hints, plus TFLint plugin hints from GitHub releases using the Terraform enable setting.
- .NET tool pins and SDK roll-forward hints.
- Gradle dependency and plugin hints in catalogs and build scripts, with shared version references and configurable Maven repositories.
- Yarn and pnpm catalog hints, with pnpm using existing npm registry settings and audits.
- Deno npm and JSR hints in configs and import maps, including scopes and package subpaths.
- GitHub Actions hints for version-tagged actions, reusable workflows, and `setup-node`, `setup-python`, and `setup-go` runtimes, preserving version precision.
- Per-ecosystem settings, registry links in hovers, cache keys, and manifest-specific comment markers for new manifests.

## 0.2.0

- Volta hints for `node`, `npm`, `yarn`, and `pnpm` pins in `package.json`, enabled by default.
- Maven hints in `pom.xml`, with POM properties, native version ranges, and configurable repositories.
- NuGet hints in SDK projects, shared props files, and `packages.config`, with native ranges and configurable V3 feeds.
- Rust hints in `Cargo.toml`, with workspace and target-specific dependencies, crate aliases, and yanked-release filtering.
- Python hints in `pyproject.toml`, `Pipfile`, and requirements files, with PEP 440 versions and Poetry constraints.
- PyPI index configuration through extension settings, environment variables, and pip config, including authentication.

## 0.1.0

First release.

- npm hints in `package.json`, with dependency aliases and `.npmrc` registry and auth settings.
- Go hints in `go.mod`, with replacements, indirect dependencies, major-version suffixes, and `GOPROXY` support.
- Shows newest in-range and latest versions, with an hourly cache that persists across reloads.
- Aligned, muted inline comments using manifest syntax, with distinct colours for major updates.
