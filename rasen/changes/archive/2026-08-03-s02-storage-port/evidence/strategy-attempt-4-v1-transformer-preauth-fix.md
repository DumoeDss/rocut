# Strategy attempt 4 v1 transformer preauthorization fix

Date: 2026-08-02  
Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`  
Change: `s02-storage-port`  
Finding: `C5-S4-M1` residual Major  
Scope: bounded same-strategy product/test fix; no task, run-state, canonical review, proposal/design/spec, migration-history, or commit edit

## Outcome

The migration preparation phase is now pure with respect to legacy/current attachment storage. From raw persisted input it derives and freezes each candidate's current media claim, both canonical stage targets, every v1 scene/project timeline target, the deterministic v1 legacy-media target, and all existing historical cleanup targets. One current-plus-retained media/library claim snapshot authorizes that complete batch before the v1 transformer, current attachment discovery, owner registration, staging, recovery intent, or cleanup intent can perform physical I/O.

The topology permit now carries two deliberately separate sets:

- `sources`: exact frozen v1 databases the transformer may access;
- `databases`: the existing cleanup subset that execution and journals may delete.

Preauthorizing `video-editor-media-${projectId}` therefore does not add it to cleanup. A safe legacy-media source may share the same whole database only with the same project's exact current media fingerprint, preserving the production v1 layout, while a timeline source, cross-project media source, or different retained binding may not alias current/retained media. Projects, stage, current/retained library, and ambiguous source databases remain protected.

Every actual `assertLegacyTarget` callback is checked against the frozen permit, including its source purpose (`legacy-timeline` versus `legacy-media`), before `IndexedDBAdapter` construction/access. An unplanned target fails closed as an internal topology conflict without exposing a physical name.

Schema v0 remains supported without weakening the boundary: the existing pure additive v0-to-v1 transformer is evaluated once during preparation to materialize its generated scene identity, then its complete v1 source plan is authorized before the first I/O-bearing v1 step. No historical migration file or semantics were rewritten.

## Changed product/test paths

- `apps/web/src/services/storage/browser-project-store-topology.ts`
  - adds `MigrationDatabaseSourceClaim`, source authorization, and a frozen `permit.sources` set;
  - rejects protected/current-retained aliases at source-access granularity;
  - preserves same-project current/legacy media compatibility and separate cleanup authority.
- `apps/web/src/services/storage/browser-project-store-migration.ts`
  - splits raw preparation/permit acquisition from transformation and staging;
  - derives complete v1 access claims before the transformer;
  - threads one permit into the transformer callback and retains cleanup-only execution/journal semantics;
  - preserves v0 by running only its pure prefix transform during preparation.
- `apps/web/src/services/storage/__tests__/browser-project-store-topology.test.ts`
  - pins source freezing without cleanup widening and the live-media timeline-alias rejection.
- `apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts`
  - adds genuine v1 call-order/protected-alias coverage and a positive safe v1 migration.
- `apps/web/src/services/storage/browser-project-store-migration-round2-probes.ts`
  - replaces the former v30 control with a real v1 protected-library/timeline alias;
  - instruments the exact target's `IDBFactory.open` during migration and restores the prototype in `finally`;
  - snapshots target DB version/stores/sentinel bytes and same-identity DB/OPFS inventories before/after refusal.

Key final locations are migration preparation/source derivation around lines 350-413 and 582-655, topology source policy around lines 393-531, unit behavior around lines 251-326 and 341-407, and Chromium access proof around lines 232-359.

## RED evidence

All commands ran from the C5 worktree root. The first unit invocation exposed a test-double wiring error because the initial `indexeddb-adapter` mock omitted the module's `deleteDatabase` export; that setup error was corrected before counting the behavioral RED.

```text
bun test apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts
```

- Valid behavioral RED: exit 1, `7 pass / 2 fail / 34 expectations`.
- Protected v1 failure inserted the exact call
  `legacy-get:video-editor-timelines-...-protected-scene/timeline`
  before `current-media`, `read-known-media`, and `read-known-libraries`.
- Positive v1 failure showed the same inverted order: the first legacy read index was 2 while strict library authorization appeared at index 6.

```text
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts browser-store.pw.ts
```

- Port 4175 was clear before the run.
- Exit 1, `1 failed`, test body 15.9s, command 29.3s.
- Exact result: `topologyMigrationPlanningPreauthorizesAttachmentDiscovery: false`.
- The field was false because the real v1 transformer called `IDBFactory.open` for the protected timeline/library alias before the later topology refusal.

## GREEN evidence

### Isolated topology units

Each file ran in its own Bun process on the final tree:

| File | Result |
| --- | --- |
| `browser-project-store-topology.test.ts` | 12/12, 61 expectations |
| `browser-project-store-media-topology.test.ts` | 7/7, 74 expectations |
| `browser-project-store-cascade-topology.test.ts` | 7/7, 48 expectations |
| `browser-project-store-migration-topology.test.ts` | 9/9, 37 expectations |

Total: `35/35`, 220 expectations.

The migration unit proves both sides of the seam:

- a protected v1 timeline/library alias rejects before any `legacy-get`, owner/stage/journal write, row delete, or database delete;
- a topology-safe v1 project migrates and its first legacy read occurs only after strict known-library authorization.

### Real Chromium

```text
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts browser-store.pw.ts
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts
```

- Focused GREEN on the final product tree: 1/1, test 18.1s, suite 33.7s, command 42.6s.
- Full C5 GREEN on the final product tree: 3/3 in 38.4s (command 43.7s): browser store 15.6s, C4 forced-none 13.8s, migration round 1 2.8s.
- Browser/Chrome: 151.0.7922.34; protocol 1.3; revision `@782af9cb30a53f54487e5d2e44738645a8ec457c`; JS 15.1.206.8.
- Shared store matrix: 19 passed, 0 failed, 0 skipped.
- Existing positive real-v1 regression: `migration.legacySuccess: true`; private fields, legacy tracks/media, attachment bytes, cleanup, and reopen remained green.
- Migration round 2: 20 boolean fields, all true; 16 lifecycle races, 0 failures.
- Cascade round 2: 33 boolean fields, all true.
- The new v1 probe required `legacyTargetOpenCount === 0`, unchanged DB version and sorted store list, identical sentinel bytes `[41,42,43,44]`, identical same-identity database and OPFS-root inventories, no project-timeline/legacy-media/stage database creation, and no current media directory creation.
- Focused and full browser harness inventories both ended at `{ databases: [], directories: [] }`.

### Type, architecture, negative, format, and planning gates

- `bun x tsc --noEmit -p apps/vite-example/tsconfig.json`: exit 0 on the final product tree.
- `node script/check-type-baseline.mjs`: exit 0; exactly 3 current diagnostics versus 13 at pin `cf5e79e9`; no diagnostic outside the pinned baseline.
- `node script/check-port-boundary.mjs`: exit 0; 30 contract modules.
- `node script/check-session-state-boundary.mjs`: exit 0; 10/10 factories, 10/10 registry keys, 52 classified imperative modules.
- `node script/check-storage-boundary.mjs`: exit 0; 723 production modules plus 3 exact fixtures; 0 singleton imports/exports, 0 adapter references, 0 unexpected mechanism hits, 46 allowed storage-boundary hits, 8 exact-fixture hits, 0 unclassified persistence-localStorage files.
- `node script/check-host-composition.mjs`: exit 0; 2 Host roots and 720 production modules.
- Port/session/Host `--negative-control`: exit 0; every rule proved able to fail.
- `bun test script/__tests__/c5-storage-boundary-red.test.mjs`: 19/19, 37 expectations.
- Touched ESLint: the first run found one unsafe generic assertion in the unit mock; it was removed. Final exit 0, no errors. The repository's known missing-pages-directory message remained informational.
- Touched Prettier final check: all five files matched.
- `git diff --check`: exit 0 with only existing line-ending warnings. The five attempt-4 files are still untracked in the overall C5 worktree, so touched-file Prettier/ESLint and the isolated compilers/tests are the direct whitespace/syntax checks for them.
- `rasen validate s02-storage-port --project rocut --strict`: exit 0, change valid.

## Cleanup and identity proof

- HEAD remained `0ef35459f685d5d41a25d0ef959aff691b7519cd`; HEAD tree remained `286272307b05d23826ffa7223a76695365194dba`.
- The Chromium probe used a randomized `c5-migration-r2-*` disposable identity. It deleted only the exact generated projects, timeline, legacy-media, two stage database names, and exact media directory recorded in its cleanup proof.
- The instrumented `IDBFactory.prototype.open` was restored in the probe's inner `finally`, including failure paths.
- The exact Playwright `.last-run.json` artifact was removed after result extraction.
- Final ports 4175 and 4177: no listeners.
- Final task-owned Bun/Node/Vite/Playwright/Chrome process count: 0.
- Final Playwright task-output file count: 0.
- No user Chrome/profile or production database identity was opened or targeted for cleanup.

## Residual risks and reviewer focus

1. The source policy deliberately models the current historical v1 accessors: per-scene/project timeline databases and deterministic legacy media metadata. A future migration that adds another storage-bearing accessor must add a new exact source claim or it will fail closed before access.
2. The same-project legacy-media/current-media database exception is intentional and required by the production v1 layout. It is restricted to `legacy-media`, the same project ID, and the exact current media fingerprint; timeline, cross-project, and different retained-binding aliases are rejected.
3. The pure v0 prefix preparation is a narrow compatibility bridge for its generated scene ID. It invokes no storage API and still subjects every subsequent v1 source to the same frozen permit.

This fixer does not self-certify the finding as closed. `C5-S4-M1` now has GREEN author evidence and awaits independent non-author review.
