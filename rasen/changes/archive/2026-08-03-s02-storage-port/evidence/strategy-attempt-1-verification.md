# C5 strategy attempt 1 material-gate verification

Date: 2026-08-02 (Asia/Shanghai)  
Mode: report-only; no product or task edits  
Product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5`  
HEAD: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
HEAD tree anchor: `286272307b05d23826ffa7223a76695365194dba`  
Merged worktree baseline: 85 status entries

Scope: the strategy-attempt-1 acceptance contract, including the two review-round3 material defects; regression of all 17 round1/round2 risks; the complete real-Chromium C5 matrix; C4 forced-none stress; focused suites; all four positive and negative architecture boundaries; the exact-three type ceiling; diff and strict validation; database, port, and runner-output cleanup.

This is a scoped material gate. It is not section 11 final verification, does not authorize landing, and does not replace the deferred fresh-build, parity, distribution, protected-hash, full inherited-suite, provenance, SBOM, license, or final write-set checks.

VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

## Inputs and independence

The verifier read the planner handoff, `evidence/review-round3.md`, `evidence/strategy-attempt-1-design.md`, and both implementation reports (`strategy-attempt-1-m1.md` and `strategy-attempt-1-m2.md`) before running the controls independently on the combined uncommitted product worktree. No implementation claim was accepted without a matching executable control.

## Required acceptance 1–7

| # | Required control | Independent result |
| --- | --- | --- |
| 1 | A migration fails after destination attachment puts; a later replacement of that attachment wins after runtime reset/new wrapper; initialization converges and removes recovery/stage state. | PASS. `stagedProjectLaterSaveWins=true` and `originalProjectLaterSaveWins=true`. The reopened record retained the later metadata and body, and the harness completed its recovery cleanup. |
| 2 | The same failure followed by a later attachment removal must not resurrect the attachment. | PASS. `stagedProjectLaterRemoveWins=true` and `originalProjectLaterRemoveWins=true`. Initialization converged with the attachment absent. |
| 3 | A failure before the staged project-row put, after at least one attachment put, must honor a later same-key save/remove through original-project recovery. | PASS. The original-project save and remove axes above were both true; the later winner survived the recovery path. |
| 4 | Physical absence without a tombstone and a digest mismatch are ambiguous and must retain recovery rather than guess. | PASS. `physicalAbsenceRetainsRecovery=true` and `digestMismatchRetainsRecovery=true`; both controls rejected convergence and retained the recovery evidence. |
| 5 | With a certified owner registry and `indexedDB.databases` masked, projects/all clear must delete every known project database/directory and allow same-ID reuse without old metadata/body. | PASS. `certifiedProjectsClearWithoutEnumeration=true` and `certifiedAllClearWithoutEnumeration=true`; both clear scopes removed the registered project/media/library targets and same-ID reuse observed no old payload. |
| 6 | With an uncertified registry and enumeration masked, projects/all clear must refuse before commit and leave project, media, and library data readable. | PASS. `uncertifiedProjectsClearRejectsAtomically=true` and `uncertifiedAllClearRejectsAtomically=true`; neither scope published a partial clear. |
| 7 | Owner registration racing with clear must be serialized, while the complete browser, lifecycle, cascade, corrupt, abort, boundary, and type controls remain green. | PASS. `ownerRegistrationClearRaceIsSerialized=true`; all retained matrices below passed. |

Material acceptance axes: M1 6/6 true; M2 5/5 true; combined 11/11.

## Complete real-Chromium matrix

Command:

    bunx playwright test --config playwright.c5-storage.config.ts

Result: exit 0; 3 passed, 0 failed in 16.5 seconds, using Chromium 151.0.7922.34 / CDP 1.3.

- Shared BrowserProjectStore conformance: 19 passed, 0 failed, 0 skipped.
- Migration round 1: 16/16 result fields true; its separate reopen spec also passed.
- Migration round 2 retained 8/8 prior boolean axes and added M1 6/6; 16 lifecycle races ran with 0 failures.
- Cascade round 1: 9/9 true.
- Cascade round 2: 11/11 true, comprising the prior 6 axes and all 5 M2 axes.
- Typed corrupt project/attachment/library list/load: 6/6 true.
- Active mid-flight read abort: 7/7 paths; `midFlightReadsAborted=true`.
- C4 forced-none session-persistence spec passed in the complete configuration.
- Migration database inventory was `beforeDatabases=[]` and `afterDatabases=[]`; randomized cleanup proofs were emitted for every disposable family.

### C4 forced-none stress

Command:

    bunx playwright test --config playwright.c5-storage.config.ts tests/c5-storage/c4-forced-none.pw.ts --repeat-each=5

Result: exit 0; 5 passed, 0 failed in 29.6 seconds. Including the complete configuration, the forced-none path passed 6/6 executions.

## Round1/round2 17-risk regression

All 17 previously accepted risks remained green.

Round 1, 10/10: nested provider-private migration; two-session sound/preset union and rejected-predecessor recovery; cascade journal recovery/reset; migration cleanup retry/diagnostic behavior; old-envelope migration; two-wrapper ordinary mutation serialization; typed corrupt list/load; duplicate late-save cleanup; external-target refusal; seven active-abort paths.

Round 2, 7/7: opaque cascade literal/cross-project refusal; 16 bidirectional same/cross-wrapper lifecycle races; same-instance initialization retry with mechanism-neutral diagnostics; cleanup-intent reload recovery; committed readback and later mutation precedence; namespace/all-clear atomic recovery; stale preset load versus later save/remove.

The review-round3 defects are covered directly by acceptance 1–6 above; neither reproduced.

## Focused executable evidence

### Strategy-focused material controls

Command covered port conformance, the isolated C5 storage RED wrapper, and all final storage-boundary negative fixtures.

Result: exit 0; 48 passed, 0 failed, 216 expectations across 3 files.

- Port conformance: 28 tests; the expected capability skips remained declared and the complete-browser profile separately prohibited required skips.
- Storage RED wrapper: 1 passed.
- Storage negative fixtures: 19 passed, 0 failed, 37 expectations.

### Broad C5 regression set

The 16-file focused command covered port conformance, opaque round-trip, v1 and provider-private migration, storage RED controls, async/lifecycle/state sessions, Host composition, project/media/save/thumbnail rewires, media persistence/capacity, and storage-provider operations.

Result: exit 0; 65 passed, 0 failed, 241 expectations.

### Expanded deterministic adversarial suites

- Async session/store isolation: 14 passed, 0 failed, 78 expectations.
- Provider-private migration: 1 passed, 0 failed, 6 expectations.
- Project persistence rewire: 4 passed, 0 failed, 19 expectations.

Aggregate: 19 passed, 0 failed, 103 expectations. The Zustand unavailable messages in the sticker negative path were expected diagnostics; all assertions passed.

## Architecture boundary gates

### Positive gates

- Port boundary: exit 0; 30 contract modules; every rule passed.
- Storage boundary: exit 0; 721 source modules; 0 direct `storageService` imports/exports, 0 `BrowserHostAdapter` references, 0 unexpected mechanism hits, 0 unclassified persistence-localStorage files, one ProjectStore role, and no production in-memory fallback.
- Host composition: exit 0; 2 Host roots / 718 production modules; every rule passed.
- Session-state boundary: exit 0; 10/10 factories, 10/10 registry keys, 52 classified imperative modules.

### Negative/non-vacuity gates

- Port negative control: exit 0; 22/22 named catch/non-catch probes matched expectation.
- Host negative control: exit 0; 12/12 rule probes were caught.
- Session-state negative control: exit 0; 36/36 named probes matched expectation.
- Storage negative fixtures: exit 0; 19 passed, 0 failed, 37 expectations.

## Exact-three type ceiling

`node script/check-type-baseline.mjs` exited 0 under TypeScript 5.9.3: 3 diagnostics now versus 13 at pin `cf5e79e9`, with no identity outside the pinned set.

The direct `apps/web` compiler exited 2 and produced exactly the expected three diagnostic identities:

1. `next.config.ts(78,49)` TS2345 — duplicate `NextConfig` identity.
2. `src/timeline/__tests__/update-pipeline.test.ts(69,40)` TS2769 — number is not `MediaTime`.
3. `src/timeline/placement/__tests__/resolve.test.ts(646,5)` TS2769 — `adjustedStartTime` number is not `MediaTime`.

No fourth or changed diagnostic identity appeared.

## Diff, strict validation, and hygiene

- `git -c core.whitespace=cr-at-eol diff --check`: exit 0. Git emitted LF-to-CRLF working-copy warnings only; there was no whitespace error.
- `rasen validate s02-storage-port --project rocut --strict --json`: exit 0; valid=true, 1 passed, 0 failed, 0 issues.
- HEAD and tree anchor remained `0ef35459f685d5d41a25d0ef959aff691b7519cd` / `286272307b05d23826ffa7223a76695365194dba`.
- A delayed Playwright web-server child briefly reappeared on port 4175 after the first clean check. Its exact chain was verified as this worktree's `node vite.js --port 4175 --strictPort --host 127.0.0.1` process (PID 47028 under the completed Playwright-launched Vite/Bun shell), and only that exact process was stopped. Immediate and delayed-five-second follow-up checks found 0 listeners on ports 4175, 43551, and 43552.
- Playwright generated exactly one 45-byte artifact path, `apps/vite-example/tests/.pw-output-c5-storage/.last-run.json`. It was inspected, removed after the delayed child exited, and remained absent in both final checks; scoped generated-output count returned to 0.
- Product worktree status returned from the transient 86 entries to its exact 85-entry pre-run baseline.
- Browser database inventory was empty before and after the disposable matrix.
- `tasks.md` SHA-256 remained `48173DD339B195768F05FC9A6EEBF64D172E7D3120818E6743DE8F7467212674`.
- All 12 section 11 tasks remained unchecked.
- The verifier edited no product file and no task item.

## Scoped assessment

The strategy-attempt-1 material contract is independently green. The later-mutation migration precedence defect and enumeration-masked clear defect did not reproduce in their positive, negative, ambiguity, or race controls, and all 17 prior risks retained their executable proof. This report intentionally stops before section 11.

TEST EVIDENCE
- scope: strategy acceptance 1–7; M1 6 axes; M2 5 axes; complete Chromium C5 matrix; round1/round2 17-risk regression; C4 forced-none stress; focused suites; four positive/negative boundaries; exact-three type ceiling; diff, strict, database, port, runner, tasks, and worktree hygiene
- rationale: independently exercises both review-round3 failure mechanisms and their refusal boundaries on the combined uncommitted tree while proving earlier controls were not weakened
- command: exact commands, selectors, counts, and environment-specific results are recorded above
- result: pass
- tree: `286272307b05d23826ffa7223a76695365194dba` (HEAD tree anchor; verified implementation is the uncommitted 85-entry product worktree above it)
