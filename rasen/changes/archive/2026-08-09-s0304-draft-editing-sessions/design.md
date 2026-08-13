## Context

T0 froze a Host-neutral `TransactionOperation` union and the `read` / `apply` / `getContext` / `watch` interfaces. T1 added a `ProjectStore`-backed `TransactionEngine`, shared `evaluateTransactionBatch`, validation/dry-run, placement policies, and durable revision/idempotency metadata. Its `cross-engine-cas` capability is deliberately `false`: expected-revision ordering is reliable only for callers sharing one engine instance because `ProjectStore` has no compare-and-swap token.

T2 must therefore provide Draft isolation above one parent session engine, not by opening an engine per Draft. A Draft needs a consistent base document, a private working document, and an ordered journal. It must expose no partial work to the live project, and final approval must remain one normal T1 apply so T1 continues to own persistence, revision increments, idempotency, and watch delivery.

The public seam remains Host-neutral and additive under `apps/web/src/editor/contracts/draft/**`. The T0/T1 public types and engine methods remain stable. Narrow T1-internal support provides a pure commit projection, a module-private native committed-state capture registry, and graph-preserving batch evaluation. A public engine wrapper does not inherit the private capture implicitly; its provider must inject the explicit Draft capture port. Draft state is intentionally in-memory; durable Draft recovery, command-journal wiring, Agent transport, provider document mapping, and external side-effect implementations belong to later changes.

## Goals / Non-Goals

**Goals:**

- Provide a small Draft manager/session interface that hides snapshot acquisition, call savepoints, journal reduction, approval serialization, review-summary generation, inverse planning, and terminal-state enforcement.
- Isolate multiple Drafts opened from one engine while allowing exactly one non-stale Draft to win when their bases match.
- Make each Draft tool call atomic against the Draft's working state and keep the durable engine untouched until approval.
- Support fixed manual and explicit auto approval modes with no implicit mode changes or rebase.
- Apply all accepted work as one T1 batch and return one structured receipt whose compensating batch is the future UI undo unit.
- Make Draft-safe versus immediate handling exhaustive in TypeScript and probeable at runtime without a generic command invocation interface.
- Reject approval unless every asset referenced by the candidate project passes a project-retention preflight.
- Provide a reusable, run-local conformance suite testable without React, Electron, Rust, or a provider schema.

**Non-Goals:**

- Persisting or reopening in-progress Drafts across process/session restart.
- Wiring the receipt into `CommandManager` or changing UI/pointer commit routing (T3).
- Running generation, export, source-package removal, or external-resource deletion; T2 classifies these as immediate and keeps them outside the rejectable Draft interface.
- Implementing provider asset copying, package deletion, or storage cleanup. T2 consumes a retention-preflight interface and supplies an in-memory conformance adapter only.
- Changing the T0 contract, T1 public engine surface, session/Host ports, Surface/Hosts, Rust, or WASM. T2 may consume shared T1-internal commit projection/capture and graph-preserving evaluator behavior without widening those public contracts.

## Decisions

### 1. One deep Draft manager owns many session handles

The external seam is `createDraftEditingManager(options)`, returning a `DraftEditingManager` that opens uniquely identified `DraftEditingSession` handles. A handle exposes only the lifecycle callers need: inspect its immutable snapshot/status, submit a Draft-safe tool call, obtain a structured review, approve a manual Draft, or reject it. Internally the manager owns the engine reference, placement-policy list, retention preflight, active-id register, snapshot acquisition, per-Draft queue, and receipt construction.

Illustrative shape (names may be mechanically refined without changing these semantics):

```ts
interface DraftEditingManager {
	open(input: {
		id: string;
		approvalMode: "manual" | "auto";
	}): Promise<DraftEditingSession>;
}

interface DraftEditingSession {
	snapshot(): DraftSnapshot;
	stage(call: DraftToolCall): Promise<DraftCallOutcome>;
	review(): DraftReviewSummary;
	approve(): Promise<DraftApplicationReceipt>; // manual only
	reject(): DraftSnapshot;
}
```

Requiring a stable, non-empty Draft id lets the final batch use a deterministic idempotency key. The manager rejects duplicate live ids. Return values are defensively cloned/frozen, and no mutable engine document or journal array crosses the interface.

Alternatives rejected:

- One independent engine per Draft would violate T1's explicit `cross-engine-cas: false` limit and could allow stale writers to both appear valid.
- A callback such as `withDraft(fn)` cannot survive multi-tool review pauses and makes explicit manual approval awkward.
- A single generic `dispatch(name, payload)`/`invoke` entry point would erase the closed operation union and violate the Target State prohibition on generic command invocation.

### 2. Opening captures a consistent base with a bounded revision sandwich

`open` reads the engine revision, project/tracks/clips/assets/markers, an exact committed-state capture, then the revision again. Equal public revisions plus a capture whose revision and public content match define one consistent base. The exact detached capture is authoritative for cross-collection alias topology and the durable idempotency ledger. A mismatch discards every result and retries the whole sequence up to a small fixed bound (three attempts); exhaustion returns a structured busy/capture failure and creates no Draft.

The native T1 construction module owns both the capture `WeakMap` and its one-time setter; the setter is a private closure and no exported module surface can register or replace a native engine entry after construction. Only a read-only binder is available to the Draft integration, and the returned detached port is frozen. No Symbol, method, or mutable document is attached to the public engine object. A public `TransactionEngine` wrapper is a different object and therefore has no implicit capability. A conforming wrapper/provider must inject an explicit `DraftCommittedStateCapture` directly into its Draft manager; the manager binds that function once, while an exact native engine always uses its construction-owned capture rather than a caller-supplied substitute. Omission, capture failure, or a same-revision content mismatch fails closed. Approval performs a fresh capture check before retention, compensation preflight, or parent apply, so a capability that becomes unavailable cannot publish forward state.

The captured entities and base revision form a private `TransactionEngineDocument` with an empty local idempotency history. The working document begins as a deep clone of that base. Opening performs no durable save, revision increment, idempotency mutation, retention action, or watch notification.

A public engine-level atomic snapshot method and a Symbol property were rejected because both expand or leak through the frozen engine object. A single pre-read revision without the post-read/capture match was rejected because reads can interleave with an apply and produce a torn or metadata-incomplete base.

### 3. Every tool call evaluates on a replace-on-success savepoint

A `DraftToolCall` contains a non-empty ordered list of `DraftSafeOperation`; it cannot carry caller-provided expected-revision or idempotency metadata. The Draft serializes calls in invocation order. For each call it clones the current working document, evaluates the call through T1's exported `evaluateTransactionBatch`, and supplies the same provider placement-policy list configured for Draft evaluation.

On acceptance, the Draft atomically replaces its working document and appends deep-cloned operations to its journal. On rejection or thrown policy failure, it discards the candidate and leaves the prior working document and journal byte-for-byte unchanged. Because evaluation is in-memory, neither result can affect the durable engine.

Calling the public engine `dryRun` for each step was rejected because it always evaluates against current durable state and cannot see preceding Draft-only operations. Reimplementing T1 validation was rejected because placement and invariant behavior would drift. The manager options therefore make the evaluator's provider-policy dependency explicit; callers that configured provider policies on the engine must pass the same frozen list to the Draft manager.

### 4. Approval mode is fixed and the state machine is terminal

States are `editing`, `applying`, `applied`, `rejected`, and `conflicted`. Failed tool calls leave the Draft in `editing`. Manual mode may accept multiple successful calls, expose reviews at any point, then perform exactly one explicit approve or reject. Auto mode is explicit at open time: the first successfully staged call immediately enters the same approval path and ends `applied` or `conflicted`; callers open a new auto Draft for the next tool call.

Approval mode cannot change after open. There is no manual-to-auto fallback, silent rebase, retry on a new base, or staging after a terminal state. Concurrent methods on one Draft are serialized; operations that reach the queue after a terminal transition receive a structured invalid-state outcome.

Keeping an auto Draft open and silently resetting its base after each apply was rejected: that would make one handle represent several unrelated undo units and obscure which revision each review covered.

### 5. Final approval delegates one flattened batch to the parent engine

Approval first rejects an empty journal, then flattens accepted operations in their original call/operation order. It constructs one `TransactionBatch` with:

- `operations`: the flattened journal;
- `expectedRevision`: the captured durable base revision, never the Draft's synthetic working revision;
- `idempotencyKey`: a deterministic namespace plus the stable Draft id.

After retention preflight succeeds, the Draft calls the shared parent engine's `apply` exactly once. T1 is the only durable commit point. Success therefore produces one save, one durable revision increment, and one watch notification. An expected-revision conflict transitions the Draft to terminal `conflicted`; it never edits the base, replays onto the latest document, or changes approval mode. Other apply errors leave a structured terminal failure outcome without claiming application.

Multiple Drafts opened at one revision remain isolated while editing. If one applies first, every sibling with that base is rejected by the same expected-revision check. This is why sharing the parent engine is an interface invariant.

### 6. Reviews and undo receipts are derived from structured operations

`review()` walks the accepted journal and emits immutable entries containing operation kind, affected entity ids, call/operation order, and aggregate counts. It does not accept Agent prose. The same deterministic derivation is used before and after apply so the receipt is auditable.

Before apply, a T2-private compensation planner compares the captured base with the accepted final candidate in a bounded set of linear collection passes. For each ordered collection it retains the longest base prefix that already appears in recoverable order. Entities whose prior values can be expressed by `update-*` stay in place and receive only the changed pre-image fields. The first missing/out-of-order entity, an asset whose value changed (there is no `update-asset`), or an entity that must lose an own property begins a minimal ordered suffix repair: only that suffix is deleted and recreated. Clip repair is closed over any track/asset parent that must be recreated, and the one batch detaches/deletes clips before parents and recreates parents before clips.

This is materially different from whole-document reconstruction. A normal single-field update produces one inverse update regardless of document size. Delete/recreate is reserved for the smallest suffix whose observable order or own-property presence cannot be represented by T1's frozen patch surface. A content-neutral forward batch replays its same affected-entity operations as the non-empty compensation rather than inventing an unrelated no-op.

The manager re-evaluates the flattened forward batch against the exact captured committed base to obtain its next-revision document, canonical fingerprint, and result. T1's shared pure commit-projection helper then constructs the same would-be committed document used by durable engine apply: it preserves every existing metadata field and appends the forward `:apply` idempotency entry with that fingerprint and result. The manager evaluates the planned compensation from this metadata-bearing projection with the same frozen provider placement-policy list before it calls the parent engine. Consequently a deterministic policy sees an equivalent current document during compensation preflight and the later real undo, including prior ledger entries, revision, and the new forward entry. Missing committed-state capability never falls back to a content-only document. A provider rejection or throw becomes a structured terminal compensation failure and the forward batch is never durably applied.

Provider-private pre-image comparison is graph-exact rather than merely value-recursive. Equality registers every first-seen object pair in both directions and still traverses descendants when the two objects are literally identical; only an already-recorded matching pair terminates a cycle. Distinct references therefore cannot collapse into one shared reference and one shared reference cannot split into several distinct references unnoticed beneath plain objects/arrays, `Map`/`Set` entries, tagged native custom data, or typed-array backing buffers. The planner applies the same first-seen traversal over the complete document with one mapping context, records every entity participating in a cross-entity alias conflict, and expands only those entities to full pre-image patches or the already-required asset suffix. T1 internally clones the complete operation array once and applies its values without per-operation re-cloning; the final compensation array is likewise cloned once. Shared references therefore survive across track, clip, asset, and marker operations, including aliases contained in `Map`/`Set` and cyclic private graphs. Unrelated ordinary updates remain one inverse operation.

On success, `DraftApplicationReceipt` contains the Draft id/mode, base and applied revisions, structured review, forward batch/result, retention evidence, and one compensating `TransactionBatch`. The undo batch uses the applied revision as `expectedRevision` and its own stable idempotency key. Applying that batch once restores the base content; if later work has advanced the project, normal T1 conflict detection rejects the stale undo.

This is the T2 meaning of "one undo": one structured compensating transaction is returned. T3 owns attachment to the existing UI command journal and must not be claimed here.

Parent-engine failures cross the Draft boundary as immutable evidence snapshots. `TransactionError` and `ProjectStoreError` retain their known prototypes and fields. Unknown executable/accessor evidence is made inert without invoking evidence-owned getters; `Map`, `Set`, `Date`, and `RegExp` internal-slot content is preserved as tagged, deeply frozen data (including nested cycles and custom data properties) rather than as mutable native containers or empty object shells.

### 7. Type and runtime registers separate reversible project edits from immediate effects

The Draft module narrows the closed T1 transaction union to `DraftSafeOperation` and publishes an exhaustive runtime classification register. Current track/clip/marker operations and the project-local asset create/delete operations are Draft-safe because T1 evaluates them as reversible project content. External deletion is distinct: named categories such as media generation, project export, source-package removal, and external-resource deletion are `immediate` and never become `TransactionOperation` values.

The Draft staging interface accepts only `DraftSafeOperation` at compile time and repeats classification at runtime for untrusted Agent/MCP input. A forged immediate category returns `immediate-operation-required` before snapshot/journal mutation. T2 publishes named category descriptors/classification helpers, not an `invokeAnyCommand(name, payload)` or catch-all executor. Provider/Agent integrations must call their explicit immediate operations outside the Draft lifecycle.

### 8. Resource retention is a precondition, not package deletion inside a Draft

The manager receives a `DraftResourceRetentionPolicy` with a read-only `preflight` operation. Before engine apply, it computes every asset id referenced by the final candidate clips and requires structured evidence that each asset's backing content is already retained as project-owned data independent of its source package. Failure aborts before `engine.apply`, preserving the live revision and watchers.

The policy is a real adapter seam: the conformance suite supplies an in-memory adapter, while a later provider integration supplies the backing-data check. The preflight itself performs no generation, export, package removal, or external deletion. Source-package removal remains an immediate operation and can occur later without invalidating content that passed the retention contract.

Embedding bytes or provider source paths in the public `Asset` contract was rejected because it would expand T0 and leak provider/storage details. Copying content inside T2 was rejected because this additive Host-neutral module has no storage authority.

### 9. Conformance tests the external seam with run-local accounting

`runDraftEditingConformance(factory)` accepts a generic fixture factory that creates a fresh shared engine/manager and optional controllable retention/placement adapters. Every invocation owns its assertion count and result arrays; repeated or concurrent runs cannot contaminate one another. Tests observe only the Draft/engine interfaces and include multi-Draft isolation, revision-sandwich retry/exhaustion, per-call rollback, manual/auto transitions, structured summary derivation, stale rejection, one-batch apply, inverse receipt behavior, classification rejection, retention failure, and terminal-state errors.

The existing transaction boundary checker already scans all future `contracts/**` descendants, including `draft/**`. Verification reruns it and its negative control; no donor schema, command, core, Zustand store, browser-storage name, Rust, or WASM import is allowed.

## Risks / Trade-offs

- **[Local evaluator policy differs from the engine]** → The manager accepts the same provider placement-policy list, uses T1's shared complete commit projection before compensation preflight, and conformance proves an adversarial deterministic policy sees the same revision/idempotency document and only the one affected update during preflight and real undo. Final `engine.apply` remains authoritative if a caller misconfigures the lists or policy state changes later.
- **[High write traffic prevents a consistent open snapshot]** → The revision sandwich is bounded and returns a typed busy/conflict result rather than looping or accepting torn data.
- **[In-memory Draft is lost on reload]** → This is explicit T2 scope; the live project is unaffected, and durable Draft recovery can be added later without changing T1 persistence.
- **[Inverse logic misses cascade/pre-image/order/alias detail]** → Derive the repair from the base/final pair, close child repair over recreated parents, track aliases with one document-wide bijection, clone each operation graph once, and test every operation kind, cascades, own keys/order, cross-entity identity, minimal operation counts, and forward-then-undo restoration.
- **[A wrapper drops committed metadata]** → Native capture stays in a private registry, wrappers must inject an explicit capture port, public reads are matched to each capture, and both open and approval fail closed when proof is unavailable.
- **[Large documents amplify a local undo]** → Construction uses linear indexes/passes; ordinary updates remain one operation. A deterministic 8,000-marker regression asserts a one-field edit returns exactly one inverse operation rather than relying on a wall-clock threshold.
- **[Retention adapter overstates project ownership]** → Make its evidence structured, cover failure in conformance, and treat provider conformance as required before claiming source-package survivability.
- **[Undo races with later edits]** → The compensating batch carries the applied revision and fails stale through T1 instead of overwriting subsequent work.

## Migration Plan

1. Add the Draft types/classification and manager implementation under the new `draft/**` subtree, plus narrow T1-internal commit projection, private capture registration, and graph-preserving batch cloning shared by durable apply and compensation preflight.
2. Add the in-memory retention adapter, fixture helpers, and reusable conformance suite in the same subtree.
3. Prove behavior against the T1 engine and run boundary/type/Host/parity/spec gates.
4. Leave all callers unchanged. T4 may consume the public Draft seam for Agent evidence, and T3 may consume the receipt later.

Rollback removes the additive `draft/**` subtree and the shared-helper refactor can return to T1's behavior-equivalent inline projection; no existing state format, durable project record, public contract, command path, or Host wiring is migrated.

## Open Questions

None block T2. T3 must separately decide how a `DraftApplicationReceipt` is represented in the existing UI command journal without weakening the receipt's single-batch expected-revision semantics.
