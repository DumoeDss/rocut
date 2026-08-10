## Why

T0 froze the Host-neutral transaction types and proved them with an in-memory fake, but the editor still has no durable engine that applies those batches through S02's `ProjectStore`. T1 is the next serial prerequisite for Drafts and UI commit routing: it must make revision, idempotency, validation, dry-run, placement, and feature-discovery semantics executable without leaking the donor schema or changing today's UI command path.

## What Changes

- Add a `ProjectStore`-backed transaction engine under `apps/web/src/editor/contracts/engine/**` that implements T0's `read` / `apply` / `getContext` / `watch` interfaces and serializes applies per engine instance.
- Make a successful durable `ProjectStore.save` the transaction commit point: evaluate a complete batch on a working copy, persist once, then publish the new revision and notify watchers. Rejected evaluation or persistence failure leaves committed state and revision unchanged.
- Preserve the store's opaque provider document through an injected document adapter; the engine consumes S02's frozen `ProjectStore` and never redefines it or treats the minimal contract `Project` as the donor's persistence schema.
- Add one shared evaluator for normal apply, structured validation, and dry-run so all three enforce the same expected-revision, idempotency, referential-integrity, and placement rules while validation/dry-run perform no durable write, revision increment, cache mutation, or watch notification.
- Add a deterministic default placement policy covering same-lane collisions, track/asset lane compatibility, positive ranges, source bounds, and alignment to the project's integer ticks-per-frame timebase; keep policy injection explicit for later provider-specific rules.
- Add typed feature discovery for the engine's base guarantees and injected optional provider features, alongside the frozen supported-operation probe.
- Add an engine conformance layer and focused tests under `engine/**` that compose T0's unchanged conformance suite with T1 cases for durable atomicity, concurrent ordering, revision/idempotency replay, dry-run purity, placement rejection, opaque round-trip, and feature probing.
- Do not route `commands/**` or pointer interaction through the engine (T3), create Draft editing sessions (T2), change `EditorSession`, or touch either Host composition root.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `transaction-automation-api`: add the durable transaction-engine behavior behind T0's frozen interfaces, including ProjectStore commit ordering, validation/dry-run purity, placement policy, and typed feature discovery.

## Impact

- Product/test touch set: additive-only `apps/web/src/editor/contracts/engine/**`; the frozen T0 files, `editor/ports/project-store.ts`, commands, session, Surface, Hosts, and Rust remain unchanged.
- Dependency: archived and review-clean T0 contract plus S02's frozen opaque `ProjectStore`; the current T0 branch is the implementation baseline.
- Downstream: unblocks T2 Draft editing sessions and T3 UI commit routing, but authors neither seam in this change.
- Verification retains both Host builds and parity behavior, the transaction boundary check and negative control, all current capability-spec assertions (16 on the post-T0 baseline; Direction's pre-T0 inventory was 15), and the pinned type-baseline ceiling of 3.
