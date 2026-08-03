# C5 review round 2 — migration lifecycle and recovery fix

Date: 2026-08-02  
Scope: B2, M1, M2, M3 and test gaps 2–5 only  
Status: implemented and verified; uncommitted

## Findings closed

### B2 — the complete migration lifecycle shares durable mutation arbitration

`BrowserProjectStore.migrate` now enters the durable-identity shared
`BrowserMutationQueue` as `all-projects`. The queued operation contains discovery,
transformation, stage writes/readback, durable recovery and cleanup-intent writes,
destination commits, committed readback, recovery finalization, and attempted
post-commit cleanup. A second wrapper resolves the same queue by durable identity.

The conflict rules already make `all-projects` conflict with project record/tree,
attachment, and projects-clear operations, while `all` conflicts with every
operation. Migration therefore orders in both directions with:

- project save;
- project remove;
- `clear({ kind: "projects" })`;
- `clear({ kind: "all" })`.

The Chromium probe executes all four operations in both directions, once on the
same wrapper and once on a second wrapper: **16 deterministic races**. A mutation
started after migration remains pending until migration settles, then its newer
save/removal/clear wins. A migration started after a paused mutation remains
pending until that mutation settles; it cannot overwrite the successful save or
resurrect a committed removal/clear.

### M1 — eager initialization rejection no longer poisons a stable store

Initialization remains eager, identity-shared, and serialized through the same
`all-projects` queue, but the instance now holds a replaceable observed promise.
On rejection it:

1. emits a fixed mechanism-neutral `storage-initialization` warning through the
   configured diagnostics callback;
2. clears only that instance's failed promise;
3. lets the global coalesced run remove itself after settlement; and
4. reconstructs initialization on the next `prepareForSession()` call.

The blocked-IDB probe holds the projects database at a version that cannot yet
create the maintenance store. The first prepare rejects; after the blocker closes,
the second prepare on the **same store instance** succeeds. The low-level opener
also closes a connection that succeeds after its earlier `blocked` rejection, so
the abandoned request cannot leave a ghost connection that blocks later cleanup.

Next and Vite Host fire-and-forget preparation handlers now record a fixed warning
instead of discarding the rejection. The store callback and Host fallback contain
only phase/operation/scope/code/retryable metadata; neither serializes the raw
mechanism error, database/store name, target, or payload.

### M2 — cleanup intent has durable recovery before its first write

After all stage readbacks validate, migration first writes a revisioned
`migration-recovery` record to the existing dedicated migration-maintenance object
store. It records the exact original and expected project rows plus validated
cleanup targets; attachment bodies/metadata remain in the already validated stage
databases. Only then does migration attempt the cleanup-journal write, and only
after that succeeds may destination commit begin.

If the first cleanup-intent write fails, the original row is still intact, the
stage databases remain, and the recovery record is durable. Initialization or
`prepareForSession()` reconstructs the cleanup intent, reloads and validates the
stage, commits it, validates the destination, and completes cleanup. The warning
is therefore truthfully retryable; it is not based on a lost in-memory target list.

### M3 — post-put readback failure retains evidence and converges

The recovery record and stage databases remain until every committed destination
readback succeeds. A failure after destination put is reported as
`migration-commit-validation`, returns `failed`, and does not delete the stage or
recovery record.

On the next initialization/session maintenance pass, recovery runs inside the
same `all-projects` conflict domain and handles each destination conservatively:

- exact original row: recommit and validate the staged value;
- exact staged value: validate the already committed destination;
- absent row: respect a later successful removal/clear; never resurrect it;
- a different current-schema row: respect a later successful save; never replace
  it with the older staged snapshot;
- any ambiguous old destination: retain recovery and retry rather than guessing.

Only after destination convergence does it delete the recovery record and process
the persisted cleanup journal. The Chromium fault fixture fails immediately after
the destination put and before readback, observes the current destination plus
retained stage/recovery evidence, resets runtime state, then proves initialization
validates the commit and removes legacy/stage databases. A following migration may
correctly return `not-needed` only because recovery was handled first.

## Cascade round-2 invariants preserved

This fixer retains the separate `${projectsStore}-cascade-maintenance` object
store, typed tombstone/clear-journal keys, exact project-target binding, atomic
library namespace clear, and durable `clear(all)` library retry introduced by the
cascade round-2 fixer. Migration recovery continues to use only
`${projectsStore}-migration-maintenance`; it never scans or writes cascade records.

## Deterministic Chromium RED

The round-2 probes and fault hooks were installed before the lifecycle fix. The
first causal full-browser run reported every new axis false:

```text
sameWrapperLifecycleOrdered: false
crossWrapperLifecycleOrdered: false
earlierMigrationOrdersLaterMutations: false
earlierMutationsOrderLaterMigration: false
initializationRetriesSameInstance: false
initializationDiagnosticMechanismNeutral: false
cleanupIntentRecoversAcrossReload: false
committedReadbackRecoversAcrossReload: false
```

Playwright therefore failed 1/1 on the exact migration-round2 assertion object.
An earlier setup run also exposed that an IDB open request rejected as `blocked`
could later succeed and leak its connection; the opener hardening above removed
that fixture-side cleanup obstruction without changing any of the eight causal
RED results.

## GREEN evidence

| Gate | Observed result |
| --- | --- |
| full real-Chromium shared matrix | **1 passed**, Chromium **151.0.7922.34** |
| migration lifecycle round 2 | **16 races / 0 failures**; all 8 public result axes true |
| shared store conformance | **19 passed, 0 failed, 0 skipped** |
| migration round 1 | **16/16 true** |
| cascade round 1 | **9/9 true** |
| cascade round 2 | **6/6 true** |
| corrupt/active-read residuals | **6/6 corrupt + 7/7 active abort true** |
| focused storage/migration/Host tests | **21 passed, 0 failed, 46 assertions** |
| Vite TypeScript | **PASS** |
| pinned type baseline | **PASS**, exactly 3 inherited diagnostics and none outside the pin |
| storage boundary | **PASS**, 720 source modules, zero forbidden findings |
| port boundary | **PASS**, 30 contract modules |
| Host composition | **PASS**, 2 roots / 717 production modules |
| session-state boundary | **PASS**, 10/10 factories, 10/10 registry keys, 52 classified modules |
| focused ESLint | **PASS**; repository informational missing-pages message only |
| focused Prettier | **PASS** |
| whole-tree CR-at-EOL diff check | **PASS**; line-ending warnings only |
| strict Rasen validation | **valid: true**, 1/1 |

Every disposable fixture ran its exact cleanup in `finally`. The full browser
result ended with the migration inventory `beforeDatabases=[]` and
`afterDatabases=[]`; round-2 fixture cleanup also completed without residual stage,
legacy, maintenance, or identity databases. After Playwright exited, port 4175 had
no listener. The generated 45-byte
`tests/.pw-output-c5-storage/.last-run.json` and its now-empty directory were
removed after retaining the evidence.

## Round-2 migration-fixer write set

- `apps/web/src/services/storage/browser-project-store.ts`
- `apps/web/src/services/storage/browser-project-store-migration.ts`
- `apps/web/src/services/storage/browser-project-store-migration-round2-probes.ts`
- `apps/web/src/services/storage/browser-storage-mechanisms.ts` (late-success
  close after a blocked open only; cascade transaction helpers preserved)
- `apps/web/src/editor/host/next-editor-host.ts`
- `apps/vite-example/src/host/vite-host-config.ts`
- `apps/vite-example/src/c5-storage-harness.ts`
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts`

No cascade decoder/manager/journal semantics, library clear, presets, library
coordinator, consumer, protected session file, task checkbox, or review report was
changed. No commit was created.
