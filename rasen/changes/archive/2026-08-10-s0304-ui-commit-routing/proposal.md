## Why

T1 now provides the durable transaction engine and the reviewed `s0304-project-settings-transaction-operation` correction adds the typed `update-project` operation, but the editor UI still mutates OpenCut managers directly and relies on a separate debounced save path. Until the command commit path uses the same session engine, UI and automation can diverge in revision/order semantics, pointer previews can bypass the durable boundary, and a later legacy save can overwrite transaction metadata.

## What Changes

- Give each loaded editor project one OpenCut-aware transaction routing seam backed by the same T1 engine instance used by automation callers; do not add a public generic command-invocation escape hatch.
- Change transaction-routable command execution to prepare one complete donor candidate and one frozen-contract operation batch before durable commit. A `BatchCommand`, ripple adjustments, nested no-history project edits, and command reactors participate in that one candidate and therefore commit atomically.
- Consume the reviewed typed `update-project` prerequisite for public Project deltas. First-image canvas selection and public frame-rate/settings changes participate in the same forward durable root, while nested `pushHistory: false` settings remain deliberately outside the command inverse.
- Publish live project state, selection intent, and undo/redo history only after the engine's single durable save succeeds. Validation, adapter, or store failure leaves the live editor, history stacks, selection, revision, and watcher output unchanged.
- Keep provider-private OpenCut fields in an explicit internal candidate carried by the donor adapter, verify that its public projection agrees with the typed transaction batch, and preserve all unrelated opaque fields in the same replacement record.
- Classify command work explicitly: reversible project-content edits route through transactions, while attachment/network/cache/export and other immediate effects remain outside the undoable transaction path and cannot be hidden inside a public operation.
- Keep pointer-move/frame preview local. Committing the interaction submits exactly one routed transaction and one history entry; discard/cancel submits none.
- Coordinate transaction publication with `SessionPersistenceCoordinator` and `SaveManager` so the successful transaction refreshes retained snapshots/caches without scheduling a duplicate save or allowing stale state to overwrite revision/idempotency metadata.
- Add focused parity and failure tests for normal commands, batches, reactors, pointer preview, undo/redo, opaque round-trip, shared-engine ordering, and save-failure non-publication.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `transaction-automation-api`: require transaction-routable UI commits, including undo/redo and final pointer-preview commits, to share the session transaction engine and its durable-before-publication semantics with automation callers.

## Impact

- Product touch set: `apps/web/src/commands/**`, `apps/web/src/core/managers/commands.ts`, pointer-preview dispatch in `timeline-manager.ts`, `EditorCore` wiring, a donor-aware routing/adapter module outside `editor/contracts/**`, and the existing persistence/save coordination seam.
- T3 authors no additional T0/T1 contract or engine change beyond consuming reviewed archive tip `aac84ff1730398879181cc689f1018ac8c92e9a1` through merge `27e4e8d2befa4b42a178ac55ec166d381a52e19c`; T1's engine/adapter interfaces, S02's `ProjectStore`, both Host composition roots, the React Surface line, Rust/WASM, and package extraction remain unchanged.
- Existing synchronous command callers must adopt the routed asynchronous completion contract where the command is durable; immediate non-project effects remain explicit and separate.
- Verification must preserve the normalized editing parity oracle on both Hosts, the transaction-boundary negative control, opaque provider data, the type-baseline ceiling of 3, and every current capability-spec assertion.
