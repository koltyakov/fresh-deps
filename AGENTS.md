# Agent notes

## Project

- Fresh Deps is a TypeScript VS Code extension that shows dependency updates inline in manifest files.
- `src/extension.ts` is the extension entry point.
- Manifest parsers live in `src/parsers/`, registry clients in `src/registries/`, and tests in `test/`.
- `package.json` defines extension contributions, settings, and development scripts.
- Use npm and the Node.js/npm versions pinned in `package.json` under `volta`.

## Making changes

- Follow existing TypeScript patterns and keep changes focused on the request.
- Add or update tests for behavior changes.
- Update `README.md` when changing user-facing behavior or settings.
- Preserve existing user changes. Do not reformat or auto-fix unrelated files in a dirty working tree.
- Edit source files rather than generated output in `dist/` or `out/`.

## Validation after changes

Agents must run the linter and formatter after making changes, before finishing the task.

- `npm run lint:check` runs Oxlint with type-aware checks.
- `npm run fmt:check` checks formatting with Oxfmt.
- Use `npm run lint` and `npm run fmt` to apply fixes, then rerun the checks. Both commands modify files, so scope fixes to the files you changed when unrelated work is present.
- `npm run check` type-checks both source and tests.
- `npm test` compiles and runs the test suite. Run it for code changes.
- `npm run build` creates the production extension bundle. Run it for changes that affect bundling or packaging.

Use the checked-in `oxlint.config.mts` and `oxfmt.config.mts` configurations. Oxfmt currently excludes Markdown files, including this file.

Report any failed or skipped checks in the final response. Do not claim validation passed if a command failed or was not run.
