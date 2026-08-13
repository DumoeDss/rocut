# S0304 Project settings transaction implementation report

## Result

The corrective child adds `update-project` as the twelfth closed transaction operation and carries it through the T0 in-memory reference, T1 durable evaluator/conformance, and T2 Draft classification, review, savepoint, inverse, compensation, and conformance paths. The implementation is ready for review once the final encoding and strict Rasen gates recorded below are green.

Validated branch: `feat/s0304-project-settings-transaction-operation`

Base and pre-commit `HEAD`: `3978d724a43329ca75b2d71cb7ec3859e86ea6ae`

## Delivered behavior

- Exported `ProjectPatch` and `UpdateProjectOperation`; `OPERATION_KINDS` now contains exactly twelve kinds.
- Runtime Project patches are non-empty, own-key closed to `name`, `frameRate`, `canvasWidth`, and `canvasHeight`, and reject `id`, unknown/symbol/accessor/non-enumerable keys, malformed values, null Projects, and mismatched IDs.
- Non-empty same-value Project patches remain successful revisioned updates; exact keyed replay remains mutation-free and same-key/different-patch reuse rejects.
- T0 commits an atomic working Project copy and uses property-order-independent canonical replay identity.
- T1 applies the Project candidate through the existing evaluator, complete final-document placement policy, canonical fingerprint, one-save durable commit, watch, and reopen flow without widening the engine, adapter, or `ProjectStore` interfaces.
- T2 treats Project updates as Draft-safe, reports the Project ID, rolls rejected tool calls back to the exact savepoint, and emits at most one constant-size Project inverse containing only changed pre-images.
- T3/T4 product code remains untouched. Their recovery prerequisites are recorded in `handoff/downstream-recovery.md`.

## Verification evidence

| Gate | Command/evidence | Result |
| --- | --- | --- |
| Focused T0/T1/T2 | `bun test apps/web/src/editor/contracts/in-memory/__tests__/in-memory.test.ts apps/web/src/editor/contracts/engine/__tests__/engine.test.ts apps/web/src/editor/contracts/draft/__tests__/draft.test.ts` | PASS — 41 tests, 0 failures, 522 expectations |
| T0 Project execution | Focused in-memory test requires `Project updates execute atomically and idempotently` to be `passed` | PASS — seeded Project case executed, not skipped |
| T0+T1 conformance | Assertions in the focused engine suite | PASS — 36 passed, 0 failed, 2 intentional zero-assertion skips |
| T2 conformance | Assertions in the focused Draft suite | PASS — 21 passed, 0 failed, 1 intentional zero-assertion skip |
| Transaction boundary | `node script/check-transaction-boundary.mjs` | PASS — 31 modules scanned, no editor-internal or storage-mechanism leak |
| Boundary negative control | `node script/check-transaction-boundary.mjs --negative-control` | PASS — every rule caught its deliberate violation and retained its non-match control |
| Type baseline | `node script/check-type-baseline.mjs` | PASS — 3 current diagnostics, all inside the pinned set; no fixture regeneration |
| Vite production build | `bun run build` in `apps/vite-example` | PASS — 2,893 modules transformed |
| Next production build | `bun run build` in `apps/web` with the nine documented placeholder variables | PASS — optimized build and all 19 generated pages completed |
| Vite parity | `bun run test:parity` in `apps/vite-example` | PASS — 1/1, 38.3 seconds |
| Next parity | production `next start` on controlled `127.0.0.1:3010`, then `PARITY_HOST=next PARITY_BASE_URL=http://127.0.0.1:3010 bun run test:parity` | PASS — 1/1, 45.2 seconds; listener stopped afterward |
| Host snapshot comparison | `node script/diff-parity-snapshots.mjs <vite-snapshot> <next-snapshot>` | PASS — 195 leaf values, 0 semantic differences, 9 existing incidental classifications |
| Diff whitespace | `git diff --check` | PASS |
| UTF-8 / BOM / mojibake / line endings / secrets | strict byte audit over 21 owned files | PASS — strict UTF-8, LF-only, no BOM/U+FFFD/mojibake/mixed endings/credential signatures; tracked diff set exact |
| Rasen strict validation | `rasen validate s0304-project-settings-transaction-operation --strict --project rocut --json` | PASS — 1 item passed, 0 failed, 0 issues |

The first controlled Next start attempt omitted the runtime placeholder environment and produced a server-side error page; its Playwright command was terminated at the outer 420-second limit and is not counted as parity evidence. After restoring the documented nine placeholders, `/projects` returned HTTP 200 without the error page and the unchanged scenario passed in 45.2 seconds. Port 3000 was left untouched because it belonged to a VS Code utility process; the owned Next listener used port 3010 and was explicitly stopped.

Build warnings were non-failing and outside this child: Vite reported the existing large-chunk/static-plus-dynamic-import warnings; Next reported workspace-root inference and low-entropy warnings for the documented placeholder auth secret.

## Canonical spec falsification sweep

All 257 SHALL/MUST lines across 16 `rasen/specs/*/spec.md` files were enumerated and reviewed. No canonical assertion is falsified.

- `transaction-automation-api` is the only capability directly touched. Its 24 normative requirement bodies remain satisfied: atomic batch/revision/watch semantics, canonical idempotency, attributable errors, non-mutating validation/dry-run, final placement, one durable save, opaque preservation, exhaustive Draft safety, savepoints, one-batch approval, minimal compensation, and reusable non-vacuous conformance.
- The other 15 capability specs are outside the product touch set. Their protected seams remain unchanged; the boundary/type gates and both production build/parity runs provide the proportionate cross-cutting checks.
- The corrective delta adds the new Project-specific normative requirement; canonical sync is intentionally deferred to archive/merge workflow.

## Scope audit

Product edits are limited to 14 allowed files: 13 tracked contract/conformance/test files plus the new focused in-memory test. The corrective Change contributes seven planning/evidence files including its generated `.openspec.yaml`. The implementation diff contains no forbidden `ProjectStore`, `TransactionEngine`, or `TransactionDocumentAdapter` interface change and no React, Zustand, storage-service, IndexedDB, OPFS, Rust, or WASM reference.

Explicitly unchanged: `rust/**`, generated WASM, Surface and Host roots, T3/T4 product implementation, engine/adapter/store public seams, archived Changes, `script/diff-parity-snapshots.mjs`, `PARITY.md`, and `script/fixtures/type-baseline.json`.

Unrelated untracked Rasen/config/spec directories and `.rasen/**` are pre-existing workspace state and are excluded from the corrective commit.

## Open follow-up

No blocker remains in this corrective child. T3 must consume the reviewed corrective commit before restoring Project projection/routing and parity evidence; T4 must then advertise and execute the twelfth operation. Neither downstream implementation is pulled into this commit.
