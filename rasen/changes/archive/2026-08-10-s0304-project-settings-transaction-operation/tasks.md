## 1. Contract operation, in-memory reducer, and T0 conformance

- [x] 1.1 Add exported `ProjectPatch` and `UpdateProjectOperation` types to `apps/web/src/editor/contracts/operations.ts`, include `update-project` in `TransactionOperation`/`OPERATION_KINDS`, and re-export the new types through the contracts barrel without adding a generic payload
- [x] 1.2 Add closed runtime Project-patch checks shared in behavior by the reference and durable reducers: require a non-empty own-key subset of `name`/`frameRate`/`canvasWidth`/`canvasHeight`, reject `id`, unknown/symbol keys, null/mismatched Projects, and validate the complete resulting Project under the existing name/dimension/frame-rate rules
- [x] 1.3 Extend `apps/web/src/editor/contracts/in-memory/index.ts` with an atomic working Project copy and `update-project` reduction so any later operation failure discards the Project patch, while success commits it with `projectId` in `changedIds`
- [x] 1.4 Prove the in-memory convention that empty Project patches reject but non-empty same-value patches succeed with one revision/watch transition; prove changed patches preserve unpatched fields, never create IDs, and keyed replay/collision includes the complete Project operation
- [x] 1.5 Extend `runTransactionConformance` with a seeded-Project update/read/atomicity/watch/idempotency vector and require the complete twelve-kind `OPERATION_KINDS` inventory; ensure a genuinely inapplicable projectless case is skipped rather than passed and the seeded reference/engine acceptance targets execute it

## 2. Durable evaluator, conformance, and native-adapter evidence

- [x] 2.1 Add exhaustive `update-project` handling to `apps/web/src/editor/contracts/engine/evaluator.ts`, using the selected non-null Project and the closed patch validation before final `isValidProject`/document invariant checks; append `projectId` per accepted operation and preserve canonical operation ordering
- [x] 2.2 Run the candidate Project through the existing final base-placement policy so an fps change rejects clips/markers left off the new grid but a same-batch typed repair can restore validity; keep validation, dry-run, Draft evaluation, and apply on this single evaluator
- [x] 2.3 Prove the existing engine commit protocol needs no interface widening: a valid Project patch fingerprints canonically, saves/publishes/notifies once, returns equal dry-run/apply results, survives reopen, and leaves reads/revision/idempotency/watchers unchanged on evaluator, adapter, or store failure
- [x] 2.4 Update `runTransactionEngineConformance` to replace the hard-coded eleven-kind assertion with the twelve-kind inventory and add Project cases for final-placement validity, queued ordering, one-save failure atomicity, canonical replay/collision, opaque preservation, and reopen equality
- [x] 2.5 Extend focused engine tests for empty/excess-key/id patches, null and mismatched Projects, empty name, non-finite/non-positive dimensions, invalid frame rates, same-value success, `changedIds`, validate/dry-run purity, same-batch fps repair, and later queue recovery
- [x] 2.6 Extend transaction-native adapter tests to prove Project name/frame-rate/canvas fields and `ProjectSummary.name` encode/decode exactly, unrelated opaque siblings survive, and reopened Project/revision/idempotency state equals the committed candidate without changing the adapter interface or implementation unless evidence exposes a defect

## 3. Draft classification, review, inverse, and compensation

- [x] 3.1 Add `update-project` to the exhaustive Draft-safe classification and affected-ID review switch; derive the twelfth `byKind` count from `OPERATION_KINDS` and report `projectId` in stable journal order
- [x] 3.2 Prove Draft savepoint evaluation accepts valid Project patches and rolls an invalid Project or mixed Project/entity tool call back to the exact prior working document and journal with zero durable effects
- [x] 3.3 Replace the Project-change throw in `planDraftCompensatingOperations` with at most one `update-project` inverse containing only changed fields' base pre-images; keep null/ID transitions fail-closed and retain the existing non-empty fallback for a content-neutral same-value forward operation
- [x] 3.4 Compose the Project inverse with existing entity updates/minimal suffix repairs and preflight the exact compensation against the projected forward commit plus the same placement/provider policies before the one parent-engine apply
- [x] 3.5 Update Draft conformance's hard-coded eleven-kind register/journal assertions to twelve and add Project coverage for classification, review counts, savepoint rollback, stale approval, one mixed Project+clip parent apply, final-timebase rejection, minimal compensation, undo restoration, and run-local repeatability
- [x] 3.6 Add focused Draft tests proving a one-to-four-field Project inverse stays one operation in a large document, contains no unchanged fields, restores the base after non-stale undo, conflicts after later work, and publishes no forward state when compensation preflight rejects

## 4. Reviewed downstream recovery handoff

- [x] 4.1 Record the independently reviewed corrective commit as an explicit prerequisite for resuming T3; do not edit T3 product source in this child or weaken its detached prepare → durable commit → publish, exact equality, shared-engine, opaque-overlay, or one-save design
- [x] 4.2 Hand off the T3 recovery matrix: projection emits `update-project`; draft context retains public fps/canvas; settings classification is public-only, mixed with exactly one typed public sibling, or explicit private-only gap; public fps ratchets use an explicit typed/history policy rather than legacy mutation
- [x] 4.3 Hand off T3 acceptance for first-image 1920x1080 → 320x180 equality across engine/live donor/persisted record/cache/reopen, all-surface rollback on failed save, stable minification-safe routing IDs, audio `hidden: false`, no duplicate legacy save, and the existing `pushHistory: false` canvas undo ownership
- [x] 4.4 Require T3 to probe fps parity under final-document placement rules and capture before-routing versus after-routing normalized evidence on each Host separately from Vite-versus-Next equality; do not change the parity oracle or pull Surface/Host/Rust work into this child
- [x] 4.5 Hand off T4 acceptance after corrected T2/T3: advertise twelve kinds, execute at least one typed Agent Project patch, assert one revision/save/watch, reopen equality, mutation-free same-key replay, and same-key/different-patch collision without donor inference

## 5. Corrective verification and scope gates

- [x] 5.1 Run the focused in-memory/T0, T1 engine/native-adapter, and T2 Draft suites plus all three reusable conformance layers; record zero failed executed cases and prove the Project cases execute rather than pass vacuously
- [x] 5.2 Run `node script/check-transaction-boundary.mjs` and `node script/check-transaction-boundary.mjs --negative-control`; confirm the widened Host-neutral operation and Draft/engine changes introduce no donor, command, core, store implementation, Zustand, storage-mechanism, React, Rust, or WASM leak
- [x] 5.3 Run `node script/check-type-baseline.mjs` and keep diagnostics at or below the pinned ceiling of 3 without regenerating the fixture
- [x] 5.4 Build `apps/web` and `apps/vite-example` and run the established unchanged parity path proportionately, classifying only independently reproduced environment failures as pre-existing because the corrective child wires no runtime caller
- [x] 5.5 Sweep every canonical `rasen/specs/*/spec.md` SHALL/MUST assertion for behavior falsified by the implementation, with special attention to atomic batches, idempotency/no-op watch semantics, final placement, Draft compensation, and the updated twelve-kind inventory
- [x] 5.6 Audit the product diff against the declared corrective touch set: contracts operation/barrel/in-memory/conformance, engine evaluator/conformance/tests/native-adapter evidence, and Draft classification/review/inverse/compensation/conformance/tests only; no engine/adapter/ProjectStore interface widening, archived Change edit, T3/T4 product implementation, Surface/Host root, Rust/WASM, parity-oracle, or type-baseline-fixture change
- [x] 5.7 Strictly decode every changed text file as UTF-8 and inspect for BOMs, U+FFFD, mojibake, mixed line endings, secrets, unrelated rewrites, and non-task working-tree changes
- [x] 5.8 Run `rasen validate s0304-project-settings-transaction-operation --strict --project rocut --json` and resolve every artifact/spec error before reporting the corrective implementation ready for review
