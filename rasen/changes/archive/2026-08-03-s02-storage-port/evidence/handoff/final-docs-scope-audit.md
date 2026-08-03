# C5 final documentation and scope audit

Date: 2026-08-02  
Audited worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`  
Planning root: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut\rasen\changes\s02-storage-port`  
Base commit: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
Mode: read-only final documentation/scope audit. No product, test, documentation, task,
run-state, or existing-evidence file was edited; no build, browser run, full test, cleanup,
or commit was performed.

## Verdict

- Current status snapshot: **116 paths** = 52 tracked status entries (51 `M`, 1 `D`) plus
  64 untracked paths.
- **Unexplained paths: 0.** Every path is mapped below to an intended C5 task/write-set
  group. Two protected session files are status/stat anomalies rather than content changes.
- **Forbidden-scope incursions: 0.** No C6 five-resource/shared-GPU implementation, C7
  emitted-headless implementation, E1 behavior, Rust source, generated-WASM drift, protected
  parity fixture/oracle drift, or protected type-fixture drift is present.
- Documentation is **not final after strategy attempt 4**. The current canonical docs and delta
  specs do not record the physical-topology rules that now make F1-F3 safe. Exact recommended
  patches are listed below; none was applied.
- Task 3.12 is **verified non-triggered**, not unfinished work. The round-2 independent contract
  review is `ACCEPTED CLEAN` and explicitly accepts the in-place `ProjectStore` amendment without
  restoring the byte-exact C1 interface or authorizing a parallel storage seam.

## 1. Exact status-to-write-set attribution

The groups below are mutually exclusive and cover the exact 116-path `git status
--porcelain=v1 --untracked-files=all` snapshot.

### G0 — protected session files, metadata-only status (2)

Attribution: no C5 content write. Both paths show `M` in status, but `git diff`/`git diff
--numstat` are empty and `git hash-object` equals the frozen HEAD blob. Treat these as
line-ending/stat refresh noise, not a protected-surface exception and not an unexplained delta.

```text
M  apps/web/src/editor/session/create-session.ts
M  apps/web/src/editor/session/session-types.ts
```

Observed normalized blobs:

- `create-session.ts`: `ee63d7843fa73df6959aa92030bf4871236b6038` (expected and observed)
- `session-types.ts`: `c67d9822a2a6c994be14f367e6980fbbaa6e454b` (expected and observed)
- the third protected file, `editor/session/index.ts`, is not in status and remains
  `59dd907482a109f8627b217764925bd284f3f223`.

### G1 — public store contract and reusable conformance (7)

Attribution: tasks 3.1-3.11 and 4.1-4.12; explicit expected-write-set group for the in-place
`ProjectStore` amendment, reference implementation, one shared conformance matrix, compile
guard, exports, and forcing decision. No second port is present.

```text
M  apps/web/src/editor/ports/DECISIONS.md
M  apps/web/src/editor/ports/__tests__/conformance.test.ts
M  apps/web/src/editor/ports/__tests__/port-roles.compile-guard.ts
M  apps/web/src/editor/ports/conformance/index.ts
M  apps/web/src/editor/ports/in-memory/index.ts
M  apps/web/src/editor/ports/index.ts
M  apps/web/src/editor/ports/project-store.ts
```

### G2 — browser store, cascade, migration, and attempt-4 topology (28)

Attribution: tasks 5.1-5.12 and 6.1-6.12, plus the accepted-fix strategy attempts culminating
in attempt 4. This group owns the production browser implementation, real/disposable controls,
legacy compatibility, cascade journals, migration journals, exact ownership certificates, the
centralized topology policy, and focused topology probes/tests. Deleting the provisional adapter
is task 9.7.

```text
D  apps/web/src/services/storage/browser-host-adapter.ts
M  apps/web/src/services/storage/indexeddb-adapter.ts
M  apps/web/src/services/storage/migrations/base.ts
M  apps/web/src/services/storage/migrations/transformers/v1-to-v2.ts
M  apps/web/src/services/storage/migrations/v1-to-v2.ts
M  apps/web/src/services/storage/service.ts
?? apps/web/src/services/storage/__tests__/browser-project-store-cascade-topology.test.ts
?? apps/web/src/services/storage/__tests__/browser-project-store-media-topology.test.ts
?? apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts
?? apps/web/src/services/storage/__tests__/browser-project-store-topology.test.ts
?? apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts
?? apps/web/src/services/storage/__tests__/migration-provider-private.test.ts
?? apps/web/src/services/storage/browser-project-store-cascade-manager.ts
?? apps/web/src/services/storage/browser-project-store-cascade-probes.ts
?? apps/web/src/services/storage/browser-project-store-cascade-round2-probes.ts
?? apps/web/src/services/storage/browser-project-store-cascade.ts
?? apps/web/src/services/storage/browser-project-store-conformance.ts
?? apps/web/src/services/storage/browser-project-store-control.ts
?? apps/web/src/services/storage/browser-project-store-internals.ts
?? apps/web/src/services/storage/browser-project-store-library-clear-bindings.ts
?? apps/web/src/services/storage/browser-project-store-media-ownership.ts
?? apps/web/src/services/storage/browser-project-store-migration-round2-probes.ts
?? apps/web/src/services/storage/browser-project-store-migration.ts
?? apps/web/src/services/storage/browser-project-store-records.ts
?? apps/web/src/services/storage/browser-project-store-residual-probes.ts
?? apps/web/src/services/storage/browser-project-store-topology.ts
?? apps/web/src/services/storage/browser-project-store.ts
?? apps/web/src/services/storage/browser-storage-mechanisms.ts
```

Attempt-4 minimum-write-set reconciliation is exact: the new topology module, browser store,
media/library ownership, cascade manager/naming, migration, cascade/migration round-2 probes,
Vite harness, Playwright assertion surface, and four focused topology tests are all present. The
mechanisms file changed earlier in C5 but attempt 4 itself did not require a new public port,
Host/session shape, transformer interface, or persisted journal revision.

### G3 — session coordinator, opaque codec, and session-owned libraries (11)

Attribution: tasks 7.1-7.10, 8.7-8.9, and 9.4-9.5. These paths add the one editor-internal
coordinator above `host.store`, retain/overlay opaque provider data, bind independent session
StoreApi instances, and test cache/queue/listener isolation. `EditorCore.persistence.destroy()`
only releases coordinator listeners/snapshots; it is not C6's five-resource disposal regime.

```text
M  apps/web/src/core/index.ts
M  apps/web/src/editor/runtime/session-stores.ts
M  apps/web/src/editor/session/__tests__/session-async-store-isolation.test.ts
M  apps/web/src/editor/session/__tests__/session-lifecycle.test.ts
M  apps/web/src/editor/session/__tests__/session-state-isolation.test.ts
M  apps/web/src/editor/use-session-store.ts
?? apps/web/src/editor/persistence/__tests__/opaque-roundtrip.test.ts
?? apps/web/src/editor/persistence/index.ts
?? apps/web/src/editor/persistence/opaque-value.ts
?? apps/web/src/editor/persistence/project-codec.ts
?? apps/web/src/editor/persistence/session-persistence-coordinator.ts
```

### G4 — required Host composition and production Next root (4)

Attribution: tasks 9.2-9.5 and 9.9-9.10. These paths make every Host role required, keep the
UI context deliberately narrow, final-override the browser store in Next, and prove the absence
of optional/fallback/private storage paths.

```text
M  apps/web/src/editor/host/__tests__/production-composition.test.ts
M  apps/web/src/editor/host/editor-host-context.tsx
M  apps/web/src/editor/host/editor-host.ts
M  apps/web/src/editor/host/next-editor-host.ts
```

### G5 — Vite Host, disposable browser harness, and C4 regression (11)

Attribution: tasks 5.10-5.12, 6.9-6.12, 8.11, 9.1, 9.6, and 9.9-9.10. The two HTML entry
points, config, harnesses, and three Playwright specs are source fixtures, not disposable output.

```text
M  apps/vite-example/src/c4-forced-none-harness.tsx
M  apps/vite-example/src/host/vite-host-config.ts
M  apps/vite-example/src/project-picker.tsx
?? apps/vite-example/c5-migration.html
?? apps/vite-example/c5-storage.html
?? apps/vite-example/playwright.c5-storage.config.ts
?? apps/vite-example/src/c5-migration-harness.ts
?? apps/vite-example/src/c5-storage-harness.ts
?? apps/vite-example/tests/c5-storage/browser-store.pw.ts
?? apps/vite-example/tests/c5-storage/c4-forced-none.pw.ts
?? apps/vite-example/tests/c5-storage/migration-round1.pw.ts
```

### G6 — inventoried consumers, propagation, recovery UI, and focused tests (25)

Attribution: tasks 7.6, 8.1-8.14. The original nine singleton/adapter consumers and the C3
preset handoff are present. Additional propagation files are justified by ordered durability,
reject-before-false-success behavior, dirty-state retention, object reconstruction, and visible
recoverable provider/sound/preset failures. The `URL.createObjectURL`/`revokeObjectURL` deltas in
media undo/reconstruction preserve C5 media behavior; they do not introduce session-wide resource
acquisition tracking or teardown owned by C6.

```text
M  apps/web/src/commands/media/add-media-asset.ts
M  apps/web/src/commands/media/remove-media-asset.ts
M  apps/web/src/components/editor/panels/assets/views/assets.tsx
M  apps/web/src/components/storage-provider.tsx
M  apps/web/src/core/managers/__tests__/project-manager-thumbnail-degraded.test.ts
M  apps/web/src/core/managers/media-manager.ts
M  apps/web/src/core/managers/project-manager.ts
M  apps/web/src/core/managers/save-manager.ts
M  apps/web/src/core/managers/scenes-manager.ts
M  apps/web/src/media/processing.ts
M  apps/web/src/media/use-paste-media.ts
M  apps/web/src/sounds/components/assets-view.tsx
M  apps/web/src/sounds/sounds-store.ts
M  apps/web/src/timeline/components/graph-editor/custom-presets-store.ts
M  apps/web/src/timeline/components/graph-editor/popover.tsx
M  apps/web/src/timeline/controllers/drag-drop-controller.ts
M  apps/web/src/timeline/hooks/use-timeline-drag-drop.ts
?? apps/web/src/components/__tests__/storage-provider-operations.test.ts
?? apps/web/src/components/storage-provider-operations.ts
?? apps/web/src/core/managers/__tests__/media-persistence-rewire.test.ts
?? apps/web/src/core/managers/__tests__/project-persistence-rewire.test.ts
?? apps/web/src/core/managers/__tests__/save-manager-persistence-failure.test.ts
?? apps/web/src/media/__tests__/persistence.test.ts
?? apps/web/src/media/__tests__/processing-capacity.test.ts
?? apps/web/src/media/persistence.ts
```

### G7 — boundary/composition controls and exact negative fixtures (25)

Attribution: tasks 10.1-10.10 and supporting session-state ownership enforcement. Every fixture
is an intentional negative control under an exact `script/fixtures/c5-*` path; none is a protected
parity/type fixture or production path.

```text
M  script/check-port-boundary.mjs
M  script/check-session-state-boundary.mjs
M  script/check-storage-boundary.mjs
M  script/fixtures/session-state-ownership.json
?? script/__tests__/c5-storage-boundary-red.test.mjs
?? script/check-host-composition.mjs
?? script/fixtures/c5-browser-store-conformance/browser-store-conformance.ts
?? script/fixtures/c5-storage-boundary/direct-adapter/apps/web/src/core/consumer.ts
?? script/fixtures/c5-storage-boundary/direct-indexeddb/apps/web/src/core/consumer.ts
?? script/fixtures/c5-storage-boundary/direct-opfs/apps/web/src/core/consumer.ts
?? script/fixtures/c5-storage-boundary/direct-singleton/apps/web/src/core/consumer.ts
?? script/fixtures/c5-storage-boundary/hidden-host-storage/apps/web/src/editor/host/editor-host.ts
?? script/fixtures/c5-storage-boundary/in-memory-fallback/apps/vite-example/src/host/vite-host-config.ts
?? script/fixtures/c5-storage-boundary/localstorage-presets/apps/web/src/timeline/components/graph-editor/custom-presets-store.ts
?? script/fixtures/c5-storage-boundary/localstorage-sounds/apps/web/src/sounds/sounds-store.ts
?? script/fixtures/c5-storage-boundary/mechanism-type-leak/apps/web/src/editor/ports/project-store.ts
?? script/fixtures/c5-storage-boundary/physical-storage-path-leak/apps/web/src/editor/ports/project-store.ts
?? script/fixtures/c5-storage-boundary/private-storage-context/apps/web/src/editor/storage-context.tsx
?? script/fixtures/c5-storage-boundary/public-command-leak/apps/web/src/editor/ports/project-store.ts
?? script/fixtures/c5-storage-boundary/public-schema-leak/apps/web/src/editor/ports/project-store.ts
?? script/fixtures/c5-storage-boundary/public-state-store-leak/apps/web/src/editor/ports/project-store.ts
?? script/fixtures/c5-storage-boundary/public-storage-implementation-leak/apps/web/src/editor/ports/project-store.ts
?? script/fixtures/c5-storage-boundary/second-media-port/apps/web/src/editor/ports/index.ts
?? script/fixtures/c5-storage-boundary/second-storage-port/apps/web/src/editor/ports/index.ts
?? script/fixtures/c5-storage-boundary/unlisted-verification/apps/vite-example/tests/probe/unlisted.ts
```

### G8 — canonical architecture/feature/parity documentation (3)

Attribution: task 12.3. These edits document the C5 store boundary, durable-library versus local
preference classification, and the direct-read parity exemption. They predate strategy attempt 4
and need the targeted follow-up patches in section 4 below.

```text
M  BOUNDARIES.md
M  FEATURE_HANDLING.md
M  PARITY.md
```

## 2. Forbidden-scope and protected-surface audit

### Result: zero forbidden incursions

1. **C6:** no implementation of five-resource acquisition/disposal, shared-GPU last-owner
   teardown, Worker/AudioContext/WebSocket ownership, or session-level object-URL registry entered
   the delta. Coordinator `destroy()` and media reconstruction/undo URL handling are C5-local
   durability/liveness behavior, not the C6 resource contract.
2. **C7:** no emitted/headless Host or React-removal implementation path is in status. Occurrences
   of “headless” in docs/types/tests describe the existing contract or Playwright mode; they do not
   emit a C7 runtime.
3. **E1:** no packaged/plugin feature behavior or renderer-performance implementation is in status.
   Project/media-manager overlaps are C5 consumer inversion and remain a serial dependency for E1.
4. **Rust/generated WASM:** `git status -- rust` is empty. The ignored generated files remain byte
   exact by SHA-256:
   - `rust/wasm/pkg/opencut_wasm.js` =
     `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1`
   - `rust/wasm/pkg/opencut_wasm_bg.wasm` =
     `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`
5. **Protected fixtures/oracle:** no status path exists under
   `apps/vite-example/tests/parity/**`; `script/diff-parity-snapshots.mjs` remains blob
   `fa387ebea1e7f0cc1110eebcb922d393a1337842`; and
   `script/fixtures/type-baseline.json` remains blob
   `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8` and SHA-256
   `0f7cc855fc8f5c7edd68b2c371bae993fe8e713d2ffd4ef21956de72bd387622`.
6. **Protected public-session shape:** the two apparent status entries are normalized hash matches
   as recorded in G0; `session/index.ts` is also unchanged. Therefore task 11.9 can still require
   the original public-session hashes literally; no rebaseline or exception is needed.

This is a path/diff/hash audit, not a substitute for task 11.8/11.9's final gate run on the final
tree.

## 3. Task 3.12 disposition

Task 3.12 is **non-triggered** on direct evidence:

- `evidence/contract-review-round2.md` says `ACCEPTED CLEAN`, tally
  `B 0 / Ma 0 / Mi 0 / T 0`.
- The reviewer explicitly states that the review does not require restoring the byte-exact C1
  surface and does not authorize `MediaStore`, `StoragePort`, `StorageContext`, a hidden Host
  property, a new factory/session argument, or a singleton escape hatch.
- `evidence/contract-implementation.md`, `handoff/contract-implementer.md`, and
  `handoff/contract-fixer-round1.md` independently repeat that accounting.
- Current status contains only the single amended `ProjectStore` role and its existing export;
  negative fixtures for second ports/private contexts are tests, not product implementations.

The unchecked box is therefore a fail-safe/non-applicable guard. It must remain reported as
“verified not triggered,” not counted as unfinished implementation and not checked as if an action
ran.

## 4. Documentation gaps introduced by strategy attempt 4

### What the implementation now guarantees but canonical docs/specs do not say

1. **Exact pair versus destructive resource ownership.** Library ownership is the exact
   `(database, store)` pair. Media cascade owns/deletes a whole database and one exact OPFS root;
   migration cleanup owns/deletes whole databases. An authentic tuple is insufficient unless its
   mutation granularity is also topology-safe.
2. **Reserved control pairs and databases.** The projects database reserves the public project
   store plus the cascade, media-ownership, library-clear-binding, and migration-maintenance store
   pairs. Media cleanup must never claim the projects database, any current/retained library
   database, either canonical stage database, a migration-owned legacy timeline database, or a
   different current/retained media owner's exact database/directory. Migration cleanup must not
   overlap live projects, current/retained library, or current/retained media databases; each stage
   database may delete only its matching canonical stage claim after the complete plan passes.
3. **Valid same-database/distinct-store configuration.** `libraryDatabase === projectsDatabase` is
   intentionally valid when `libraryStore` is distinct from all five reserved project/control
   stores. A database-name-only rejection would be an over-broad regression. This positive case is
   one of attempt 4's explicit Chromium assertions.
4. **Current precommit versus historical fail-closed behavior.** A current unsafe remove/clear is
   rejected before media-owner registration, project deletion, tombstone/journal commit, or
   physical I/O, so a collision-free wrapper may later reuse the same project ID. An already
   persisted unsafe historical journal is retained byte-for-byte, performs no target I/O or
   journal rewrite, emits a fixed nonretryable topology diagnostic, and can continue to block
   same-ID save. Automatic convergence is deliberately not claimed for intrinsically unsafe
   historical authority.
5. **Migration batch authorization.** Current migration planning and historical recovery/cleanup
   must authorize the complete database cleanup batch before stage/owner/intent writes, the first
   delete, or any journal shrink. A safe early target never permits partial progress when a later
   target conflicts.
6. **Non-leaking diagnostics.** Topology conflicts cross the public store boundary only as
   mechanism-neutral `unavailable` errors with logical operation/scope. Maintenance diagnostics use
   fixed topology phases, `retryable:false`, and no physical database/store/directory names,
   payload contents, raw platform causes, or provider-private values.

None of these guarantees is stated in current `BOUNDARIES.md` section 3,
`FEATURE_HANDLING.md`, `PARITY.md`, or `editor/ports/DECISIONS.md`. The attempt-4 design and
implementation evidence contain them, but evidence is not the canonical architecture/spec surface.
The two delta specs likewise have no scenario that would make T1-T10/F1-F3 part of future change
validation. The stale `evidence/cleanup.md` scenario map consequently omits attempt-4 topology
tests.

### Exact patch recommendations (do not apply in this audit)

1. **`proposal.md` — “What Changes”, after the production browser-store bullet.** Add one bullet
   saying the browser implementation centrally authorizes physical topology according to mutation
   granularity: exact library store pairs, whole media/migration databases, and exact OPFS roots;
   both new plans and historical retries fail closed. In “Impact”, add the topology module and
   cascade/migration topology probes to the expected implementation write set. State explicitly
   that attempt 4 does not widen the public port or persisted journal format.

2. **`design.md` — insert “Decision 9. Authorize physical topology before logical or physical
   mutation” immediately after Decision 8 and before “Risks / Trade-offs”.** The section should
   contain six short normative paragraphs:
   - ownership granularity: library exact pair; media whole database + exact root; migration whole
     database;
   - the five reserved `(PDB, PS/C/O/A/G)` pairs and protected database sets;
   - the allowed `LDB === PDB && LS` distinct-from-reserved positive configuration;
   - precommit ordering for current remove/clear and media registration;
   - historical journal full-preflight/retain-without-rewrite behavior and same-ID distinction;
   - complete migration-batch authorization plus fixed payload-free/nonretryable diagnostics.
   Under “Risks / Trade-offs”, add “exact authorization can still alias a protected physical
   domain” and its centralized-policy mitigation. Under “Expected Write Set”, add the exact
   attempt-4 minimum files from `strategy-attempt-4-design.md` lines 448-481.

3. **`specs/browser-persistence-boundary/spec.md` — before `## REMOVED Requirements`, add a new
   modified requirement named “Physical cleanup authority is topology-safe”.** Required scenarios:
   - `Library ownership is an exact store pair` — reserved pairs reject without writes;
   - `A distinct library store may share the projects database` — the valid positive configuration
     remains functional;
   - `Media cleanup cannot own a protected whole database or another owner's exact root`;
   - `Current remove and clear refuse before logical commit` — no owner, project delete, tombstone,
     journal, store clear, DB delete, or directory delete;
   - `Historical cascade conflict is retained fail-closed` — full journal and all targets unchanged,
     no partial execution, nonretryable generic diagnostic;
   - `Migration authorizes the complete cleanup batch` — no staging/intent/delete/journal shrink if
     any target conflicts;
   - `Historical migration cleanup cannot partially advance` — safe-before-unsafe ordering still
     executes zero deletes and retains the exact journal;
   - `A safe same-owner exact retry remains idempotent`.
   These scenarios provide the missing spec-to-test mapping for the attempt-4 topology unit tests
   and the 12 new Chromium result fields.

4. **`specs/host-port-contract/spec.md` — requirement “Storage operations have explicit failure
   and cancellation semantics”, scenario “Platform failures do not cross the port by name”.** Add
   an `AND` paragraph covering topology/configuration failures: public errors and session
   diagnostics may carry only stable code/operation/logical scope; no physical identity, topology
   reason, payload, provider-private value, or raw cause crosses the port. Do not expose the
   topology policy in the public `ProjectStore` type.

5. **`BOUNDARIES.md` — section 3, after the paragraph ending “`BrowserHostAdapter` has been
   deleted”.** Insert a subsection titled “Physical cleanup is authorized by mutation
   granularity”. It should spell out the exact-pair/whole-database/exact-root distinction, the five
   reserved project/control pairs, current/retained protected database sets, and the valid
   shared-PDB/distinct-library-store case. In the existing migration paragraph (currently lines
   170-175), add complete-batch authorization before stage/intent/delete and historical-journal
   retention/no-rewrite/no-partial-I/O. In the diagnostics paragraph (currently lines 163-168),
   add fixed topology phase + nonretryable semantics and prohibit physical identity/topology reason.

6. **`apps/web/src/editor/ports/DECISIONS.md` — append section 8 after section 7.** Recommended
   title: “Physical cleanup — authorize topology as well as durable identity”. Use the established
   `What forced it / What it rules out / What it does not claim` structure:
   - forcing evidence: attempt-3 exact certificates still permitted `MDB=PDB/LDB`, stage/live DB
     aliases, control-store pair aliases, and cross-owner exact root aliases;
   - chosen rule: centralized private topology policy with the exact ownership granularities,
     reserved pairs/databases, full precommit and historical batch checks;
   - ruled out: target-local comparisons, making media cleanup only store-scoped, a new public port,
     or a new durable global topology registry;
   - positive compatibility: same projects/library database with a distinct non-reserved library
     store is conforming;
   - diagnostics and historical limitation: generic non-leaking failure, retained unsafe journals,
     no automatic-remapping claim.

7. **`FEATURE_HANDLING.md` — no topology-mechanism subsection is appropriate.** This document is
   user-visible feature classification and is already correct about durable saved sounds/presets,
   local UI preferences, required store composition, and payload-free diagnostics. If task 12.3
   wants a user-observable sentence, add only to the `store` row's Notes: “An unsafe Host storage
   configuration refuses as generic unavailable before mutation; physical storage names are not
   shown.” Link to `BOUNDARIES.md` section 3 rather than duplicating reserved-name mechanics.

8. **`PARITY.md` — do not hand-edit topology prose or measured counts.** Attempt 4 is below the
   Host-neutral boundary and does not change the parity classification. Preserve the first
   paragraph's exact direct-read exemption. After task 11.5, regenerate the report only through
   `script/diff-parity-snapshots.mjs`; replace measured counts/rows only if the protected rerun
   produces a real delta. Until that run, the current 9/0/195 report is prior-run evidence, not
   attempt-4 final-tail proof.

9. **Final evidence, not existing evidence repair.** Do not overwrite the invalidated
   `evidence/cleanup.md`. Task 11.12 should create/update `evidence/regression.md` with the final
   tree's commands, hashes, build/parity counts, and source/provenance results. Tasks 12.1-12.4 and
   12.8 should create a new final cleanup/scope record (or a clearly later appended final section)
   whose scenario table includes every attempt-4 topology scenario and whose status inventory is
   taken after the accepted review/fix tree settles.

### Final-build number warning

`BOUNDARIES.md` currently reports a production Vite count of 2,844 modules and other build/asset
measurements, while section 11 is still unchecked and attempt 4 added a production topology module.
Those numbers must be treated as stale until tasks 11.3/11.7 rerun from fresh output. Likewise,
`PARITY.md` is a prior-run generated report until tasks 11.5/11.6 reproduce it without changing the
protected oracle. Documentation patching must not guess replacement counts.

## 5. Task 12.8 disposable artifacts and process/listener checks

### Current read-only observation

- No `apps/vite-example/dist`, `apps/web/.next`, `out`, coverage, Playwright report, test-results,
  or attempt-4 log file is present.
- `apps/vite-example/tests/.pw-output-c5-storage/` exists but is empty. It is a disposable
  Playwright output directory, not source.
- Ignored incremental/generated artifacts present:
  - `apps/web/tsconfig.phase4a.tsbuildinfo`
  - `apps/web/tsconfig.tsbuildinfo`
  - `apps/web/.content-collections/cache/content-collection-config.mjs`
  - `apps/web/.content-collections/cache/mapping.json`
  - `apps/web/.content-collections/generated/allChangelogs.js`
  - `apps/web/.content-collections/generated/index.d.ts`
  - `apps/web/.content-collections/generated/index.js`
- No task-owned Bun/Node/Vite/Playwright/Chromium process matching the C5 worktree, C5 harness, or
  port 4175 was found.
- No listener exists on TCP port 4175.
- The audit did not open, enumerate, mutate, or delete browser profile databases. Attempt-4
  implementation evidence records randomized exact cleanup targets, empty before/after fixture
  inventories, and zero task process/listener residue, but task 12.8 must repeat those checks after
  the final browser run rather than inheriting that earlier observation.

### Safe final-tail disposition

1. Keep all 64 untracked source paths in G2/G3/G5/G6/G7; they are intentional source/tests/fixtures,
   not cleanup candidates.
2. After extracting the final test evidence, remove only the resolved worktree-local disposable
   paths:
   - empty `apps/vite-example/tests/.pw-output-c5-storage/`;
   - `apps/web/tsconfig.phase4a.tsbuildinfo` and `apps/web/tsconfig.tsbuildinfo`;
   - `.content-collections/cache/**`;
   - `.content-collections/generated/**` only after the last type/full-suite gate (the type gate
     requires it and can regenerate it);
   - any newly created exact `dist*`, `.next`, Playwright output, parity-artifact, trace,
     screenshot, coverage, or bounded log path owned by the final verifier.
3. Before any recursive removal, resolve each exact path and verify it remains below this C5
   worktree. Never target a browser user-data directory, home directory, broad database namespace,
   or any path derived only from an unresolved prefix.
4. Re-run `git status --short --untracked-files=all` and an ignored-artifact inventory. The only
   remaining status paths should be the intentional groups above plus any final canonical docs and
   evidence explicitly authorized by the parent stage.
5. Re-run the process/listener checks after every browser/build process has exited:

```powershell
Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -match '^(node|bun|chrome|chromium|msedge|playwright)(\.exe)?$' -and
    $_.CommandLine -match 'rocut-wt-c5|c5-storage|4175|playwright'
  } |
  Select-Object ProcessId, Name, CommandLine

Get-NetTCPConnection -State Listen -LocalPort 4175 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, OwningProcess, State
```

Expected final result: no task-owned process and no 4175 listener. If either remains, resolve its
command line/PID before terminating it; do not kill unrelated Chrome/Node processes by name.

6. For database cleanup proof, use only fixture-returned exact randomized
   `c5-disposable-<uuid>` identities and exact legacy names that the fixture itself created. Record
   before/after inventories and require zero residual fixture databases/directories. Do not run a
   broad delete against the production identity or a user's Chrome profile.

## 6. Final gate consequences

- Tasks 11.1-11.12 and 12.1-12.8 remain final-tree work. This audit supplies scope/documentation
  guidance but does not satisfy builds, parity, full regression, provenance, final review, or
  cleanup execution.
- Task 12.3 is not complete until the attempt-4 rules are promoted from evidence into canonical
  design/spec/boundary/decision documentation as recommended above.
- Task 12.4's scenario mapping must include attempt-4 T1-T10/result fields; the invalidated cleanup
  map is insufficient.
- Task 12.7 remains a hard stop until the independent non-author strategy reviewer closes F1-F3 and
  the final protected/regression tail is green.
- Task 12.8 should preserve the 64 intentional untracked source paths and remove only the exact
  worktree-local disposable outputs listed above.

## Durable findings

1. Authentic target identity is not cleanup authority: library ownership is an exact store pair,
   while media and migration cleanup act at whole-database granularity and media also owns an exact
   OPFS root.
2. Fail-closed means authorizing the complete current or historical batch before the first logical
   commit, delete, or journal rewrite; retaining an unsafe historical journal is safer than silently
   remapping or partially shrinking it.
3. A safe topology policy must reject reserved pairs/databases without rejecting the valid
   `libraryDatabase === projectsDatabase` plus distinct non-reserved `libraryStore` configuration.
