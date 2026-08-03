# S02 C5 strategy attempt 4 planner handoff (continuation 2)

## Why this handoff exists

The `rasen-auto` planner handoff trigger fired because this session underwent context compaction while auditing the current C5 cascade probe implementation. The assigned contract requires an immediate handoff rather than continuing design work after compaction.

This document preserves the completed reads, verified storage-topology facts, emerging design comparison, and the exact remaining work. It is not a final design verdict.

## Role and scope constraints

- Role: C5 strategy attempt 4 planner.
- Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5`.
- Change root: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/rasen/changes/s02-storage-port`.
- Design and acceptance planning only.
- Do not edit product code, `tasks.md`, or run state.
- Do not commit.
- Do not act as the final verifier.
- Do not spawn, delegate to, or wait for subagents.
- Compare at least two substantively different designs and choose the smallest safe design.
- The forced axis is physical topology, including whole-database media deletion collisions, not only the previously identified library-binding alias.

## Completed instruction and artifact reads

The following were read completely:

- Product root `AGENTS.md`.
- `apps/web/src/services/storage/migrations/AGENTS.md`.
  - Migrations are additive only.
  - Do not delete, rename, or replace persisted data in a migration; cleanup is separate.
- `handoff/strategy-attempt-4-planner.md`.
- `rasen-codebase-design/SKILL.md`.
- `rasen-codebase-design/DEEPENING.md`.
- `rasen-codebase-design/DESIGN-IT-TWICE.md`.
- `proposal.md`.
- `design.md`.
- `tasks.md`.
- `specs/browser-persistence-boundary/spec.md`.
- `specs/host-port-contract/spec.md`.
- `evidence/strategy-attempt-3-review.md`.
- `evidence/strategy-attempt-3-design.md`.
- `handoff/escalation.md`.

The following implementation and harness files were read completely:

- `apps/web/src/services/storage/browser-project-store-internals.ts`.
- `apps/web/src/services/storage/browser-project-store-library-clear-bindings.ts`.
- `apps/web/src/services/storage/browser-project-store-control.ts`.
- `apps/web/src/services/storage/browser-project-store-cascade.ts`.
- `apps/web/src/services/storage/browser-project-store-cascade-manager.ts`.
- `apps/web/src/services/storage/browser-project-store-media-ownership.ts`.
- `apps/web/src/services/storage/browser-project-store.ts` (all 1404 lines).
- `apps/web/src/services/storage/browser-project-store-migration.ts` (all 1490 lines).
- Relevant `browser-storage-mechanisms.ts` implementations: `openDatabaseStores`, `idbClear`, project/cascade transactions, `idbDeleteByStringKeyPrefix`, and `deleteDatabaseExact`.
- `apps/vite-example/src/c5-storage-harness.ts`.
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts`.
- `apps/vite-example/playwright.c5-storage.config.ts`.

Partially read:

- `apps/web/src/services/storage/browser-project-store-cascade-round2-probes.ts`.
  - The declarations and function outline were inspected through `rg`.
  - Lines 1-500 were read completely.
  - Lines 501-1986 remain unread in this planner pass; the attempted continuation coincided with compaction.

## Prior attempt findings that remain authoritative

Strategy attempt 3 identified a Major defect: an accepted library target can alias `${projectsStore}-library-clear-bindings`. A `clear(all)` can therefore clear its own authorization. If the process crashes after library clear but before journal deletion, retry permanently loses its authorization and a same-ID save remains blocked.

Attempt 4 must broaden this from one alias to the complete physical storage topology. The existing specs require:

- one deep `BrowserProjectStore` boundary;
- mechanism-neutral errors;
- fail-closed behavior;
- no partial mutation on refusal;
- exact durable isolation.

## Verified physical topology inventory

`BrowserStorageIdentity` contains:

- `projectsDatabase`
- `projectsStore`
- `mediaDatabasePrefix`
- `mediaStore`
- `libraryDatabase`
- `libraryStore`
- `mediaDirectoryPrefix`

Current `validateStorageIdentity` only checks non-empty values and rejects the literal string `"undefined"`; it does not validate collisions.

### Stores and databases

1. Public project pair: `(projectsDatabase, projectsStore)`.
2. Cascade maintenance pair: `(projectsDatabase, `${projectsStore}-cascade-maintenance`)`.
3. Media ownership/certificate pair: `(projectsDatabase, `${projectsStore}-media-ownership`)`.
4. Library-clear authorization pair: `(projectsDatabase, `${projectsStore}-library-clear-bindings`)`.
5. Migration maintenance/recovery/cleanup pair: `(projectsDatabase, `${projectsStore}-migration-maintenance`)`.
   - Known keys include `migration-recovery` and `postcommit-cleanup`.
6. Configured library pair: `(libraryDatabase, libraryStore)`.
7. Migration staging databases:
   - `${projectsDatabase}-c5-projects-stage`, store `staged-projects`.
   - `${projectsDatabase}-c5-attachments-stage`, store `staged-attachments`.
8. Current and historical media bindings derive:
   - database `${mediaDatabasePrefix}${projectId}`;
   - object store `mediaStore`;
   - OPFS directory `${mediaDirectoryPrefix}${projectId}`.
9. Legacy migration databases may include `video-editor-timelines-${projectId}`, name variants, and `video-editor-media-${projectId}`.

## Verified operation granularity and collision behavior

### Library operations are exact-pair/store scoped

- Library list/load/save/remove and namespace/all cleanup act on the exact `(database, store)` pair.
- `idbClear` clears one object store only.
- Therefore using the same database with a distinct, non-reserved store is physically safe and should remain legal.
- The configured library pair is unsafe when it equals the public project pair or any internal control pair.
- Current library authorization validates control-plane identity and target equality, but it does not prove the library target pair is disjoint from public/internal stores.

### Media cleanup is whole-database scoped

- Cascade media cleanup calls `indexedDB.deleteDatabase(target.database)` through `deleteDatabaseExact`.
- It deletes the entire database independently of `mediaStore`.
- A current or historical media database equal to `projectsDatabase` therefore destroys the public project store and every internal control store even when its media store name differs.
- It may likewise destroy `libraryDatabase` or a migration staging database. The final design must explicitly decide which database names are reserved; protecting `projectsDatabase` is mandatory.
- OPFS cleanup removes an exact root directory name and has a different collision domain.

### Commit and retry timing

- `commitProjectRemoval` derives current media targets, then atomically deletes the project and writes a cleanup tombstone before physical cleanup. It currently has no topology validation before the logical commit.
- `commitProjectsClear` plans media, prepares library authorization, commits the project clear/journal, then performs cleanup. Media validation covers fingerprint, descriptor, certificate, and derived equality, but not physical database collision.
- `retryPendingCleanup` validates media ownership and library descriptors before I/O but does not validate collision topology.
- Attachment list/load/save/remove call `registerMediaOwner` and then access the derived media database. Registration validates descriptor integrity, not topology. A dangerous target can therefore receive durable authority before a later clear.
- Initialization calls `cascade.retryPendingCleanup()` before migration recovery/cleanup. A dangerous historical journal can delete the projects database or a migration staging database before recovery executes.
- `clear(all)` commits across the project, cascade-maintenance, and library-binding stores, then clears the configured library target and deletes the journal.
- Runtime mutation serialization is keyed by the projects control plane and covers all/project mutations; it does not replace static topology validation.
- Migration stage names and maintenance names are private derivations in the migration module. A centralized topology module must own or export the canonical names so validation cannot drift from execution.

## Emerging design comparison (not yet final)

### Candidate A: centralized physical topology policy module

Add a deep internal module such as `browser-project-store-topology.ts` that owns canonical physical-name derivation, classification, and validation. Its narrow interface would:

- validate the static storage identity;
- classify all reserved exact store pairs;
- classify all databases subject to whole-database protection;
- validate a configured library exact pair while permitting a shared database with a distinct safe store;
- validate current media targets before registration or access;
- validate complete precommit clear/remove plans;
- validate every persisted historical retry target before the first cleanup I/O;
- produce mechanism-neutral errors for caller translation.

This appears to give the best depth, leverage, and locality. It also creates one canonical owner for migration-stage and internal-store names, avoiding string drift.

### Candidate B: operation-local guards

Add separate checks in constructor validation, library binding preparation, media-owner registration, cascade commit, and retry code.

This is superficially a smaller diff, but duplicates topology knowledge across modules, is prone to missing the historical retry path, and lets migration/private name derivations drift. It is likely unsafe and too shallow.

### Candidate C: replace database deletion with store-scoped media clearing

Change media cleanup from `deleteDatabase` to clearing only `mediaStore`.

This is substantively different but is likely not the minimum safe design: it changes cleanup semantics, can leave unknown object stores and stale data, complicates historical bindings, and does not address library aliases. Even if selected in the future, a topology policy would still be required.

The successor must complete and record the formal comparison rather than treating these notes as a verdict.

## Semantics that the final design must settle

- Static library rejection must cover the exact public pair and every internal project/control pair.
- `libraryDatabase === projectsDatabase` with a distinct store that is not reserved should remain valid.
- Decide whether the exact stage pairs must also be reserved when a library database happens to equal a stage database; a general pair classifier suggests yes.
- Whole-database media targets must never equal `projectsDatabase`.
- Explicitly decide whether `libraryDatabase` and both migration staging databases are also protected from media database deletion. The physical-topology frame strongly suggests protecting every non-media database that the same store instance owns or depends on.
- Validate current targets before attachment registration/save and before any durable owner descriptor, attachment metadata, IndexedDB, or OPFS side effect.
- Validate project remove and projects/all clear plans before the logical commit.
- Validate every historical journal target on reload/retry as a complete preflight before the first physical I/O.
- Map refusal to a mechanism-neutral `ProjectStoreError` (likely `unavailable`, with an operation/scope appropriate to the caller), with no raw storage mechanism details or physical names in the public payload.
- Rejection must produce zero side effects: no project, library, media, control-store, certificate, journal, or OPFS mutation.
- Repeated failure must be deterministic and fail closed.
- For a newly attempted unsafe topology, no tombstone/journal may commit, so a later safe wrapper can save the same project ID.
- For an already persisted historical unsafe journal, retry must retain the journal and perform no I/O. The final design must state honestly whether same-ID convergence remains intentionally blocked pending explicit repair/remapping, or define a safe convergence mechanism. Do not claim convergence without a recovery design.

## Minimum required real-Chromium acceptance coverage

The final matrix must be explicit and minimal, but it must cover every internal store plus the whole-database collision class.

At minimum include:

- Library exact-pair alias rejection for:
  - public project store;
  - cascade maintenance store;
  - media ownership/certificate store;
  - library-clear binding store;
  - migration maintenance/recovery/cleanup store.
- A positive control proving the same `projectsDatabase` plus a distinct, non-reserved library store remains legal.
- Current media database collision with `projectsDatabase` during attachment registration/save, proving refusal occurs before authority or media mutation.
- Current media database collision during project remove and projects/all clear, proving refusal before logical commit and before cleanup I/O.
- Historical persisted binding/journal collision with `projectsDatabase` on reload/retry, proving full preflight, deterministic mechanism-neutral failure, retained journal, and zero project/control/media drift.
- Crash/reload and same-ID convergence for the precommit-refused current-target case: after constructing a safe identity, saving the same project ID succeeds because no tombstone/journal was committed.
- If `libraryDatabase` and migration stage databases are declared whole-database reserved, include targeted cases for those classes or a table-driven harness proving the same invariant for each reserved database.
- Assertions must cover public project records, all internal stores, library data, media data/ownership, journal/tombstone state, and OPFS side effects as applicable.
- Extend `c5-storage-harness.ts` result fields and `browser-store.pw.ts` expectations with explicit booleans; do not rely only on a generic probe-success bit.

## Remaining work

1. Finish reading `browser-project-store-cascade-round2-probes.ts`, lines 501-1986, and reconcile the existing helpers/result contract with the proposed acceptance matrix.
2. Complete the formal comparison of at least two substantively different designs using module/interface/seam/adapter/depth/leverage/locality vocabulary.
3. Choose the smallest safe design and define its exact internal interface and call-site seams.
4. Decide and justify the reserved whole-database set, especially `libraryDatabase` and both migration staging databases.
5. Resolve the historical-journal crash/reload/same-ID convergence semantics without weakening fail-closed behavior.
6. Define the minimum product write set. Expected areas, subject to the completed audit:
   - one centralized topology module;
   - canonical internal/stage name ownership or exports;
   - constructor/static identity seam;
   - attachment registration/access seam;
   - cascade precommit seam;
   - retry full-preflight seam;
   - Chromium probe/harness/test extensions.
7. Write the final design and acceptance evidence to `evidence/strategy-attempt-4-design.md`.
8. Update `handoff/strategy-attempt-4-planner.md` with the final conclusion only after the design is complete; do not falsely mark it final based on this continuation handoff.
9. Run `rasen validate s02-storage-port --project rocut --strict` and record the result.
10. Return `DONE` with paths, minimum write set, acceptance commands, and 1-3 durable findings.

## Current repository state for this planner pass

- No product files were edited.
- `tasks.md` and run state were not edited.
- No commit was created.
- Strict validation was not run in this interrupted planner attempt.
- Earlier C5 round1 library concurrency and round2 stale preset-load fixes/tests remain in the shared worktree as described by their own evidence and handoff documents; this planner did not alter them.

