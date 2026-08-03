# C5 pre-landing review — round 2

- Branch: `feat/s02-storage-port`
- Explicit base: `0ef35459f685d5d41a25d0ef959aff691b7519cd`
- Review date: 2026-08-02
- Scope: the complete tracked and untracked C5 product diff, the round-1 report, and all four round-1 fix handoffs/evidence sets
- Mode: report-only; no product, task-list, or existing-evidence edits
- Verdict: **CHANGES REQUIRED**
- Tally: **Blocker 2 · Major 5 · Minor 0 · Test-gap 7**

## Executive result

The round-1 repair work closed most of the original findings. Nested provider-private migration data, same-store cross-session library mutations, ordinary project-cascade commit ordering, same-identity wrapper queues, old envelopes, corrupt-row discrimination, duplicate cleanup, disposable target validation, active read cancellation, and the stale Host documentation all now have credible implementation and test evidence.

The landing set is not safe yet. Two independent real-Chromium probes reproduced data loss:

1. a provider-private project field is interpreted as an internal cascade tombstone, hiding a successfully saved project and allowing maintenance to delete another project's attachments; and
2. migration bypasses the browser mutation queue, so it overwrites a concurrent successful save with its older staged snapshot.

Five additional recovery/ordering windows remain. Existing browser and unit suites pass because none exercises these windows.

## Blockers

### B1 — Cascade maintenance records collide with opaque project data and can delete another project's attachments

**Spec axes:** opaque provider-private round-trip; project isolation; exact destructive target ownership.  
**Standards axis:** silent project loss and cross-project attachment deletion.

`createStoredProject` spreads every top-level field from opaque `record.data` into the physical project row (`apps/web/src/services/storage/browser-project-store-records.ts:76-87`). Cascade maintenance then reserves the unexported top-level key `__opencutProjectCascade` (`browser-project-store-cascade.ts:8`) and classifies any valid-looking value under that key as a maintenance record (`:70-116`) even when the same row also contains a valid `__opencutProjectStore` project envelope.

That classification has three destructive consequences:

- project list/load skip or return absence for the row (`browser-project-store.ts:263-265`, `:305-308`);
- initialization/session maintenance scans the row as cleanup (`browser-project-store-cascade-manager.ts:51-61`); and
- ownership validation accepts any database/directory under the configured prefix (`:272-280`), rather than requiring a project tombstone's targets to equal the media database/directory derived from `record.id`.

A report-only Chromium probe used the public `BrowserProjectStore` against a randomized disposable identity. The first, empty-target form returned success from `save`, followed by:

```text
loadAfterSuccessfulSave: null
listedIds: []
```

A second probe first saved an attachment `[11,22,33]` for project `target`, then saved an unrelated `provider-project` whose opaque private field had the valid tombstone shape and named `target`'s same-prefix media database/directory. Observed result:

```text
beforeAttachmentBytes: [11,22,33]
providerProjectLoadImmediatelyAfterSuccessfulSave: null
targetAttachmentAfterMaintenance: null
```

This is a valid opaque payload according to the public port contract. A provider-private field must not acquire adapter control-plane meaning, and a project-scoped tombstone must not be authorized to delete another project merely because the target shares a prefix.

**Required action:** place cascade journals/tombstones in a dedicated maintenance object store or another namespace that cannot be supplied through opaque project data. Make current project-envelope precedence unambiguous. Validate a project tombstone's targets exactly against `mediaDatabaseName(identity, record.id)` and `mediaDirectoryName(identity, record.id)`; reserve prefix-wide inventories only for store-wide clear journals. Preserve and return a literal provider field named `__opencutProjectCascade` unchanged.

### B2 — Migration is outside the shared mutation queue and overwrites concurrent successful writes

**Spec axes:** durable mutation ordering; migration/cascade interaction; multi-session sharing.  
**Standards axis:** lost-update data loss.

Ordinary browser mutations enter the identity-shared `BrowserMutationQueue`, for example project save at `apps/web/src/services/storage/browser-project-store.ts:338-353` and clear at `:825-852`. `migrate`, however, directly calls `runBrowserProjectMigration` at `:201-234`; the durable-identity `migrationStates` map only coalesces other migration calls. It does not conflict migration with project save/remove/clear or cascade maintenance.

A real-Chromium adversarial probe seeded a v30 row, paused migration at `beforeCommit`, successfully saved a v31 replacement with `concurrentSaveSentinel: { keep: "newer" }`, then released migration. The observed final state was:

```text
migrationStatus: migrated
finalSummaryName: legacy v30
concurrentSaveSentinel: null
legacySentinel: { keep: "legacy" }
```

The normal save resolved successfully and was then silently overwritten by migration's older staged snapshot. The same missing conflict permits a project clear/remove to race migration and have a staged row written back after destructive commit.

The migration cleanup journal and cascade tombstone journal use different object stores and do not overwrite each other's journal records. The unsafe interaction is lifecycle arbitration: cascade/ordinary mutations are queued while migration is not.

**Required action:** run the complete migration transaction lifecycle under the same durable-identity queue with an `all-projects`/equivalent identity, including staging, commit validation, and cleanup-intent persistence. Ensure already-running ordinary mutations are ordered before migration and later mutations cannot enter until the migration's logical commit is settled. Add save/remove/projects-clear races from both the same wrapper and a second wrapper.

## Majors

### M1 — A transient initialization failure permanently poisons the production store instance and emits no diagnostic

The constructor saves one eager initialization promise into `this.ready` (`apps/web/src/services/storage/browser-project-store.ts:139-163`). Although the global `initializationRuns` entry is removed after settlement, the instance never replaces a rejected `this.ready`. `prepareForSession` begins with `await this.ready` (`:170-193`), so it cannot perform the retry it was added to provide. Both production Hosts also discard that rejection (`apps/web/src/editor/host/next-editor-host.ts:48`; `apps/vite-example/src/host/vite-host-config.ts:42`).

A Chromium probe held an IndexedDB connection open long enough to block the projects-store upgrade once, then released it. Results:

```text
first prepareForSession: unavailable
second prepareForSession after release: unavailable
fresh BrowserProjectStore for the same identity: ok
diagnostics from the poisoned store: []
```

Thus a transient startup failure bricks the stable production singleton until page reload, and the fire-and-forget Host path supplies neither retry nor visible warning.

**Required action:** make initialization retryable after rejection, or make `prepareForSession` recreate the initialization run rather than awaiting a permanently rejected instance promise. Attribute top-level maintenance read/open failures through the mechanism-neutral diagnostic callback, and do not silently discard the only failure signal in production composition.

### M2 — Failure to create the migration cleanup journal loses the only retry intent

After committed rows validate, `cleanupCommittedSources` derives cleanup targets only in local memory and then reads/writes the cleanup journal (`apps/web/src/services/storage/browser-project-store-migration.ts:567-591`). The whole journal-creation block is caught at `:596-603` and reported as `retryable: true`.

If the first `writeCleanupJournal` fails—for example quota, unavailability, or a blocked object-store upgrade—no durable intent exists. On reload the migrated rows are no longer candidates, `retryPendingCleanup` can only read an existing journal (`:612-650`), and the legacy/stage databases are left permanently. The current probe injects `beforeCleanup` only after the journal already exists; it does not exercise journal creation failure.

**Required action:** durably record cleanup intent before considering the logical migration fully finalized, preferably in a transaction coupled to the project commit where possible. If intent persistence fails, retain a reconstructible source/stage record and retry it. Do not label a warning retryable when a later run has no state from which to retry.

### M3 — Committed-readback validation failure reports migration failure after overwriting the source, then cannot retry

Migration writes attachment metadata and the current project row at `apps/web/src/services/storage/browser-project-store-migration.ts:470-501`, and only then reads the committed result back at `:503-565`. Any readback failure reaches the outer catch, which deletes stage databases and returns `failed` (`:273-301`). The original project row has already been overwritten, and the next run excludes the now-current row from its candidate set.

A Chromium fault probe made only the first post-commit project readback miss. Observed result:

```text
firstStatus: failed
outerLegacyVersionAfterFailure: 31
decodedSchemaAfterFailure: 31
secondStatus: not-needed
```

The result contradicts its own reason (`failed before a validated commit`): a write committed, the source was not preserved, stage evidence was removed, and retry became a no-op.

**Required action:** keep a durable copy of the original row/staged value until committed readback succeeds. On post-write validation failure, retain retry/restore state and report the actual commit phase. Add fault injection after the destination put and before/during committed readback, followed by reload and retry.

### M4 — Library namespace/all clear can partially commit and then reject

Namespace clear lists records and deletes each in a separate IndexedDB transaction (`apps/web/src/services/storage/browser-project-store.ts:1064-1081`). A failure on the second or later delete leaves a partially cleared namespace while the public operation rejects. Store-wide clear first commits project tombstones/cascade clear and only afterwards clears the separate library database (`:839-850`); a library failure therefore reports whole-operation failure after projects are already hidden and physical cleanup may have begun.

The conformance control injects failures only at the single pre-commit hook, so neither partial window is covered.

**Required action:** clear one library namespace atomically in one read-write transaction/range cursor, including the legacy `user-sounds` row. For `all`, define and implement a durable cross-database commit/retry protocol so that once the first destructive component commits the operation completes or has durable retry state rather than returning an ambiguous partial failure.

### M5 — A slow custom-preset load overwrites newer live state after a successful save

`createCustomPresetsStore.load` publishes its fetched array without a request generation or mutation barrier (`apps/web/src/timeline/components/graph-editor/custom-presets-store.ts:101-114`). Save/remove serialize only with each other (`:57-62`, `:117-155`). The graph UI leaves Save enabled based on editor editability, not `isLoading` (`apps/web/src/timeline/components/graph-editor/popover.tsx:205-216`).

A direct report-only repro delayed the initial load, completed `savePreset`, and then released the older load:

```text
durableCount: 1
visibleAfterSave: 1
visibleAfterOlderLoadCompletes: 0
hasLoaded: true
```

The durable record survives, but the active session hides a successful user action until another reload. Saved sounds already invalidates its load generation on mutation (`apps/web/src/sounds/sounds-store.ts:302-304`, `:330-332`, `:370-372`); presets needs the equivalent behavior.

**Required action:** invalidate or sequence an in-flight preset load whenever save/remove begins, and publish a load only if its generation is still current. Add a deterministic load-before-save/load-finishes-last test.

## Round-1 disposition

| Round-1 item | Round-2 disposition |
| --- | --- |
| B1 nested migration private fields | **Closed.** Transformer spreads plus direct migration-private test and real-browser reopen evidence cover project, metadata, scene, track, clip, and attachment metadata. |
| B2 cross-session sounds/presets lost update | **Closed for the specified shared store object.** Shared WeakMap arbitration and two complete-session tests preserve both updates; failure settlement does not poison the next mutation. M5 is a distinct load-publication race. |
| B3 attachment-first project removal/clear | **Closed for adapter-created journals.** Tombstone/journal commit precedes physical cleanup and retry tests pass. B1 is a new control-plane/data namespace collision in that implementation. |
| M1 cleanup retry/production diagnostics | **Partially closed.** Durable journal, next-session/reload retry, and production diagnostic wiring exist; M1 and M2 above leave startup and first-journal-write failures non-retryable. |
| M2 old current envelopes excluded | **Closed.** Candidate selection now uses decoded schema version; Chromium old-envelope probe passes. |
| M3 queues local to wrapper | **Closed for ordinary mutations.** Same durable identity resolves to one weakly held queue and all five two-wrapper races pass. B2 above is migration's omission from that queue. |
| M4 corrupt rows hidden/reinterpreted | **Closed.** Current-envelope presence is authoritative and six browser list/load corruption probes pass. |
| M5 duplicate cleanup race | **Closed.** Creation waits for all settlements before cleanup; focused regression passes. |
| M6 disposable physical target scope | **Closed.** Exact disposable project/target checks and the external-target refusal probe pass. |
| m1 mid-flight reads ignore abort | **Closed.** Seven active-read abort probes pass in Chromium. |
| m2 stale Host comment | **Closed.** Header now matches the wired topology. |
| m3 generated verifier output | **Closed.** The submitted patch contained no verifier output. This review's Playwright run regenerated the 45-byte `.last-run.json`; the reviewer removed that known test side effect after verification, restoring the pre-run worktree state. |

Round-1 test gaps 1, 2, 3, 5, 6, 7, 8, 9, and 10 are closed by the added focused/browser cases. Gap 4 is **partially closed**: cleanup failure after a successfully persisted journal is covered through next session and reload, but first journal-write failure and poisoned initialization are not.

## Special-check results

- **Migration journal vs cascade journal:** physical journal storage is separate: migration uses `${projectsStore}-migration-maintenance`; cascade records live in the projects object store. Project clear does not erase the migration maintenance store. No direct journal-key overwrite was found. Lifecycle serialization is still unsafe because migration bypasses the shared queue (B2).
- **WeakRef browser queue lifecycle:** the queue is strongly held by each live store; the `FinalizationRegistry` callback checks the current weak reference before deletion, so an old finalizer does not delete a newer queue for the same key. Same-identity wrapper probes pass. No finding.
- **Library weak arbitration settlement/reentrancy:** rejected predecessors are converted to settled blockers, entry deletion checks promise identity, and the weak entry is removed when empty. Current sound/preset mutators are synchronous and do not re-enter the same key. Recursive same-key mutation from inside the async callback would be non-reentrant, but no production caller does so and it is not counted as a current defect.
- **Corrupt vs legacy discrimination:** project, attachment, and library current-envelope presence is authoritative; only explicitly recognized raw legacy shapes fall back. Six Chromium corruption probes pass. No finding.
- **Diagnostic payload safety:** browser maintenance records emit fixed phase/operation/scope/code/retryable metadata; consumer failure records omit stored payloads and raw provider errors. Existing secret-sentinel tests and the Chromium cascade diagnostic probe pass. M1 is missing delivery, not payload leakage.

## New test gaps

1. Opaque project data containing a literal valid-shaped `__opencutProjectCascade` value must round-trip and must not trigger cleanup; a forged project tombstone may not name another project's targets.
2. Migration must serialize with same-/cross-wrapper save, remove, projects clear, and all clear; successful later writes must survive and committed clears must not resurrect rows.
3. A transient initialization/open/upgrade failure must emit a mechanism-neutral diagnostic and recover on the same stable production store during the next session attempt.
4. Failure of the first migration cleanup-journal write must leave durable retry state and clean successfully after session/reload retry.
5. A failure after destination put but before/during committed readback must retain original/stage recovery state and retry after reopen.
6. Failure on the second namespace delete, and library failure after project commit during `clear(all)`, must not produce an unjournaled partial result.
7. Custom preset load starts first, save/remove commits second, and the older load resolves last; live state must retain the newer committed result.

## Commands and observed evidence

- Focused persistence/session/consumer suite: **45 passed, 0 failed, 201 assertions** across 13 files.
- Real Chromium (`playwright.c5-storage.config.ts`): **3 passed**. Shared store matrix: 19 passed / 0 failed / 0 skipped; migration 16/16; cascade 9/9; corrupt 6/6; active abort 7/7. Browser: Chromium 151.0.7922.34.
- Full `bun test`: **291 passed, 8 failed, 2 loader/module errors, 788 assertions**. The eight/two red identities match the frozen inherited baseline (`ZERO_MEDIA_TIME`, WASM loader, and `DEFAULTS` initialization); no new full-suite red appeared.
- `node script/check-storage-boundary.mjs`: PASS, 718 source modules, zero unexpected mechanism hits, no fallback/private port.
- `node script/check-port-boundary.mjs`: PASS, 30 contract modules.
- `node script/check-session-state-boundary.mjs`: PASS, 10/10 factories and registry keys.
- `node script/check-host-composition.mjs`: PASS, two Host roots and 715 production modules.
- `bun test script/__tests__`: **19 passed, 0 failed, 37 assertions**.
- `bunx tsc --noEmit -p apps/vite-example/tsconfig.json`: PASS.
- `node script/check-type-baseline.mjs`: PASS, 3 diagnostics now vs 13 at the pin, none outside the baseline set.
- `git -c core.whitespace=cr-at-eol diff --check`: PASS apart from line-ending conversion warnings.
- Reviewer product/task/existing-evidence edits: **0**. The generated Playwright status file created by this review was removed after the run. Commit created: **no**.
