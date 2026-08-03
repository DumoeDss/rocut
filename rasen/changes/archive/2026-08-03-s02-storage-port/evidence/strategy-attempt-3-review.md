# C5 review-cycle strategy attempt 3 - independent implementation review

Date: 2026-08-02  
Branch/worktree: `feat/s02-storage-port` / `rocut-wt-c5`  
Explicit base and current HEAD: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
Mode: dispatched report-only; no subagents, product edits, task edits, prior-evidence edits, or commit  
Verdict: **STRATEGY ATTEMPT 3 NOT CONFIRMED - STRATEGY BUDGET EXHAUSTED**  
Tally: **Blocker 0 / Major 1 / Minor 0 / Test-gap 1**

## Executive result

Strategy attempt 3 fixes attempt-2 B1 for ordinary distinct storage identities.
Real Chromium confirms that an interrupted all-clear journals and later clears
the exact historical library database/store even when the reopening wrapper's
media database prefix, media store, media directory prefix, library database,
and library store all differ. The new configuration's library survives. All
seven attempt-3 acceptance groups, both attempt-2 M1 controls, the attempt-2 M2
matrix, and the earlier cascade/migration matrices remain green.

The strategy is nevertheless not clean. `BrowserStorageIdentity` accepts a
library target that aliases the new durable library-authorization object store.
An all-clear then physically clears its own authorization descriptor. A fault
after that clear but before journal deletion leaves a v3 journal that can never
pass retry preflight. Initialization and same-ID saves remain unavailable on
every reload. This was independently reproduced in Chromium. Because this is
attempt 3 of 3, the open Major exhausts the default strategy budget.

## Major

### M1 - An accepted library binding can erase the authorization required to retry its own v3 journal

**Canonical severity:** Major.  
**Axes:** durable authorization, configuration validation, crash recovery,
same-ID availability.

The binding store is deterministically named
`<projectsStore>-library-clear-bindings`
(`browser-project-store-library-clear-bindings.ts:42-44`). Neither general
identity validation (`browser-project-store-internals.ts:108-116`) nor library
binding validation (`browser-project-store-library-clear-bindings.ts:58-71`)
requires the library target to be disjoint from that internal store. Therefore
this accepted identity is possible:

```text
libraryDatabase = projectsDatabase
libraryStore = projectsStore + "-library-clear-bindings"
```

The initial v3 preflight succeeds while its descriptor exists. Cleanup then
passes the journaled target directly to `idbClear`
(`browser-project-store-cascade-manager.ts:372-381`), which clears both the
library data and the descriptor in the aliased object store. The injected
post-library/pre-journal-delete fault occurs at `:382`; journal deletion would
only happen later at `:395-403`. On reload, authorization rereads the now-empty
binding store (`browser-project-store-library-clear-bindings.ts:164-176`) and
fails `unavailable` before cleanup can complete.

Independent real-Chromium reproduction:

1. Construct a disposable identity with the alias above; seed a project,
   attachment, and library value.
2. Inject `failAfterAllClearLibraryCommit("unavailable")` and run `clear(all)`.
3. Reset runtime state and reopen the same identity, then attempt a same-ID
   project save.

Observed:

```text
after first cleanup: library row = null, binding descriptors = 0,
                     pending maintenance remains
after reload:        binding descriptors = 0, pending maintenance remains
same-ID save:        ProjectStoreError unavailable
                     "Project storage cleanup is pending retry"
diagnostics:         repeated project-cascade-postcommit-cleanup,
                     code unavailable, retryable true
```

The retry is not transient: the only descriptor capable of authorizing the
exact target has already been destroyed. The logical clear cannot converge and
same-ID reuse stays blocked. The same invariant should be audited for the media
ownership/certificate store as well, because v3 retries preflight media
authorization before library cleanup.

**Required resolution after strategy exhaustion:** before logical commit,
reject a library target that aliases any durable authorization store needed by
the pending journal, or redesign/fence authorization so clearing an authorized
target cannot erase retry authority. Add a Chromium post-library/pre-journal-
delete crash regression for the alias configuration. It must prove either an
atomic precommit refusal with project/library state unchanged or successful
reload convergence with same-ID saves unblocked.

## Test gap

1. The seven attempt-3 browser groups cover target/descriptor tampering,
   cardinality, changed configuration, legacy records, and the post-library
   crash window, but none combines that crash window with a library target that
   aliases the descriptor or media-authorization store. The missing
   configuration-invariant test allowed M1.

## Attempt-3 acceptance matrix

| Axis | Independent result | Evidence |
| --- | --- | --- |
| Interrupted all-clear under a wholly different current identity | **PASS** | Built-in v3 group is true. A separate Chromium counterexample used different old/new media bindings and different library databases/stores: the old library and media namespaces were removed and the new library sentinel was byte-for-byte unchanged. |
| Projects journal has no library side effect | **PASS** | `projectsJournalNeverTouchesLibraryAcrossConfigurationReload: true`; old and new library sentinels survived. |
| Tampered descriptor/target cannot start physical I/O | **PASS** | `tamperedLibraryBindingCannotCrossDelete: true`; both library sentinels and the not-yet-cleaned media sentinel survived, the journal remained, and the diagnostic was nonretryable/corrupt. Strict target and descriptor equality was also verified statically. |
| Legacy v2 boolean fails closed | **PASS** | `legacyVersion2LibraryBooleanFailsClosed: true`; media and both libraries survived and the journal remained with the binding-required diagnostic. |
| Optional trusted v2 upgrade converges exactly | **PASS** | `legacyVersion2LibraryBindingUpgradeConverges: true`; only the explicitly supplied historical library binding was cleared and the upgraded journal converged. |
| Post-library/pre-journal-delete crash is idempotent | **PASS for disjoint stores** | `postLibraryPreJournalCrashRetriesExactTarget: true`; the old library stayed absent, the new library survived, and the journal disappeared on reload. M1 is the uncovered accepted-alias variant. |
| v3 codec/cardinality negatives | **PASS** | `version3CodecCardinalityTamperRejects: true`; projects+library, all+zero-library, duplicate-library, and extra-envelope-key records were retained as corrupt state without touching either library. |

## Complete-diff special checks

- **Three-store logical commit:** PASS for disjoint stores. Project rows,
  maintenance replacements, and the exact descriptor are written in one
  transaction; the descriptor is reread and conflict-checked before mutation.
- **Descriptor authorization/forgery:** PASS except M1. Exact outer/envelope/
  binding/target keys, canonical SHA-256 recomputation, digest-derived row key,
  control-plane equality, and exact target equality prevent record forgery or
  target substitution. They do not enforce physical-store disjointness.
- **v3 retry order:** PASS except M1. All media and library authorization is
  preflighted before the first physical operation; media databases/directories
  precede the exact library clear; the journal is deleted last.
- **Same control plane with different media/library configuration:** PASS. Retry
  resolves journaled historical targets and does not consult the reopening
  wrapper's current library fields.
- **Legacy v1/v2 handling:** PASS. v1/v2 `clearLibrary:true` without trusted
  history fails closed; v1 is never promoted; v2 promotion requires the
  internal previous binding and CAS-replaces the same journal with its
  descriptor atomically; `clearLibrary:false` stays media-only.
- **Cleanup partial preflight:** PASS. The implementation validates every media
  certificate and every library descriptor before deletion; the browser
  tamper probe confirms zero partial physical cleanup.
- **Attempt-2 regressions:** PASS. M1 is 2/2; M2's six reported groups are 6/6;
  strategy-1 M1 is 6/6; cascade round 1 is 9/9; corrupt-row and active-abort
  groups are 6/6 and 7/7 respectively.

## Verification evidence

- Complete real-Chromium C5 configuration: **3 passed / 0 failed**, Chromium
  `151.0.7922.34`; browser store 19/19, migration lifecycle 16/16, all seven
  attempt-3 fields true, all inherited matrices green, and empty before/after
  disposable-database inventories.
- Independent distinct-database/distinct-store old/new library retry:
  **PASS 1/1**; only the historical target was removed.
- Independent authorization-store alias crash reproduction: **FAIL 1/1** as M1;
  its disposable identity was cleaned.
- Focused unit/negative suite: **48 passed / 0 failed / 216 expectations**.
- Vite TypeScript: PASS, zero diagnostics. Pinned repository baseline: PASS,
  three inherited diagnostics and none outside the pin.
- Port boundary: PASS, 30 modules. Session-state boundary: PASS, 10/10 factories
  and registry keys. Storage boundary: PASS, 722 modules. Host composition:
  PASS, two roots / 719 production modules.
- Attempt-3 product ESLint: PASS, 0 errors / 0 warnings. A broader invocation
  additionally named two Vite files outside the configured ESLint scope and
  emitted only the expected two ignored-file warnings.
- Focused Prettier and
  `git -c core.whitespace=cr-at-eol diff --check`: PASS.
- `rasen validate s02-storage-port --project rocut --strict --json
  --no-interactive`: PASS, 1/1 valid, zero issues.

## Hygiene

- Reviewer-started Chromium/Vite processes are stopped; port 4175 is free.
- Playwright's generated `.last-run.json` is absent.
- Product, tasks, and prior evidence/handoffs edited by reviewer: **0**.
- New files written by reviewer: this report and
  `handoff/strategy-attempt-3-reviewer.md` only.
- Commit created: **no**.
