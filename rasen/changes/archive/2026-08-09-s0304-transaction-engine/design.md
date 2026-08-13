## Context

T0 added a frozen, Host-neutral contract at `apps/web/src/editor/contracts/`: minimal domain entities, typed operations, `TransactionRead` / `TransactionApply` / `TransactionGetContext` / `TransactionWatch`, `TransactionError`, an in-memory fake, and a reusable conformance suite. The fake proves contract semantics but is not the durable editor engine.

S02's `ProjectStore` is the only persistence seam T1 may consume. It deliberately accepts `ProjectRecord.data: unknown` and round-trips provider-private fields; `SessionPersistenceCoordinator` performs the current donor decode/overlay work outside the frozen port. `ProjectStore.save` atomically replaces one record and summary, but the port exposes no compare-and-swap argument. `EditorSession.watch` observes lifecycle only, and `EditorCore`/`commands/**` still mutate donor stores directly. T1 therefore builds the engine without wiring either runtime seam; T3 owns the donor command/document adapter and commit routing.

The module must remain additive under `apps/web/src/editor/contracts/engine/**`. It may import the frozen contract and `@/editor/ports`, but it may not import OpenCut schema, command, core, Zustand, wasm, or storage-mechanism modules. The existing transaction boundary checker scans the new subtree. Both Hosts, parity, all current capability specs (16 after T0 archive), and the pinned type-baseline ceiling of 3 remain gates.

## Goals / Non-Goals

**Goals:**

- Provide one deep transaction-engine module implementing all four T0 interfaces against a supplied `ProjectStore`.
- Make batch evaluation, one durable save, revision publication, idempotency, and watch delivery one ordered commit protocol.
- Persist revision and idempotency metadata with the opaque project record so reopen continues the same transaction history.
- Share one deterministic evaluator across apply, validation, and dry-run.
- Enforce a conservative base placement policy and compose optional provider rules without weakening the base rules.
- Make optional behavior discoverable through typed feature keys rather than method-presence guessing.
- Test through the engine interface by composing T0 conformance with T1 engine-specific conformance.

**Non-Goals:**

- Map OpenCut `TProject`, `TimelineTrack`, `TimelineElement`, `MediaAsset`, or `Bookmark` into the contract; T3 supplies that adapter.
- Route `CommandManager`, `BaseCommand`, `BatchCommand`, pointer previews, or either Host through the engine; T3 owns that commit seam.
- Create Drafts, savepoints, approval modes, or one-undo Draft application; T2 owns them.
- Add a transaction member to `EditorSession`, change the frozen T0 files/root entry point, widen `ProjectStore`, or edit `SessionPersistenceCoordinator`.
- Claim cross-process or cross-Host compare-and-swap. The current `ProjectStore` cannot express it.
- Define public Artifact/Capability concepts, package extraction, or provider-private effects/masks/keyframes.

## Decisions

### D1: One deep engine interface, opened asynchronously

`openTransactionEngine(options)` loads and decodes the selected project and returns a `TransactionEngine<FeatureName>`. The engine implements T0's four interfaces directly and adds only `validate(batch)` and `dryRun(batch)`. Its interface includes the ordering/error facts below; callers do not orchestrate load/evaluate/save/revision/watch themselves.

Illustrative shape:

```ts
const engine = await openTransactionEngine({
  store,
  projectId,
  documentAdapter,
  placementPolicies: [providerPlacementPolicy],
  optionalFeatures: { "provider-ripple-edit": false } as const,
});

await engine.apply(batch);
await engine.validate(batch);
await engine.dryRun(batch);
await engine.capabilities();
```

The module is imported from `@/editor/contracts/engine`; T0's root `contracts/index.ts` remains frozen. The same engine object can be passed as `read`, `apply`, `getContext`, and `watch` to the existing conformance target.

**Alternatives considered:**

1. Put load/evaluate/save helpers in callers. Rejected as a shallow module: atomicity and error handling would reappear in Draft, command, and Agent callers.
2. Hide `ProjectStore` behind a new repository port. Rejected because S02 already froze the local-substitutable port and T1 is explicitly required to consume it; another repository interface would be pass-through indirection.
3. Let the engine directly interpret `ProjectRecord.data` as contract entities. Rejected because the contract model is intentionally not the donor persistence schema and would destroy provider-private round-trip.

The selected hybrid keeps the external engine interface small while using one necessary document-adapter seam inside the module.

### D2: A document adapter owns opaque translation and transaction metadata placement

`TransactionDocumentAdapter` is the only seam allowed to inspect `ProjectRecord.data: unknown`. It decodes a record into an engine document (contract project/entities, revision, and idempotency ledger) and encodes a candidate engine document back into exactly one `ProjectRecord` plus `ProjectSummary`. Encoding receives the previously loaded record so the adapter can overlay known values and retain provider-private fields.

T1 ships a transaction-native adapter/fixture for conformance; T3 supplies the OpenCut adapter outside `contracts/**`. These are two real adapters, not a speculative interface. The engine never imports donor types and never treats its transaction-native adapter as safe for an existing donor record.

Adapter output is validated before it reaches `ProjectStore.save`: record/summary IDs must equal the requested port `ProjectId`, revision must be a non-negative integer, and every decoded entity must satisfy the frozen domain constructors. A malformed persisted document becomes a mechanism-neutral `ProjectStoreError` with `code: "corrupt"` and `operation: "load-project"`; raw payload or cause is not exposed.

**Alternative considered:** store revision/idempotency in `ProjectStore` library records. Rejected because project content and metadata would require two durable writes with no shared atomic commit. The adapter instead embeds transaction metadata in the same opaque project record it replaces.

### D3: One serialized commit protocol; durable save precedes publication

Every `apply` enters a per-engine promise queue in invocation order. A rejected apply does not poison the queue. Inside the queue the engine:

1. checks an existing idempotency key by canonical operation fingerprint; an exact replay returns its persisted original result before expected-revision checking, while a different fingerprint throws `TransactionError { code: "duplicate" }`;
2. compares `expectedRevision` with the current committed revision;
3. evaluates all operations in order against a deep working copy, collecting created/changed IDs and applying the base plus provider placement policies;
4. constructs revision `current + 1` and a candidate idempotency entry, then asks the document adapter to encode one replacement record and summary;
5. awaits exactly one `ProjectStore.save`;
6. only after that durable call resolves, swaps the committed in-memory snapshot, records the replay result, and notifies watchers once with the new revision.

The canonical fingerprint sorts object keys recursively while preserving array/operation order, so equivalent operation objects do not depend on JavaScript property insertion order. Successful results and fingerprints are persisted by the adapter; reopening the engine preserves revision and keyed replay semantics. Unkeyed identical batches remain independent.

Operation/domain failures use T0's `TransactionError` and include `operationIndex` when applicable. A `ProjectStoreError` remains a `ProjectStoreError`; the engine does not relabel quota/unavailable/aborted/corrupt failures as a domain error. Any save failure leaves revision, idempotency state, reads, and watchers unchanged.

`ProjectStore` has no CAS token. This protocol guarantees ordering and expected-revision conflict detection for all callers sharing one engine instance and continuity after reopen. It does not claim exclusion against another engine/process concurrently replacing the same record; feature discovery reports `cross-engine-cas: false`. T2 must share its parent session's engine rather than open one engine per Draft.

### D4: Apply, validation, and dry-run use one evaluator

The evaluator is pure over a cloned engine document plus a batch. It returns either a candidate document/result or structured issues; only `apply` invokes the adapter's encode/save commit path.

- `validate(batch)` returns a discriminated outcome containing the base revision and all deterministic operation/domain/placement issues it can attribute. It does not reserve an idempotency key.
- `dryRun(batch)` follows the exact idempotency, expected-revision, operation-order, and placement path used by apply and returns the projected `TransactionResult` or structured rejection. It does not save, increment the committed revision, mutate the replay ledger, alter read results, or notify watchers.
- `apply(batch)` converts the first blocking evaluator issue to T0's matching `TransactionError` and commits only an accepted candidate.

`validate` and `dryRun` are ordered behind any earlier apply already in the engine queue so their reported base revision is coherent. Later applies do not wait for caller-side inspection of the returned outcome.

**Alternative considered:** implement dry-run by applying and rolling back. Rejected because a durable write or watcher callback cannot be made observationally absent after the fact.

### D5: The base placement policy is conservative, deterministic, and non-replaceable

The base policy enforces the minimum behavior Direction §3.3 names:

- every clip duration is positive; clip and marker time values align to the project's integer ticks-per-frame derived from its validated `FrameRate`;
- referenced tracks/assets exist in the candidate document, IDs are unique, and an update cannot move an entity onto a missing relation;
- half-open clip intervals `[startTime, startTime + duration)` on one track do not overlap; touching endpoints are allowed;
- audio assets occupy audio tracks; image/video assets occupy video or graphic tracks; asset-less clips occupy text, graphic, or effect tracks;
- when an asset declares duration, `trimStart + duration + trimEnd` does not exceed that source duration.

Issues carry a stable placement code, message, `operationIndex`, and involved IDs. Apply exposes them as `TransactionError { code: "validation" }`; validate/dry-run preserve the richer issue structure.

Optional provider policies are appended after the base policy and can reject more candidates or attach typed feature keys. They cannot replace or waive base rules. T3 may therefore add donor lane semantics without making T1's documented guarantees implicit.

### D6: Feature discovery narrows T0's capability record with typed keys

The engine exports a closed `TransactionEngineBaseFeature` union and a generic `TransactionEngineCapabilities<FeatureName>`. `capabilities()` remains assignable to T0's `Readonly<Record<string, boolean>>`, while engine-aware callers receive typed keys for base guarantees and literal optional feature names inferred from `openTransactionEngine` options.

Base keys include atomic batch, expected revision, durable revision, durable idempotency, validation, dry-run, placement policy, and `cross-engine-cas` (false). `supportedOperations()` continues to report T0's operation-kind union. Optional behavior is never inferred from a method existing or an operation silently succeeding.

**Alternative considered:** add provider-specific methods to the engine. Rejected because it would widen the interface for every provider and turn feature presence into an implicit runtime guess.

### D7: Engine conformance composes, rather than edits, T0 conformance

`runTransactionEngineConformance(factory)` lives under `engine/conformance/`. A factory is required because T1 cases need fresh durable stores, reopen, controlled save failures, and concurrent calls. Each target first runs the unchanged `runTransactionConformance`, then T1 cases assert:

- one-save atomic commit and no publication on save failure;
- queue ordering for concurrent calls and unchanged state for a rejected middle batch;
- persisted revision and idempotency replay/collision after reopen;
- validation/dry-run purity and equality with the later real apply result;
- every base placement rejection plus adjacency acceptance;
- opaque sentinel preservation through the adapter;
- typed/base/optional feature probes, including `cross-engine-cas: false`.

Focused Bun tests run this conformance target against S02's `InMemoryProjectStore` and the T1 transaction-native adapter. Tests observe only engine methods, `ProjectStore` records, and watcher output; they do not reach into evaluator state.

## Risks / Trade-offs

- **[No cross-engine CAS]** Two independent processes can replace the same project after both read one revision because `ProjectStore.save` has no expected token. → Advertise `cross-engine-cas: false`, guarantee only one-engine ordering, and require T2/T3 to share the session engine. Widening the port is a future explicit contract change, not a hidden T1 claim.
- **[Adapter can violate opaque round-trip]** A provider adapter could rebuild rather than overlay its document. → Conformance seeds unknown sentinels and fails adapters that drop them; T3 must run the same engine conformance with its concrete adapter.
- **[Persisted idempotency ledger grows]** Correct retry behavior conflicts with eviction. → Keep exact history for this Slice's correctness scale; expose no eviction that could silently reapply a key. S08 performance work may add an explicit retention contract.
- **[Conservative placement rejects a donor-valid layout]** The minimal contract lacks every provider lane nuance. → Keep the base rules limited and explicit, allow additive provider policies, and stop at Direction if T3 cannot map current parity fixtures without weakening the contract.
- **[Contract boundary checker covers implementation files]** An innocent donor import anywhere below `contracts/engine` fails the freeze. → Keep translation adapters that import donor types outside `contracts/**`; T1 imports only frozen contracts and `@/editor/ports`.
- **[Durable save latency serializes applies]** Per-engine ordering means one slow save delays later validation/apply work. → Correct atomic ordering is the priority for T1; performance batching and 2,000-clip budgets are S08 exclusions.

## Migration Plan

1. Add the engine types, adapter seam, evaluator, placement policies, implementation, conformance, and tests under the new `engine/**` subtree.
2. Run T0 conformance unchanged against the engine, then the T1 engine-specific conformance against `InMemoryProjectStore`.
3. Run transaction boundary/negative-control, focused tests, both Host builds/parity, the type-baseline ceiling, and a falsification sweep over all 16 current capability specs (the Direction plan's count of 15 predates T0 archive).
4. Ship locally without wiring any existing caller. T2 and T3 consume the stable engine in later serial changes.

Rollback is deletion of the additive `engine/**` subtree and its T1 change artifacts; no current runtime path imports it, no persisted donor document is migrated by this change, and T0 remains usable unchanged.

## Open Questions

None for T1. The OpenCut document adapter/command routing is intentionally resolved by T3, Draft ownership by T2, and true multi-engine CAS only by a future explicit `ProjectStore` contract change.
