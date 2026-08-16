# ProjectStore-backed fakes verification

Date: 2026-08-16

All commands below ran from the `feat/sdk-ecosystem-enablement` worktree after
the additive `./conformance/fakes` entry and contracts `0.3.0` version change.

## Interface and package tests

- RED control before implementation:
  `bun test packages/editor-contracts/src/conformance/fakes/__tests__/fakes.test.ts`
  failed with `Cannot find module '..'` (0 pass, non-zero exit).
- Green interface run: 7 tests, 36 expectations, 0 failures, exit 0.
- Requirement-index guard: 4 tests, 24 expectations, 0 failures, exit 0.
- Contracts package run:
  `bun test packages/editor-contracts/src` — 126 tests across 14 files,
  1,378 expectations, 0 failures, exit 0. The printed stale-revision block is
  the intentional real failing-report input of the requirement-first formatter
  test; the surrounding test passes.
- Scoped TypeScript check:
  `bunx tsc --ignoreConfig --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck --types bun packages/editor-contracts/src/conformance/fakes/index.ts packages/editor-contracts/src/conformance/fakes/__tests__/fakes.test.ts`
  — 0 diagnostics, exit 0.
- Scoped ESLint over the new entry and interface test — 0 findings, exit 0.

## Surface-label checker and controls

- Live run: 3 packages, 36 non-mechanical export entries, 0 dangling targets,
  all 4 rules passed.
- Final live census:

  | package | entries | frozen | provider | experimental |
  | --- | ---: | ---: | ---: | ---: |
  | `@opencut/editor-ports` | 6 | 5 | 0 | 1 |
  | `@opencut/editor-contracts` | 11 | 9 | 0 | 2 |
  | `@opencut/editor-classic` | 19 | 2 | 13 | 4 |

- Negative control: all planted completeness, marker-agreement,
  override-validity, and target-existence violations fired, including the
  unlabeled experimental entry, absent target at both classes, conditional
  target, and stale marker; exit 0.
- Converse control: 3 correctly classified fixture entries (1 frozen,
  1 provider, 1 experimental), 0 dangling targets, no false positive; exit 0.

## Package-boundary checker and controls

- Live run: 1,140 repository files considered; 1,013 source files and 419
  cross-package edges scanned; 418 `@opencut/*` specifiers examined; 872 files
  scanned for internal re-exports; 76 base-layer files scanned for React/DOM
  isolation. All 5 rules passed, exit 0.
- Negative control: every planted rule violation fired, including an
  undeclared cross-package subpath and the fourth-package/electron-consumer
  scope controls; exit 0.
- Converse control: every legal downward/declared/prose/base-layer case stayed
  silent; exit 0.

## Packed consumer view

`node script/check-sdk-consumer-view.mjs` packed fresh artifacts and inspected
their extracted contents rather than the workspace. Exit 0 with 0 failures and
0 dangling export entries.

| packed package | version | frozen | provider | experimental |
| --- | --- | ---: | ---: | ---: |
| `@opencut/editor-ports` | `0.2.0` | 5 | 0 | 1 |
| `@opencut/editor-contracts` | `0.3.0` | 9 | 0 | 2 |
| `@opencut/editor-classic` | `0.2.0` | 2 | 13 | 4 |

The extracted contracts tarball contained the new target and its single
`@opencutSurface experimental` marker; the export and classification sets were
equal.

## Frozen-byte comparison

`git diff --quiet 661d7ac8 -- <path>` passed for all four standing frozen
files. Their Git blobs and SHA-256 values exactly match
`evidence/before-contracts-surface.md`:

| path | Git blob | SHA-256 |
| --- | --- | --- |
| `packages/editor-classic/src/editor/transactions/opencut/index.ts` | `40862cca34f7128dc12b7114efe9db7233778659` | `24f01d2231363d9d5edbe013262e1aeb3794b3ae967f90b49c00b83dc59cb1fa` |
| `packages/editor-contracts/src/engine/engine.ts` | `b29d2f7588b9f691b3f8890ed274ba3669d42049` | `7575b63ceec9d809776dd3fc3e37a3c2f1ad147ee614c097b0ad5fac137212a4` |
| `packages/editor-ports/src/index.ts` | `87c19d8e335e74cdc225a303274e5b810c413455` | `cb747ee83ed1accd5bf9ad94dc87d023eed8a5845480c8960b9c54b34e05cdb9` |
| `packages/editor-classic/src/editor/surface/embedding/types.ts` | `52f1ec78da16a598d5433719362c5938d23c5636` | `bfdd9f888bab76ce0ae28a55e4ab0d5391b96fa9286df1ff3661de2c61cb6bee` |
