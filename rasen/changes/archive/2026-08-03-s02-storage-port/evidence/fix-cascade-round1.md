# C5 review round 1 — recoverable project cascade and browser arbitration

Date: 2026-08-02  
Scope: B3, M3, and test gaps 3/6  
Status: implemented and verified; uncommitted

## Findings closed

`BrowserProjectStore.remove` and project/all `clear` no longer destroy attachment
storage before the logical project commit. They now atomically replace the project
view with internal tombstone/journal rows in the projects object store, making the
affected projects invisible first. Per-project IndexedDB and OPFS cleanup then runs
as post-commit maintenance. A physical failure cannot resurrect a visible project
whose attachments have already been partly removed.

The cleanup intent is durable:

- remove writes a project tombstone containing the exact owned media targets;
- project/all clear atomically clears visible projects, writes completed tombstones
  for affected project IDs, and writes one clear cleanup journal;
- successful cleanup completes a project tombstone or removes the clear journal;
- partial cleanup leaves the record retryable and idempotent;
- store initialization and `prepareForSession` retry pending cleanup, including
  after the module runtime is reset and a new wrapper is opened;
- invalid/out-of-identity physical targets are never deleted;
- warnings expose only the logical operation/scope, stable error code, and
  retryability. They contain no database name, OPFS directory, raw platform error,
  or stored payload.

Completed tombstones also close the inverse race. An attachment write invoked after
an earlier remove/clear waits for that project-tree mutation, then rejects with a
typed conflict instead of recreating orphaned media. A later explicit project save
may safely replace a completed tombstone; it first retries and refuses any still
pending cleanup for that same physical project identity. Never-created project IDs
retain the existing port behavior, so independent attachment identities in the
shared conformance suite remain legal.

## Durable-identity mutation arbitration

All `BrowserProjectStore` wrappers with the same `durableIdentityKey` now obtain the
same `BrowserMutationQueue`. The registry stores only `WeakRef` values and uses a
`FinalizationRegistry` to remove dead keys; test runtime reset also clears the weak
index. This keeps the arbitration lifecycle bounded without introducing a payload
owner or exposing a browser mechanism through `ProjectStore`.

The existing logical conflict lattice is therefore effective across wrappers:

- same attachment key saves serialize in invocation order;
- replacement and removal of one attachment serialize;
- project-tree removal conflicts with every attachment mutation for that project;
- project/all clear conflicts with all affected project and attachment mutations;
- unrelated attachment keys and library namespaces retain their documented
  independence.

Initialization runs are no longer retained forever. Concurrent wrappers coalesce
one in-flight initialization, and the identity entry is deleted when it settles so
a later wrapper/reload can retry durable maintenance.

## Deterministic RED and regression probes

The first browser RED used the new control hook to fail cleanup immediately after
one physical cascade target. Against the old delete-first implementation, the real
Chromium matrix failed with an `InvalidModificationError` from `removeEntry`; the
operation had no recoverable logical journal and could race destructive cleanup.

`browser-project-store-cascade-probes.ts` now exercises disposable real browser
storage with deterministic pause/failure controls. It proves:

1. remove remains resolved and the project is invisible after failure between its
   two attachment cleanup targets;
2. project clear remains resolved and every project is invisible after the same
   partial-cleanup failure;
3. a runtime reset plus a new wrapper removes all remaining media databases and
   directories;
4. diagnostics have an exact mechanism-neutral field set and retain only logical
   scope;
5. two wrappers serialize same-key saves and replace/remove;
6. attachment-first remove, project clear, and all clear finish with no surviving
   attachment;
7. remove/clear-first inverse races block the later attachment write and reject it
   as a typed conflict, preventing orphan recreation.

The clear journal and tombstone codecs are also excluded from ordinary project
decode and schema-version/migration candidate discovery, so maintenance records
cannot appear as projects or perturb the migration watermark.

## GREEN evidence

Observed commands/results:

| Gate                                                              | Result                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| real Chromium `browser-store.pw.ts`                               | **1 passed**; store 19/19, migration 16/16, cascade 9/9, residual corruption 6/6, mid-flight abort 7/7 |
| focused conformance/storage/Host/session suites                   | **33 passed, 0 failed, 179 assertions**                                                                |
| Vite TypeScript check                                             | **PASS**                                                                                               |
| `node script/check-type-baseline.mjs`                             | **PASS**, exactly 3 inherited diagnostics and none outside the pinned set                              |
| `node script/check-storage-boundary.mjs`                          | **PASS**, 718 source modules, zero forbidden findings                                                  |
| `node script/check-host-composition.mjs`                          | **PASS**, 2 Host roots / 715 production modules                                                        |
| `node script/check-port-boundary.mjs`                             | **PASS**, 30 contract modules                                                                          |
| `node script/check-session-state-boundary.mjs`                    | **PASS**, 10/10 factories, 10/10 registry keys, 52 classified imperative modules                       |
| focused ESLint                                                    | **PASS**; only the repository's informational missing-pages message                                    |
| focused Prettier                                                  | **PASS**                                                                                               |
| `git -c core.whitespace=cr-at-eol diff --check`                   | **PASS**                                                                                               |
| `rasen validate s02-storage-port --project rocut --strict --json` | **valid: true**, 1/1                                                                                   |

The manually started diagnostic Vite server was stopped, port 4175 had no listener,
and generated `.pw-output-c5-storage/.last-run.json` was removed after retaining the
result above.

## Exact fixer write set

- `apps/web/src/services/storage/browser-project-store-cascade.ts`
- `apps/web/src/services/storage/browser-project-store-cascade-manager.ts`
- `apps/web/src/services/storage/browser-project-store-cascade-probes.ts`
- `apps/web/src/services/storage/browser-project-store-control.ts`
- `apps/web/src/services/storage/browser-project-store-records.ts` (internal-row exclusion only)
- `apps/web/src/services/storage/browser-project-store-migration.ts` (internal-row exclusion only)
- `apps/web/src/services/storage/browser-project-store.ts`
- `apps/web/src/services/storage/browser-storage-mechanisms.ts`
- `apps/vite-example/src/c5-storage-harness.ts`
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts`

The records/store/migration/harness files are shared with the residual and migration
fixers; their unrelated additions were preserved. This fixer did not edit library
consumers, duplicate cleanup, cancellation/corruption behavior, protected session
surface, task lists, or the round-1 review report.
