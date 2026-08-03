# C5 review round 2 — opaque cascade control plane and atomic library clear

Date: 2026-08-02  
Scope: B1, M4, and test gaps 1/6  
Status: implemented and verified; uncommitted

## Findings closed

Cascade maintenance no longer shares physical rows with provider-owned project
data. The projects database now has a dedicated
`${projectsStore}-cascade-maintenance` object store. Project list/load/migration
decode only project rows, and a current project envelope always wins over any
provider-private compatibility fields. A literal field named
`__opencutProjectCascade` is therefore opaque data again: it survives immediate
load and reopen unchanged and cannot create maintenance work.

The control-plane record key space is also typed:

- project tombstones use `.c5-project-tombstone:${encodeURIComponent(projectId)}`;
- store-wide clear journals use the disjoint `.c5-project-clear-` prefix;
- the decoder requires a tombstone key to be the exact deterministic encoding of
  its project scope, so a user-controlled project ID cannot collide with or delete
  a clear journal;
- project tombstones may only name the one media database and directory derived
  from that bound project ID (or no targets once completed);
- only a store-wide clear journal may carry a prefix-scoped inventory.

Project visibility and maintenance intent retain an atomic logical commit point:

- project save writes the project and removes its completed typed tombstone in one
  projects-database transaction;
- project removal deletes the project and writes its tombstone in one transaction;
- projects/all clear atomically clears project rows and installs the completed
  tombstones plus optional clear journal in that same database transaction.

## Atomic and recoverable library clear

A library namespace clear now uses one IndexedDB read-write transaction and one
cursor. Every encoded namespace key and, for `saved-sounds`, the raw legacy
`user-sounds` key is deleted in that transaction. An injected failure after the
second cursor deletion aborts the transaction; all three seeded rows remain and
the public operation rejects with its typed failure.

`clear(all)` now records `clearLibrary: true` in its durable clear journal as part
of the first destructive projects-database commit. Post-commit maintenance then
deletes the inventoried project media and clears the library store. If library
clear fails after projects have committed, the public clear does not return an
ambiguous rejection: it resolves, emits a mechanism-neutral retryable warning,
and leaves the journal. Initialization/next-session maintenance in a new wrapper
replays the exact idempotent work, clears the library, and removes the journal.

## Deterministic Chromium RED → GREEN

The real-Chromium round-2 probe first ran against the round-1 implementation and
reported all six regression axes false:

```text
opaqueCascadeLiteralRoundTrips: false
opaqueCascadeLiteralCannotDeleteOtherProject: false
forgedMaintenanceCannotCrossDelete: false
namespaceClearIsAtomic: false
allClearCommitIsRecoverable: false
allClearRetriesAcrossReload: false
```

That RED reproduced the reviewer failure: a public save containing a valid-shaped
opaque cascade literal hid the provider project and deleted another project's
attachment. It also reproduced a second-delete namespace failure leaving a
partial result and a library failure after the project half of `clear(all)` had
committed without reload convergence.

The final disposable Chromium probe proves:

1. the valid-shaped literal round-trips byte-for-JSON-value unchanged through a
   runtime reset and new wrapper;
2. the literal cannot delete another project's attachment;
3. even a directly seeded, correctly namespaced maintenance tombstone cannot name
   a different project's physical targets and produces a non-retryable `corrupt`
   maintenance diagnostic;
4. a second namespace deletion failure rolls the complete transaction back,
   including `user-sounds`;
5. library failure after the project commit leaves `clear(all)` resolved with a
   retryable diagnostic;
6. runtime reset plus a new wrapper clears library/media and converges.

## GREEN evidence

Observed commands/results:

| Gate                                                              | Result                                                                                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| real Chromium `browser-store.pw.ts`                               | **1 passed**; store 19/19, migration 16/16, cascade round 1 9/9, cascade round 2 6/6, corruption 6/6, active read abort 7/7 |
| focused conformance/storage/Host/session suites                   | **33 passed, 0 failed, 179 assertions**                                                                                     |
| Vite TypeScript check                                             | **PASS**                                                                                                                    |
| `node script/check-type-baseline.mjs`                             | **PASS**, exactly 3 inherited diagnostics and none outside the pinned set                                                   |
| `node script/check-storage-boundary.mjs`                          | **PASS**, 719 source modules, zero forbidden findings                                                                       |
| `node script/check-host-composition.mjs`                          | **PASS**, 2 Host roots / 716 production modules                                                                             |
| `node script/check-port-boundary.mjs`                             | **PASS**, 30 contract modules                                                                                               |
| `node script/check-session-state-boundary.mjs`                    | **PASS**, 10/10 factories, 10/10 registry keys, 52 classified imperative modules                                            |
| focused ESLint                                                    | **PASS**, zero errors; two Vite harness files are outside the root ESLint config                                            |
| focused Prettier                                                  | **PASS**                                                                                                                    |
| `git -c core.whitespace=cr-at-eol diff --check`                   | **PASS**; line-ending warnings only                                                                                         |
| `rasen validate s02-storage-port --project rocut --strict --json` | **valid: true**, 1/1                                                                                                        |

The Playwright server exited normally, port 4175 has no listener, and the generated
`.pw-output-c5-storage/.last-run.json` was removed after retaining the result above.

## Round-2 fixer write set

- `apps/web/src/services/storage/browser-project-store-cascade.ts`
- `apps/web/src/services/storage/browser-project-store-cascade-manager.ts`
- `apps/web/src/services/storage/browser-project-store-cascade-round2-probes.ts`
- `apps/web/src/services/storage/browser-project-store-control.ts`
- `apps/web/src/services/storage/browser-project-store-records.ts`
- `apps/web/src/services/storage/browser-project-store-migration.ts` (project-row maintenance filtering removal only)
- `apps/web/src/services/storage/browser-project-store.ts`
- `apps/web/src/services/storage/browser-storage-mechanisms.ts`
- `apps/vite-example/src/c5-storage-harness.ts`
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts`

The store, records, migration, harness, and Playwright files are shared integration
surfaces. Round-1 migration/residual fields and the shared durable mutation queue
were preserved. This fixer did not edit migration lifecycle/init, presets,
coordinators, protected session/task files, or either review report.
