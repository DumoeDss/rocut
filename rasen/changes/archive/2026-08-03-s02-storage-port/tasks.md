## 1. Freeze the C5 Baseline

- [x] 1.1 Verify `feat/s02-storage-port` is exactly at commit `0ef35459f685d5d41a25d0ef959aff691b7519cd`, tree `286272307b05d23826ffa7223a76695365194dba`, with a clean worktree; stop and reconcile any mismatch before editing.
- [x] 1.2 Record the protected `apps/web/src/editor/ports` base tree `3f7d89b52a3d8f1474519695b7ae7e0a5f68c471` before the intentional C5 contract edit.
- [x] 1.3 Verify and record the protected parity tree `e1fbb55b985f4fb490c6b233d18c50c58ea14c28` and parity oracle blob `fa387ebea1e7f0cc1110eebcb922d393a1337842`.
- [x] 1.4 Verify and record the protected type-fixture blob `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8` and SHA-256 `0f7cc855fc8f5c7edd68b2c371bae993fe8e713d2ffd4ef21956de72bd387622`.
- [x] 1.5 Verify and record public session blobs `ee63d7843fa73df6959aa92030bf4871236b6038`, `c67d9822a2a6c994be14f367e6980fbbaa6e454b`, and `59dd907482a109f8627b217764925bd284f3f223`.
- [x] 1.6 Verify and record Rust trees `d782b046c0f39e85b8a5ed518b42389214c211e5`, `4da4fe82bd946d6ef3937ec0c25f10e77ba674f2`, and `cdaa2215e4b7bbe3f42d2e2c8db32e429cd5af34`.
- [x] 1.7 Verify and record generated package SHA-256 values `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1` and `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`.
- [x] 1.8 Capture the current storage-boundary output: 736 source files, three explicit verification exemptions, browser APIs confined to `services/storage`, zero direct Host mechanism calls, and one `BrowserHostAdapter` user.
- [x] 1.9 Capture the current nine production storage-service/adapter import paths and separately classify direct test/harness consumers, direct IndexedDB/OPFS probes, durable editor preferences, and shell-only preferences.
- [x] 1.10 Capture the type-check ceiling of exactly three inherited errors with their identities; any fourth or changed identity is a hard stop unless explicitly attributed to C5.
- [x] 1.11 Capture the inherited full-suite result `250 pass / 8 fail / 2 loader or module errors / 688 expectations` and the exact `ZERO_MEDIA_TIME`, `__wbindgen_start`, and `DEFAULTS` red identities.
- [x] 1.12 Create `evidence/preflight.md` with commands, exit codes, hashes, inventories, and accepted-red identities rather than relying on terminal recollection.

## 2. Prove the Current Storage Seams Fail

- [x] 2.1 Add a red test that loads a project containing unknown nested provider fields, changes one known timeline field, saves, recreates the Host/session, and demonstrates the unknown fields are currently lost.
- [x] 2.2 Add a red test showing the current project-only `ProjectStore` cannot express media attachment bytes/metadata without importing the singleton or inspecting the opaque payload.
- [x] 2.3 Add a red test showing saved-sound and custom-preset durable libraries cannot use the current store surface without a private path.
- [x] 2.4 Add a red production-composition test showing both Hosts currently inherit `InMemoryProjectStore` when they spread `createInMemoryPorts`.
- [x] 2.5 Add a red inventory assertion for every current production importer, including `BrowserHostAdapter` and the C3-deferred custom-preset local-storage path.
- [x] 2.6 Add a red browser-store conformance fixture that imports the shared storage case matrix and fails because no production browser `ProjectStore` implementation exists.
- [x] 2.7 Add a red migration failure fixture proving legacy sources must remain readable when staged validation fails.
- [x] 2.8 Add red isolation fixtures for equal attachment keys in two projects and equal library keys in two namespaces.
- [x] 2.9 Add negative fixtures for a private storage port/context, direct singleton import, direct IndexedDB/OPFS use, mechanism type leak, and production in-memory fallback; first demonstrate the current gate misses the applicable regressions.
- [x] 2.10 Save the failing outputs and exact test selectors in `evidence/failing-controls.md` before implementation turns them green.

## 3. Amend and Review the Public Store Contract

- [x] 3.1 Inventory the exact media, saved-sound, custom-preset, capacity/support, clear, and cascade operations that the C1 project-only surface cannot express; add that forcing evidence to the committed storage decision record.
- [x] 3.2 Define public mechanism-neutral project-attachment values scoped by `{ projectId, key }`, with opaque metadata and defensively copied portable bytes.
- [x] 3.3 Define public durable library-record values scoped by `{ namespace, key }`, with schema version and opaque data.
- [x] 3.4 Define public availability/capacity results without IndexedDB, OPFS, database, browser-adapter, or OpenCut-schema names.
- [x] 3.5 Define a mechanism-neutral `ProjectStore` error taxonomy for aborted, quota-exceeded, unavailable, corrupt, and conflict outcomes while preserving `null` for absence.
- [x] 3.6 Extend the existing `ProjectStore` directly with attachment, library, capacity, clear/cascade, and optional cancellation operations; do not add a second top-level port, context, factory parameter, or hidden Host property.
- [x] 3.7 Specify that project removal cascades only that project's attachments and never erases another project or user-library namespace.
- [x] 3.8 Specify defensive cloning for records, summaries, opaque data, attachment metadata/bodies, library values, and list results.
- [x] 3.9 Update the existing port export surface and decision record without importing an editor schema, command, state store, persistence mechanism, or database/path literal.
- [x] 3.10 Run the port-boundary positive and negative controls against the amended public surface.
- [x] 3.11 Obtain an independent contract review of the materialized C1 risk, the in-place `ProjectStore` amendment, and rejected alternatives before wiring a production consumer.
- [x] 3.12 Hard stop if review requires preserving the byte-exact C1 interface: return to direction/C1 rather than inventing `MediaStore`, `StoragePort`, `StorageContext`, or a singleton escape hatch.
  - Accounting status: verified not triggered by the round-2 `ACCEPTED CLEAN` review; this is a non-applicable hard-stop guard, not unfinished implementation work.

## 4. Expand the Shared Conformance Matrix and In-Memory Store

- [x] 4.1 Extend the exported storage conformance factory once; keep one case matrix that accepts an adapter fixture rather than copying browser-specific cases.
- [x] 4.2 Add opaque nested project round-trip cases with a defensive-copy assertion and an ordinary known edit between load and save.
- [x] 4.3 Add attachment save/load/list/replace/remove cases that compare metadata and every byte.
- [x] 4.4 Add equal attachment-key isolation across two project IDs and cascade-removal cases.
- [x] 4.5 Add library save/load/list/replace/remove cases and equal-key isolation across two namespaces.
- [x] 4.6 Add availability/capacity cases that distinguish unsupported or unavailable storage from a valid zero-space estimate.
- [x] 4.7 Add `null`-for-absence and typed quota/unavailable/corrupt/conflict failure cases.
- [x] 4.8 Add pre-aborted read/write cases and failure-before-commit cases that prove the previous value remains visible.
- [x] 4.9 Add serialized durable-mutation ordering cases for one key and independent progress for distinct keys.
- [x] 4.10 Keep destructive migration cases behind `exerciseMigration: true` and require a fixture-declared disposable identity/prefix.
- [x] 4.11 Extend `InMemoryProjectStore` to pass the complete matrix using copied opaque values and buffers, with no fixed-return stub.
- [x] 4.12 Run the complete port conformance suite and record per-port/per-case results in `evidence/conformance-in-memory.md`.

## 5. Implement the Production Browser Store

- [x] 5.1 Introduce `BrowserProjectStore` under `apps/web/src/services/storage/` as the only production browser implementation of `EditorHost.store`.
- [x] 5.2 Move or wrap project summary/payload CRUD behind `BrowserProjectStore` while retaining the real configured projects database and object-store identities.
- [x] 5.3 Implement project attachment metadata/body CRUD behind the store using staged bodies and an explicit metadata commit point.
- [x] 5.4 Implement durable library-record CRUD for saved sounds and graph presets without exposing their schema or namespace constants in the port contract.
- [x] 5.5 Implement availability/capacity inspection and clear/cascade behavior in mechanism-neutral contract terms.
- [x] 5.6 Defensively clone every browser-store input/output so adapter authors and editor callers cannot mutate persisted state by reference.
- [x] 5.7 Map DOM/IndexedDB/OPFS failures to the public error taxonomy with operation/scope diagnostics and without payload contents.
- [x] 5.8 Honor pre-aborted signals before work, preserve prior values on failure/cancellation before commit, and avoid reporting cancellation after commit.
- [x] 5.9 Ensure temporary attachment bodies are not enumerable as committed records and make orphan cleanup idempotent/best-effort.
- [x] 5.10 Export a browser conformance fixture that creates a randomized prefix-validated disposable database/path identity and resolves every cleanup target before deletion.
- [x] 5.11 Run the exact shared storage matrix against `BrowserProjectStore` in a real browser environment without skipped, copied, or adapter-weakened cases.
- [x] 5.12 Record real browser conformance, database inventory, storage identities, and cleanup proof in `evidence/conformance-browser.md`.

## 6. Make Migration Durable, Real, and Non-Destructive

- [x] 6.1 Key browser migration coordination by configured durable database identity as well as the existing once-per-store session promise.
- [x] 6.2 Open legacy databases and object stores under their real names; assert no name can derive from `undefined`.
- [x] 6.3 Stage migrated projects, summaries, attachment metadata, and bodies without deleting or overwriting the readable source first.
- [x] 6.4 Validate staged keys, schema versions, project/attachment counts, known structure, and opaque sentinels by reading the staged result back.
- [x] 6.5 Commit the current representation only after validation and delete legacy sources only after the committed result is re-read successfully.
- [x] 6.6 Preserve and retry the source on transformation, write, validation, conflict, quota, unavailability, or pre-commit cancellation failure.
- [x] 6.7 Treat cleanup failure after a successful commit as attributed retryable diagnostics rather than erasing the committed result or falsely rerunning transformation.
- [x] 6.8 Preserve the C1 rule that concurrent sessions sharing one store await one migration result and a failed attempt is retryable on later creation.
- [x] 6.9 Add real-browser probes for current-version no-op, seeded legacy success, failure-before-commit preservation, two-wrapper race prevention, and missing opt-in refusal.
- [x] 6.10 Compare the same probe's before/after database inventory to the recorded `undefined` defect trace and verify no undefined database/store remains.
- [x] 6.11 Verify migration tests never open the developer's real profile identity and teardown only the resolved disposable prefix.
- [x] 6.12 Record migration progress, validation, failure, source-preservation, retry, and cleanup evidence in `evidence/migration.md`.

## 7. Add the Session Persistence Coordinator and Opaque Codec

- [x] 7.1 Add one session-scoped editor persistence coordinator above `host.store`; it may know OpenCut schemas but must not call browser persistence APIs.
- [x] 7.2 Decode known project data while retaining a defensive complete opaque snapshot for that session/project.
- [x] 7.3 Implement identity-aware overlay for project, scene, track, clip, media, attachment metadata, and library records, preserving unknown sibling fields.
- [x] 7.4 Ensure deletion of a known identified node removes that node and its private fields, while a newly created node does not inherit unrelated private data.
- [x] 7.5 Replace JSON-only cloning or typed `SerializedProject` reconstruction with structured-clone-compatible opaque handling.
- [x] 7.6 Serialize durable mutations per logical key and surface save failure before mutating UI state as if persistence succeeded.
- [x] 7.7 Add tests with private sentinels at every supported nesting level, a known edit, full Host/session recreation, and semantic equality after reopen.
- [x] 7.8 Add tests for delete/new-node behavior so private fields are preserved only for retained identities.
- [x] 7.9 Add two-session tests proving committed durable sharing but independent decoded snapshots, caches, listeners, and command queues.
- [x] 7.10 Hard stop if any provider-private sentinel is lost or if a passing test omits the known edit/full-recreation steps.

## 8. Rewire Every Persistence Consumer

- [x] 8.1 Rewire `core/managers/project-manager.ts` project list/load/save/delete/duplicate flows through the session coordinator/store and remove its singleton import.
- [x] 8.2 Rewire `core/managers/media-manager.ts` attachment list/load/object reconstruction through the owning session and remove its singleton import.
- [x] 8.3 Rewire `core/managers/scenes-manager.ts` persistence after scene mutations through the owning session and remove its singleton import.
- [x] 8.4 Rewire `commands/media/add-media-asset.ts` to commit attachment bytes/metadata through the owning session with ordered durable semantics.
- [x] 8.5 Rewire `commands/media/remove-media-asset.ts` through the owning session and preserve project isolation/cascade semantics.
- [x] 8.6 Rewire `media/processing.ts` capacity checks and persisted attachment lookup without importing storage mechanisms or the singleton.
- [x] 8.7 Rewire `sounds/sounds-store.ts` to a session-owned durable library namespace while preserving ordered durable mutations and independent live StoreApi state.
- [x] 8.8 Rewire `timeline/components/graph-editor/custom-presets-store.ts` from direct localStorage/process caches to a session-owned durable library namespace.
- [x] 8.9 Rewire `components/storage-provider.tsx` to expose the existing session store/coordinator, capacity state, and clear actions without constructing a hidden store.
- [x] 8.10 Update `project-manager-thumbnail-degraded.test.ts` to inject a conforming test store/coordinator rather than monkey-patching `storageService`.
- [x] 8.11 Update `c4-forced-none-harness.tsx` to seed through its Host store/coordinator while preserving the C4 forced-none assertions.
- [x] 8.12 Classify and update any remaining test/harness singleton consumer; do not exempt a production path merely to make the inventory pass.
- [x] 8.13 Verify project/media/sound/preset failures reach session diagnostics and visible recoverable UI paths without payload leakage or silent success.
- [x] 8.14 Run focused manager, command, media-processing, sounds, preset, storage-provider, and C4 harness tests after each call family is inverted.

## 9. Complete Host Composition and Retire Provisional Paths

- [x] 9.1 Create a stable explicitly configured browser-store instance in `apps/vite-example/src/host/vite-host-config.ts` and final-override the in-memory `store` value.
- [x] 9.2 Create a stable explicitly configured browser-store instance in `apps/web/src/editor/host/next-editor-host.ts` and final-override the in-memory `store` value.
- [x] 9.3 Ensure concurrent sessions in one Host intentionally share the durable store identity while session coordinators/caches remain per-session.
- [x] 9.4 Make every `EditorHost` port role required, collapse `EditorHost`/`ResolvedEditorHost` optionality, and remove fallback/cast resolution made obsolete by complete Host composition.
- [x] 9.5 Update in-memory Host/test factories to supply the complete required surface explicitly without widening the public session/factory call shape.
- [x] 9.6 Rewire `apps/vite-example/src/project-picker.tsx` through the configured Host store/coordinator and remove its `BrowserHostAdapter` import.
- [x] 9.7 Delete `services/storage/browser-host-adapter.ts` and all provisional documentation after verifying no importer remains.
- [x] 9.8 Remove or internalize the exported process-global `storageService` so no distributable editor production module can import it.
- [x] 9.9 Add a production-graph assertion for both Hosts that rejects in-memory store inheritance, a missing final override, fallback expressions, adapter resurrection, and parallel storage contexts.
- [x] 9.10 Run both Host/session focused suites, including migration once-per-store/retry behavior and two-session durable sharing.

## 10. Enforce the Final Boundary with Negative Controls

- [x] 10.1 Update `script/check-storage-boundary.mjs` to enumerate all production source files and report direct singleton/adapter imports separately from mechanism calls.
- [x] 10.2 Permit IndexedDB/OPFS only under `apps/web/src/services/storage/**` and the three exact parity/seed/legacy-migration fixtures; reject broad directory or glob exemptions.
- [x] 10.3 Remove saved sounds and custom graph presets from any localStorage preference allowlist after their durable-library rewiring.
- [x] 10.4 Keep unrelated shell/local UI preferences explicitly classified and outside C5 rather than silently broadening the change.
- [x] 10.5 Extend the port-boundary check to reject OpenCut schema, command, state-store, database/store/path, and browser-mechanism leaks in public storage signatures/imports.
- [x] 10.6 Extend the composition check to reject a second storage/media port, storage context, hidden Host property, direct singleton, or in-memory production fallback.
- [x] 10.7 Run every negative fixture and record its non-zero exit and targeted diagnostic; a gate without a demonstrated failure is not accepted.
- [x] 10.8 Run the positive gates on the real tree and record zero unexpected direct importers, zero adapter users, and only the three named mechanism exceptions.
- [x] 10.9 Perform `rg` sweeps for `storageService`, `BrowserHostAdapter`, `indexedDB`, OPFS APIs, storage-path literals, and persistence localStorage; classify every hit in evidence.
- [x] 10.10 Record the final source-file count, explicit exemptions, and commands in `evidence/boundaries.md`.

## 11. Verify Builds, Parity, Regressions, and Provenance

- [x] 11.1 Run the focused C5 tests together: both conformance implementations, opaque full-reload round-trip, migration, isolation, failure/cancellation, consumer rewiring, Host composition, and negative controls.
- [x] 11.2 Run the type gate and compare with the exact three-error inherited ceiling; hard stop on any new or changed error identity.
- [x] 11.3 Build Vite from a fresh output/cache state and record module count/output manifest; compare with the C4 baseline of 2,873 transformed modules.
- [x] 11.4 Build Next from a fresh output/cache state and run the existing 18/18 route gate.
- [x] 11.5 Run the protected Vite and Next parity capture/diff unchanged and require 10/10 scenarios, 195 leaves, zero semantic differences, and only the nine known incidental differences unless separately explained.
- [x] 11.6 Verify the parity tree and oracle hashes are unchanged after the parity run.
- [x] 11.7 Run the source-graph/boundary manifest gates and account for any delta from the C4 baselines of 699 modules, 298 copied files, and seven emitted files.
- [x] 11.8 Run the WASM API/artifact gates and preserve 38 JavaScript exports, 58 binary exports, and 609 imports.
- [x] 11.9 Recompute public-session, type-fixture, Rust-tree, and generated-WASM hashes and require every protected value to match preflight.
- [x] 11.10 Run the full regression suite and require no new red beyond the exact inherited eight failures/two loader-module errors; classify every delta by test identity.
- [x] 11.11 Run source inventory, provenance, SBOM, license/reference, and tracked-generated-file checks; update generated documentation only through its canonical generator if C5's real source graph requires it.
- [x] 11.12 Save commands, environment, exit codes, counts, diffs, and artifact hashes in `evidence/regression.md`; do not summarize a failed gate as passing.

## 12. Cleanup, Review, and Ship Hard Stops

- [x] 12.1 Inspect the final diff against the expected write set; attribute every additional product file and remove accidental cache, database, browser-profile, screenshot, build-output, or test-fixture artifacts.
- [x] 12.2 Verify no C6 five-resource disposal/shared-GPU teardown, C7 headless emission, E1 behavior, protected fixture, Rust, or generated-WASM implementation entered the diff.
- [x] 12.3 Update `BOUNDARIES.md`, `FEATURE_HANDLING.md`, `PARITY.md`, and relevant storage/Host documentation to describe the final store boundary, private-data guarantee, migration rules, and explicit preference classifications.
- [x] 12.4 Re-run strict Rasen validation and verify every implemented scenario maps to at least one focused or integration test and every task has evidence.
- [x] 12.5 Request an independent pre-landing review focused on unknown-field retention, IndexedDB/OPFS commit gaps, migration deletion ordering, error/cancellation semantics, private backchannels, Host fallbacks, and multi-session isolation.
- [x] 12.6 Fix all accepted findings and re-run the smallest affected gates plus the full protected/boundary/regression tail; retain finding disposition in `evidence/review.md`.
- [x] 12.7 Hard stop shipping on any provider-private loss, browser/non-browser conformance divergence, production in-memory fallback, unclassified direct persistence hit, unsafe migration deletion, parity-oracle change, protected-hash drift, type ceiling increase, or new regression red.
- [x] 12.8 Verify the final worktree contains only intentional C5 files, all disposable storage has been safely cleaned, and no user-profile database was targeted.
- [x] 12.9 Commit the product change only after the review/verification tail is green; record exact commit/tree identities and delivery destination in the implementation handoff.
- [x] 12.10 State in the handoff that C6 must rebase on C5 before editing ports/session/storage consumers, C7 follows C6 and consumes the required Host shape, and E1 must serialize project/media-manager overlap.
