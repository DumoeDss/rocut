# C4 implementation baseline

Date: 2026-08-01
Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c4`

## Identity and protected inputs

- `git status --short`: empty before implementation.
- `git rev-parse HEAD`: `507cecf456ed68007c60829be5c3c41bebf64a5d`.
- `git rev-parse HEAD^{tree}`: `2dd46187ff2d31b026010cb3d6573dcf099441d3`.
- branch: `feat/s02-asset-resource-ports`.
- Node: `v24.14.0`; Bun: `1.2.2`.
- protected port tree (`HEAD:apps/web/src/editor/ports`): `3f7d89b52a3d8f1474519695b7ae7e0a5f68c471`.
- protected parity tree (`HEAD:apps/vite-example/tests/parity`): `e1fbb55b985f4fb490c6b233d18c50c58ea14c28`.
- protected type-baseline blob: `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8` (SHA-256 `0F7CC855FC8F5C7EDD68B2C371BAE993FE8E713D2FFD4EF21956DE72BD387622`).
- protected parity-diff oracle blob: `fa387ebea1e7f0cc1110eebcb922d393a1337842`.
- protected public session blobs: `create-session.ts` `ee63d7843fa73df6959aa92030bf4871236b6038`; `session-types.ts` `c67d9822a2a6c994be14f367e6980fbbaa6e454b`; `index.ts` `59dd907482a109f8627b217764925bd284f3f223`.

## Frozen boundary gates before editing

All commands ran from the clean C4 worktree.

- `node script/check-port-boundary.mjs`: exit 0, 30 contract modules, all five rules PASS.
- `node script/check-reference-boundary.mjs`: exit 0, 869/1241 files scanned, all rules PASS.
- `node script/check-storage-boundary.mjs`: exit 0, 721 source files, browser storage confined to storage services and current provisional Host adapter path.
- `node script/check-session-state-boundary.mjs`: exit 0, 9/9 factories, 9/9 registry keys, 52 classified imperative modules.
- `node script/check-next-imports.mjs`: exit 0, 726 files, 25 shell-only Next importers and no editor-graph Next import.
- `bun run build` in `apps/vite-example`: exit 0, fresh output, 2863 transformed modules.
- `node script/check-distributable-boundary.mjs`: exit 0, 2863-module fresh graph, all ten exclusion rules PASS (568 editor, 9 Vite Host, 2282 dependency, 4 other modules).

## Type and full-suite baseline

Content Collections was first generated through its canonical `createBuilder(...).build()` API because
the ignored `.content-collections/generated` directory is a required local build artifact. Before
generation the type checker correctly failed with the eight missing-content diagnostics; that run is
environment bring-up evidence, not a product baseline.

- `node script/check-type-baseline.mjs`: exit 0 after generation; exactly 3 current diagnostics,
  all in the pinned baseline set; compiler TypeScript 5.9.3.
- first `bun test` run: 221 pass / 9 fail / 3 errors / 552 expectations. The only extra result was
  the outer session-state wrapper crossing its 5-second timeout while its isolated child passed all
  six tests in 4.84 seconds.
- focused rerun `bun test apps/web/src/editor/session/__tests__/session-state-isolation.test.ts`:
  exit 0, 1 pass in 4.34 seconds.
- authoritative immediate full rerun `bun test`: expected exit 1 with exactly **222 pass / 8 fail /
  2 module errors / 552 expectations**, 230 tests across 38 files. The six failures remain
  `resolveTrackPlacement` / `ZERO_MEDIA_TIME`; the errors remain masks/WASM
  `__wbindgen_start` and timeline update-pipeline / `DEFAULTS`. No new identity remains.

The transient wrapper timeout is recorded rather than hidden; the isolated rerun plus immediate
full-suite result identifies it as scheduling noise, not a changed baseline.
