## Context

T1 added a `ProjectStore`-backed `TransactionEngine` with a strict commit point: it evaluates a typed batch, asks a `TransactionDocumentAdapter` to encode one replacement record, awaits one `ProjectStore.save`, and only then advances revision, publishes reads, records idempotency, and notifies watchers. The reviewed `s0304-project-settings-transaction-operation` correction widened the closed union with Host-neutral `update-project` while preserving that engine/document-adapter interface and commit protocol. T3 consumes archive tip `aac84ff1730398879181cc689f1018ac8c92e9a1` through merge `27e4e8d2befa4b42a178ac55ec166d381a52e19c`. The port still has no compare-and-swap token, so every caller that edits one loaded project must share one engine instance.

The donor editor does not yet satisfy that model. `Command.execute/undo/redo` are synchronous and mutate `EditorCore` managers directly. `CommandManager.execute` runs the root command, ripple adjustment, selection application, reactors, and history publication in sequence. `BatchCommand` only loops over children and cannot roll the earlier children back. The empty-track reactor performs another manager mutation after the command. `executeWithoutHistory` is used both for nested edits and for continuous property updates, which currently gives it no durable meaning.

Persistence is also split. `SessionPersistenceCoordinator` retains an opaque `ProjectRecord.data` snapshot and OpenCut decode cache, while `SaveManager` subscribes to scene/timeline publications and later calls `ProjectManager.saveCurrentProject()`. If the T1 engine saves a record and those caches are not refreshed, the debounced path can encode from a stale retained snapshot and overwrite transaction revision/idempotency metadata.

The frozen public model is intentionally smaller than the donor model. Its twelve-operation union can express public Project metadata plus tracks, clips, assets, and markers, but not scenes, track mute, effects, masks, keyframes, retiming, source-audio flags, attachments, cache mutations, or network/export effects. The union remains closed and has no generic provider-command operation. T3 must preserve provider-private data without pretending that a private-only edit is a public transaction.

## Goals / Non-Goals

**Goals:**

- Make one session/project transaction router the canonical owner of the T1 engine used by UI and automation callers.
- Prepare deterministic command state off the published editor, commit once through T1, and publish live state/history/selection only after durability succeeds.
- Fold `BatchCommand`, nested command work, ripple adjustment, and reactors into one candidate and one revision.
- Keep OpenCut-private state and transaction metadata in the same atomic replacement record while proving the private candidate agrees with the typed public projection.
- Make pointer preview local until one final routed commit; make undo and redo routed commits too.
- Keep legacy persistence caches coherent and prevent a transaction-origin publication from causing a second save.
- Name and enforce the boundary between transaction-routable project edits, local preview, provider-private-only edits, and immediate external effects.

**Non-Goals:**

- Author another T0/T1 contract or engine change after consuming the separately reviewed typed `update-project` correction, or change T1's engine/adapter interfaces or S02's `ProjectStore`.
- Add a public `invokeAnyCommand(name, payload)` mechanism or encode provider-private commands into an untyped public operation.
- Make attachments, URL/cache work, media processing, generation, export, or external resource deletion rollback-capable.
- Claim that an edit with no non-empty frozen-contract operation batch is a transaction; such gaps stay explicit until the public contract is deliberately widened.
- Modify either Host composition root, the React Surface line, Rust/WASM, package boundaries, or the type-baseline fixture.

## Decisions

### D1: A session-owned transaction router is the only engine authority

Add a donor-aware deep module outside `apps/web/src/editor/contracts/**` (for example `apps/web/src/editor/transactions/opencut/**`). `EditorCore` owns one router for the active project. The router owns the concrete OpenCut document adapter, the underlying T1 engine, a per-project mutation arbiter, commit token generation, and the durable publication receipt. UI dispatch and later automation composition receive the router's canonical engine facade; the raw underlying engine is not separately opened or exposed.

The router is opened as part of `ProjectManager.loadProject` before the newly loaded project becomes editable. Project switch/disposal retires the old router and its candidate state. The facade serializes `apply`, `validate`, and `dryRun` with coordinator project-record saves through the same session arbiter, while T1 remains responsible for transaction-to-transaction ordering. This closes the stale legacy-save race that T1 alone cannot close because `ProjectStore` has no CAS.

**Alternatives considered:**

1. Open one engine for the UI and another for automation. Rejected because T1 reports `cross-engine-cas: false`; expected revisions cannot exclude a sibling engine.
2. Put donor mapping below `editor/contracts/engine/**`. Rejected because the transaction boundary checker bans donor schema, core, command, store implementation, and wasm imports there.
3. Let every command call `ProjectStore` directly. Rejected because it would duplicate T1's ordering, revision, idempotency, and watcher protocol.

### D2: Commands prepare a detached candidate instead of mutating live state optimistically

Refactor the reversible project-edit part of commands into deterministic transitions over an `OpenCutProjectDraft`/command mutation target created from the router's committed donor snapshot. A prepared root command contains:

- the base revision and a unique UI idempotency/commit token;
- the complete donor candidate needed to publish the editor after success;
- the deterministic frozen-contract projection before and after the edit;
- the resulting non-empty `TransactionOperation[]` diff;
- selection intent plus forward/inverse history material.

The command transition, nested no-history work, ripple computation, and reactors all run against that same draft. They may read their own earlier draft changes, but no live manager is changed and no subscriber fires. A preparation exception discards the draft. The router then calls the shared engine once with `expectedRevision` and the generated idempotency key. Only after the call resolves does it adopt the encoded record in persistence, publish the donor candidate to live managers under a transaction-publication scope, apply selection, and mutate history stacks.

This changes durable command methods to asynchronous completion (`execute`, `undo`, `redo`, and final preview commit). Call sites that intentionally do not await must use `void` plus the existing persistence-failure reporting path; code that depends on resulting state must await. The command manager serializes routed invocations so later preparation always sees the last published candidate.

**Alternatives considered:**

1. Mutate live state, save, and roll back on failure. Rejected because subscribers, rendering, selection, and arbitrary synchronous reads can observe a candidate that never became durable; some resource effects are not reversible.
2. Run the current command against live state with notifications muted, snapshot it, restore it, then save. Rejected because notification muting does not undo resource/cache/attachment effects and makes correctness depend on every manager honoring a hidden suppression flag.
3. Save first and run the existing command afterward without a donor candidate. Rejected because T1's adapter must encode the exact provider-private record before save, and executing the command later can diverge from the record already committed.

The chosen design is the larger refactor, but it creates one deep preparation boundary whose invariants are testable instead of distributing rollback rules across more than fifty command modules.

### D3: Public operations are derived from before/after projection; private state is explicit and checked

The donor mapping module projects the active OpenCut project/current scene into T0's `Project`, `Track`, `Clip`, `Asset`, and `Marker` shapes. A deterministic differ emits one typed `update-project` when public Project fields differ plus the smallest stable create/update/delete entity sequence from the pre-command and post-command projections. Operation ordering is fixed (Project update, dependent deletes before parents, parents before dependent creates, then updates) so fingerprints and parity do not depend on object iteration order.

The prepared donor candidate is not an undeclared payload on the public batch. The router registers it explicitly against the unique UI commit token. When T1 calls the adapter's existing synchronous `encode`, the adapter may consume a staged candidate only when all of these hold:

- the candidate token matches the idempotency entry being encoded;
- the candidate was derived from the same previous-record digest and base revision;
- re-projecting the candidate exactly equals the engine candidate document for every frozen public field;
- the candidate retains every donor field that the command did not own.

Any mismatch rejects before `ProjectStore.save`. On a normal automation apply with no staged UI candidate, the adapter applies the typed engine document to the prior donor record through the same projector/overlay rules. In both paths it embeds a versioned transaction metadata envelope (revision and idempotency ledger) in `ProjectRecord.data`, overlays rather than rebuilds the retained record, and emits one `ProjectSummary`. The adapter retains the exact encoded record as the router's publication receipt; candidate registration and receipts are cleared in `finally` on every result.

Assets whose durable bytes/metadata live in attachment storage are not made atomic by inventing a project-record side channel. Only project-record state participates in this transaction. Attachment creation/removal remains an immediate effect, and any public asset catalog represented in the transaction document is metadata rather than a claim that attachment bytes committed in the same save.

### D4: A closed routing classification prevents false transactions

Every command entry point is classified before work begins:

- `transaction`: deterministic, reversible project-record work that produces a non-empty batch in T0's closed operation union;
- `preview`: local overlay/state that performs no durable apply until an explicit final transaction command;
- `provider-private`: reversible donor project-record work whose public projection is empty (for example a field not represented by T0); it remains an explicit unsupported/legacy gap and does not advance the transaction revision;
- `immediate`: attachment, network, cache, media-processing, generation, export, or external-resource work that cannot be rolled back with the project record.

`BatchCommand` may contain only transaction children. A mixed batch is rejected before any child or immediate effect runs. Nested `executeWithoutHistory` is replaced by a preparation-only nested operation that contributes to its root candidate; external continuous updates migrate to preview plus final commit, or to an explicit non-transaction class. `UpdateProjectSettingsCommand` is classified per changed field: public-only and mixed public/private patches have a real `update-project` sibling, while private-only patches remain provider-private. No command may smuggle a provider-private-only mutation into a no-op public update merely to increment revision.

This is a deliberate honesty boundary. Effects, masks, keyframes, scene-only structure, and other omitted fields are preserved when a routable command also changes public state, but a private-only change is not labeled as sharing the Agent transaction seam until a future contract change adds a typed operation for it.

### D5: Batch, ripple, reactors, and selection/history have one commit lifecycle

`CommandManager` becomes the coordinator for one prepared root:

1. capture the committed donor/public base and previous selection;
2. apply the root command or every `BatchCommand` child to one draft;
3. apply ripple adjustments to that draft;
4. run registered reactors against that draft;
5. compute the final selection intent and public operation diff;
6. submit one router commit;
7. after success, publish the candidate, selection, and one history entry while clearing redo.

The empty-track reactor therefore contributes `delete-track` operations to the same batch rather than causing a second commit. A child failure, invalid final placement, adapter mismatch, or store failure publishes none of the draft. `BatchCommand` retains “latest explicit selection wins” but gains actual atomicity.

### D6: Undo and redo are new transactions, not local history rewinds

Each successful history entry stores deterministic forward and inverse prepared material for the complete committed root, including ripple/reactor results. Undo prepares the inverse against the current revision and calls the router once; only success moves the entry to redo and restores prior selection when the original command declared selection intent. Redo applies the forward material as one new transaction and only then moves the entry back to history. Each success increments revision once, saves once, and notifies transaction watchers once. Failure leaves both stacks, live state, and selection unchanged. Atomic forward durability and inverse ownership are separate: settings nested with `pushHistory: false` remain in the forward donor/typed batch but their final values are retained in the undo target and omitted from the inverse, preserving first-image canvas behavior.

Whole-snapshot donor material is safe only for the top history entry; the manager never applies an arbitrary old snapshot across intervening history. The public inverse remains a typed operation batch and is revalidated by T1 placement/expected-revision rules.

### D7: Pointer preview clears only after one successful final commit

`previewElements` continues to update only `previewOverlay`/`previewTracks` and notify preview subscribers. It never enters command history and never calls the router. `commitPreview` creates one routed `TracksSnapshotCommand` from committed tracks to the final preview tracks and awaits `CommandManager.execute`; success clears the overlay as part of publication. A rejected final commit keeps the committed project/history/revision unchanged and retains the local overlay for retry or explicit discard. `discardPreview` clears the overlay and emits no transaction.

### D8: Persistence adopts the exact engine record and suppresses only duplicate publication saves

Extend `SessionPersistenceCoordinator` with an adoption method that accepts the exact encoded `ProjectRecord` from the router, decodes it through the existing project codec, and refreshes `projectSnapshots` plus `projectCache` without calling `store.save`. It emits the existing project mutation notification only after the engine save has succeeded.

`SaveManager` gains a scoped “already durable transaction publication” path. Scene/timeline notifications produced while the router publishes an adopted candidate do not set `hasPendingSave`; an unrelated pre-existing dirty flag is not silently cleared. All non-routed dirty mutations retain the current debounce/flush behavior. Coordinator project saves and router transaction work share the D1 project arbiter, so a pending legacy save cannot derive its retained overlay until the transaction receipt has been adopted.

**Alternative considered:** stop `SaveManager` entirely after T3. Rejected because provider-private-only and other non-command dirty paths still require the existing durable fallback during this Slice.

### D9: Verification uses behavior and boundary oracles, including negative controls

Focused tests instrument the shared engine/store/router rather than asserting private fields. They count engine applies, underlying project saves, watcher calls, history entries, and live publications for normal commands, batches, nested edits, reactors, pointer frames/end/cancel, undo/redo, and injected save failures. Adapter tests seed opaque sentinels and deliberately mismatched staged candidates. Persistence tests queue transaction and legacy saves in both orders and prove revision/idempotency metadata survives.

The established normalized parity fixture must remain unchanged on both Hosts. Verification captures before-routing versus after-routing behavior on Vite and Next independently, then compares Vite versus Next as a second axis so a shared Host regression cannot pass. The transaction boundary check and negative control must prove the new donor modules stay outside `contracts/**` and no forbidden donor import enters the frozen boundary. The type baseline remains at or below 3, and the implementation performs a falsification sweep over every canonical capability spec present at verification time.

## Risks / Trade-offs

- **[Closed public operations cover less than the donor command set]** The reviewed `update-project` correction closes public Project settings, but a private-only UI edit still cannot honestly become a T1 transaction. → Keep a checked command-routing register, classify settings per field, fail mixed/ambiguous routing before mutation, and report the provider-private gap rather than using a no-op or generic invocation. Any further widening remains a future explicit change.
- **[Command preparation is a broad refactor]** More than fifty command modules currently assume concrete live managers. → Migrate by command category, centralize draft transition helpers, require exhaustive routing registration, and keep parity plus focused command tests green after each category.
- **[Adapter candidate side state can race]** T1's adapter interface does not carry a donor candidate parameter. → Bind candidate and receipt to a unique persisted idempotency token, previous-record digest, base revision, and exact public projection; serialize router/coordinator writers and clear registrations in `finally`.
- **[Immediate media effects cannot join project atomicity]** Attachment bodies and cache/network work use different port calls. → Reject mixed batches before effects run and keep immediate commands outside undo/transaction claims.
- **[Durable latency becomes visible]** UI state publishes after an asynchronous save instead of immediately. → Serialize interactions, expose pending/error state through existing diagnostics/UI handling, and keep pointer motion local so high-frequency interaction remains responsive.
- **[A durable save can succeed before live publication throws]** The record cannot be rolled back safely after T1 commits. → Make publication a deterministic decode/adopt of the already validated receipt, test it as non-throwing for valid candidates, and treat an impossible publication failure as a reload-required diagnostic rather than a compensating save.
- **[Legacy save paths may remain]** Provider-private-only edits still use the coordinator. → Share the project arbiter and exact retained snapshot so they preserve transaction metadata; tests prove no routed publication schedules a duplicate save.

## Migration Plan

1. Consume the reviewed typed `update-project` prerequisite, then add the OpenCut projection/diff, document adapter, candidate registry, engine facade, and project mutation arbiter outside `editor/contracts/**`; prove transaction-native automation and staged UI encode paths independently.
2. Add coordinator record adoption and SaveManager transaction-publication scoping, then open one router during project load and retire it on switch/disposal.
3. Refactor `Command`, `BatchCommand`, and `CommandManager` around detached preparation and asynchronous durable completion; preserve selection semantics and make routing registration exhaustive.
4. Migrate transaction-routable command categories and nested edits, extracting pure draft transitions from live manager mutations. Register provider-private and immediate commands explicitly and reject mixed batches.
5. Route undo/redo and pointer-preview finalization, retaining local overlays on failed commit.
6. Run focused router/command/persistence tests, T0/T1 conformance against the concrete adapter, boundary checks and negative controls, type baseline, both Host builds/parity, and the full capability falsification sweep.

No eager project migration is required. The adapter adds a versioned transaction envelope on the first routed commit; the existing opaque overlay preserves it across later legacy saves. Rollback removes the routed caller wiring and leaves the envelope as ignored opaque data. It must not delete or rewrite persisted records merely to remove metadata.

## Open Questions

None. The important scope boundary is explicit: T3 routes only edits representable by a non-empty frozen operation batch and preserves private siblings; it does not falsify completeness by inventing a provider-private public operation.
