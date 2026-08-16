# Final text and worktree hygiene

Date: 2026-08-16

Repository base: `661d7ac87c3d324839d51bf30470bbf81764b694`

The final scan covers every file returned by
`git ls-files -m -o --exclude-standard`, including the implementation, documentation, template,
Rasen artifacts, and evidence added by this change.

## Text encoding and line endings

- 56 changed or new text files decoded with .NET's throwing UTF-8 decoder.
- Invalid UTF-8: 0.
- UTF-8 BOM: 0.
- CR bytes: 0.
- Unicode replacement characters (`U+FFFD`): 0.
- Typical mojibake code-point patterns (`U+00C3`, `U+00E2`, `U+9359`, `U+93C2`,
  `U+951B`): 0.
- `git diff --check`: exit 0.

## Structured files

- 9 changed JSON files parsed through `ConvertFrom-Json`: 9/9 passed.
- `.github/workflows/bun-ci.yml` and the change's `.openspec.yaml` parsed through PyYAML
  `safe_load`: 2/2 passed.

## Staging and untracked inventory

- Staged paths at scan time: 0.
- Staged `.rasen/` paths: 0.
- Git-visible untracked files: 38 after adding this evidence file.
- Every untracked file belongs to one of the intended additive roots:
  `docs/adapter-authors/`, `packages/editor-contracts/src/conformance/fakes/`,
  `rasen/changes/sdk-ecosystem-enablement/`, `templates/adapter-project/`, or one of the five
  named adapter-author runner/checker/lifecycle files (including the lifecycle safety test).
- Unexpected untracked generated artifacts: 0.
- The local `.rasen/` directory contains directories only and no files; it is not staged and will
  remain outside every explicit commit pathspec.

## Path-reference check

An executable scan extracted repository-relative `apps/`, `docs/`, `examples/`, `packages/`,
`rasen/`, `rust/`, `script/`, and `templates/` references from added diff lines and the full text
of new files, then checked each concrete path with `Test-Path -LiteralPath`.

- Concrete added path references: 36.
- Missing or stale moved-path references: 0.
- The glob family name `script/check-*.mjs` was classified as a glob, not a concrete path.
- The prose compound `CI/docs/checker` was classified as workflow shorthand, not a concrete
  `docs/checker` path.

No existing historical prose outside added lines was reclassified as a new reference merely
because its large containing document received a scoped additive section.
