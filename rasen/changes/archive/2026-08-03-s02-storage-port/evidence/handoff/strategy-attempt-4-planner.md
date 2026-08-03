# C5 strategy attempt 4 final planner handoff

Date: 2026-08-02  
Branch/worktree: `feat/s02-storage-port` / `rocut-wt-c5`  
Status: **DONE - design selected; F1 Blocker and F2/F3 Majors remain open**

## Final conclusion

Select the centralized physical topology policy in
`evidence/strategy-attempt-4-design.md`. Attempt 3 proved exact durable target
authorization, but the topology audit proved that an authentic target can still
alias a public/control store, another logical database, a migration stage, or
another owner's OPFS root. Attempt 4 therefore adds a second precondition to
every destructive path:

```text
strict durable authorization AND safe physical topology
```

The policy is a pure, in-process deep module at the seam between decoded plans
and existing IndexedDB/OPFS mechanisms. It owns canonical `C/O/A/G` and `SP/SA`
names, exact store-pair rules, whole-database reserved sets, exact OPFS owner
rules, and one stable internal conflict classification. No new public port,
adapter, or persisted topology registry is selected.

## Designs compared

1. **Centralized pure topology policy - selected.** Highest depth/leverage and
   locality across static identity, media first use, clear/remove precommit,
   cascade retry, migration planning, and migration retry.
2. **Operation-local guards - rejected.** Superficially fewer lines per site but
   shallow; it duplicates all protected names and is likely to miss historical
   retry or drift from migration derivations.
3. **Store-scoped media clear - rejected.** Changes cleanup semantics and still
   leaves OPFS, library/control, and migration whole-database aliases.
4. **New durable global topology registry - deferred.** Broader arbitrary-origin
   ownership but not the minimum safe repair for current adapter-owned claims.

## Normative reserved topology

Reserved exact library pairs in `projectsDatabase` are the public project store
plus all four control stores:

```text
projectsStore
projectsStore-cascade-maintenance
projectsStore-media-ownership
projectsStore-library-clear-bindings
projectsStore-migration-maintenance
```

`libraryDatabase === projectsDatabase` remains legal only with a store distinct
from all five.

Every cascade media whole-database target must be disjoint from:

- `projectsDatabase`;
- current and strictly retained library databases;
- `${projectsDatabase}-c5-projects-stage`;
- `${projectsDatabase}-c5-attachments-stage`;
- the legacy timeline namespace owned by migration.

Every migration whole-database target must be disjoint from the projects
database, current/retained library databases, and every current/retained media
database. A canonical stage target may delete itself only after proving no
library/media claim aliases it. A legacy target may not equal either stage DB.

Different media owner keys may not share an exact database or an exact OPFS root
directory. Same owner + same tuple retry remains legal.

## Exact call seams

1. `BrowserProjectStore` performs the static topology gate before initialization
   creates or reads any store.
2. `registerMediaOwner` and ownership certification validate current/discovered
   claims before descriptor, owner, certificate, media DB, or OPFS writes.
3. Project removal validates its current media target before the project/
   tombstone transaction.
4. Projects/all clear validates the complete media plus library plan before the
   logical clear transaction.
5. Cascade retry runs one full topology preflight after codec/certificate/
   descriptor validation and before the first physical I/O.
6. Migration first builds every candidate/cleanup claim in memory, validates the
   complete batch, and only then registers owners or stages data.
7. Migration recovery/cleanup retries validate the complete journal before any
   target delete or journal shrink.

New/current conflicts are `ProjectStoreError unavailable` at the caller's exact
operation/scope with zero side effects. Historical conflicts retain their
journal and emit a fixed nonretryable topology diagnostic.

## Honest same-ID semantics

- A newly refused current topology commits no owner, tombstone, or journal;
  reopening a safe identity can save the same project ID.
- A historical unsafe cascade journal already represents a committed logical
  removal/clear. It remains retained and continues blocking same-ID save. It is
  not deleted, rebound, or called converged. An intrinsically unsafe target such
  as shared `projectsDatabase` needs an explicit audited repair outside attempt
  4.
- Historical unsafe migration maintenance likewise remains pending with zero
  cleanup I/O. A cleanup-only journal gains no new public same-ID guarantee.

## Minimum implementation write set

1. New `apps/web/src/services/storage/browser-project-store-topology.ts`.
2. `browser-project-store.ts`.
3. `browser-project-store-media-ownership.ts`.
4. `browser-project-store-library-clear-bindings.ts`.
5. `browser-project-store-cascade-manager.ts`.
6. `browser-project-store-cascade.ts` for canonical-name delegation only.
7. `browser-project-store-migration.ts`.
8. `browser-project-store-cascade-round2-probes.ts` for T1-T7/T10.
9. `browser-project-store-migration-round2-probes.ts` for T8/T9.
10. Vite C5 harness and Playwright expectation.
11. Focused pure topology unit tests.

No change is required to `ProjectStore`, Hosts/sessions, persisted v3 journal
shape, or `browser-storage-mechanisms.ts`.

## Explicit Chromium additions

Cascade round-2 fields:

```text
topologyLibraryReservedPairsRejectAtomically
topologySharedProjectsDatabaseSafeLibraryStoreWorks
topologyMediaProjectsDatabaseAccessRejectsWithoutAuthority
topologyMediaProtectedDatabasesRefuseRemoveAndClearPrecommit
topologyHistoricalProtectedMediaJournalFailsClosed
topologyHistoricalPhysicalAliasesFailClosed
topologyPrecommitRefusalAllowsSafeSameIdReuse
topologyHistoricalUnsafeJournalKeepsSameIdBlocked
topologyCollisionFreeCascadeStillConverges
```

Migration round-2 fields:

```text
topologyStageCleanupAliasesRefuseBeforeMutation
topologyLegacyCleanupAliasesRefuseBeforeMutation
topologyHistoricalMigrationJournalFailsClosedWithoutPartialCleanup
```

These are table-driven over all five reserved project-store pairs and the
protected `PDB/LDB/SP/SA` database classes, with separate exact DB and OPFS
cross-owner cases. Preserve all existing 24 cascade round-2 and migration/C5
results.

## Acceptance commands

From `apps/vite-example`:

```text
bunx playwright test --config playwright.c5-storage.config.ts
bunx playwright test --config playwright.c5-storage.config.ts tests/c5-storage/browser-store.pw.ts
```

From the planning checkout:

```text
rasen validate s02-storage-port --project rocut --strict
```

Planner validation result: **exit 0** - `Change 's02-storage-port' is valid`;
Rasen resolved project `rocut` at
`E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut`.

Implementation evidence must additionally record focused topology/storage unit
tests, Vite TypeScript, repository baseline, focused ESLint/Prettier, the four C5
architecture boundary checks, diff check, and the exact tested tree fingerprint.

## Next roles and exit gate

An implementer applies the selected policy without self-closing F1-F3. A
non-author reviewer then audits the full diff and reproduces T1-T10; a non-author
verifier runs the complete gate. Only their confirmation may close the findings.

Planner final status: **design complete; not CLEAN; F1 Blocker and F2/F3 Majors
remain open**.
