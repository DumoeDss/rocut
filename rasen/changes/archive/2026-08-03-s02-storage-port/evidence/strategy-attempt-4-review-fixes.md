# Strategy attempt 4 independent-review fixes

Date: 2026-08-02  
Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`  
Change: `s02-storage-port`  
Scope: only accepted findings `C5-S4-M2` (ordinary media authorization) and `C5-S4-M1` (migration preauthorization)

## Outcome and review status

Both accepted Major fix deltas are implemented and the focused plus required tail gates below are GREEN. This fixer does **not** self-certify CLEAN; independent non-author review remains the closure authority. No task checkbox, run state, proposal, design, spec, canonical review report, or commit was changed.

The frozen product identity remained:

- HEAD `0ef35459f685d5d41a25d0ef959aff691b7519cd`
- HEAD tree `286272307b05d23826ffa7223a76695365194dba`
- merge base `4c54b2fd332809c31cc12666010af9afc35b4732`

## Fix files

- `apps/web/src/services/storage/browser-project-store-media-ownership.ts`
- `apps/web/src/services/storage/__tests__/browser-project-store-media-topology.test.ts`
- `apps/web/src/services/storage/browser-project-store-migration.ts`
- `apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts`
- `apps/web/src/services/storage/browser-project-store-migration-round2-probes.ts`
- `apps/vite-example/src/c5-storage-harness.ts`
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts`

## C5-S4-M2 - ordinary media authorization

`registerMediaOwner` now obtains one strict current-plus-retained library-claim snapshot with `readKnownLibraryPhysicalClaims` before its first candidate authorization or media-ownership read. It reuses that immutable snapshot for the initial candidate check and the complete known-media check.

`refreshMediaOwnership` likewise reads exactly one library snapshot before its first ownership read, threads it through existing-known and inventory-discovered media authorization, and passes the same snapshot through legacy ownership backfill. No mid-operation library reread is performed.

Topology conflicts still become the mechanism-neutral `ProjectStoreError` code `unavailable`; focused negative assertions reject physical database/store names in the surfaced error. The valid `libraryDatabase === projectsDatabase` with a distinct non-reserved store remains covered by the pure topology and Chromium cascade result surfaces.

Focused media coverage now includes:

- retained old-library database with the exact media store name;
- retained old-library database with a distinct library store (same database/different store);
- safe nonalias retained library plus exact same-owner media registration retry;
- protected databases, persisted cross-owner database/root aliases, and inventory refresh controls.

The existing call expectations intentionally changed because a strict library-claim read is now a required authorization input, not optional I/O. Each top-level tested operation asserts one `idbGetAllLibrary`, never repeated.

## C5-S4-M1 - migration preauthorization

`runBrowserProjectMigration` now has a plan-before-discovery split:

1. decode and transform every candidate in memory;
2. derive and freeze each project identity, current media physical claim/store, legacy cleanup targets, and both canonical stage targets;
3. read the existing cleanup journal plus strict current/retained media and library claims;
4. authorize one complete migration-cleanup batch;
5. only then call `stageLegacyAttachments`, using the frozen media database/directory/store plan;
6. retain the existing all-project attachment discovery, owner registration, stage validation, recovery intent, commit/readback, and cleanup ordering.

The new unit regression asserts the exact call order. For an MDB aliased by a retained LDB, planning reads the project/current-media claim and strict known claims, then rejects with no attachment MDB read, OPFS read, owner registration, stage/journal put, row delete, or database delete.

The real Chromium result field `topologyMigrationPlanningPreauthorizesAttachmentDiscovery` uses a randomized disposable identity whose derived MDB equals its protected projects database. Before migration it snapshots the database version, sorted store list, and four sentinel bytes. Refusal must keep all three byte/exact values unchanged, keep the full same-prefix database and root-directory inventories unchanged, add no media store, create neither stage database nor media directory, and expose only the generic nonretryable `unavailable` topology diagnostic. Every generated database and exact root directory is cleaned in `finally`.

The retained lifecycle fields confirm later-write-wins and recovery semantics remain green (`staged/original` save/remove winners, physical-absence/digest recovery retention, cleanup recovery, and 16/16 wrapper/mutation races). The historical mixed cleanup field still proves zero partial cleanup.

## RED evidence

All commands ran from the C5 worktree root, each Bun topology file in its own process.

```text
bun test apps/web/src/services/storage/__tests__/browser-project-store-media-topology.test.ts
```

- Exit 1: `0 pass / 7 fail / 24 expectations`.
- The retained-library alias case returned no error, and every expected strict library snapshot was absent.

```text
bun test apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts
```

- Exit 1: `7 pass / 1 fail / 31 expectations`.
- Exact failing access: `read-all:migration-media-migration-topology-test-preauthorization/media` occurred before `read-known-media`, `current-media:*`, and `read-known-libraries` completed the permit.

```text
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts browser-store.pw.ts
```

- Exit 1: `1 failed`; test body 15.7s, command 27.5s.
- Exact field: `topologyMigrationPlanningPreauthorizesAttachmentDiscovery: false`.
- Port 4175 was clear before and after; the task-owned server/browser stopped normally.

## GREEN evidence

### Focused units and four-file isolation

```text
bun test apps/web/src/services/storage/__tests__/browser-project-store-media-topology.test.ts
bun test apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts
```

- Media: `7 pass / 0 fail / 74 expectations`.
- Migration: `8 pass / 0 fail / 34 expectations`.

Final isolated four-process results:

| File | Result |
| --- | --- |
| `browser-project-store-topology.test.ts` | 9/9, 53 expectations |
| `browser-project-store-media-topology.test.ts` | 7/7, 74 expectations |
| `browser-project-store-cascade-topology.test.ts` | 7/7, 48 expectations |
| `browser-project-store-migration-topology.test.ts` | 8/8, 34 expectations |

Total: `31/31`, 209 expectations. One intermediate rerun encountered a Bun 1.2.2 process segmentation fault before emitting test results; an immediate clean-process rerun and the final isolated run both passed 8/8, so it is recorded as runner instability rather than a test RED.

### Real browser

```text
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts browser-store.pw.ts
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts
```

- First GREEN focused run: 1/1, test 18.7s, suite 25.5s.
- Final-tree focused rerun: 1/1, test 12.3s, suite 18.7s.
- Full C5: 3/3 in 35.9s; browser store 14.1s, C4 forced-none 11.0s, migration round 1 4.0s.
- Shared store matrix: 19 passed, 0 failed, 0 skipped.
- Migration round 2: 20 boolean fields, all true; lifecycle race count 16, failures 0.
- Cascade round 2: 33 boolean fields, all true.
- Focused and full harness inventories: before `{ databases: [], directories: [] }`; after `{ databases: [], directories: [] }`.
- Chromium/Playwright browser `151.0.7922.34`; CDP product `Chrome/151.0.7922.34`, protocol 1.3, revision `@782af9cb30a53f54487e5d2e44738645a8ec457c`, JS `15.1.206.8`.

### Type, boundaries, negative controls, formatting, and validation

- `bun x tsc --noEmit -p apps/vite-example/tsconfig.json`: exit 0 (final-tree rerun).
- `node script/check-type-baseline.mjs`: exit 0, exactly 3 current diagnostics versus 13 at pin `cf5e79e9`; no diagnostic outside the pinned set.
- `node script/check-port-boundary.mjs`: exit 0, 30 contract modules.
- `node script/check-session-state-boundary.mjs`: exit 0, 10/10 factories, 10/10 registry keys, 52 classified imperative modules.
- `node script/check-storage-boundary.mjs`: exit 0, 723 production modules plus 3 exact fixtures; 0 direct singleton imports/exports, 0 adapter references, 0 unexpected mechanism hits, 44 allowed boundary hits, 8 exact-fixture hits, 0 unclassified durable local-storage files.
- `node script/check-host-composition.mjs`: exit 0, 2 Host roots and 720 production modules.
- Port/session/Host `--negative-control` runs: exit 0; every rule proved able to fail.
- `bun test script/__tests__/c5-storage-boundary-red.test.mjs`: 19/19, 37 expectations.
- Touched ESLint: exit 0, 0 errors; the two Vite-example files retain the known no-matching-config warnings.
- Touched Prettier final check: all seven files matched.
- `git diff --check`: exit 0; only pre-existing LF-to-CRLF notices.
- `rasen validate s02-storage-port --project rocut --strict`: exit 0, change valid.

## Cleanup

- Browser fixtures used randomized `c5-*` identities; external legacy databases and the new protected-alias database/stage names were deleted only by exact generated names, and the exact generated media root was removed in `finally`.
- No user Chrome/profile, production identity, or broad persisted-storage namespace was read for cleanup or deletion.
- The exact Playwright `.last-run.json` artifact was removed after result extraction; no temporary TypeScript config or test log remains.
- Final task-owned Bun/Node/Chromium process count: 0.
- Final listener checks: ports 4175 and 4177 clear.

## Durable findings

1. A media authorization snapshot is complete only when it contains both current and retained library database claims; library ownership is an exact pair, but media cleanup owns the whole database.
2. A nominal IndexedDB read can create a database or upgrade its schema, so migration discovery is mutation-capable and must occur only after the whole-batch topology permit.
3. Freezing physical claims before discovery prevents authorization/execution drift while preserving canonical stage targets, historical cleanup authority, and later-write-wins recovery behavior.
