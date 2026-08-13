## 1. Domain types

- [x] 1.1 Create `apps/web/src/editor/contracts/domain.ts` with branded `MediaTime` type (non-negative integer, `__mediaTime` brand), `TICKS_PER_SECOND = 120000` constant, and the `mediaTime({ ticks })` constructor that rejects negative or non-integer values
- [x] 1.2 Add `FrameRate` type `{ numerator: number; denominator: number }` and a `validateFrameRate(rate)` function that rejects rates where `120000 * denominator / numerator` is not a positive integer (Target State locked decision 4)
- [x] 1.3 Add branded ID types: `TrackId`, `ClipId`, `AssetId`, `MarkerId` (branded strings, `number` not assignable without constructor)
- [x] 1.4 Add `TrackKind` union (`"video" | "audio" | "text" | "graphic" | "effect"`) and entity interfaces: `Project`, `Track`, `Clip`, `Asset`, `Marker` — all standalone, no imports from editor-internal modules

## 2. Operations and transaction types

- [x] 2.1 Create `apps/web/src/editor/contracts/operations.ts` with the `TransactionOperation` discriminated union (create/update/delete for track, clip, asset, marker), where `update-*` operations take `Partial<Omit<Entity, "id">>` patches
- [x] 2.2 Create `apps/web/src/editor/contracts/transaction.ts` with branded `Revision` type (starting at 0), `TransactionBatch` (operations + optional expectedRevision + optional idempotencyKey), `TransactionResult` (revision + changedIds + createdIds), `TransactionErrorCode` union, and `TransactionError` class extending `Error`

## 3. Interfaces and entry point

- [x] 3.1 Create `apps/web/src/editor/contracts/interfaces.ts` with `TransactionRead` (tracks, clips, assets, markers, project, revision — all `Promise`-returning, defensively cloning results), `TransactionApply` (accepts `TransactionBatch`, returns `Promise<TransactionResult>`), `TransactionGetContext` (revision, capabilities, supportedOperations — all `Promise`-returning per A3 = async), and `TransactionWatch` (subscribe to revision changes, returns unsubscribe handle)
- [x] 3.2 Create `apps/web/src/editor/contracts/index.ts` re-exporting all public types and interfaces as the single entry point

## 4. In-memory fake

- [x] 4.1 Create `apps/web/src/editor/contracts/in-memory/index.ts` with `createInMemoryTransactionStore()` returning an object implementing all four interfaces (`TransactionRead`, `TransactionApply`, `TransactionGetContext`, `TransactionWatch`), storing state in plain `Map`s with no React, Electron, or Host-port dependency
- [x] 4.2 Implement atomic batch apply in the fake: validate all operations before committing any; on any failure, reject the entire batch without modifying state or incrementing revision
- [x] 4.3 Implement idempotency-key dedup in the fake: store `{ key, operations, result }` for each keyed apply; replay result on same key + same operations; reject with `duplicate` on same key + different operations
- [x] 4.4 Implement revision/watch in the fake: monotonic revision counter, watch subscribers notified only on successful applies (not on dedup replay or rejection)
- [x] 4.5 Implement defensive cloning in the fake's `read` methods: `structuredClone` or equivalent deep-copy on every return so caller mutations don't corrupt state

## 5. Conformance suite

- [x] 5.1 Create `apps/web/src/editor/contracts/conformance/index.ts` with `runTransactionConformance(args)` as a plain async function returning a `ConformanceReport` with per-case `passed`/`failed`/`skipped` status — modelled on S02's `ports/conformance/` (not a test file, runnable without React or Electron)
- [x] 5.2 Write conformance cases covering: read returns current state after mutations; apply creates entities and increments revision monotonically; apply with expectedRevision succeeds on match and rejects with `conflict` on mismatch; idempotency dedup (same key + same ops = same result, revision unchanged); idempotency collision (same key + different ops = `duplicate`); batch atomicity (one failing op rolls back all); watch fires on revision change, not on rejection; getContext reports revision and supported operations; read results are defensively cloned
- [x] 5.3 Ensure a case that executed no assertion is recorded as `skipped`, not `passed` (modelled on S02's `SkipCase` pattern)

## 6. Boundary check script

- [x] 6.1 Create `script/check-transaction-boundary.mjs` modelled on S02's `check-port-boundary.mjs`, scanning `apps/web/src/editor/contracts/` for: (1) no imports from editor-internal modules (`@/project`, `@/timeline`, `@/commands`, `@/core`, `@/stores`, `@/scenes`, `@/effects`, `@/masks`, `@/media`, `@/wasm`, `@/services/storage`, `zustand`, any path ending in `-store`), (2) no IndexedDB/OPFS mechanism types or physical storage fields in public signatures
- [x] 6.2 Add `--negative-control` mode that materialises a fixture violating each rule and asserts each is caught, plus converse fixtures proving rules don't fire indiscriminately — every rule proven able to fail
- [x] 6.3 Ensure an empty scan is a failure, not a pass (modelled on the port boundary check's `files.length === 0` guard)

## 7. Verification

- [x] 7.1 Run `node script/check-transaction-boundary.mjs` and `node script/check-transaction-boundary.mjs --negative-control` — both pass
- [x] 7.2 Run the conformance suite against the in-memory fake — report is `passed: true`
- [x] 7.3 Build both Hosts (`apps/web` and `apps/vite-example`) — both stay green
- [x] 7.4 Run `node script/check-type-baseline.mjs` — type baseline count does not exceed ceiling 3
- [x] 7.5 Run the parity fixture on both Hosts — unchanged (the contract wires nothing)
- [x] 7.6 Spec-falsification sweep: grep all fifteen existing capability specs for SHALL assertions this diff makes false — confirm none
