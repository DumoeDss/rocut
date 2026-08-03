# S02 C5 strategy attempt 4 — independent review

**Mode:** dispatched, report-only, non-author review  
**Frozen base:** `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
**Frozen tree:** `286272307b05d23826ffa7223a76695365194dba`  
**Verdict:** **FINDINGS**

| Severity | Count |
|---|---:|
| Blocker | 0 |
| Major | 2 |
| Minor | 0 |
| Trivial | 0 |

Scope check: the reviewed C5 files implement the requested browser persistence topology/cleanup boundary. Much of the implementation is untracked, so this review inspected the actual files and `git ls-files --others --exclude-standard`, not only `git diff`.

## Findings

### [Major] Ordinary media access omits current/retained library claims

**Root cause:** `apps/web/src/services/storage/browser-project-store-media-ownership.ts:910-923` builds every `media-access` request with `knownLibraries: []`. The affected callers include first registration at `:106-134` (the first check also has `knownMedia: []`) and refresh checks at `:333-349` and `:398-413`. The implementation never calls the available strict reader `readKnownLibraryPhysicalClaims` (`browser-project-store-library-clear-bindings.ts:199-240`) on these ordinary media paths.

**Impact:** after a library configuration change, a retained library can still own `(oldLDB, oldLS)` while the current library uses a different database. A current media derivation can use `MDB(project) = oldLDB` and receive a permit because the retained library claim is absent. List/load then open that MDB at `browser-project-store.ts:513-535` and `:609-632`; save proceeds from registration to media commit at `:693-702`. Same-database/different-store is an unapproved whole-database ownership overlap, and the same pair can collide with or overwrite retained library rows.

**Focused reproduction:** an inline Bun policy check used a disposable identity whose current library DB differed from a retained old LDB, then authorized the same media claim twice. With the production wiring's empty library list, authorization returned `{"permit":"media-access"}`. With the retained claim included, it threw `BrowserStorageTopologyConflict` with reason `ambiguous-physical-owner`. This proves the omitted claim changes the decision; the topology primitive itself is correct (`browser-project-store-topology.ts:242-253`, especially `:245`).

**Fix direction:** before the first media authorization or any ownership/media descriptor, IndexedDB, or OPFS access, load the strict current-plus-retained library claims and pass them to every first-access and refresh authorization. Add negative coverage for retained old-LDB exact-pair and same-DB/different-store aliases, plus a collision-free control.

**Accepted finding:** `C5-S4-M2` is **not closed**.

### [Major] Migration attachment discovery opens/upgrades protected IndexedDB before topology authorization

**Root cause:** `runBrowserProjectMigration` calls `stageLegacyAttachments` at `apps/web/src/services/storage/browser-project-store-migration.ts:336-339`; it does not call `authorizeMigrationCleanup` until `:369-380`. The staging function derives the current media database and calls `idbGetAll` at `:507-520`, and can read OPFS at `:531-542`. The real `idbGetAll` enters `openDatabaseStores` (`browser-storage-mechanisms.ts:141-155`). That helper opens a named database at `:42-48`; a nonexistent database is created during the initial open, and a missing store causes a version increment/reopen at `:71-85`, with `createObjectStore` executed at `:49-54`. Therefore this nominal read can perform persistent database/schema mutation before the full permit is requested. The later authorization does load known media and current/retained library claims (`browser-project-store-migration.ts:768-804`), but it is too late to protect discovery.

**Impact:** a legacy project's derived MDB can alias PDB, current/retained LDB, SP, SA, or another protected live database. Migration eventually refuses the topology, but only after it may have created the aliased database or added `mediaStore` and incremented its schema version. This violates the fail-closed rule that refusal precede descriptor, metadata, IndexedDB, OPFS, or mutation access.

**Focused evidence:** the executable call order above is decisive and the production IndexedDB helper explicitly performs the mutation. A randomized, headless Playwright/Chromium reproduction was attempted against a task-owned Vite server on port 4177. The browser run did not return before the review deadline and was terminated without a result assertion; the exact task-owned listener (PID 61056) was stopped and port 4177 was verified clear. No user browser/profile/database was used. The failed browser attempt is not counted as proof; the finding rests on the direct product-code execution path and mandatory IndexedDB open/upgrade semantics implemented by this repository.

**Fix direction:** split migration planning into a pure derivation phase. Derive all candidate current media physical claims and cleanup targets, load strict known media/library claims, and obtain one full migration permit before `stageLegacyAttachments` performs any IndexedDB or OPFS access. Execute only the frozen permit-authorized targets. Add real Chromium coverage asserting that an aliased protected DB retains its original version/store list and that no new DB/directory is created when authorization refuses.

**Accepted finding:** `C5-S4-M1` is **not closed**. The cleanup/delete and retry loops may be permit-gated, but pre-permit discovery still crosses and mutates the same protected boundary.

## Accepted-finding closure analysis

- `C5-S4-B1` — **no bypass found in code inspection, but formal closure not independently asserted in this expedited report.** Current project removal obtains a full permit before writing its tombstone (`browser-project-store-cascade-manager.ts:213-240`); current clear obtains the permit before journal/logical commit (`:291-359`); historical cleanup preflights before its physical loops (`:392-406`); and database/directory/library mutation loops consume permit targets (`:413-440`). `authorizeCleanup` includes strict known media and library claims (`:586-609`). The requested independent topology/unit/Chromium gates were not run after the two blocking Major findings were confirmed, so this report does not provide the command evidence required to declare the previously accepted Blocker closed.
- `C5-S4-M1` — **open**, retained by the preauthorization migration-discovery finding above.
- `C5-S4-M2` — **open**, retained by the omitted current/retained library claims on ordinary media access.

## Enum, union, bypass, and result-shape review

- The topology request union includes `knownLibraries` for `media-access`, `cascade-cleanup`, and `migration-cleanup` (`browser-project-store-topology.ts:43-67`); the defect is wiring, not a missing union member.
- Conflict reasons remain the three-value union `reserved-store-pair | protected-database | ambiguous-physical-owner` (`browser-project-store-topology.ts:93-96`). The focused A reproduction exercised `ambiguous-physical-owner`.
- Physical cascade deletion/clear sites inspected are downstream of permit acquisition as cited above. The migration discovery bypass is the uncovered pre-permit physical-access site.
- No additional exact-three public result-shape defect was established in the continuation review.

## Coverage

```text
CODE PATH COVERAGE
==================
[GAP → Major] ordinary media first access vs retained library LDB alias
              production wiring passes [] and the focused policy repro proves permit/refusal divergence
[GAP → Major] migration discovery refusal before real IndexedDB open/upgrade
              production ordering proves access is early; real Chromium no-mutation regression is missing
[INSPECTED]   current/historical cascade deletion consumes authorized permit targets

USER FLOW COVERAGE
==================
[GAP → E2E] load/list/save attachment after library reconfiguration retaining old LDB
[GAP → E2E] migrate legacy project whose derived MDB aliases a protected live DB
```

These gaps are part of the two findings above and are not double-counted.

## Commands and gates

| Check | Result |
|---|---|
| `git rev-parse HEAD` | PASS — `0ef35459f685d5d41a25d0ef959aff691b7519cd` |
| `git rev-parse 'HEAD^{tree}'` | PASS — `286272307b05d23826ffa7223a76695365194dba` |
| `git status --short` and untracked-file enumeration | PASS — actual tracked/untracked C5 scope inspected |
| Focused A inline Bun topology reproduction | PASS — omitted libraries permitted; retained claim refused with `ambiguous-physical-owner` |
| Disposable Chromium B attempt | INCONCLUSIVE — timed out/non-returning; task-owned server stopped, port clear |
| Four isolated topology unit files | NOT RUN — review stopped after two confirmed Major findings at LEAD direction |
| Focused/full C5 Playwright suites | NOT RUN — same |
| Targeted TypeScript/exact-three/boundary/static checks | NOT RUN — same |

No PR exists; Greptile was skipped. No product code, tests, tasks, run state, or prior evidence were modified.

## Standards and spec axes

- **Standards:** 2 Major correctness/data-boundary findings; worst is preauthorization IndexedDB/schema access.
- **Spec:** 2 Major failures of the attempt-4 requirement that every known current/retained physical claim be authorized before media or migration storage access.

**Final verdict: FINDINGS — 0 Blocker, 2 Major, 0 Minor, 0 Trivial.**

---

## Post-fix independent re-review — strategy attempt 4

**Date:** 2026-08-02  
**Mode:** dispatched, report-only, non-author re-review  
**Frozen base / worktree HEAD:** `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
**Post-fix verdict (supersedes the pre-fix count above):** **FINDINGS**

| Severity | Count |
|---|---:|
| Blocker | 0 |
| Major | 1 |
| Minor | 0 |
| Trivial | 0 |

### Prior-findings disposition

| Finding | Post-fix status | Independent disposition |
|---|---|---|
| `C5-S4-M2` | **CLOSED** | Ordinary registration and refresh now obtain one strict frozen current-plus-retained library-claim snapshot and reuse it across initial authorization, strict ownership state, inventory discovery, and legacy backfill. Retained library exact-database aliases (same or different store) reject as generic `unavailable` without physical names; a safe retained library, same-owner exact retry, and `LDB === PDB` with a distinct non-reserved store remain green. |
| `C5-S4-M1` | **OPEN — Major** | The narrow pre-permit `stageLegacyAttachments` defect is fixed, but the migration's named “planning” phase is still not pure: v1→v2 transformation performs legacy attachment/timeline IndexedDB access before legacy targets are derived/frozen and before the complete migration permit. |
| `C5-S4-B1` | **CLOSED** | Current remove and projects/all clear authorize before logical commit; historical journals receive one full permit before any physical loop or legacy-journal rewrite; execution iterates the permit's frozen targets. Protected PDB/LDB/SP/SA, retained-library, valid shared-PDB library, and mixed-batch zero-mutation cases are green in isolated units and real Chromium. |

### [Major] v1 migration transformation still opens legacy IndexedDB before planning authorization

`runBrowserProjectMigration` invokes `transformLegacyProject` while `phase = "planning"` (`apps/web/src/services/storage/browser-project-store-migration.ts:332`). Only after that awaited call returns does it derive the v1 timeline cleanup targets (`:357`), read the historical cleanup journal (`:387`), and obtain the complete migration permit (`:391`). For v1 input, the awaited transformation enters `loadV1ToV2Context` (`apps/web/src/services/storage/migrations/v1-to-v2.ts:25-50`), opens the per-scene and project timeline databases through `IndexedDBAdapter` (`:108-146`), and can open the legacy media-metadata database (`:176-184`). `IndexedDBAdapter.getDB` calls `indexedDB.open` and creates the requested object store during `onupgradeneeded` (`apps/web/src/services/storage/indexeddb-adapter.ts:24-32`). Thus a nominal planning read can create a database/store or touch a protected alias before topology authorization.

The added unit and Chromium preauthorization regressions do not cover this call chain: both seed schema version 30 (`apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts:164-183`; `apps/web/src/services/storage/browser-project-store-migration-round2-probes.ts:261,1507-1526`), so they skip the I/O-bearing v1→v2 transformer. They prove that current-media attachment discovery is gated, but not that the complete migration planning phase is pure.

**Impact:** a v1 legacy timeline/media name that aliases PDB, current/retained LDB/MDB, or another protected database is accessed before the batch refusal. Because the adapter's read path can create storage, migration can reject later with protected storage already opened or schema-mutated, contrary to the required zero-access/zero-mutation boundary.

**Fix direction:** split migration preparation into a genuinely pure target plan before invoking any I/O-bearing migration step. Derive and freeze every candidate's current media claim, both canonical stage targets, every v1 timeline/legacy access-cleanup target, and existing historical cleanup targets from raw input; load strict current/retained claims; authorize the complete frozen batch; only then load legacy timeline/media context, transform, discover current attachments, stage, and execute the permit. Add a v1 unit call-order regression and a real-Chromium protected-alias test that snapshots version, stores, bytes, and same-prefix DB/root inventories before and after refusal.

### Independent command evidence

| Command/check | Result |
|---|---|
| `git rev-parse HEAD` | PASS — `0ef35459f685d5d41a25d0ef959aff691b7519cd` |
| `bun test apps/web/src/services/storage/__tests__/browser-project-store-topology.test.ts` | PASS — 9/9, 53 expectations |
| `bun test apps/web/src/services/storage/__tests__/browser-project-store-media-topology.test.ts` | PASS — 7/7, 74 expectations |
| `bun test apps/web/src/services/storage/__tests__/browser-project-store-cascade-topology.test.ts` | PASS — 7/7, 48 expectations |
| `bun test apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts` | PASS — 8/8, 34 expectations |
| Port 4175 listener check before focused browser | PASS — clear |
| `bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts browser-store.pw.ts` | PASS — 1/1 in 22.0s (test 15.6s); store matrix 19 passed / 0 failed / 0 skipped; all 20 migration and all 33 cascade boolean fields true; lifecycle races 16 with 0 failures; before/after inventories both `{ databases: [], directories: [] }`; Chromium/Chrome `151.0.7922.34`, protocol 1.3 |
| Port 4175 listener check after focused browser | PASS — clear |
| Full C5 Playwright | NOT RUN — LEAD accepted the residual Major from the exact v1 call chain and directed a concise blocking report rather than delaying for redundant broad reruns |
| Targeted TypeScript / exact-three / positive boundary tail | NOT RUN — same blocking-finding direction; the four isolated topology processes and focused full browser-store matrix are the independent executed gates |

No PR exists; Greptile was skipped. No product code, tests, tasks, run state, planning artifact, or prior `## Findings` text was edited. The exact task-owned Playwright `.last-run.json` artifact was removed after result extraction; port 4175 was clear.

### Formal closure status

- `C5-S4-B1`: **CLOSED** — independent code and command evidence covers current remove/clear, historical preflight, frozen-permit execution, protected databases/library, valid shared-PDB library, and mixed-batch zero mutation.
- `C5-S4-M1`: **OPEN (Major)** — current attachment discovery is now preauthorized, but v1 transformation still performs mutation-capable IndexedDB access before complete target derivation/freezing/authorization.
- `C5-S4-M2`: **CLOSED** — the strict immutable library snapshot is threaded through all ordinary media authorization paths and the required negative/positive boundaries pass without physical-name leakage.

**Post-fix final verdict: FINDINGS — 0 Blocker, 1 Major, 0 Minor, 0 Trivial.**

## Second post-fix independent re-review - v1 transformer preauthorization

**Date:** 2026-08-02  
**Mode:** dispatched, report-only, fresh non-author reviewer  
**Frozen base / worktree HEAD:** `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
**HEAD tree:** `286272307b05d23826ffa7223a76695365194dba`  
**Verdict:** **CLEAN**

| Severity | Count |
|---|---:|
| Blocker | 0 |
| Major | 0 |
| Minor | 0 |
| Trivial | 0 |

No PR exists for this review branch, so Greptile was unavailable and skipped.

### Primary finding disposition

| Finding | Status | Independent disposition |
|---|---|---|
| `C5-S4-M1` | **CLOSED** | Schema-v1 and schema-v0 preparation now derive and freeze the complete possible source/current-media/stage/historical-cleanup plan before the first I/O-bearing transformer step. The one migration authorization reads current/retained media once and current/retained libraries once, and every transformer target must match the frozen source permit. Source-read authority is kept separate from cleanup authority, so the conservative legacy-media source is not journaled or deleted. |
| `C5-S4-B1` | **CLOSED - re-confirmed** | The source-permit addition is confined to migration authorization. Isolated cascade tests and the complete Chromium C5 matrix still prove current remove/clear precommit refusal, historical all-target preflight, frozen-permit execution, shared-PDB safe library behavior, and mixed-batch zero mutation. |
| `C5-S4-M2` | **CLOSED - re-confirmed** | Ordinary media registration still reads one strict current-plus-retained library snapshot and threads it through both initial and complete ownership authorization. The isolated media suite and all 33 Chromium cascade fields remain green. |

### Independent call-order and authority audit

- `runBrowserProjectMigration` performs the pure v0 prefix transform and derives v1 source claims at `browser-project-store-migration.ts:350-377`, reads the historical journal, and obtains the complete permit at `:400-416`; only afterwards does it enter `transformLegacyProject` at `:420-428`.
- Schema v1 source derivation includes every scene timeline database, the project timeline database, and the deterministic legacy-media database (`browser-project-store-migration.ts:595-641`). Schema v0 calls the additive, storage-free v0-to-v1 transformer exactly once, keeps the generated scene identity, and then uses the same v1 source planner (`:583-593`). No historical migration file was rewritten.
- Every actual migration accessor calls `assertLegacySourceAuthorized`; it must match permit source kind, project ID, and database before `IndexedDBAdapter` construction/access (`browser-project-store-migration.ts:546-575,643-663`). The v1 migration wrapper itself calls the assertion before constructing either timeline or media adapter (`migrations/v1-to-v2.ts:119-145,170-184`).
- Topology validation rejects sources that collide with projects/stages/current or retained libraries, rejects timeline/current-media collisions, and allows legacy-media/current-media sharing only for the same project and exact current media fingerprint (`browser-project-store-topology.ts:489-541`). Cross-project and different retained-binding aliases fail closed.
- Cleanup and source authority are distinct frozen arrays (`browser-project-store-topology.ts:477-485`). Recovery journals, cleanup journals, early stage cleanup, and retry deletion consume only `permit.databases` through `cleanupTargetsFromPermit` or a stage-only database filter (`browser-project-store-migration.ts:1003-1015,1047-1067,1632-1689,1814-1822`). They never consume `permit.sources`; authorizing `video-editor-media-${projectId}` for transformer reads cannot add it to delete/journal authority.
- The same-project legacy/current media exception remains usable: the positive genuine-v1 unit migration and existing real-browser `migration.legacySuccess` both pass. The policy rejects a legacy-media alias lacking the exact same current fingerprint and rejects all timeline, cross-project, retained-library, and different retained-media binding aliases.

### Independent command evidence

| Command/check | Result |
|---|---|
| `bun test apps/web/src/services/storage/__tests__/browser-project-store-topology.test.ts` | PASS - 12/12, 61 expectations |
| `bun test apps/web/src/services/storage/__tests__/browser-project-store-media-topology.test.ts` | PASS - 7/7, 74 expectations |
| `bun test apps/web/src/services/storage/__tests__/browser-project-store-cascade-topology.test.ts` | PASS - 7/7, 48 expectations |
| `bun test apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts` | PASS - 9/9, 37 expectations; genuine-v1 protected refusal precedes all legacy reads/mutations and topology-safe v1 migration succeeds after authorization |
| Four topology files, separate Bun processes | PASS - 35/35, 220 expectations |
| `bun test apps/web/src/services/storage/migrations/__tests__/v0-to-v1.test.ts` | PASS - 10/10, 22 expectations; additive pure prefix transformer and property preservation remain green |
| Port 4175/4177 checks before browser execution | PASS - both clear |
| `bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts browser-store.pw.ts` | PASS - 1/1; test 16.6s, suite 24.2s, command 26.4s |
| Focused real-Chromium v1 proof | PASS - `topologyMigrationPlanningPreauthorizesAttachmentDiscovery=true`; exact protected target `IDBFactory.open` count 0 during migration; unchanged DB version/store list and sentinel bytes `[41,42,43,44]`; unchanged same-identity DB/OPFS inventories; no project-timeline, legacy-media, stage DB, or current media root created |
| Focused store/migration/cascade matrix | PASS - shared store 19/19 with 0 failed/0 skipped; all 20 migration and all 33 cascade booleans true; lifecycle races 16 with 0 failures; inventories before/after both `{ databases: [], directories: [] }` |
| `bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts` | PASS - 3/3; browser store 14.7s, C4 forced-none 10.9s, migration round 1 3.0s; suite 34.6s, command 36.5s |
| Browser identity | Chromium/Chrome `151.0.7922.34`, protocol 1.3, revision `@782af9cb30a53f54487e5d2e44738645a8ec457c`, JS `15.1.206.8` |
| `bun x tsc --noEmit -p apps/vite-example/tsconfig.json` | PASS - exit 0 |
| `node script/check-type-baseline.mjs` | PASS - exactly 3 current diagnostics versus 13 at pin `cf5e79e9`; no diagnostic outside the pinned baseline |
| `node script/check-port-boundary.mjs` | PASS - 30 contract modules |
| `node script/check-session-state-boundary.mjs` | PASS - 10/10 factories, 10/10 registry keys, 52 classified imperative modules |
| `node script/check-storage-boundary.mjs` | PASS - 723 production/fixture modules, 0 singleton imports/exports, 0 adapter references, 0 unexpected mechanism hits, 46 allowed storage-boundary hits, 8 exact-fixture hits, 0 unclassified durable local-storage files |
| `node script/check-host-composition.mjs` | PASS - 2 Host roots and 720 production modules |
| Port/session/Host `--negative-control` | PASS - every rule proved able to fail without firing indiscriminately |
| `bun test script/__tests__/c5-storage-boundary-red.test.mjs` | PASS - 19/19, 37 expectations |
| Targeted ESLint | PASS - exit 0; only the repository-known missing-pages-directory informational message |
| Targeted Prettier | PASS - all five residual-fix product/test files matched |
| `git diff --check` | PASS - exit 0; only existing LF-to-CRLF warnings |
| `rasen validate s02-storage-port --project rocut --strict` | PASS - change valid |

### Coverage and scope check

Code-path coverage is complete for the residual finding:

```text
raw v1 -> derive timeline/project/legacy-media sources -> full permit -> transformer access checks -> migration GREEN
       -> protected library/media/stage alias -> full permit refusal -> zero source open/mutation GREEN
raw v0 -> pure additive v0-to-v1 prefix -> frozen generated scene identity -> same v1 source planner
permit.sources -> transformer read authority only
permit.databases -> recovery/cleanup journal + physical delete authority only
```

The change remains inside C5's private browser-storage topology boundary. No public `ProjectStore` shape, session API, Rust/WASM surface, C6 disposal behavior, C7 headless behavior, or E1 feature behavior is introduced by the residual fix. The required product/planning delta and the observed implementation agree; no scope drift or missing residual requirement was found.

### Cleanup proof

- Focused and full Playwright used randomized `c5-*` disposable identities and reported empty before/after C5 database and directory inventories.
- The test-owned `.last-run.json` was removed; final `.pw-output-c5-storage` file count is 0.
- Final ports 4175 and 4177 are clear; final task-owned Bun/Node/Chrome process count is 0.
- No user Chrome/profile or production storage identity was opened or targeted for cleanup.
- This reviewer changed no product code, tests, tasks, run state, proposal, design, or specs; only this dated canonical review section was appended.

### Formal final status

- `C5-S4-M1`: **CLOSED**.
- `C5-S4-B1`: **CLOSED, re-confirmed**.
- `C5-S4-M2`: **CLOSED, re-confirmed**.

**Second post-fix final verdict: CLEAN - 0 Blocker, 0 Major, 0 Minor, 0 Trivial.**
