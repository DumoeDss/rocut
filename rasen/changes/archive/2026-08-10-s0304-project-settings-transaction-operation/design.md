## Context

T0 froze a Host-neutral `Project` whose public fields are `id`, `name`, `frameRate`, `canvasWidth`, and `canvasHeight`, but its closed `TransactionOperation` union contains only eleven track, clip, asset, and marker operations. T1's evaluator consequently copies `document.project` unchanged while reducing every legal batch. T2 then made that same union exhaustive in Draft classification, review counts, savepoint evaluation, and compensation planning; its current inverse planner throws if Project metadata differs.

T3's implementation audit exposed the resulting contradiction. Established first-image insertion changes the public canvas from 1920x1080 to the image's 320x180 dimensions. Exact donor/engine projection equality and one durable save require that public change to be produced by the typed batch, yet no current operation can express it. Omitting the canvas change breaks editing parity; inferring it in an adapter makes open reads, replay, and reopen disagree; a second legacy save breaks atomicity. Direct frame-rate and canvas settings have the same hole.

The existing transaction module is otherwise the correct deep module and seam. Its small `apply`/`validate`/`dryRun` interface already hides canonical fingerprinting, final-document invariants, placement policy, one `ProjectStore.save`, durable-before-publication, revision/idempotency metadata, reads, watches, and reopen. This correction adds one operation at that existing interface rather than layering another mutation path or widening the engine, document-adapter, or `ProjectStore` interfaces.

Current update semantics are also authoritative context: `update-track`, `update-clip`, and `update-marker` accept a non-empty same-value patch, append the target ID to `changedIds`, and produce a normal successful revision. They currently also accept empty patches. This design preserves the former convention for `update-project` but deliberately rejects an empty Project patch, because a new operation can define a deterministic no-intent guard without retroactively changing the archived operation semantics.

## Goals / Non-Goals

**Goals:**

- Add one compile-visible, Host-neutral `update-project` operation at the existing transaction interface.
- Make Project updates atomic, attributable, idempotent, validation/dry-run-pure, durable, watchable, reopenable, and discoverable through the same evaluator and engine paths as every other operation.
- Preserve the current update convention for non-empty same-value patches while making empty and runtime-smuggled Project patches fail deterministically.
- Validate frame-rate changes against the complete final batch document, including every existing or simultaneously repaired clip and marker placement.
- Extend the in-memory reference implementation, T0/T1 conformance, and T2 Draft classification/review/inverse/compensation behavior without adding another public mutation interface.
- Give T3 and T4 an explicit reviewed prerequisite that restores public Project-setting parity and third-party Agent evidence.

**Non-Goals:**

- Add create/delete Project operations, change Project selection, or allow `id` mutation.
- Expose donor `TProjectSettings`, provider-private settings, a generic command payload, or an invoke-any-command interface.
- Infer canvas or frame rate from assets/clips, mutate Project data inside an adapter or placement policy, attach an untyped companion delta, or perform a second legacy save.
- Widen `TransactionEngine`, `TransactionDocumentAdapter`, S02's `ProjectStore`, session/Host ports, or the canonical error-code union.
- Edit archived T0/T1/T2 Change history, implement T3 command routing or T4 Agent code in this child, or touch Surface, Host composition roots, Rust/WASM, package boundaries, the parity oracle, or the type-baseline fixture.

## Decisions

### 1. Design it twice: widen the closed operation union, not the batch or adapter seam

Two materially different interfaces were evaluated:

| Design | Interface and hidden behavior | Depth, locality, and seam result |
| --- | --- | --- |
| **A. Typed `update-project` operation** | One new discriminated member enters the existing batch. The existing evaluator, canonical fingerprint, placement validation, engine commit protocol, adapter encode, reads, watches, and reopen behavior remain behind the same interface. | Highest leverage and locality: callers learn one typed operation; all correctness stays in the established transaction module; exhaustive consumers fail visibly until updated. |
| **B. Batch companion Project delta or adapter inference** | `TransactionBatch` gains a second mutation channel, or the concrete adapter derives Project changes from donor/assets/clips. Validation, fingerprinting, results, reads, replay, Drafts, and reopen must all learn hidden semantics outside `supportedOperations()`. | Shallow and split: every caller/test must understand two mutation channels, or engine state diverges from the saved record. Direct settings changes remain unrepresentable if inference depends on media. |

Design A is selected. The engine and in-memory dependencies are in-process or local-substitutable, so there is no reason to add a new port. The current document adapter seam already has two real adapters (transaction-native and OpenCut); neither needs a wider interface. Design B is rejected because its complexity would reappear across callers and conformance targets, failing the deletion test for a useful module.

Deriving canvas from `create-asset`/`create-clip`, allowing a provider-private staged candidate to mutate public Project state, or issuing a same-root legacy save are also rejected. Each either gives an existing operation an undocumented public side effect, omits direct settings cases, breaks the canonical idempotency identity, or creates an observable partial commit.

### 2. The twelfth operation has a narrow Host-neutral type

The contract adds these exported types and includes the operation in `TransactionOperation` and `OPERATION_KINDS`:

```ts
type ProjectPatch = Partial<
  Pick<Project, "name" | "frameRate" | "canvasWidth" | "canvasHeight">
>;

type UpdateProjectOperation = {
  readonly kind: "update-project";
  readonly projectId: ProjectId;
  readonly patch: ProjectPatch;
};
```

The name is `update-project`, not `update-project-settings`: the operation owns only the public Host-neutral `Project`, never the donor's broader settings object. It has no create/delete counterpart because the selected Project lifecycle remains outside this transaction slice.

Widening the union is intentionally compile-visible. `OperationKind`, `supportedOperations()`, exhaustive switches, classification records, review counts, conformance vectors, and downstream consumers must all acknowledge the twelfth kind. This is the visibility T0 explicitly chose over a generic escape hatch.

### 3. Runtime patch validation is closed and final-Project validation reuses the invariant

TypeScript's `Partial<Pick<...>>` is not a runtime trust boundary. Before spreading the patch, both reducers must require a non-null object whose own keys are a non-empty subset of exactly `name`, `frameRate`, `canvasWidth`, and `canvasHeight`. Every other own key—including `id`, a provider-private string, or a symbol—is rejected at the operation index. This prevents object spread plus the permissive entity invariant from silently retaining smuggled fields.

The selected document must contain a non-null Project and `operation.projectId` must equal its `id`. A null Project or mismatched ID is a structured not-found failure. The operation then overlays the allowed patch without changing `id` and validates the resulting Project through the existing invariant:

- `name` is a string with `length > 0`; whitespace is not newly normalized;
- `canvasWidth` and `canvasHeight` are finite numbers greater than zero; this design does not invent an integer-only rule;
- `frameRate.numerator` and `.denominator` are positive integers accepted by `validateFrameRate`, so the rate is a valid positive rational with integer ticks per frame at 120,000 ticks/sec;
- the resulting `id` still equals the selected project ID.

The in-memory fake performs the same checks against a working Project copy and commits it only after every operation succeeds. T1's evaluator uses `isValidProject`/`validateTransactionDocument` on the final candidate. No new invariant module or error code is needed.

### 4. Empty patches fail; non-empty same-value patches are successful updates

An empty `patch` is rejected as an attributable validation/invalid-entity issue before durability. It does not enter `changedIds`, increment revision, save, reserve an idempotency key, or notify watchers.

A non-empty patch whose values equal the selected Project is accepted, matching the established `update-track`/`update-clip`/`update-marker` convention. For each accepted `update-project`, the reducer appends `projectId` to `changedIds` in operation order, adds nothing to `createdIds`, and the batch follows the normal successful path: one revision increment, one save in the durable engine, and one watcher notification. It is not a contract no-op. This avoids a fourth, Project-only equality protocol and keeps validate/dry-run results equal to a later apply.

An exact keyed replay remains the real no-op: because the complete typed operation and patch enter the existing canonical fingerprint, replay returns the original result with no new revision/save/watch, while the same key with any different Project patch rejects as `duplicate`. Property insertion order remains irrelevant and operation-array order remains significant.

### 5. Frame-rate validity is evaluated on the complete final document

`update-project` mutates the evaluator's working Project before the existing final invariant and base placement policy run. The policy therefore computes ticks per frame from the candidate Project and validates every final clip time field and marker time, not only entities mentioned by the Project operation.

Consequences are explicit:

- changing 30 fps (4,000 ticks/frame) to 24 fps (5,000 ticks/frame) is rejected if an existing clip or marker remains on the old-only grid;
- the same batch is accepted when accompanying typed clip/marker operations leave the complete final document valid on the new grid;
- validation, dry-run, Draft savepoints, compensation preflight, and apply all reuse this evaluator and reach the same placement decision;
- a rejected change publishes and persists nothing.

This is a T3 parity risk because the donor's legacy settings command may have permitted a frame-rate change that leaves placements misaligned. The correction does not weaken T1's non-replaceable placement contract. T3 must add a baseline probe and treat the typed rejection as the transaction rule; it may preserve an intended edit only by including the necessary typed placement repairs in the same root batch, never by retiming implicitly.

### 6. The existing engine commit protocol and adapters require no new interface

Once the evaluator returns the Project-bearing candidate, the current engine already provides the required behavior:

1. canonicalize the full operation array, including `projectId` and every patch field;
2. evaluate expected revision, idempotency, operations, invariant, and placement on a clone;
3. encode the complete candidate through the existing adapter;
4. await exactly one `ProjectStore.save`;
5. publish the Project/revision/idempotency result and notify once only after save;
6. decode the same Project after reopen.

The transaction-native adapter already stores the complete `TransactionEngineDocument` and derives `ProjectSummary.name` from `document.project`. Its focused tests must prove Project patches survive encode/decode, preserve opaque siblings, and update the summary when the public name changes. The OpenCut adapter already overlays these public Project fields and is consumed later by T3; it is not changed in this child.

`validate` and `dryRun` remain pure because they call the same evaluator without encode/save/publication. Store failure remains a `ProjectStoreError`; operation/invariant/placement failures remain existing structured transaction issues/errors. The current `cross-engine-cas: false` limitation is unchanged.

### 7. Conformance advertises and exercises all twelve kinds

T0 conformance must require the complete `OPERATION_KINDS` inventory rather than a six-kind subset and add a seeded-Project case covering update/read, `changedIds`, atomic rollback, same-value success, empty/unknown patch rejection, watch behavior, and keyed replay/collision. A projectless target may report a Project-specific case as skipped only when the case performs no assertion; the in-memory reference and engine targets used for acceptance must be seeded so the case executes and passes.

T1 conformance replaces the hard-coded `length === 11` assertion with the twelve-kind inventory and adds durable Project cases for dry-run/apply equality, one-save publication, save-failure non-publication, canonical replay/collision, opaque-field preservation, and reopen Project/summary equality. Focused engine/native-adapter tests cover invalid name, dimensions, frame rate, ID mismatch, null Project, forbidden keys, queued ordering, and final-placement rejection/repair.

No conformance interface is widened. Tests continue crossing the same public transaction/engine interfaces and observable store/watch seam.

### 8. T2 treats Project updates as Draft-safe and builds a constant-size inverse

`update-project` is reversible project-content work, so it enters the exhaustive `DRAFT_OPERATION_CLASSIFICATION` as `draft-safe`. Runtime classification accepts the twelfth operation; review derivation reports `projectId`, initializes a twelfth `byKind` count, and preserves journal order.

Draft staging already holds `project` in its private working document and calls the shared evaluator. A valid Project patch therefore participates naturally in per-call savepoint replacement; any invalid patch or final placement issue rolls back the complete call without changing earlier Draft work or durable state.

The compensation planner replaces its current “Project metadata changed” throw with one inverse `update-project` when the candidate Project differs from the base:

- null/non-null transitions or ID changes still fail closed because this operation cannot create, delete, or retarget a Project;
- the inverse patch contains only the pre-image of the allowed public fields whose values differ between base and candidate;
- Project inverse size is constant—at most one operation and four fields—regardless of track/clip/asset/marker collection size;
- it composes with the existing minimal entity updates/suffix repairs in one compensation batch and passes the same provider-policy preflight against the complete projected forward commit;
- a content-neutral same-value forward Project update uses the existing non-empty compensation fallback rather than inventing another operation.

Conformance updates both hard-coded eleven-kind assertions, includes Project in the “every operation kind” journal/inverse case, and proves savepoint rollback, stale approval rejection, a mixed Project+clip one-parent-apply, review counts, minimal inverse, compensation preflight, undo restoration, and repeatable run-local accounting. Focused tests additionally prove the Project inverse remains one operation in a large document.

### 9. T3 resumes only after consuming the reviewed correction

T3 must preserve its reviewed detached prepare → durable commit → publish design, stable explicit routing IDs, audio `hidden: false` normalization, exact donor/engine public equality, opaque overlay, one shared engine, and one-save publication. It consumes or cherry-picks this corrective implementation before resuming and updates its own artifacts rather than rewriting archived T0/T1/T2 history.

The recovery contract is:

- `projection.ts` emits one `update-project` when public Project fields differ;
- `draft-context.ts` no longer discards public `fps` or `canvasSize` mutations;
- `UpdateProjectSettingsCommand` is classified per changed field: public-only edits route as a transaction, mixed public/private edits carry exactly one typed public sibling plus private donor state in the staged candidate, and private-only edits remain an explicit provider-private gap;
- first-image canvas selection stays in the same root transaction as the asset/clip work and preserves 1920x1080 → 320x180 behavior across engine reads, live donor state, persisted record, persistence cache, and reopen;
- public fps ratchets cannot remain an untracked legacy mutation; they require an explicit typed transaction and explicit history policy after attachment success;
- failed save leaves all those surfaces at the base value, and successful publication still causes one apply/save/revision/watch/history publication;
- before-routing versus after-routing normalized parity is recorded on both Hosts, separately from Vite-versus-Next comparison.

Atomic durability and undo ownership remain separate. Baseline `InsertElementCommand` performs the first-image canvas update with `pushHistory: false`, and its undo restores tracks only. T3 must pin and preserve that behavior unless Direction explicitly changes it: the forward root includes `update-project` for atomic durability, while its history inverse keeps the new canvas and omits a Project reversal. This child does not redesign T3 history.

### 10. T4 publishes the corrected third-party surface

After T2 and corrected T3 are available, T4 updates published conformance vectors to advertise all twelve operation kinds. Its Agent scenario performs at least one typed `update-project` patch through the public interface, asserts exactly one revision/save/watch result, reopens and compares Project equality, replays the same idempotency key without mutation, and proves a same-key/different-patch collision. The scenario must not depend on donor inference or a provider-private command.

## Risks / Trade-offs

- **[Compile-visible union widening]** Exhaustive consumers will fail until updated. → Treat those failures as the intended inventory of work; update contract, engine, Draft, and downstream vectors together and keep the union closed.
- **[Frame-rate parity differs from permissive legacy behavior]** Existing content may become invalid on a new timebase. → Validate the complete final batch, add the T3 baseline probe, and require explicit typed repairs rather than weakening placement or retiming implicitly.
- **[Same-value patches consume a revision]** A caller can intentionally commit unchanged Project values. → Preserve cross-entity update consistency; reserve no-op semantics for rejection and keyed replay, and reject only the truly empty patch.
- **[Runtime excess properties bypass TypeScript]** Untrusted callers can force `id` or provider fields across the boundary. → Validate every own patch key against the four-key allowlist before spread and cover string/symbol excess keys in conformance.
- **[T2 compensation changes a previously impossible path]** Incorrect field selection could restore too much or fail placement. → Emit only changed public pre-images, preflight the exact inverse against the projected forward commit, and test mixed Project/time-entity batches plus large-document constant size.
- **[Archived artifacts still describe eleven kinds]** Historical T0/T1/T2 documents will not reflect the correction. → Preserve them as reviewed history; this corrective delta and the canonical spec after archive become current authority.
- **[No cross-engine CAS]** Project updates share the same pre-existing independent-engine race as other operations. → Keep `cross-engine-cas: false` and require T2/T3 callers to share the session engine; do not widen `ProjectStore` here.

## Migration Plan

1. Implement and review the corrective contract/evaluator/Draft delta in the current product tree; do not edit archived Change directories or T3's preserved implementation.
2. Run T0, T1, and T2 conformance/focused tests plus boundary, type-baseline, Host build/parity, UTF-8, and canonical spec-falsification gates. Archive the corrective Change only after independent verification, syncing its one additive requirement into `transaction-automation-api`.
3. Update T3's artifacts to consume the correction, resume its preserved implementation, restore Project projection/routing, and record first-image, settings, failure, undo-policy, and before/after parity evidence.
4. Update T4's vectors and Agent evidence to advertise and exercise the twelfth operation.

No persisted data migration is required: Project fields and the engine document already exist, and the idempotency ledger stores fingerprints/results rather than a new Project payload schema. Before T3/T4 consume the operation, rollback is removal of the additive support. After consumers ship, rollback must remove or gate those callers at the same time; silently accepting `update-project` through an older eleven-kind implementation is not allowed.

## Open Questions

None for this corrective child. Project patch shape, empty/same-value behavior, final-document frame-rate validity, T2 inverse semantics, T3 baseline undo ownership, and T4 evidence are fixed above.
