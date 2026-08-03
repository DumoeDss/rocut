# C5 review-cycle strategy attempt 1 — M2 implementation evidence

Date: 2026-08-02  
Branch/worktree: `feat/s02-storage-port` / `rocut-wt-c5`  
Base: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
Scope: preferred M2-A only; M1-A preserved  
Disposition: **M2 implemented and locally green; independent re-review still required**

## Outcome

Projects/all clear no longer treats missing IndexedDB enumeration as an empty
physical inventory. A third internal object store,
`${projectsStore}-media-ownership`, now records logical media owners separately
from both migration and cascade maintenance. It contains strictly decoded,
key-bound revision-1 owner rows and one complete-coverage certificate. Owner rows
contain only the logical project ID; database and directory names are always
derived at the destructive boundary.

The certificate is written only by one successful full sweep of both available
`indexedDB.databases()` names and OPFS root entries. The sweep backfills every
validated configured-prefix owner in one owner-store transaction and writes the
certificate in that same transaction. Initialization attempts this
opportunistically: unsupported enumeration, OPFS failure, or owner-store failure
emits at most a fixed mechanism-neutral maintenance warning and does not make the
store itself unusable.

Database enumeration is now explicitly tri-state:

- `available(names)` is a real inventory;
- `unsupported` is a capability state;
- an actual enumeration failure remains a failure.

The legacy string-list helper throws `NotSupportedError` for unsupported
enumeration instead of converting it to `[]`.

## Write-ahead ownership and ordering

Every adapter path that may open/create a current media database or directory
registers the logical owner first:

- public attachment list/load/save/remove;
- the initialization orphan scan before it opens an enumerated media database;
- migration staging and migration recovery before current media access.

Attachment list/load now enter the existing durable-identity shared queue around
tombstone check, owner registration, media metadata open, and OPFS read. Save and
remove register inside their existing queued operation. Migration registers from
inside its existing `all-projects` operation and never recursively enters the
queue. A write-ahead crash can therefore leave only a harmless false-positive
owner; a physical media target cannot be created without a durable logical owner.

When a project clear already committed, attachment list/load observe the cascade
tombstone and return logical absence without recreating an empty media database;
remove is an idempotent no-op and save retains its typed conflict. A later
explicit project save removes only that project's typed tombstone and makes the
scope usable again.

## Exact clear planner and commit boundary

Before projects/all clear can commit, the cascade manager now:

1. strictly decodes every project row;
2. strictly decodes and ownership-validates every cascade row;
3. strictly decodes every media-owner/certificate row;
4. proves coverage, requiring a full DB+OPFS sweep when no certificate exists;
5. unions project IDs, completed cascade tombstone IDs, owner IDs, and any
   optionally enumerated legacy/orphan IDs;
6. derives and round-trip validates the exact database and directory for every
   ID;
7. rechecks cancellation and atomically installs project invisibility, completed
   tombstones, and the complete exact clear journal.

Malformed owner/project/tombstone input, unprovable coverage, owner backfill or
certificate failure, target derivation failure, or journal transaction failure
all fail before physical deletion or project/library commit. A certified owner
registry remains authoritative when database enumeration is unsupported. An
uncertified registry with unsupported enumeration rejects `unavailable` before
the project transaction, leaving project, media, and library data unchanged.

The owner store is not cleared by the cascade transaction. Postcommit physical
and library cleanup retains the round-2 durable journal, idempotent retry, and
mechanism-neutral diagnostic behavior.

## Deterministic Chromium RED → GREEN

The five M2 axes were added before product implementation. The first real
Chromium run produced the intended RED while all existing M1/cascade axes stayed
green:

```text
certifiedProjectsClearWithoutEnumeration: false
certifiedAllClearWithoutEnumeration: false
uncertifiedProjectsClearRejectsAtomically: false
uncertifiedAllClearRejectsAtomically: false
ownerRegistrationClearRaceIsSerialized: false
```

The final probes use randomized disposable identities and demonstrate:

1. with a complete certificate and `indexedDB.databases` masked, projects clear
   deletes both project-owned and owner-only media; same-ID project reuse exposes
   no old metadata/body while the library remains;
2. the equivalent all clear deletes both media owners and the library;
3. when initialization begins with enumeration masked, both projects and all
   clear reject `unavailable` before commit and project/media/library remain
   readable;
4. a never-created project's attachment read is paused after write-ahead owner
   registration and media dispatch; a concurrent projects clear cannot pass it,
   includes the owner after release, and deletes the created empty media DB.

Final result:

```text
certifiedProjectsClearWithoutEnumeration: true
certifiedAllClearWithoutEnumeration: true
uncertifiedProjectsClearRejectsAtomically: true
uncertifiedAllClearRejectsAtomically: true
ownerRegistrationClearRaceIsSerialized: true
```

## First-store initialization ordering discovered during the full gate

Adding another internal store exposed an existing first-open ordering race in
the C4 production-identity harness. Maintenance could create its object store
before the public projects store existed; a concurrent first `list-projects`
upgrade then received Chromium `InvalidStateError: blocked`. The public projects
store is now ensured as the first initialization operation, before any cascade,
ownership, or migration maintenance upgrade. The temporary error-name diagnostic
was removed. C4 then passed five consecutive clean Chromium repeats and the final
combined 3-test configuration.

## Implementation write set

- `apps/web/src/services/storage/browser-project-store-media-ownership.ts` (new)
- `apps/web/src/services/storage/browser-storage-mechanisms.ts`
- `apps/web/src/services/storage/browser-project-store-cascade-manager.ts`
- `apps/web/src/services/storage/browser-project-store.ts`
- `apps/web/src/services/storage/browser-project-store-migration.ts` (owner registration only)
- `apps/web/src/services/storage/browser-project-store-cascade-round2-probes.ts`
- `apps/vite-example/src/c5-storage-harness.ts`
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts`

No public port, Host, consumer, library coordinator, protected session, task
list, review report, M1 attachment codec, or M1 recovery state machine changed.
No commit was created.

## Verification

```text
bunx playwright test --config apps/vite-example/playwright.c5-storage.config.ts
  PASS, 3/3 on Chromium 151.0.7922.34
  shared browser store 19/19
  migration lifecycle races 16/16
  M1 acceptance axes 6/6
  cascade round 1 9/9
  cascade round 2 including M2 11/11
  corrupt rows 6/6
  active read abort 7/7
  C4 forced-none PASS
  migration round 1 PASS

C4 clean repeat after first-store ordering fix
  PASS, 5/5

bun test <conformance + storage controls + storage-boundary negative suite>
  PASS, 48 tests / 0 failed / 216 expectations

bun run --cwd apps/vite-example typecheck
  PASS, zero diagnostics
node script/check-type-baseline.mjs
  PASS, 3 inherited diagnostics and none outside the pinned set
node script/check-storage-boundary.mjs
  PASS, 721 source modules, zero forbidden hits
node script/check-host-composition.mjs
  PASS, 2 Host roots / 718 production modules
node script/check-port-boundary.mjs
  PASS, 30 contract modules / five rules
node script/check-session-state-boundary.mjs
  PASS, 10/10 factories, 10/10 registry keys, 52 classified modules

focused M2 ESLint
  PASS, zero errors/warnings; repository informational missing-pages message only
focused Prettier
  PASS
git -c core.whitespace=cr-at-eol diff --check
  PASS; line-ending conversion warnings only
rasen validate s02-storage-port --project rocut --strict --json --no-interactive
  PASS, 1/1 valid, zero issues
```

All disposable identities were cleaned, Playwright's `.last-run.json` was
removed, and port 4175 had no remaining listener. No user profile was opened.

## Remaining review-cycle state

Preferred M1-A and M2-A are both implemented and locally green. Strategy attempt
1 is ready for independent non-author re-review of the two round-3 Majors. The
review cycle must not be called clean and C5 must not ship until that review
confirms both findings.
