# Strategy attempt 4 implementation evidence

Date: 2026-08-02  
Implementation worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`  
Change: `s02-storage-port`  
Scope: C5 centralized physical topology policy, attempt 4, Phases 1-4

## Outcome and review status

Attempt-4 implementation and the assigned Phase 4B verification tail are GREEN against the focused unit, real-browser, targeted TypeScript, repository type-baseline, boundary, formatting, diff, and strict-Rasen gates listed below. The implementing author is **not self-certifying CLEAN**. The original audit findings **F1 Blocker, F2 Major, and F3 Major remain open until an independent non-author reviewer confirms closure**. No task checkbox, run-state, or existing review artifact was changed, and no commit was created.

## RED to GREEN history

Counts below are copied from the surviving phase DONE/handoff records; no missing count was reconstructed.

| Phase | RED evidence | GREEN evidence |
| --- | --- | --- |
| Phase 1 - pure topology authority and static identity gate | `0 pass / 1 fail / 1 error`; the new topology test failed because `browser-project-store-topology` did not yet exist | `8 pass / 0 fail / 47 expectations` |
| Phase 2 - media topology integration | `1 pass / 4 fail / 6 expectations` after the test WASM setup was corrected | Combined Phase 1+2: `13 pass / 0 fail / 102 expectations` |
| Phase 3A - cascade topology integration | `9 pass / 5 fail / 55 expectations` | Combined topology/media/cascade: `21 pass / 0 fail / 156 expectations` |
| Phase 3B - real-browser cascade probes | First focused browser run failed `1/1` with `Project store clear failed: unavailable`; subsequent runs isolated real IndexedDB `blocked` upgrades, two false legacy-library fields, then custom probe inventory leaks | Focused `1/1` in 18.3s and full C5 `3/3` in 38.6s; all 33 cascade booleans true and inventory empty |
| Phase 4A - migration topology integration | `2 pass / 5 fail / 10 expectations` | Migration topology `7 pass / 0 fail / 29 expectations`; four isolated files `28/28`, 185 expectations |
| Phase 4B - real-browser migration probes and final verification | The handed-off partial probe referenced three unimplemented functions and did not compile. The repository baseline later exposed five equivalent TS2322 diagnostics from a Phase 4A test callback returning/narrowing `Array.push`; the callback was corrected and the migration unit re-run | Targeted Vite TypeScript passed; focused browser `1/1` in 27.7s; full C5 `3/3` in 49.9s; all 19 migration and 33 cascade booleans true; exact-three baseline and all static gates passed |

Phase 3B's honest browser progression was: parallel missing-store IndexedDB upgrades blocked; strict media/library claim reads were serialized; library ownership was corrected to exact `(database, store)` pairs; custom probe cleanup was constrained to the randomized full fixture identity; the final inventory was empty.

## Phase 4B implementation

The migration round-2 probe now covers:

- canonical projects stage aliased by configured or retained library storage;
- canonical attachments stage aliased by the current media binding;
- a positive canonical, unaliased two-stage cleanup control;
- table-driven legacy cleanup aliases for PDB, LDB, current MDB, and retained MDB;
- a safe legacy target first and an unsafe PDB target second, proving the whole journal batch is authorized before any deletion or journal shrink;
- byte-distinct sentinels, exact before/after journal comparison, and the fixed `migration-cleanup-topology-conflict` / `unavailable` / nonretryable diagnostic;
- exact `deleteDatabaseExact` cleanup in `finally` for each external `video-editor-timelines-*` database. No broad persisted-storage deletion is used.

Phase 4B changed:

- `apps/web/src/services/storage/browser-project-store-migration-round2-probes.ts`
- `apps/vite-example/src/c5-storage-harness.ts`
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts`
- `apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts` (diagnostic callback typing only)

It builds on Phase 4A's cleanup-batch authorization and strict retained/current topology reads in `browser-project-store-migration.ts`, `browser-project-store-topology.ts`, and the migration topology unit fixture.

## Preserved cascade result surface

Playwright independently asserted 33 boolean fields, all `true`:

1. `opaqueCascadeLiteralRoundTrips`
2. `opaqueCascadeLiteralCannotDeleteOtherProject`
3. `forgedMaintenanceCannotCrossDelete`
4. `namespaceClearIsAtomic`
5. `allClearCommitIsRecoverable`
6. `allClearRetriesAcrossReload`
7. `certifiedProjectsClearWithoutEnumeration`
8. `certifiedAllClearWithoutEnumeration`
9. `uncertifiedProjectsClearRejectsAtomically`
10. `uncertifiedAllClearRejectsAtomically`
11. `ownerRegistrationClearRaceIsSerialized`
12. `uncertifiedBindingMismatchRefusesAtomically`
13. `certifiedBindingHistoryCleansExactNamespaces`
14. `revision1NeverImplicitlyRebinds`
15. `bindingScopedOwnersAvoidCrossProduct`
16. `crossBindingRegistrationClearRaceIsSerialized`
17. `version2JournalRetriesAcrossBindingReload`
18. `version3AllJournalRetriesExactLibraryAcrossConfigurationReload`
19. `projectsJournalNeverTouchesLibraryAcrossConfigurationReload`
20. `tamperedLibraryBindingCannotCrossDelete`
21. `legacyVersion2LibraryBooleanFailsClosed`
22. `legacyVersion2LibraryBindingUpgradeConverges`
23. `postLibraryPreJournalCrashRetriesExactTarget`
24. `version3CodecCardinalityTamperRejects`
25. `topologyLibraryReservedPairsRejectAtomically`
26. `topologySharedProjectsDatabaseSafeLibraryStoreWorks`
27. `topologyMediaProjectsDatabaseAccessRejectsWithoutAuthority`
28. `topologyMediaProtectedDatabasesRefuseRemoveAndClearPrecommit`
29. `topologyHistoricalProtectedMediaJournalFailsClosed`
30. `topologyHistoricalPhysicalAliasesFailClosed`
31. `topologyPrecommitRefusalAllowsSafeSameIdReuse`
32. `topologyHistoricalUnsafeJournalKeepsSameIdBlocked`
33. `topologyCollisionFreeCascadeStillConverges`

## Migration result surface

Playwright independently asserted 19 boolean fields, all `true`:

1. `sameWrapperLifecycleOrdered`
2. `crossWrapperLifecycleOrdered`
3. `earlierMigrationOrdersLaterMutations`
4. `earlierMutationsOrderLaterMigration`
5. `initializationRetriesSameInstance`
6. `initializationDiagnosticMechanismNeutral`
7. `cleanupIntentRecoversAcrossReload`
8. `committedReadbackRecoversAcrossReload`
9. `stagedProjectLaterSaveWins`
10. `stagedProjectLaterRemoveWins`
11. `originalProjectLaterSaveWins`
12. `originalProjectLaterRemoveWins`
13. `physicalAbsenceRetainsRecovery`
14. `digestMismatchRetainsRecovery`
15. `preRecoveryIntentLaterRemoveMigrates`
16. `malformedPreRecoveryTombstoneRejects`
17. `topologyStageCleanupAliasesRefuseBeforeMutation`
18. `topologyLegacyCleanupAliasesRefuseBeforeMutation`
19. `topologyHistoricalMigrationJournalFailsClosedWithoutPartialCleanup`

`lifecycleRaceCount` remained 16 and `lifecycleRaceFailures` remained 0. `cleanupProof` is an array and is intentionally excluded from the boolean count.

## Verification results

### Real browser

Both commands ran in hidden background processes with separate stdout/stderr logs and foreground polling below the 270-second ceiling:

```text
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts browser-store.pw.ts
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts
```

- Focused: `1 passed` in 27.7s; main test 19.5s.
- Full: `3 passed` in 49.9s; browser-store 20.1s, C4 forced-none 14.2s, migration round 1 3.2s.
- Store conformance: 19 passed, 0 failed, 0 skipped.
- Migration round 2: 19 boolean fields, all true.
- Cascade round 2: 33 boolean fields, all true.
- Chromium: Playwright `151.0.7922.34`; CDP product `Chrome/151.0.7922.34`; protocol `1.3`; revision `@782af9cb30a53f54487e5d2e44738645a8ec457c`; JS `15.1.206.8`.
- Focused and full result inventories: before `{ databases: [], directories: [] }`; after `{ databases: [], directories: [] }`.

### Isolated focused units

The files were deliberately run in four separate Bun processes because global `mock.module` state leaks across a combined process:

| File | Result |
| --- | --- |
| topology | 9/9, 53 expectations |
| media topology | 5/5, 55 expectations |
| cascade topology | 7/7, 48 expectations |
| migration topology | 7/7, 29 expectations |

Total: `28/28`, 185 expectations. Migration topology was re-run after the diagnostic callback typing fix and remained `7/7`, 29 expectations.

### Type, boundaries, and static gates

- Targeted Vite TypeScript: `bun x tsc --noEmit -p apps/vite-example/tsconfig.phase4b.json` passed; the temporary config was deleted afterward.
- Repository baseline: `node script/check-type-baseline.mjs` passed with exactly 3 diagnostics now versus 13 at pin `cf5e79e9`; no diagnostic exists outside the pinned baseline set.
- Port boundary: 30 contract modules; all rules passed.
- Session-state boundary: 10/10 factories, 10/10 registry keys, 52 classified imperative modules; passed.
- Storage boundary: 723 production modules plus 3 exact fixtures; 0 direct `storageService` imports/exports, 0 `BrowserHostAdapter` references, 0 unexpected browser-mechanism hits, 43 allowed storage hits, 8 exact-fixture hits, 0 unclassified persistence-localStorage files; passed.
- Host composition: 2 Host roots and 720 production modules; passed.
- Touched ESLint: exit 0; the two Vite-example files were outside the root ESLint match and reported as ignored warnings, with no errors. The existing Pages-directory environment message was unchanged.
- Touched Prettier: all six required files matched.
- `git diff --check`: exit 0; only existing LF-to-CRLF notices.
- `rasen validate s02-storage-port --project rocut --strict`: valid.

## Cleanup and inventory proof

- External legacy databases were deleted only by their exact generated names in `finally` blocks.
- No user-profile database, user Chrome session, or broad persisted-storage namespace was targeted.
- The four `.phase4b-*` logs and `apps/vite-example/tests/.pw-output-c5-storage/.last-run.json` were removed after evidence extraction.
- `apps/vite-example/tsconfig.phase4b.json` was removed.
- Final task-owned Bun/Node/Vite/Chromium process count: 0.
- Final port 4175 listener count: 0.

## Open findings and durable findings

Open pending independent non-author review:

- **F1 Blocker:** independently confirm a certified media target can no longer delete a projects or library database through any current or retained authority path.
- **F2 Major:** independently confirm migration stage and legacy cleanup authority is disjoint from every live current/retained database and that batch cleanup cannot partially mutate.
- **F3 Major:** independently confirm reserved control-store pairs and exact library/media ownership cannot be bypassed without breaking valid shared-database/distinct-store configurations.

Durable findings:

1. Cleanup safety requires authorizing the complete journal batch before the first delete or journal rewrite; a safe first target cannot justify partial progress when a later target is unsafe.
2. Current and retained media/library topology claims are equally security-relevant. Exact equality is required; fuzzy or prefix alias checks would reject valid configurations or authorize the wrong owner.
3. Library ownership is the exact `(database, store)` pair, while media cleanup owns a whole database and OPFS directory.
4. Unit mocks do not model real IndexedDB version-upgrade contention; real-browser verification caught the need to serialize strict missing-store reads.
5. Reading a deleted IndexedDB recreates it; deletion proof must come from inventory, not a raw post-delete read.

