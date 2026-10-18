# Changelog

## 0.7.0

- Add Bun `bun.lock` direct-dependency baselines, workspace and alias selection, source checks, provenance, and lockfile refresh handling. Detect legacy `bun.lockb` with text-migration guidance instead of invoking Bun.
- Add metadata-backed release, changelog and documentation links, public-crate Docs.rs links, and lazy verified comparisons for direct public GitHub Go modules.
- Add resource-scoped manifest exclusions, ordered package update policies, and conditional prerelease selection while preserving existing defaults. Update suppression retains availability and security warnings.
- Preserve OSV severity labels, CVSS evidence and package-specific affected ranges. Add an explicit, cancellable candidate-version audit command with the existing provider and source restrictions.
- Add pnpm lockfile formats 6/9 and Yarn Classic/Berry direct-dependency baselines, verified ancestor workspace discovery, and npm workspace hoisting support. Explain baseline origins and rejected selections, and refresh visible manifests after lockfile changes.
- Add a versioned, credential-redacted JSON report and share a normalized snapshot with Markdown reports. Report exclusions, policy decisions, runtime assumptions and incomplete checks without writing project files.
- Invalidate stale analysis immediately on edits and prevent cleared lazy-detail caches from being repopulated by older requests.

## 0.6.3

- Lower the minimum supported VS Code version to 1.107.0.
- Fix OSV audits for Deno npm imports and shared audit results with `package.json`.
- Respect pip command-specific index precedence and match lockfile selections to package sources.
- Honor folder-specific inline hint settings and keep status updates tied to the active editor.
- Render hints in all split editors and invalidate existing entries when cache duration changes.
- Abort canceled checks without interrupting registry requests still needed by another editor.
- Separate registry adapters from dependency analysis and add regression tests for these workflows.

## 0.6.2

- Preserve Go update hints when optional newer-major probes time out or return proxy errors. Keep the base release or the latest discovered major, while still reporting failures of the base module lookup.

## 0.6.1

- Keep GitHub commit-pin hints beside their declarations without widening the aligned columns used by regular dependency hints.

## 0.6.0

- Add `Fresh Deps: Generate Outdated Dependencies Report` to scan supported manifests across all workspace folders and open a read-only Markdown preview. Include minor/patch and major updates, audit warnings, source links, and failed or skipped checks.
- Use fresh registry lookups and existing ecosystem, registry, prerelease, lockfile, and audit settings for reports, even with inline hints disabled. Include hidden project manifests, exclude common dependency and build directories, and support cancellation.
- Check npm `github:owner/repo#<SHA>` pins for updates on the repository's default branch. Support full SHAs and abbreviations of at least seven characters, show updates only when the pin is an ancestor of the branch tip, and include the full target SHA and a comparison link in hovers.

## 0.5.0

- Extend version-availability checks to all supported ecosystems, Deno imports, and runtime declarations. Preserve withdrawn releases as existence evidence, validate Go pseudo-versions directly, and handle tag styles, runtime matrices, vcpkg baselines, and multiple package sources.
- Check npm declarations for missing versions, unmatched ranges, and published versions ahead of `latest`. Show per-declaration lookup failures, availability hovers, and version-issue counts in the status bar.
- Show the newest available update within the current major before the latest major upgrade, including exact pins. Keep separate in-range details in hovers and preserve Go module path hints.
- Select the highest published stable npm version when the `latest` tag lags behind, using metadata from the selected release. Reserve ahead-of-latest availability warnings for prerelease versions.

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
