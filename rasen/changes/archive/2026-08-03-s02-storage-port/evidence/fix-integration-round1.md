# C5 post-fix integration verification — round 1

Date: 2026-08-02 (Asia/Shanghai)  
Mode: report-only integration verification; no product or task edits  
Product worktree: E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5  
HEAD: 0ef35459f685d5d41a25d0ef959aff691b7519cd  
HEAD tree anchor: 286272307b05d23826ffa7223a76695365194dba  
Scope: the ten round-1 adversarial controls, their focused suites, port/storage/Host/session positive and negative gates, the exact-three type ceiling, diff check, strict Rasen validation, disposable database cleanup, and verifier ports.

This is not section 11 final verification. Fresh production builds, two-host parity, protected hashes, WASM surface, the whole regression suite, provenance/SBOM/license checks, and the final write-set review remain outside this pass.

VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

The verdict applies only to the post-fix integration scope stated above.

## Inputs read

The verifier read the complete round-1 review and all four fix-cluster evidence artifacts before running commands:

- evidence/review-round1.md
- evidence/fix-library-concurrency-round1.md
- evidence/fix-migration-round1.md
- evidence/fix-residual-round1.md
- evidence/fix-cascade-round1.md

## Ten adversarial controls

| # | Risk/control | Independent merged-tree result |
| --- | --- | --- |
| 1 | Nested migration opaque reopen | PASS. The direct transformer test retained project, metadata, scene, track, and clip sentinels: 1 pass, 0 fail, 6 expectations. Real Chromium additionally reported legacyPrivateFieldsReopened=true after reopen, including attachment metadata/bytes checks in the fixture. |
| 2 | Two-session sounds/presets union and failure recovery | PASS. The isolated session suite reported 12 pass, 0 fail, 69 expectations. Both concurrent unions, rejected-predecessor recovery, namespace independence, reload, and distinct live StoreApi ownership passed. |
| 3 | Remove/clear failure mid-cascade plus journal reload | PASS. Real Chromium reported removeCommitRecoverable=true, clearCommitRecoverable=true, and retryAcrossRuntimeReset=true. |
| 4 | Migration cleanup on next session/reload with diagnostics | PASS. cleanupJournalRetriedByNextSession, cleanupJournalRetriedAfterReload, cleanupWarningWasMechanismNeutral, postCommitCleanupDiagnosed, and postCommitCleanupRetried were all true. |
| 5 | Old-schema current envelope | PASS. oldEnvelopeMigrated=true after migration and reopen. |
| 6 | Two-wrapper races | PASS. Same-key save, replace/remove, project removal, projects clear, and all clear serialization were all true (5/5). |
| 7 | Typed corrupt list/load | PASS. Project, attachment, and library list/load paths were all true (6/6). |
| 8 | Duplicate early-failure/late-success cleanup | PASS. The isolated project suite reported 4 pass, 0 fail, 19 expectations; the named late-success test left no duplicate. |
| 9 | Disposable-prefix refusal | PASS. disposableExternalTargetRefused=true; the external sentinel remained outside the disposable identity and the source row remained recoverable. |
| 10 | Mid-flight abort | PASS. Seven dispatched read paths rejected as aborted and midFlightReadsAborted=true (7/7). |

## Focused test evidence

### Deterministic non-browser controls

1. Command: bun test apps/web/src/services/storage/__tests__/migration-provider-private.test.ts
   - Exit 0; 1 pass, 0 fail, 6 expectations.
2. Command: OPENCUT_SESSION_ASYNC_STORE_TEST_ISOLATED=1 bun test apps/web/src/editor/session/__tests__/session-async-store-isolation.test.ts
   - Exit 0; 12 pass, 0 fail, 69 expectations.
   - Zustand emitted 13 expected “storage unavailable” warnings while exercising the sticker request-generation cases; no assertion failed.
3. Command: OPENCUT_PROJECT_PERSISTENCE_TEST_ISOLATED=1 bun test apps/web/src/core/managers/__tests__/project-persistence-rewire.test.ts
   - Exit 0; 4 pass, 0 fail, 19 expectations.

Aggregate: 17 pass, 0 fail, 94 expectations.

### Corresponding focused suites

Command:

    bun test apps/web/src/editor/ports/__tests__/conformance.test.ts apps/web/src/editor/persistence/__tests__/opaque-roundtrip.test.ts apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts apps/web/src/editor/host/__tests__/production-composition.test.ts apps/web/src/editor/session/__tests__/session-lifecycle.test.ts apps/web/src/editor/session/__tests__/session-state-isolation.test.ts

Result: exit 0; 33 pass, 0 fail, 179 expectations across 6 files.

The in-memory conformance report retained 18 store passes, 0 failures, and its one declared no-migration skip. The no-rasterizer profile retained its documented capability-control skips; none was counted as a complete-browser pass.

## Real-browser evidence

Command:

    bunx playwright test --config playwright.c5-storage.config.ts tests/c5-storage/migration-round1.pw.ts tests/c5-storage/browser-store.pw.ts

Result: exit 0; 2 pass, 0 fail in 7.9 seconds.

- Browser: Chromium 151.0.7922.34; CDP 1.3.
- Shared store conformance: 19 passed, 0 failed, 0 skipped.
- Migration result fields: 16/16 true.
- Cascade result fields: 9/9 true.
- Corrupt list/load paths: 6/6 true.
- Mid-flight abort paths: 7/7.
- Browser page errors and console errors: 0.
- beforeDatabases=[] and afterDatabases=[].
- The migration and cascade cleanupProof arrays named only randomized c5-disposable-/c5-cascade- identities plus the deliberate external refusal sentinel.

Port 4175 had no listener before the run and no listener after Playwright stopped its Vite server. Ports 43551 and 43552 also remained unused. The generated tests/.pw-output-c5-storage/.last-run.json was inspected as the only runner artifact and then removed; worktree status returned from 83 entries to the 82-entry merged-tree baseline.

## Boundary gates

### Positive

- Port boundary: exit 0; 30 contract modules; every rule passed.
- Storage boundary: exit 0; 718 production/fixture source modules; 0 direct storageService imports/exports, 0 BrowserHostAdapter references, 0 unexpected mechanism hits, 0 unclassified persistence-localStorage files, one ProjectStore role, and no production in-memory fallback.
- Host composition: exit 0; 2 Host roots / 715 production modules; all composition rules passed.
- Session-state boundary: exit 0; 10/10 factories, 10/10 registry keys, and 52 classified imperative modules.

### Negative/non-vacuity

- Port negative control: exit 0; 22/22 named catch/non-catch probes matched expectation.
- Host negative control: exit 0; 12/12 rule probes were caught.
- Session-state negative control: exit 0; 36/36 named probes matched expectation.
- Storage negative fixtures: exit 0; 19 pass, 0 fail, 37 expectations.

## Type ceiling

Canonical command: node script/check-type-baseline.mjs

Result: exit 0 under TypeScript 5.9.3; 3 current diagnostics, 13 at pin cf5e79e9, and no diagnostic outside the pinned set.

Direct apps/web compiler output was non-zero with exactly these three identities:

1. next.config.ts(78,49) TS2345 — duplicate NextConfig identity.
2. src/timeline/__tests__/update-pipeline.test.ts(69,40) TS2769 — number is not MediaTime.
3. src/timeline/placement/__tests__/resolve.test.ts(646,5) TS2769 — adjustedStartTime number is not MediaTime.

The first verifier wrapper incorrectly required the direct compiler exit code to equal 1. TypeScript returned 2 while diagnostic_count=3 and expected_identity_matches=3, so that wrapper itself exited 1. A corrected wrapper accepted any non-zero compiler exit and re-established exit_code=2, diagnostic_count=3, expected_identity_matches=3. This was a verifier assertion error, not a fourth type diagnostic or a product failure.

## Diff and planning validation

- git -c core.whitespace=cr-at-eol diff --check: exit 0. Git emitted only LF-to-CRLF working-copy warnings; no whitespace error was reported.
- rasen validate s02-storage-port --project rocut --strict --json: exit 0; 1 item passed, 0 failed, 0 issues, valid=true.
- Section 11 tasks remained unchecked and tasks.md was not edited by this verifier.
- Product files were not edited by this verifier.

## Scoped assessment

No round-1 finding reproduced in its assigned adversarial control, and the combined fixes preserved the positive/negative architecture gates. This integration pass is clean for the ten repaired risks. It does not authorize landing and cannot replace the final section 11/full-tail verification after review is clean.

TEST EVIDENCE
- scope: focused post-fix integration controls, real-browser BrowserProjectStore/migration matrix, architecture boundaries, exact-three type baseline, diff check, and strict planning validation
- rationale: this scope directly exercises all ten round-1 review gaps on the combined uncommitted tree and checks their principal composition boundaries
- command: the exact commands and environment selectors are recorded in the sections above
- result: pass
- tree: 286272307b05d23826ffa7223a76695365194dba (HEAD tree anchor; verified implementation is the uncommitted 82-entry merged worktree above it)
