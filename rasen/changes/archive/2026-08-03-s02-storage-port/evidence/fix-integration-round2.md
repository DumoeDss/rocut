# C5 post-fix integration verification — round 2

Date: 2026-08-02 (Asia/Shanghai)  
Mode: report-only; no product or task edits  
Product worktree: E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5  
HEAD: 0ef35459f685d5d41a25d0ef959aff691b7519cd  
HEAD tree anchor: 286272307b05d23826ffa7223a76695365194dba  
Merged worktree baseline: 84 status entries

Scope: the seven round-2 review gaps, regression of all ten round-1 risks, the complete real-Chromium store/migration-R1/migration-R2/cascade-R1/cascade-R2/corrupt/abort matrix, focused suites, all four positive and negative architecture boundaries, the exact-three type ceiling, diff check, strict Rasen validation, disposable database cleanup, verifier ports, and runner-output cleanup.

This is not section 11 final verification. It does not cover fresh Vite/Next production builds, protected two-host parity, source/distributable/asset graph baselines, WASM surface, every protected hash, the full inherited-red regression suite, or final provenance/SBOM/license/write-set checks.

VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

The verdict applies only to the scoped round-2 post-fix integration matrix above.

## Inputs read completely

The verifier read both review reports and every currently present fix evidence artifact:

- evidence/review-round1.md
- evidence/review-round2.md
- evidence/fix-library-concurrency-round1.md
- evidence/fix-migration-round1.md
- evidence/fix-residual-round1.md
- evidence/fix-cascade-round1.md
- evidence/fix-integration-round1.md
- evidence/fix-cascade-round2.md
- evidence/fix-migration-round2.md
- evidence/fix-preset-round2.md

## Round-2 seven-gap result

| # | Review gap | Independent merged-tree result |
| --- | --- | --- |
| 1 | Opaque literal cascade round-trip and forged cross-project refusal | PASS. Chromium reported opaqueCascadeLiteralRoundTrips=true, opaqueCascadeLiteralCannotDeleteOtherProject=true, and forgedMaintenanceCannotCrossDelete=true. The provider-owned literal survived reopen, could not trigger cleanup, and a directly seeded maintenance row could not delete another project's targets. |
| 2 | Same/cross-wrapper migration ordering against save/remove/projects-clear/all-clear in both directions | PASS. lifecycleRaceCount=16 and lifecycleRaceFailures=0. sameWrapperLifecycleOrdered, crossWrapperLifecycleOrdered, earlierMigrationOrdersLaterMutations, and earlierMutationsOrderLaterMigration were all true. |
| 3 | Same stable store retries transient initialization and emits a safe diagnostic | PASS. initializationRetriesSameInstance=true and initializationDiagnosticMechanismNeutral=true. |
| 4 | First cleanup-intent write failure remains retryable after reload | PASS. cleanupIntentRecoversAcrossReload=true; retained recovery/stage state converged after runtime reset. |
| 5 | Destination put/readback failure recovery and later save/delete precedence | PASS. committedReadbackRecoversAcrossReload=true. The 16 bidirectional lifecycle races separately exercised later save/remove precedence so newer saves survived and removals/clears were not resurrected. |
| 6 | Second namespace-delete rollback and clear(all) library-failure convergence | PASS. namespaceClearIsAtomic=true, allClearCommitIsRecoverable=true, and allClearRetriesAcrossReload=true. |
| 7 | Preset stale load cannot overwrite later save/remove | PASS. The two named deterministic tests passed inside the 14-test isolated async-store suite; a later explicit reload matched durable state in both cases. |

Round-2 control axes: 7/7 passed. Migration lifecycle races: 16/16 passed. Cascade round-2 public result fields: 6/6 true.

## Complete real-browser matrix

Command:

    bunx playwright test --config playwright.c5-storage.config.ts tests/c5-storage/browser-store.pw.ts tests/c5-storage/migration-round1.pw.ts

Result: exit 0; 2 passed, 0 failed in 10.6 seconds.

- Browser: Chromium 151.0.7922.34; CDP 1.3.
- Shared BrowserProjectStore conformance: 19 passed, 0 failed, 0 skipped.
- Migration round 1: 16/16 result fields true; the dedicated migration-R1 reopen spec also passed.
- Migration round 2: 8/8 boolean result axes true; 16 races, 0 failures.
- Cascade round 1: 9/9 true.
- Cascade round 2: 6/6 true.
- Typed corrupt project/attachment/library list/load: 6/6 true.
- Active mid-flight abort: 7/7 paths; midFlightReadsAborted=true.
- Browser page/console errors: 0.
- Migration beforeDatabases=[] and afterDatabases=[].
- Cleanup proof contained randomized c5-disposable-, c5-migration-r2-, c5-cascade-, and c5-cascade-r2- identities plus the deliberately protected external-refusal sentinel. Each fixture completed its exact finally cleanup.

## Round-1 ten-risk regression

Every round-1 risk remained green:

1. Nested provider-private migration: direct transformer and Chromium reopen passed.
2. Two-session sounds/presets union and rejected-predecessor recovery: isolated async-store suite passed.
3. Remove/clear mid-cascade recovery and runtime-reset journal retry: cascade-R1 fields passed.
4. Migration next-session/reload cleanup diagnostics: migration-R1 fields passed.
5. Old-schema current envelope migration: oldEnvelopeMigrated=true.
6. Two-wrapper ordinary mutation races: five cascade-R1 serialization fields passed.
7. Typed corrupt list/load: 6/6.
8. Duplicate early-failure/late-success cleanup: isolated project test passed.
9. Disposable external-target refusal: true.
10. Mid-flight abort: 7/7.

## Focused suites

### Deterministic adversarial unit suites

1. OPENCUT_SESSION_ASYNC_STORE_TEST_ISOLATED=1 bun test apps/web/src/editor/session/__tests__/session-async-store-isolation.test.ts
   - Exit 0; 14 passed, 0 failed, 78 expectations.
   - Includes both new preset stale-publication cases and the round-1 two-session union/failure-recovery cases.
   - The sticker cases emitted 13 expected Zustand “storage unavailable” warnings; no assertion failed.
2. bun test apps/web/src/services/storage/__tests__/migration-provider-private.test.ts
   - Exit 0; 1 passed, 0 failed, 6 expectations.
3. OPENCUT_PROJECT_PERSISTENCE_TEST_ISOLATED=1 bun test apps/web/src/core/managers/__tests__/project-persistence-rewire.test.ts
   - Exit 0; 4 passed, 0 failed, 19 expectations.

Aggregate deterministic adversarial units: 19 passed, 0 failed, 103 expectations.

### Core six-file focused subset

The port conformance, opaque round-trip, storage RED-control, production Host composition, session lifecycle, and session-state isolation command exited 0 with 33 passed, 0 failed, and 179 expectations across 6 files.

### Broad C5 focused aggregate

The verifier ran 16 files covering port conformance, opaque coordinator round-trip, v1 migration and provider-private migration, storage RED controls, async/lifecycle/state session suites, production Host composition, project/media/save/thumbnail manager rewires, media persistence/capacity, and storage-provider operations.

Result: exit 0; 65 passed, 0 failed, 241 expectations across 16 files.

The in-memory reference retained 18 store passes, 0 failures, and its one declared no-migration skip. The no-rasterizer profile retained only its documented capability-control skips; no browser-required case was weakened.

## Architecture boundary gates

### Positive gates

- Port boundary: exit 0; 30 contract modules; all rules passed.
- Storage boundary: exit 0; 720 source modules; 0 direct storageService imports/exports, 0 BrowserHostAdapter references, 0 unexpected browser-mechanism hits, 0 unclassified persistence-localStorage files, one ProjectStore role, and no production in-memory fallback.
- Host composition: exit 0; 2 Host roots / 717 production modules; all rules passed.
- Session-state boundary: exit 0; 10/10 factories, 10/10 registry keys, and 52 classified imperative modules.

### Negative/non-vacuity gates

- Port negative control: exit 0; 22/22 named catch/non-catch probes matched expectation.
- Host negative control: exit 0; 12/12 rule probes were caught.
- Session-state negative control: exit 0; 36/36 named probes matched expectation.
- Storage negative fixtures: exit 0; 19 passed, 0 failed, 37 expectations.

## Exact-three type ceiling

Canonical command: node script/check-type-baseline.mjs

Result: exit 0 under TypeScript 5.9.3; 3 current diagnostics versus 13 at pin cf5e79e9, and no diagnostic outside the pinned set.

The direct apps/web compiler returned exit 2 with diagnostic_count=3 and expected_identity_matches=3:

1. next.config.ts(78,49) TS2345 — duplicate NextConfig identity.
2. src/timeline/__tests__/update-pipeline.test.ts(69,40) TS2769 — number is not MediaTime.
3. src/timeline/placement/__tests__/resolve.test.ts(646,5) TS2769 — adjustedStartTime number is not MediaTime.

No fourth or changed diagnostic identity appeared.

## Diff, strict validation, and hygiene

- git -c core.whitespace=cr-at-eol diff --check: exit 0. Git emitted LF-to-CRLF working-copy warnings only; no whitespace error.
- rasen validate s02-storage-port --project rocut --strict --json: exit 0; valid=true, 1 passed, 0 failed, 0 issues.
- Ports 4175, 43551, and 43552 had no listener before verification and no listener after Playwright exited.
- Playwright generated exactly one 45-byte tests/.pw-output-c5-storage/.last-run.json. It was inspected and deleted. Worktree status returned from the transient 85 entries to the 84-entry merged-tree baseline.
- Browser database inventory was empty before and after the disposable matrix.
- tasks.md SHA-256 remained 48173DD339B195768F05FC9A6EEBF64D172E7D3120818E6743DE8F7467212674.
- All 12 section 11 tasks remained unchecked.
- Product files and tasks were not edited by this verifier.

## Scoped assessment

None of the seven round-2 gaps or ten round-1 risks reproduced in its assigned control, and the combined fixes retained all positive and negative boundary invariants. The round-2 post-fix integration scope is clean. This report does not authorize landing and cannot replace section 11 final verification.

TEST EVIDENCE
- scope: round-2 seven-gap controls, round-1 ten-risk regression, complete Chromium C5 matrix, broad focused C5 suites, positive/negative boundaries, exact-three type ceiling, diff check, strict validation, database/port/runner cleanup
- rationale: directly exercises every reported round-2 recovery/ordering window plus all prior repair axes on the combined uncommitted tree
- command: exact commands and environment selectors are recorded above
- result: pass
- tree: 286272307b05d23826ffa7223a76695365194dba (HEAD tree anchor; verified implementation is the uncommitted 84-entry merged worktree above it)
