# Review Report: s0304-transaction-contract-freeze

**Reviewer:** Claude Opus 5 (dispatched, report-only)
**Branch:** `feat/s0304-transaction-contract-freeze`
**Commit:** `6d603adb71795525f36d7544f686fad823f4e41b`
**Baseline:** `d84d9d50`
**Date:** 2026-08-09

## Verdict

**CLEAN** — 0 Blocker, 0 Major, 1 Minor, 3 Trivial. Ship-able.

## Gate Results

| Gate | Result | Detail |
|------|--------|--------|
| Type baseline | **PASS** | 3 diagnostics (≤ 3 ceiling). T0 adds zero new diagnostics. |
| vite-example build | **GREEN** | Built in 41.49s, no errors. |
| apps/web build | **PRE-EXISTING FAILURE** | `/api/sounds/search` rejects — missing `FREESOUND_CLIENT_ID`/`FREESOUND_API_KEY` env vars. No `.env` exists. T0's `contracts/**` are imported by nothing (confirmed via grep). NOT a T0 regression. |
| Conformance suite | **PASS** | 19 passed, 0 failed, 1 skipped (deliberate SkipCase demonstration). |
| Boundary check | **PASS** | Zero violations across 7 contract modules. |
| Boundary negative control | **PASS** | Every rule proven able to fail, plus converse fixtures proving rules don't fire indiscriminately. |

## Scope Check

**CLEAN** — The diff is exactly 7 contract files (`apps/web/src/editor/contracts/**`) + `script/check-transaction-boundary.mjs` + 4 change artifacts. No `embedding/` files leaked. No `commands/**`, `ports/`, `rust/`, or Surface edits. Matches proposal/design/tasks precisely.

- **A1=(a) compliance:** CONFIRMED. T0 does NOT author the Surface↔transaction commit binding. T0 exposes frozen types that R1 will consume. No commit-path wiring, no command binding.

## Standards Axis

### Findings

**[Minor] FrameRate spec scenario uses a mathematically incorrect rejection example**
- **File:** `rasen/changes/s0304-transaction-contract-freeze/specs/transaction-automation-api/spec.md:20-21` (mirrored in `design.md:42`)
- **Problem:** The spec's rejection scenario says `{ numerator: 30000, denominator: 1001 }` (NTSC 29.97fps) "is rejected with a typed error, because `120000 / (30000 / 1001)` is not an integer." But `120000 * 1001 / 30000 = 4004` — which IS a positive integer. The code correctly accepts this rate. Verified by running the actual `validateFrameRate` function: `RESULT: ACCEPTED`. The validation logic itself is sound (7/1 and 90/1 are properly rejected), but the spec's worked example is factually wrong.
- **Impact:** A future implementer reading the spec would expect NTSC rejection and could implement it, creating a behavioral divergence from the reference domain types. NTSC frame rates are critical in video editing.
- **Fix:** Replace the spec's rejection example with a rate that actually fails (e.g., `{ numerator: 90, denominator: 1 }` → 1333.333 ticks/frame, or `{ numerator: 7, denominator: 1 }` → 17142.857 ticks/frame). The design.md example ("30000/1001 at 120,000 ticks/sec yields 4000.1333...") should also be corrected — the correct value is 4004, and it is an integer.

**[Trivial] Spec says "every case has status 'passed'" but suite deliberately includes a skipped case**
- **File:** `specs/transaction-automation-api/spec.md:200`
- **Problem:** The spec's conformance-passes scenario asserts "every case has status 'passed'". But the suite includes a deliberate SkipCase demonstration that is intentionally `"skipped"`. The report's `passed` field IS `true` (defined as `failed === 0`), but not every case is `"passed"`.
- **Fix:** Change spec wording to "no case has status 'failed'" or "every non-demonstration case has status 'passed'".

**[Trivial] Spec's "negative duration" scenario expects a TransactionError but validation happens upstream**
- **File:** `specs/transaction-automation-api/spec.md:129-131`
- **Problem:** The spec says creating a clip with negative duration yields `TransactionError { code: "validation" }`. But `MediaTime` rejects negative values at construction (`mediaTime({ ticks: -1 })` throws `RangeError`), so a clip with negative duration cannot reach the `apply` path. The defense-in-depth is correct, but the error type differs from what the spec describes.
- **Fix:** Either update the spec to note that validation occurs at the domain constructor layer (`RangeError`), or add an explicit duration-sanity check in the in-memory fake's `create-clip` path that throws `TransactionError { code: "validation" }`.

**[Trivial] `revisionOf` is marked `@internal` but exported from the public entry point**
- **File:** `apps/web/src/editor/contracts/transaction.ts:27` (JSDoc `@internal`), `apps/web/src/editor/contracts/index.ts:60` (re-export)
- **Problem:** `revisionOf` carries `@internal` JSDoc but is re-exported from the barrel. The in-memory fake needs it, so the export is intentional; the `@internal` tag is misleading.
- **Fix:** Remove the `@internal` tag, or stop re-exporting from index.ts and import directly in the in-memory fake.

### Standards Checklist (no findings)

- **SQL & Data Safety:** N/A — no SQL or persistence in this diff.
- **Race Conditions & Concurrency:** The in-memory fake is single-threaded (async wrappers over synchronous Maps). No concurrency hazard. The real engine (T1) owns concurrency.
- **LLM Output Trust Boundary:** N/A.
- **Enum & Value Completeness:** `TransactionErrorCode` (5 codes), `TrackKind` (5), `AssetKind` (3), `OperationKind` (11) — all complete and internally consistent. The "unsupported" error code is declared but never thrown by the fake (correct — the fake supports all operations).
- **Conditional Side Effects:** `apply` modifies state and notifies watchers only on success. Correct by design.
- **Magic Numbers & String Coupling:** `TICKS_PER_SECOND = 120_000` is a well-named constant. `serializeOps` uses `JSON.stringify` for idempotency comparison — deterministic for the discriminated-union shapes (all string-keyed, insertion-ordered).
- **Dead Code & Consistency:** `_setProject` is a documented test convenience. No dead code.

## Spec Axis

The implementation faithfully matches `proposal.md`, `design.md`, and `tasks.md`:

- **D1 (MediaTime standalone):** Implemented as branded integer at 120,000 ticks/sec with no `@/wasm` import. ✓
- **D2 (Minimal domain types):** All 5 entity interfaces are flat, minimal, and Host-neutral. Not a donor-schema mirror. ✓
- **D3 (Four interfaces):** `read`, `apply`, `getContext`, `watch` — all Promise-returning (except `watch` which is callback-based). ✓
- **D4 (Operations union):** 11 operations with `kind` discriminator. `update-*` takes `Partial<Omit<Entity, "id">>`. ✓
- **D5 (Revisions/idempotency):** Branded `Revision` starting at 0, +1 per apply. `expectedRevision` conflict detection. Idempotency dedup with `duplicate` collision rejection. ✓
- **D6 (Structured errors):** `TransactionError` with 5-code closed union, `operationIndex`, revision details. ✓
- **D7 (Atomic batches):** Working-copy approach — validate+apply on copies, swap in only on success. ✓
- **D8 (File layout):** Matches exactly. ✓
- **D9 (Boundary check):** Two rules, negative control with converse fixtures, empty-scan-is-failure guard. ✓
- **D10 (Conformance suite):** Plain async function, SkipCase pattern, covers all required behaviors. ✓

All 46 tasks in `tasks.md` marked complete. No drift from the proposal's stated "wires nothing" constraint.

## Coverage Diagram

```
CODE PATH COVERAGE
===========================
[+] apps/web/src/editor/contracts/domain.ts
    │
    ├── mediaTime({ ticks })
    │   ├── [TESTED] Non-negative integer → valid (conformance + spec)
    │   ├── [TESTED] Negative → RangeError
    │   └── [TESTED] Non-integer → RangeError
    │
    ├── validateFrameRate(rate)
    │   ├── [TESTED] 30/1 → accepted (spec scenario)
    │   ├── [VERIFIED] 30000/1001 → accepted (code verified, spec example wrong)
    │   ├── [VERIFIED] 7/1, 90/1 → rejected (verified manually)
    │   └── [GAP] No automated test for FrameRate validation (conformance suite
    │           does not exercise it; spec scenario example is incorrect)
    │
    └── Branded ID constructors (trackId, clipId, assetId, markerId, projectId)
        └── [TESTED] Used throughout conformance suite

[+] apps/web/src/editor/contracts/in-memory/index.ts
    │
    ├── apply(batch)
    │   ├── [★★★ TESTED] Create entities + monotonic revision — conformance
    │   ├── [★★★ TESTED] expectedRevision match/mismatch — conformance
    │   ├── [★★★ TESTED] idempotency dedup + collision — conformance
    │   ├── [★★★ TESTED] batch atomicity rollback — conformance
    │   ├── [★★  TESTED] update partial patches — conformance
    │   ├── [★★  TESTED] not-found with operationIndex — conformance
    │   └── [GAP] Empty batch guard (tested by code path but no explicit case)
    │
    ├── read.*()
    │   ├── [★★★ TESTED] tracks/clips/assets/markers + filter — conformance
    │   ├── [★★★ TESTED] defensive cloning — conformance
    │   └── [★   TESTED] project() — exercised via _setProject
    │
    ├── watch(callback)
    │   ├── [★★★ TESTED] fires on success — conformance
    │   ├── [★★★ TESTED] no fire on rejection — conformance
    │   ├── [★★★ TESTED] no fire on dedup — conformance
    │   └── [★★★ TESTED] unsubscribe — conformance
    │
    └── getContext.*()
        ├── [★★  TESTED] revision consistency — conformance
        ├── [★★  TESTED] supportedOperations — conformance
        └── [★   TESTED] capabilities object — conformance

[+] script/check-transaction-boundary.mjs
    ├── [★★★ TESTED] Normal scan — 7 modules, 0 violations
    └── [★★★ TESTED] Negative control — 15 fixtures, all correct

─────────────────────────────────
COVERAGE: Strong. 19 conformance cases + boundary check + negative control.
GAPS: 1 — no automated test for FrameRate validation (spec scenario example
is wrong, so even if a test existed it would fail against correct code).
─────────────────────────────────
```

## Contract Soundness Assessment

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Domain types are minimal flat interfaces, NOT donor-schema mirror | ✓ | `Project`/`Track`/`Clip`/`Asset`/`Marker` are flat, minimal. Design D2 explicitly maps to donor analogues with "NOT a mirror" declaration. |
| `MediaTime` is standalone branded integer at 120,000 ticks/sec, NOT from `@/wasm` | ✓ | `domain.ts:23` `TICKS_PER_SECOND = 120_000`, `domain.ts:38` branded type. No `@/wasm` import. Boundary check bans it. |
| `FrameRate` rejects non-integer-ticks-per-frame at construction | ✓ | `domain.ts:85-106` `validateFrameRate` checks `(TICKS_PER_SECOND * denominator) / numerator` is a positive integer. Verified working for 7/1 and 90/1 rejections. |
| `read`/`apply`/`getContext`/`watch` interfaces | ✓ | `interfaces.ts` defines all four with consistent Promise-returning shapes. |
| Atomic batches | ✓ | Working-copy approach in `processBatch` — copies mutated, real state swapped only on success. |
| Monotonic revisions | ✓ | `INITIAL_REVISION = 0`, `+1` per successful apply, branded type. |
| Expected-revision conflict detection | ✓ | `apply` checks `batch.expectedRevision !== revision` → `TransactionError { code: "conflict" }` with both revisions. |
| Idempotency keys | ✓ | Same key + same ops → replay result. Same key + different ops → `duplicate` error. |
| Structured errors | ✓ | `TransactionError` with 5-code closed union, `operationIndex`, revision details. |
| `apply`→`applier` destructuring handles `.apply()` collision correctly | ✓ | `TransactionConformanceTarget.apply` is typed as `TransactionApply` (an object with `.apply()` method). The suite destructures `apply: applier` then calls `applier.apply(batch)`. When the store is passed as each facet (`{ read: store, apply: store, ... }`), `applier` IS the store, and `applier.apply(batch)` calls the store's apply method correctly. Not a bug. |
