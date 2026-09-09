# Changelog

## 0.3.0

- Docker Hub image hints in Dockerfiles and Compose, preserving tag precision and image variants.
- Helm chart dependencies, GitHub-hosted Swift packages, Conan Center recipes, sbt Maven coordinates, Conda channels, and Clojure Maven dependencies.
- Terraform/OpenTofu registry module hints, .NET tool pins and SDK roll-forward hints, and Yarn catalogs.
- Per-ecosystem settings, registry links, cache keys, and manifest-specific comment markers for the new manifests.

- Runtime hints for GitHub Actions `setup-node`, `setup-python`, and `setup-go`, preserving version precision.
- Update hints for Composer, Dart/Flutter, Ruby, Elixir, and Terraform/OpenTofu using their public registries and native version constraints.
- Gradle dependency and plugin hints in version catalogs and build scripts, with shared version references and configurable Maven repositories.
- pnpm catalog hints in `pnpm-workspace.yaml`, using existing npm registry settings and audits.
- Deno hints for npm and JSR imports in configs and import maps, including scopes and package subpaths.
- GitHub Actions hints for version-tagged actions and reusable workflows, preserving tag precision.
- Separate Deno and GitHub Actions enable settings, registry links in hovers, and manifest-specific comment markers.

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
