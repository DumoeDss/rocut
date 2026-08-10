## Context

S02 froze the editor's *lifecycle* boundary: `createEditorSession`, the frozen Host port contract (`editor/ports/`), and the session-owned `EditorCore`. What S02 deliberately left open is the *mutation* boundary — there is no `read`/`apply`/`getContext`/`watch` over project content, no revision, no transaction, no draft session. Every property Target State §5.3 requires is hypothetical today.

The current commit path is imperative-snapshot: commands (in `apps/web/src/commands/**`, ~50 modules + `base-command.ts`/`batch-command.ts`) receive an `EditorCommandContext { editor: EditorCore }`, snapshot `SceneTracks`, mutate stores directly via `editor.timeline.updateTracks(...)`, and restore the snapshot on undo. There is no typed operation boundary, no revision, no idempotency, no separation of draft-safe mutations from immediate side effects.

This child freezes the transaction contract as a single coherent surface in new files under `apps/web/src/editor/contracts/**`, modelled on the freeze-before-consume discipline S02's C1 established for ports. It wires nothing and migrates no behaviour.

**Branch baseline**: S02 product-line tip `feat/session-runtime-host-ports@d84d9d50`.

**Consumed, not redefined**: `ProjectStore` (opaque `data: unknown`, typed `ProjectSummary`), `EditorHost`, `EditorSession`. The contract attaches to these; it does not shadow them.

## Goals / Non-Goals

**Goals:**

- Author Host-neutral domain types (Project / Track / Clip / Asset / Marker) and OpenCut-compatible `MediaTime` at fixed 120,000 ticks/sec with rational `FrameRate`.
- Author the `read` / `apply` / `getContext` / `watch` typed interfaces with atomic batches, monotonic revisions, expected-revision conflict detection, idempotency keys, structured errors, and changed/created IDs.
- Provide an in-memory fake of every interface and a conformance suite runnable without React or Electron.
- Provide a boundary check script with a negative control enforcing that no OpenCut schema type, command class, Zustand store, IndexedDB name, or OPFS path appears in the public contract payload.

**Non-Goals:**

- Wire the contract into the editor's commit path (T3).
- Implement the real engine behind the contract types (T1).
- Implement draft editing sessions (T2).
- Author the Surface commit binding (R1, per A1 = (a)).
- Migrate any behaviour. Commands keep committing exactly as they do today.
- Extract packages or publish anything (S05).
- Touch `ports/`, `rust/`, `commands/**`, or any Host composition root.

## Decisions

### D1: MediaTime as a standalone branded integer at 120,000 ticks/sec

The donor's `MediaTime` is a branded `number` from `@/wasm` with `TICKS_PER_SECOND = 120,000`. The contract defines its own `MediaTime` — same tick rate, same structural semantics — without importing from `@/wasm` or `opencut-wasm`. This keeps the contract boundary-check-clean: the boundary rule bans editor-internal imports, and `@/wasm` is an editor-internal module.

Structural compatibility (same tick rate) means T1/T3 bridge between contract `MediaTime` and donor `MediaTime` with a zero-cost cast at the seam. The contract also defines `FrameRate` as `{ numerator: number; denominator: number }` independently — same shape as the wasm binding.

**Alternative considered**: re-export `MediaTime` from `@/wasm`. Rejected: it would create a contract dependency on the wasm module, and the boundary check exists precisely to prevent that.

**Structured rejection**: `FrameRate` must produce an integer ticks/frame (Target State §5.1, locked decision 4). `120000 / (numerator / denominator)` must be a positive integer. A rate that cannot produce one (e.g., 30000/1001 at 120,000 ticks/sec yields 4000.1333...) is rejected with a typed error at construction time. The contract's `mediaTime` constructor takes `{ ticks }` and enforces non-negative integers.

### D2: Domain entity types as minimal Host-neutral interfaces

The donor schema (`TProject`, `TimelineTrack` with 5 variants, `TimelineElement` with 8 variants, `MediaAsset`/`MediaAssetData`, `Bookmark`) is rich and provider-specific. The contract defines simplified, stable interfaces that cover what an automation client needs:

| Contract type | Donor analogue | Key fields |
|---|---|---|
| `Project` | `TProject` + `TProjectSettings` | `id`, `name`, `frameRate`, `canvasWidth`, `canvasHeight` |
| `Track` | `TimelineTrack` (5 variants) | `id`, `kind` (video/audio/text/graphic/effect), `name`, `hidden` |
| `Clip` | `TimelineElement` (8 variants) | `id`, `trackId`, `startTime`, `duration`, `trimStart`, `trimEnd`, `assetId?` |
| `Asset` | `MediaAsset`/`MediaAssetData` | `id`, `kind` (image/video/audio), `name`, `duration?`, `width?`, `height?` |
| `Marker` | `Bookmark` | `id`, `time`, `note?`, `color?` |

Provider-private fields (effects, masks, keyframes, retiming, animations) are excluded — Target State §5.3 "Not Now" until two real use cases exist. The contract types are NOT a mirror of the full schema; they are the minimal stable surface. T1/T3 map between them at the seam.

**Alternative considered**: make `Clip` a union matching all 8 donor element variants. Rejected: 5 of those variants carry provider-private concerns the contract must not expose yet. A flat interface with optional `assetId` covers the automation use cases (create/move/trim/split) without leaking provider internals.

### D3: Four interfaces — read / apply / getContext / watch

- **`TransactionRead`**: query the project content snapshot. Returns `Promise` for implementations that may be async (store-backed). Methods: `tracks()`, `clips(trackId?)`, `assets()`, `markers()`, `revision()`, `project()`.
- **`TransactionApply`**: submit atomic batches of operations. Returns `Promise<TransactionResult>` with the new revision, changed IDs, and created IDs.
- **`TransactionGetContext`**: probe context metadata. Returns `Promise` (ruling **A3 = async**, for consistency with `read`/`apply` and to allow implementations that probe external state). Methods: `revision()`, `capabilities()`, `supportedOperations()`.
- **`TransactionWatch`**: subscribe to revision changes. Different from S02's `session.watch` (which is over the session *lifecycle* snapshot). Returns an unsubscribe handle.

**A3 ruling**: `getContext` is **async**. The three data interfaces (`read`, `apply`, `getContext`) share a consistent `Promise`-returning shape. `watch` is callback-based, matching S02's `session.watch` pattern.

### D4: Operations as a discriminated union

```typescript
type TransactionOperation =
  | { kind: "create-track"; track: Track }
  | { kind: "update-track"; trackId: TrackId; patch: Partial<Omit<Track, "id">> }
  | { kind: "delete-track"; trackId: TrackId }
  | { kind: "create-clip"; clip: Clip }
  | { kind: "update-clip"; clipId: ClipId; patch: Partial<Omit<Clip, "id">> }
  | { kind: "delete-clip"; clipId: ClipId }
  | { kind: "create-asset"; asset: Asset }
  | { kind: "delete-asset"; assetId: AssetId }
  | { kind: "create-marker"; marker: Marker }
  | { kind: "update-marker"; markerId: MarkerId; patch: Partial<Omit<Marker, "id">> }
  | { kind: "delete-marker"; markerId: MarkerId };
```

The `kind` discriminator makes `apply` type-safe: the payload for each operation kind is structurally distinct. `update-*` operations take a `patch` (partial minus `id`), not a full replacement, so a caller cannot accidentally drop the `id` field or change the entity kind.

### D5: Monotonic revisions, expected-revision, and idempotency

- **Revision**: branded integer starting at 0, incrementing by 1 per successful `apply`. Branded so `number` is not assignable to `Revision` without the constructor.
- **Expected-revision**: `apply` accepts an optional `expectedRevision: Revision`. If the current revision doesn't match, the batch is rejected with `TransactionError { code: "conflict" }`. Enables optimistic concurrency for concurrent Drafts (T2) and agent scripts (T4).
- **Idempotency**: `apply` accepts an optional `idempotencyKey: string`. The engine (T1) deduplicates applies with the same key, returning the original result. For T0's in-memory fake, the key is stored and replayed. A key collision with *different* operations yields `TransactionError { code: "duplicate" }`.

### D6: Structured errors

```typescript
type TransactionErrorCode =
  | "conflict"      // expected-revision mismatch
  | "validation"    // operation violates a domain rule
  | "not-found"     // referenced entity doesn't exist
  | "duplicate"     // idempotency key collision with different operations
  | "unsupported";  // operation kind not supported by this implementation

class TransactionError extends Error {
  readonly code: TransactionErrorCode;
  readonly operationIndex?: number;   // which operation in the batch failed
  readonly expectedRevision?: Revision;
  readonly actualRevision?: Revision;
}
```

Modelled on `ProjectStoreError` from S02: a stable failure shape with a code, an operation context, and revision details where relevant.

### D7: Atomic batches

A batch is all-or-nothing. If any operation fails, the entire batch is rejected and the state is unchanged — the revision does not increment, no entities are created or modified. `TransactionResult` includes `changedIds` and `createdIds` so callers can observe what the batch produced without re-reading.

### D8: File layout

```
apps/web/src/editor/contracts/
  domain.ts          — MediaTime, FrameRate, ticks/sec constant,
                       Project/Track/Clip/Asset/Marker, branded ID types
  operations.ts      — TransactionOperation discriminated union
  transaction.ts     — Revision, TransactionBatch, TransactionResult,
                       TransactionError, TransactionErrorCode
  interfaces.ts      — TransactionRead, TransactionApply,
                       TransactionGetContext, TransactionWatch
  index.ts           — re-exports (the single entry point)
  in-memory/
    index.ts         — createInMemoryTransactionStore()
  conformance/
    index.ts         — runTransactionConformance()

script/
  check-transaction-boundary.mjs
```

**A4 ruling**: location is `apps/web/src/editor/contracts/`. Package extraction is S05; the in-repo location matches the stated touch set.

### D9: Boundary check script

Modelled on S02's `check-port-boundary.mjs`. Scans `apps/web/src/editor/contracts/` for:

1. **No editor-internal imports**: no import from `@/project`, `@/timeline`, `@/commands`, `@/core`, `@/stores`, `@/scenes`, `@/effects`, `@/masks`, `@/media`, `@/services/storage`, `@/wasm`, `zustand`, or any path ending in `-store`.
2. **No storage-mechanism types**: no IndexedDB type names, no OPFS handle types, no `navigator.storage` calls, no physical storage fields in public signatures.

The negative control materialises fixtures that violate each rule and asserts each is caught — because a check that cannot fail is not evidence.

### D10: Conformance suite

Modelled on S02's `ports/conformance/`: a plain async function returning a `ConformanceReport`, not a test file. Runnable without React or Electron. An adapter author (T1, T4, or a third party) points it at their implementation and runs it unmodified.

The suite exercises:
- `read` returns current state after mutations
- `apply` creates entities and increments revision monotonically
- `apply` with `expectedRevision` succeeds on match, rejects on mismatch
- `apply` with `idempotencyKey` deduplicates (same key + same operations = same result)
- `apply` with `idempotencyKey` collision (same key + different operations) rejects with `duplicate`
- Batch atomicity: a batch with one failing operation leaves state unchanged
- `watch` fires on revision change and not on no-op
- `getContext` reports revision, capabilities, and supported operations
- `read` results are defensively cloned (mutating a result doesn't change state)

## Risks / Trade-offs

- **[Domain type drift]** The contract's simplified types (flat `Clip`, single `Track` kind) will diverge from the donor schema as it evolves. → The contract types are explicitly minimal; T1/T3 own the mapping at the seam. Adding fields is non-breaking; removing them is the hazard the boundary check and conformance suite exist to surface.

- **[getAsync vs sync for `getContext`]** A3 was open. → Ruled async (D3). If T1 finds `getContext` must be sync for a hot path, the interface can add a sync variant without breaking the async one.

- **[Operations union growth]** Adding an operation kind (e.g., `create-effect`) widens the discriminated union, which is a compile-breaking change for consumers. → This is intentional: a new operation kind is a contract change that should be visible at compile time, not silently swallowed by a generic escape hatch.

- **[In-memory fake diverges from real engine]** T1's real engine might behave subtly differently. → The conformance suite is the same suite both run; divergence surfaces as a conformance failure, not as silent behaviour drift.
