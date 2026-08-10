## Why

T3's design audit proved that the editor's established canvas and frame-rate changes cannot pass through the shared UI/Agent transaction seam: those fields are public on `Project`, but the closed eleven-operation union cannot mutate them. The correction is needed before T3 resumes and T4 publishes Agent evidence, otherwise exact donor/engine equality, one-save atomicity, or existing editing parity must be broken.

## What Changes

- **BREAKING** Widen the closed `TransactionOperation` union with a twelfth, Host-neutral `update-project` member carrying `projectId` and a typed patch limited to `name`, `frameRate`, `canvasWidth`, and `canvasHeight`; the patch never permits `id` or provider-private fields.
- Define deterministic Project-update semantics across the in-memory fake and durable engine: require a matching non-null Project, reject empty or unknown-key patches, validate the final Project, report its ID in `changedIds`, and preserve the existing update convention that a non-empty same-value patch is still one successful revisioned apply.
- Evaluate Project patches through the existing transaction evaluator, placement policy, canonical idempotency fingerprint, validation/dry-run, one-save commit, watch, replay, and reopen paths without widening the engine/document-adapter interface or `ProjectStore`.
- Extend T0/T1 conformance and focused engine tests so all implementations advertise twelve operation kinds and prove atomic failure, durable publication, canonical replay/collision, and reopen equality for Project updates.
- Extend T2's exhaustive Draft-safe classification, review counts, savepoint evaluation, minimal inverse planning, compensation preflight, conformance, and focused tests so an `update-project` participates in the same one-batch approval and undo receipt as other reversible project-content operations.
- Establish the reviewed prerequisite consumed when T3 and T4 resume: T3 emits one typed public Project sibling while retaining exact donor equality and established history policy; T4 advertises and exercises the twelfth kind through the public transaction interface.
- Reject hidden alternatives: no asset/clip-derived Project mutation, adapter inference, companion delta, provider-private or generic payload smuggling, second legacy save, or new persistence seam.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `transaction-automation-api`: add the typed `update-project` operation and require the contract, engine, Draft workflow, conformance layers, and downstream UI/Agent consumers to preserve atomic, idempotent, durable Project-setting semantics.

## Impact

- Corrective implementation scope: `apps/web/src/editor/contracts/operations.ts`, the in-memory reducer and T0 conformance, T1 evaluator/conformance/focused tests, and T2 classification/review/inverse/manager/conformance/focused tests.
- The compile-visible union expansion requires every exhaustive `OperationKind` switch/register and hard-coded eleven-kind fixture to handle `update-project`; `supportedOperations()` will advertise twelve kinds.
- T3 and T4 remain downstream consumers, not product-code implementation scope for this corrective child. After this child is reviewed, their existing Changes must be updated and resumed against the corrected contract, including before/after parity and Agent save/reopen evidence.
- No engine or document-adapter interface widening, no `ProjectStore` change, no new private adapter seam, and no changes to Surface, Host composition roots, Rust/WASM, package boundaries, parity oracles, or the type-baseline fixture.
