# Changelog

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
