# Review cycle round 1 fixer evidence

## Scope and disposition

- Change: `s0304-project-settings-transaction-operation`
- Original implementation range: `3978d724a43329ca75b2d71cb7ec3859e86ea6ae..b79f7995019df0a27da1d15a5503c127ff3faff0`
- Round-1 correction base: `b79f7995019df0a27da1d15a5503c127ff3faff0`
- Reviewed base tree: `b3e351f94a06aed6457c0936eb13a5e295e0a18f`
- Tested product/test tree before adding this report: `42d872dc7d69afa62298495868f974a91ddfbfe3`
- Fixer: Codex round-1 non-author fixer
- Status: F1-F3 correction implemented and gate-tested, then independently re-reviewed over `b79f7995019df0a27da1d15a5503c127ff3faff0..a798bbe46d42b9c2a24494630101de49b5821c84`; **the round-1 delta is CLEAN for all prior Blocker/Major findings**. F4 remains accepted-known.
- F4 remains accepted-known exactly as recorded by the reviewer. No Host-evidence redesign or parity-oracle change was attempted.

The correction is limited to the C1 transaction reference, durable evaluator/placement policy, focused tests, reusable T1 conformance, and C1 review evidence. It does not edit T3/T4 product code, Host roots, Surface, Rust/WASM, engine/document-adapter/`ProjectStore` interfaces, parity oracles, type-baseline fixtures, archived Changes, or Rasen run-state.

## Round 1 finding corrections

| Finding | Fixer correction | Regression evidence | Independent confirmation |
| --- | --- | --- | --- |
| F1 Blocker | Both T0 and T1 now inspect nested `frameRate` descriptors without invoking accessors, require exactly enumerable data properties `numerator` and `denominator`, reject excess/string-private/symbol/accessor/non-enumerable payload shapes, and construct a fresh two-field candidate value. | Focused T0 and T1 adversarial loops; T1 reusable conformance checks dry-run/apply rejection plus live/persisted/reopen equality and exact persisted keys. | **CONFIRMED RESOLVED** — non-author inspection plus an independent live/persist/reopen probe rejected the nested private key and retained exactly `numerator`/`denominator`. |
| F2 Major | Removed eager Project validation before canonicalization. Canonical fingerprinting and durable same-key replay/collision now precede serializable Project patch reduction; normal `collectAllIssues` reduction reports both attributable Project issues; non-canonicalizable inputs retain a structured `invalid-entity` fallback without invoking a `kind` getter. | T0 and T1 same-key collisions with empty and excess patches; T1 dry-run/apply collision checks; two-operation validation expects indexes `[0, 1]`; nested symbol/accessor/non-enumerable cases exercise the fallback. | **CONFIRMED RESOLVED** — empty/excess keyed patches returned dry-run `idempotency-conflict` and apply `duplicate`; independent validation returned both indexes `[0, 1]`. |
| F3 Major | Timebase placement attribution resolves over the affected clip/marker plus the Project timebase origin while returning only the affected entity in `entityIds`. The evaluator records an origin only when FPS actually changes, so a later name-only Project patch cannot steal causality. | Focused T1 validate/apply checks for untouched clip and marker at Project operation index 1, followed by a later Project patch; reusable conformance repeats both entity-ID/index checks and accepts explicit same-batch clip+marker repair. | **CONFIRMED RESOLVED** — independent validate/apply attributed untouched clip and marker failures to Project operation 1, and explicit same-batch repair committed all three IDs. |
| F4 Minor | Accepted-known; unchanged. | Existing review report remains canonical. | **ACCEPTED-KNOWN** — deliberately not expanded in round 1. |

## Verification scope and rationale

The risk is confined to runtime input closure, evaluator ordering, durable publication/reopen, placement attribution, and Draft reuse of the evaluator. The focused T0/T1/T2 suites exercise those paths and embed all three reusable conformance layers. Boundary and type gates cover seam/type regressions; both production builds cover the shared TypeScript module graph. Browser parity was not rerun because this child still has no runtime caller and F4 is explicitly accepted-known; the correction changes no UI/Host/parity path.

| Gate | Exact command | Result |
| --- | --- | --- |
| Focused T0/T1/T2 plus embedded conformance | `bun test apps/web/src/editor/contracts/in-memory/__tests__/in-memory.test.ts apps/web/src/editor/contracts/engine/__tests__/engine.test.ts apps/web/src/editor/contracts/draft/__tests__/draft.test.ts` | PASS — 45 tests, 0 failures, 609 expectations. Embedded T0+T1 conformance remains 36 passed / 0 failed / 2 intentional skips; T2 remains 21 passed / 0 failed / 1 intentional skip. The seeded T0 Project case executed, not skipped. |
| Transaction boundary | `node script/check-transaction-boundary.mjs` | PASS — 31 contract modules scanned; no editor-internal import or storage-mechanism leak. |
| Boundary negative control | `node script/check-transaction-boundary.mjs --negative-control` | PASS — every deliberate violation was caught and every non-match control remained uncaught. |
| Type baseline | `node script/check-type-baseline.mjs` | PASS — 3 current diagnostics, all inside the pinned baseline; no fixture regeneration. |
| Corrected engine-source lint | `bunx eslint apps/web/src/editor/contracts/engine/evaluator.ts apps/web/src/editor/contracts/engine/placement.ts` | PASS — 0 diagnostics. |
| Vite production build | `bun run build` from `apps/vite-example` | PASS — Vite 7.3.6, 2,893 modules transformed, built in 46.64s. Existing dynamic/static import and large-chunk warnings only. |
| Next production build | `$env:DATABASE_URL='postgresql://opencut:opencut@localhost:5432/opencut'; $env:BETTER_AUTH_SECRET='build-placeholder-secret-32-characters'; $env:NEXT_PUBLIC_SITE_URL='http://localhost:3000'; $env:UPSTASH_REDIS_REST_URL='https://placeholder.example.com'; $env:UPSTASH_REDIS_REST_TOKEN='build-placeholder-token'; $env:NEXT_PUBLIC_MARBLE_API_URL='https://placeholder.example.com'; $env:MARBLE_WORKSPACE_KEY='build-placeholder'; $env:FREESOUND_CLIENT_ID='build-placeholder'; $env:FREESOUND_API_KEY='build-placeholder'; bun run build` from `apps/web` | PASS — compiled successfully, generated all 19 static pages; existing workspace-root inference warning only. Values are documented non-secret build placeholders. |
| Rasen strict validation | `rasen validate s0304-project-settings-transaction-operation --strict --project rocut --json` | PASS — 1 item passed, 0 failed, 0 issues. |
| Strict text audit | PowerShell 5.1-compatible `.NET UTF8Encoding(false, true)` byte audit over the six correction files plus `review-report.md` and this report | PASS — 8/8 strict UTF-8, LF-only, no BOM, U+FFFD, named mojibake signatures, bare CR, or mixed line endings. |
| Diff whitespace | `git diff --check` | PASS. |

## Adversarial path evidence

### Nested `frameRate` closure

- A canonicalizable `{ numerator: 30, denominator: 1, providerPrivate: "smuggle" }` is rejected by normal Project reduction.
- A symbol-keyed value, an accessor whose getter throws if invoked, and an exact-key value with non-enumerable `denominator` are rejected structurally. The accessor is never invoked.
- T0 retains its base Project/revision. T1 reports indexed `invalid-entity` from validate/dry-run/apply, performs zero saves, keeps the live Project unchanged, preserves the exact persisted two-key frame rate, and reopens to the unchanged Project.

### Canonical identity and issue collection

- After a valid keyed Project commit, same-key empty and excess Project patches return `idempotency-conflict` from dry-run and `TransactionError { code: "duplicate" }` from apply before serializable patch validation.
- Without an idempotency collision, validate reduces two independently invalid Project operations and reports both indexes in operation order.
- Non-canonicalizable symbol/accessor/non-enumerable values still return the structured Project-indexed fallback; fallback kind discovery reads descriptors rather than invoking getters.

### FPS placement attribution

- A batch with operation 0 updating a track, operation 1 changing Project FPS, and operation 2 changing only Project name leaves an untouched clip and marker off-grid. Both issues retain only their affected entity ID and carry `operationIndex: 1`.
- Apply exposes the same Project operation index and publishes nothing.
- Explicit same-batch Project+clip+marker repair commits in order and reports all three changed IDs.

## Post-fix tree and re-review pointer

- Product/test tree exercised by the final focused/type/build gates: `42d872dc7d69afa62298495868f974a91ddfbfe3`
- Round-1 delta starts at: `b79f7995019df0a27da1d15a5503c127ff3faff0`
- Independent reviewer re-reviewed exactly `b79f7995019df0a27da1d15a5503c127ff3faff0..a798bbe46d42b9c2a24494630101de49b5821c84` against F1-F3 and left F4 accepted-known.

## Independent reviewer confirmation — round 1

### Final disposition

- Reviewer mode: independent Codex C1 reviewer, dispatched/report-only; no product/test/run-state edits and no subagent delegation.
- Exact reviewed delta: `b79f7995019df0a27da1d15a5503c127ff3faff0..a798bbe46d42b9c2a24494630101de49b5821c84`.
- Confirmed current `HEAD`: `a798bbe46d42b9c2a24494630101de49b5821c84`.
- Confirmed `git rev-parse 'HEAD^{tree}'`: `43fa65f07636dd45441e0b92d0e5c01d1be64716`.
- Scope check: CLEAN — six transaction implementation/test files plus the two canonical review evidence files; no T3/T4, Host, Surface, Rust/WASM, public adapter/store interface, parity-oracle, type-fixture, archive, or run-state change.
- Disposition: **CLEAN — 0 Blocker / 0 Major / 0 new Minor / 0 Trivial in the round-1 F1-F3 delta.** The original F1 Blocker and F2/F3 Majors are independently confirmed resolved.
- Accepted-known: original F4 Minor remains exactly as recorded in `review-report.md`; no expansion or reranking was performed.

### Non-author resolution audit

| Prior finding | Independent code-path confirmation | Independent runtime confirmation | Result |
| --- | --- | --- | --- |
| F1 nested `frameRate` trust boundary | T0/T1 enumerate own descriptors, reject excess/symbol/accessor/non-enumerable shapes, and rebuild a two-field value; T1 canonicalization also rejects non-plain or non-data input before cloning. | Reviewer-only in-memory ProjectStore probe observed indexed validate/dry-run/apply rejection, unchanged live Project, persisted keys exactly `numerator`/`denominator`, and unchanged reopened Project. | RESOLVED |
| F2 idempotency precedence and issue aggregation | T1 canonical fingerprint/clone and durable lookup now precede reduction; serializable Project validation runs inside the collecting reducer. T0 already fingerprints/looks up before `processBatch`. | Same-key empty and excess patches produced dry-run `idempotency-conflict` and apply `duplicate`; a separate two-invalid-operation validate produced indexes `[0, 1]` in order. | RESOLVED |
| F3 causal FPS attribution | The evaluator stores the Project origin only on an actual frame-rate change; timebase issues resolve attribution over affected entity plus Project while keeping only the entity in `entityIds`. | Untouched clip and marker issues both carried `operationIndex: 1`; apply exposed the same index; a later name-only Project patch did not steal attribution; Project+clip+marker repair committed all three changed IDs. | RESOLVED |

### Reviewer-executed final gates

| Gate | Exact command | Independent result |
| --- | --- | --- |
| Focused T0/T1/T2 and embedded conformance | `bun test apps/web/src/editor/contracts/in-memory/__tests__/in-memory.test.ts apps/web/src/editor/contracts/engine/__tests__/engine.test.ts apps/web/src/editor/contracts/draft/__tests__/draft.test.ts` | PASS — 45 tests, 0 failures, 609 expectations. The suites assert T0+T1 `36/0/2 intentional skips` and T2 `21/0/1 intentional skip`. |
| Transaction boundary | `node script/check-transaction-boundary.mjs` | PASS — 31 modules, 0 violations. |
| Boundary negative control | `node script/check-transaction-boundary.mjs --negative-control` | PASS — every deliberate violation caught and every converse retained. |
| Type baseline | `node script/check-type-baseline.mjs` | PASS — 3 current diagnostics, 0 outside the pinned baseline. |
| Corrected engine lint | `bunx eslint apps/web/src/editor/contracts/engine/evaluator.ts apps/web/src/editor/contracts/engine/placement.ts` | PASS — 0 diagnostics. |
| Strict Change validation | `rasen validate s0304-project-settings-transaction-operation --strict --project rocut --json` | PASS — 1/1 item, 0 failures, 0 issues. |
| Delta whitespace | `git diff --check b79f7995019df0a27da1d15a5503c127ff3faff0 a798bbe46d42b9c2a24494630101de49b5821c84` | PASS — no output. |
| Reviewer-only adversarial probe | PowerShell 5.1 UTF-8 here-string piped to `bun run -`; no file written | PASS — independently exercised F1 live/persist/reopen, F2 collision/aggregation, and F3 clip+marker/apply attribution plus same-batch repair. |

### Coverage

```text
ROUND-1 DELTA COVERAGE
======================
[*** TESTED] F1 exact nested frameRate boundary -> validate/dry-run/apply/live/persist/reopen
[*** TESTED] F2 keyed invalid collision -> dry-run/apply; two invalid operations -> all issues
[*** TESTED] F3 FPS cause -> untouched clip + marker + apply; explicit same-batch repair

Scoped prior Blocker/Major findings: 3/3 independently resolved.
New scoped gaps: 0.
Accepted-known outside the round-1 fix gate: F4 Minor only.
```

### Durable findings

1. A structured public value is closed only when its own descriptors are exact and the committed candidate is rebuilt from allowed fields; closing the outer patch alone is insufficient.
2. Canonical identity and durable keyed lookup are observable semantics and must precede validation of any canonicalizable competing payload.
3. Global Project timebase mutations require a retained causal origin that later non-timebase Project edits cannot overwrite.
