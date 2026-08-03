# C5 final-tree scope, documentation, and scenario map

Date: 2026-08-02  
Product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5`  
Planning root: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut`  
Frozen base and current HEAD: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
Frozen base and current HEAD tree: `286272307b05d23826ffa7223a76695365194dba`

This is a read-mostly final-scope/scenario map for tasks 12.1-12.4. It does not
claim the fresh tests, builds, parity, source graph, WASM, provenance, full
suite, or final-cleanup measurements owned by section 11. It does not mark a
task complete and it does not replace `evidence/regression.md`.

Snapshot boundary: the exact 116-path status below was captured before the
parallel Phase-A verifier created its run-owned
`apps/vite-example/dist-c5-final-20260802-155342/**` and
`apps/vite-example/tests/.pw-output-c5-storage/.last-run.json` outputs. Those
ephemeral files are not part of the 116-path candidate write set, are owned by
Phase A's output ledger, and were deliberately neither attributed nor touched
here. The final 12.1/12.8 refresh must run only after that owner has extracted
evidence and performed its bounded cleanup.

## Outcome and phase boundary

| Item | Result | State |
| --- | --- | --- |
| Full tracked + untracked status | 116 paths: 52 tracked entries (51 modified, 1 deleted) + 64 untracked | READY snapshot; refresh after Phase A/B |
| Expected-write-set attribution | 116/116 attributed; 0 unexplained | READY snapshot; refresh after Phase A/B |
| Later-change / protected-scope audit | 0 C6, C7, E1, Rust, generated-WASM, parity/type-fixture incursions | READY snapshot; Phase B repeats protected hashes |
| Canonical documentation semantics | Final store boundary, private-data guarantee, migration/topology order, and preferences are covered | READY except measured fields below |
| Delta-spec scenario map | 52/52 scenarios mapped to a focused/integration test and evidence | READY map; Phase A/B supplies final-run evidence |
| Tasks 1.1-12.4 evidence audit | 114/130 have completed-task evidence; 12 section-11 tasks are pending; 4 final-tree tasks are prepared here but remain final-refresh dependent | BLOCKED-BY-PHASE-A/B for task completion |

## Exact 116-path status attribution

The groups are mutually exclusive and exhaustive for
`git status --porcelain=v1 --untracked-files=all`. Counts sum to 116.

### G0 - protected session metadata-only status (2)

These two paths have no content diff from the frozen base and their normalized
worktree blobs equal the protected blobs. They are stat/line-ending noise, not
C5 source edits.

```text
M  apps/web/src/editor/session/create-session.ts
M  apps/web/src/editor/session/session-types.ts
```

### G1 - public store contract and shared conformance (7)

Tasks 3.1-3.11 and 4.1-4.12: the in-place `ProjectStore` amendment, one
reference implementation, one shared case matrix, compile guard, exports, and
forcing decision. No second storage port is present.

```text
M  apps/web/src/editor/ports/DECISIONS.md
M  apps/web/src/editor/ports/__tests__/conformance.test.ts
M  apps/web/src/editor/ports/__tests__/port-roles.compile-guard.ts
M  apps/web/src/editor/ports/conformance/index.ts
M  apps/web/src/editor/ports/in-memory/index.ts
M  apps/web/src/editor/ports/index.ts
M  apps/web/src/editor/ports/project-store.ts
```

### G2 - browser store, cascade, migration, and physical topology (28)

Tasks 5.1-6.12 plus accepted-fix strategy attempts 1-4. This is the named
browser boundary, including the final v1 transformer-source preauthorization
fix. The provisional adapter deletion is task 9.7.

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

### G3 - session coordinator, opaque codec, and session-owned libraries (11)

Tasks 7.1-7.10, 8.7-8.9, and 9.4-9.5. Coordinator `destroy()` releases only
coordinator snapshots/listeners; it is not C6's five-resource disposal regime.

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

### G4 - required Host composition and Next root (4)

Tasks 9.2-9.5 and 9.9-9.10.

```text
M  apps/web/src/editor/host/__tests__/production-composition.test.ts
M  apps/web/src/editor/host/editor-host-context.tsx
M  apps/web/src/editor/host/editor-host.ts
M  apps/web/src/editor/host/next-editor-host.ts
```

### G5 - Vite Host, disposable browser harness, and C4 regression (11)

Tasks 5.10-5.12, 6.9-6.12, 8.11, 9.1, 9.6, and 9.9-9.10. HTML,
configuration, harness, and Playwright files are intentional source fixtures.

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

### G6 - persistence consumers, propagation, recovery UI, and tests (25)

Tasks 7.6 and 8.1-8.14. The original singleton/adapter consumers and C3 preset
handoff are present. The object-URL changes are bounded C5 media
reconstruction/undo liveness; there is no session-wide registry or teardown.

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

### G7 - boundary/composition controls and exact negative fixtures (25)

Tasks 10.1-10.10. Every untracked fixture is an intentional negative control,
not production code or a protected parity/type fixture.

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

### G8 - canonical architecture/feature/parity documentation (3)

Task 12.3 semantic documentation. Phase A/B still owns exact final measured
numbers.

```text
M  BOUNDARIES.md
M  FEATURE_HANDLING.md
M  PARITY.md
```

## Protected and forbidden-scope proof

The frozen protected paths have an empty content diff and zero untracked files.
The two metadata-only session entries are also content-identical.

| Protected object | Observed identity | Result |
| --- | --- | --- |
| parity fixture tree | `e1fbb55b985f4fb490c6b233d18c50c58ea14c28` | no diff; 0 untracked |
| parity oracle blob | `fa387ebea1e7f0cc1110eebcb922d393a1337842` | no diff; 0 untracked |
| type fixture blob / SHA-256 | `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8` / `0f7cc855fc8f5c7edd68b2c371bae993fe8e713d2ffd4ef21956de72bd387622` | no diff; 0 untracked |
| public session blobs (`create-session`, `session-types`, `index`) | `ee63d7843fa73df6959aa92030bf4871236b6038`, `c67d9822a2a6c994be14f367e6980fbbaa6e454b`, `59dd907482a109f8627b217764925bd284f3f223` | no content diff; 0 untracked |
| Rust trees (`rust/wasm`, GPU, compositor) | `d782b046c0f39e85b8a5ed518b42389214c211e5`, `4da4fe82bd946d6ef3937ec0c25f10e77ba674f2`, `cdaa2215e4b7bbe3f42d2e2c8db32e429cd5af34` | no diff; 0 untracked |
| generated WASM JS / binary SHA-256 | `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1`, `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1` | byte exact |

`git status -- rust` is empty. A complete added-line plus untracked-source
semantic search found no C6 five-resource/shared-GPU last-owner implementation,
no C7 emitted/headless Host, and no E1 Design Studio/plugin/performance feature
implementation. The superficially matching additions are all attributable:

- `URL.createObjectURL`/`revokeObjectURL` are C5 media reconstruction and undo
  liveness, without a session registry or teardown contract;
- coordinator `destroy()` releases only C5 snapshots/listeners; test calls to
  the pre-existing `session.dispose()` do not change disposal implementation;
- `runtimeResources`, Worker/AudioContext/object-URL, headless, and compositor
  matches occur in existing Host documentation, composition assertions, or
  negative/source-boundary accounting;
- Playwright `headless: true` is a C5 browser-test setting; and
- the only plugin-token match is the existing dependency name
  `@vitejs/plugin-react` in documentation.

Result: unexplained paths **0**; forbidden-scope incursions **0**.

## Canonical documentation coverage

| Required topic | Canonical coverage | Status |
| --- | --- | --- |
| Final public store boundary | `BOUNDARIES.md` section 3 and `FEATURE_HANDLING.md` state that `EditorHost.store` is the sole production persistence role, both Hosts final-override it with stable `BrowserProjectStore`, and the provisional adapter/singleton path is gone. `DECISIONS.md` section 7 records the in-place public amendment and rejected private seams. | READY |
| Provider-private guarantee | `BOUNDARIES.md` records structured-clone-compatible snapshots, identity-aware overlay, retained/deleted/new identity behavior, defensive cloning, and payload-free diagnostics. `DECISIONS.md` section 7 records opaque/mechanism-neutral values and shared conformance. | READY |
| Migration and topology ordering | `BOUNDARIES.md` records frozen mutation-granularity permits, current and retained claims, full historical preflight, v1 timeline/media source planning before transformer access, source-vs-cleanup authority separation, stage/readback/commit/readback/delete order, and failure behavior. `DECISIONS.md` section 8 records forcing aliases, positive shared-database compatibility, and limits. | READY |
| Explicit preferences | `FEATURE_HANDLING.md` and `BOUNDARIES.md` classify saved sounds and graph presets as durable namespaced library records; changelog, feedback, mobile gate, generic form, onboarding, and prompt dismissal remain explicit local UI preferences. | READY |
| Parity classification | `PARITY.md` preserves the exact direct-read verification exemption and declares the report evidence rather than a Slice verdict. | READY semantic classification; BLOCKED-BY-PHASE-B final rerun |

Only measured fields remain deferred; no semantic topology/private-data prose is
missing:

1. `BOUNDARIES.md` still contains the earlier production-build module split
   (`2,844` total and its category counts), copied/public byte counts, emitted
   file/byte totals, and the three on-demand asset observations. Tasks 11.3 and
   11.7 must replace or affirm them from fresh Phase A/B outputs; do not guess
   from the 2,873 C4 comparison baseline.
2. `PARITY.md`'s 10-interaction ledger, 195 leaves, 0 semantic / 9 incidental
   differences, concrete values, and host snapshots remain prior-run evidence
   until Phase B tasks 11.5-11.6 reproduce them with the protected oracle.
3. The final C5 source-module delta, 298 copied / 7 emitted asset-manifest
   accounting, WASM 38/58/609 surface, full-suite red multiset, and provenance
   drift belong only in `evidence/regression.md` after tasks 11.3-11.12. They
   are not asserted by this mapper.

## Complete delta-spec scenario map (52/52)

`Final owner` names the run that must supply final-tree evidence. `READY` means
the test and implementation/evidence path exist now; it is not a substitute for
the required final rerun.

### `host-port-contract` (24/24)

| Scenario | Focused/integration test | Existing evidence | Final owner |
| --- | --- | --- | --- |
| Missing data is not an infrastructure failure | shared `runPortConformance` case `missing project, attachment, and library values return null` in `editor/ports/__tests__/conformance.test.ts`; browser shared matrix | `conformance-in-memory.md`, `conformance-browser.md` | READY; Phase A 11.1 |
| Platform failures do not cross the port by name | conformance typed-failure/cause-retention cases; `session-async-store-isolation.test.ts` payload-free diagnostics; topology unit/browser refusal assertions | `conformance-in-memory.md`, `consumer-integration.md`, `strategy-attempt-4-v1-transformer-preauth-fix.md`, `review-report.md` CLEAN tail | READY; Phase A 11.1 |
| A pre-aborted operation cannot mutate storage | shared conformance pre-aborted read/write case, in-memory and complete-browser profiles | `conformance-in-memory.md`, `conformance-browser.md` | READY; Phase A 11.1 |
| Attachment replacement is all-or-previous | shared conformance staging/failure-before-commit case; browser matrix | `conformance-in-memory.md`, `conformance-browser.md` | READY; Phase A 11.1 |
| Durable command ordering is preserved | conformance same-key/distinct-key cases; `opaque-roundtrip.test.ts` ordering/failure case; media and library concurrency tests | `conformance-in-memory.md`, `opaque-roundtrip.md`, `consumer-integration.md` | READY; Phase A 11.1 |
| Equal attachment keys in different projects do not collide | shared conformance matrix; `media/__tests__/persistence.test.ts` | `conformance-in-memory.md`, `conformance-browser.md`, `consumer-integration.md` | READY; Phase A 11.1 |
| Equal keys in different library namespaces do not collide | shared conformance matrix; `session-async-store-isolation.test.ts` namespace-clear/independent-library cases | `conformance-in-memory.md`, `conformance-browser.md`, `rewire-libraries.md` | READY; Phase A 11.1 |
| Two sessions share only committed durable state | `opaque-roundtrip.test.ts` two-session case; `production-composition.test.ts` shared-store/distinct-coordinator case | `opaque-roundtrip.md`, `host-composition.md` | READY; Phase A 11.1 |
| Disposable stores cannot affect a production identity | complete-browser shared matrix exact disposable binding and before/after inventory | `conformance-browser.md`, `migration.md`, attempt-4 browser evidence | READY; Phase A 11.1 |
| All required port roles are reachable from one contract | `port-roles.compile-guard.ts`; positive port and Host composition gates | `contract-implementation.md`, `host-composition.md` | READY; Phase A 11.1/11.2 |
| The existing host seam is preserved, not replaced | compile guard; `production-composition.test.ts`; protected public-session blob proof | `host-composition.md`, this file's protected table | READY; Phase A 11.1 and Phase B 11.9 |
| Production Hosts cannot inherit reference storage, asset, or Worker behavior | `production-composition.test.ts`; `check-host-composition.mjs` positive/negative | `host-composition.md`, `boundaries.md` | READY; Phase A 11.1 |
| A private storage channel is rejected | host/storage boundary negative fixtures for second port, hidden property, and private context | `boundaries.md`, `failing-controls.md` | READY; Phase A 11.1 |
| The boundary is enforced by a check, not by review | `check-port-boundary.mjs` positive contract scan | `boundaries.md` | READY; Phase A 11.1 |
| The check is proven able to fail | `check-port-boundary.mjs --negative-control`; `c5-storage-boundary-red.test.mjs` mechanism/schema/state/path fixtures | `failing-controls.md`, `boundaries.md` | READY; Phase A 11.1 |
| Persisted project content crosses the boundary opaquely | shared conformance opaque/defensive-copy cases; `opaque-roundtrip.test.ts` known edits and complete recreation | `conformance-in-memory.md`, `opaque-roundtrip.md` | READY; Phase A 11.1 |
| Attachments and libraries remain mechanism-neutral | compile/port boundary negative controls; shared attachment/library matrix | `contract-implementation.md`, `boundaries.md`, conformance evidence | READY; Phase A 11.1 |
| The reference implementation passes complete conformance | `editor/ports/__tests__/conformance.test.ts` in-memory fixture | `conformance-in-memory.md` | READY; Phase A 11.1 |
| The browser implementation passes the same storage cases | exported fixture plus `tests/c5-storage/browser-store.pw.ts` | `conformance-browser.md`, attempt-4 final browser evidence | READY; Phase A 11.1 |
| The reference implementation is working, not stubbed | conformance opaque, defensive-copy, bytes, library, scheduling, and non-vacuity cases | `conformance-in-memory.md` | READY; Phase A 11.1 |
| Migration cases are opt-in | conformance opted-in/skipped/outside-prefix tests and browser missing-opt-in probe | `conformance-in-memory.md`, `migration.md` | READY; Phase A 11.1 |
| The suite is runnable by an adapter author outside this change | exported shared `runPortConformance` fixture and per-port/per-case reporting test | `conformance-in-memory.md`, `conformance-browser.md` | READY; Phase A 11.1 |
| Each decision names what forced it | `editor/ports/DECISIONS.md` eight `What forced it` decisions, including sections 7-8 | `contract-implementation.md`, contract reviews, topology audit | READY documentation |
| The C1 storage risk is resolved explicitly | `DECISIONS.md` section 7 forcing inventory; second contract review accepts in-place amendment | `contract-review-round2.md`, `contract-implementation.md` | READY documentation |

### `browser-persistence-boundary` (28/28)

| Scenario | Focused/integration test | Existing evidence | Final owner |
| --- | --- | --- | --- |
| Browser storage APIs are confined | `check-storage-boundary.mjs`; exact unlisted-mechanism negative fixture | `boundaries.md` | READY; Phase A 11.1 |
| Both examples depend on the final store contract | `production-composition.test.ts`; `check-host-composition.mjs` | `host-composition.md` | READY; Phase A 11.1 |
| Former direct consumers are inverted | storage boundary scan plus manager/media/library/provider focused suites | `rewire-core.md`, `rewire-libraries.md`, `consumer-integration.md`, `boundaries.md` | READY; Phase A 11.1 |
| The boundary gate is proven able to reject regressions | `c5-storage-boundary-red.test.mjs` and direct singleton/adapter/IndexedDB/OPFS/in-memory fixtures | `failing-controls.md`, `boundaries.md` | READY; Phase A 11.1 |
| Reopen after full reload restores the project | protected `tests/parity/editor-parity.pw.ts` save/reload/reopen flow | prior `PARITY.md`; final result intentionally not inherited | MAPPED; BLOCKED-BY-PHASE-B 11.5 |
| A known edit does not discard unknown provider data | `opaque-roundtrip.test.ts` known edits at all levels and complete Host/session recreation; migration private-field tests | `opaque-roundtrip.md`, `migration.md` | READY; Phase A 11.1 |
| Media assets survive reload | protected parity full-reload scenario; `media/__tests__/persistence.test.ts`; browser attachment conformance | `consumer-integration.md`, `conformance-browser.md`; prior `PARITY.md` | MAPPED; Phase A 11.1 + BLOCKED-BY-PHASE-B 11.5 |
| No database named after an undefined value exists | real Chromium `migration.noUndefinedNames` plus empty inventory | `migration.md`, `conformance-browser.md` | READY; Phase A 11.1 |
| The runner sees the projects the browser store wrote | real Chromium project migration/store probes | `migration.md`, `conformance-browser.md` | READY; Phase A 11.1 |
| One durable identity migrates once | real Chromium `wrappersCoalesced`; session lifecycle same-store/concurrent-waiter tests | `migration.md`, `host-composition.md` | READY; Phase A 11.1 |
| The defect's prior observable trace is used as the before-state | preflight `undefined` database trace and matching Chromium no-undefined inventory | `preflight.md`, `migration.md` | READY evidence chain |
| A seeded legacy project reaches the current version | genuine v1 Chromium `legacySuccess`; `v1-to-v2.test.ts`; provider-private migration test | `migration.md`, `strategy-attempt-4-v1-transformer-preauth-fix.md` | READY; Phase A 11.1 |
| Migration is reported rather than silent | Chromium progress assertion (`completed === total`) | `migration.md` | READY; Phase A 11.1 |
| Writing a migrated project back succeeds | genuine v1 Chromium committed/readback result and v1 transformer unit suite | `migration.md` | READY; Phase A 11.1 |
| Validation failure leaves the source readable | Chromium `sourcePreservedOnFailure`; conformance staged-validation failure | `migration.md`, `conformance-browser.md` | READY; Phase A 11.1 |
| Migration conformance is opt-in and disposable | conformance opt-in/prefix tests; browser missing-opt-in refusal and inventories | `conformance-in-memory.md`, `migration.md` | READY; Phase A 11.1 |
| A current-version project is left untouched | Chromium `currentVersionNoOp` raw v31 sentinel | `migration.md` | READY; Phase A 11.1 |
| Legacy timeline data is carried forward, not discarded | genuine v1 Chromium legacy timeline migration; v1 track-loading unit cases | `migration.md`, v1 preauthorization fix evidence | READY; Phase A 11.1 |
| Legacy media metadata and bodies are carried forward | genuine v1 Chromium legacy media/body bytes and private sentinels | `migration.md`, v1 preauthorization fix evidence | READY; Phase A 11.1 |
| Library ownership is an exact store pair | topology unit reserved-pair tests; Chromium `topologyLibraryReservedPairsRejectAtomically` | `strategy-attempt-4-implementation.md`, `review-report.md` CLEAN tail | READY; Phase A 11.1 |
| A distinct library store may share the projects database | topology unit positive test; Chromium `topologySharedProjectsDatabaseSafeLibraryStoreWorks` | attempt-4 implementation/review evidence | READY; Phase A 11.1 |
| Ordinary media first access includes current and retained libraries | `browser-project-store-media-topology.test.ts` retained same/different-store tests | `strategy-attempt-4-review-fixes.md`, `review-report.md` (`C5-S4-M2` closed) | READY; Phase A 11.1 |
| Media cleanup cannot own a protected whole database or another owner's exact root | pure topology/media tests; Chromium protected-database and physical-alias fields | attempt-4 implementation and CLEAN review | READY; Phase A 11.1 |
| Current remove and clear refuse before logical commit | cascade topology remove/clear tests; Chromium `topologyMediaProtectedDatabasesRefuseRemoveAndClearPrecommit` and same-ID reuse | attempt-4 implementation and CLEAN review | READY; Phase A 11.1 |
| Historical cascade conflict is retained fail-closed | cascade mixed-journal/legacy tests; Chromium historical protected/physical-alias and blocked-same-ID fields | attempt-4 implementation and CLEAN review | READY; Phase A 11.1 |
| Migration authorizes the complete cleanup batch before discovery | migration topology SP/SA and genuine-v1 call-order tests; Chromium stage/legacy/preauthorization fields | `strategy-attempt-4-v1-transformer-preauth-fix.md`, `review-report.md` (`C5-S4-M1` closed) | READY; Phase A 11.1 |
| Historical migration cleanup cannot partially advance | migration topology mixed-target test; Chromium `topologyHistoricalMigrationJournalFailsClosedWithoutPartialCleanup` | attempt-4 implementation and CLEAN review | READY; Phase A 11.1 |
| A safe same-owner exact retry remains idempotent | pure topology/media same-owner tests; collision-free cascade and canonical stage cleanup tests | attempt-4 implementation and CLEAN review | READY; Phase A 11.1 |

No delta-spec scenario is unmapped. The removed provisional-boundary
requirement has no live scenario and is correctly excluded from the 52.

## Task evidence audit through 12.4

The current task parser reports 115/136 complete. One completed task is 12.10,
outside this through-12.4 audit, so the exact through-12.4 state is 114/130
completed and 16 pending.

| Task IDs | Count | Evidence/status |
| --- | ---: | --- |
| 1.1-1.12 | 12 | `preflight.md`; protected identities also rechecked in this file |
| 2.1-2.10 | 10 | `failing-controls.md`, followed by the green conformance/rewire evidence |
| 3.1-3.11 | 11 | `contract-implementation.md`, `contract-review.md`, `contract-review-round2.md` |
| 3.12 | 1 | Verified non-triggered: round-2 contract review is `ACCEPTED CLEAN` and does not require the byte-exact C1 interface or authorize a second/private storage seam |
| 4.1-4.12 | 12 | `conformance-in-memory.md` |
| 5.1-5.12 | 12 | `conformance-browser.md` plus browser-store fix evidence |
| 6.1-6.12 | 12 | `migration.md`, migration fix evidence, attempt-4 topology/v1 preauthorization evidence, and final CLEAN review tail |
| 7.1-7.10 | 10 | `opaque-roundtrip.md` |
| 8.1-8.14 | 14 | `rewire-core.md`, `rewire-libraries.md`, `consumer-integration.md`, focused fix evidence |
| 9.1-9.10 | 10 | `host-composition.md` |
| 10.1-10.10 | 10 | `boundaries.md`, with negative controls in `failing-controls.md` |
| 11.1-11.4 | 4 | **BLOCKED-BY-PHASE-A**: final focused/browser tests, exact type ceiling, fresh Vite, fresh Next/18-route output; record only in `regression.md` |
| 11.5-11.12 | 8 | **BLOCKED-BY-PHASE-B**: protected parity/oracle, source/emitted graphs, WASM, hashes, full suite, provenance/SBOM/generated-file checks, and final `regression.md` |
| 12.1 | 1 | **READY snapshot here** (116/116, 0 unexplained), but refresh after Phase A/B and generated inventory changes |
| 12.2 | 1 | **READY snapshot here** (0 forbidden; exact hashes), but Phase B repeats final protected checks |
| 12.3 | 1 | **READY semantics** in canonical docs; **BLOCKED-BY-PHASE-A/B** only for the exact measured fields listed above |
| 12.4 | 1 | **READY map** (52/52) and strict validation below; refresh from the unchanged final tree after section 11/task updates |

Completed-task evidence coverage: **114/114 completed tasks through 10.10**.
Pending-task disposition: **12/12 section-11 tasks explicitly assigned to Phase
A/B; 4/4 tasks 12.1-12.4 prepared but not claimed final**.

## Existing evidence catalog read for routing (48 files)

```text
boundaries.md
cleanup.md
conformance-browser.md
conformance-in-memory.md
consumer-integration.md
contract-implementation.md
contract-review.md
contract-review-round2.md
failing-controls.md
fix-cascade-round1.md
fix-cascade-round2.md
fix-integration-round1.md
fix-integration-round2.md
fix-library-concurrency-round1.md
fix-migration-round1.md
fix-migration-round2.md
fix-preset-round2.md
fix-residual-round1.md
host-composition.md
migration.md
opaque-roundtrip.md
preflight.md
review-cycle-report.md
review-report.md
review-round1.md
review-round2.md
review-round3.md
rewire-core.md
rewire-libraries.md
strategy-attempt-1-design.md
strategy-attempt-1-m1.md
strategy-attempt-1-m2.md
strategy-attempt-1-review.md
strategy-attempt-1-verification.md
strategy-attempt-2-design.md
strategy-attempt-2-m1.md
strategy-attempt-2-m2.md
strategy-attempt-2-review.md
strategy-attempt-2-verification.md
strategy-attempt-3-design.md
strategy-attempt-3-implementation.md
strategy-attempt-3-review.md
strategy-attempt-3-verification.md
strategy-attempt-4-design.md
strategy-attempt-4-implementation.md
strategy-attempt-4-review-fixes.md
strategy-attempt-4-topology-audit.md
strategy-attempt-4-v1-transformer-preauth-fix.md
```

`cleanup.md` is an explicitly invalidated pre-fix map and is not promoted here.
The superseding strategy verdict is the final section of `review-report.md`:
`CLEAN - 0 Blocker, 0 Major, 0 Minor, 0 Trivial`, with `C5-S4-M1`,
`C5-S4-B1`, and `C5-S4-M2` closed/re-confirmed.

## Strict Rasen validation

Command (planning root):

```text
rasen validate s02-storage-port --project rocut --strict --json
```

Exit: **0**. Result: `valid: true`, **1 passed / 0 failed / 0 issues**
(`durationMs: 28`). This is the current artifact-tree result; task 12.4 still
requires a final rerun after Phase A/B and final task/evidence updates.
