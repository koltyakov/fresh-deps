# Changelog

## Unreleased

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
