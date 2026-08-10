## ADDED Requirements

### Requirement: Host-neutral domain types are frozen

The transaction contract SHALL define standalone TypeScript types for `Project`, `Track`, `Clip`, `Asset`, and `Marker` that contain no import of any OpenCut schema module, command class, editor store, Zustand store, or storage-service implementation. Every public time value — placement, duration, source trim, marker time — SHALL be a `MediaTime`: a non-negative branded integer at a fixed 120,000 ticks per second. The contract SHALL define `FrameRate` as `{ numerator: number; denominator: number }` and SHALL reject at construction time any rate that cannot produce an integer ticks-per-frame at the fixed tick rate.

#### Scenario: Domain types compile without editor-internal imports

- **WHEN** the contract module graph is inspected
- **THEN** no module under `apps/web/src/editor/contracts/` imports from `@/project`, `@/timeline`, `@/commands`, `@/core`, `@/stores`, `@/scenes`, `@/effects`, `@/masks`, `@/media`, `@/wasm`, `@/services/storage`, or `zustand`

#### Scenario: MediaTime is a branded integer at 120,000 ticks per second

- **WHEN** a `MediaTime` value is constructed from `{ ticks }`
- **THEN** it is a non-negative integer, and the contract declares `TICKS_PER_SECOND = 120000` as the fixed rate
- **AND** a raw `number` is not assignable to `MediaTime` without the constructor

#### Scenario: A frame rate that cannot produce integer ticks is rejected

- **WHEN** a `FrameRate` of `{ numerator: 90, denominator: 1 }` is validated against 120,000 ticks/sec
- **THEN** construction is rejected with a typed error, because `120000 / (90 / 1)` is not an integer

#### Scenario: A conforming frame rate produces integer ticks

- **WHEN** a `FrameRate` of `{ numerator: 30, denominator: 1 }` is validated against 120,000 ticks/sec
- **THEN** it is accepted, because `120000 / 30 = 4000` ticks per frame

### Requirement: The read interface queries project content

The contract SHALL define a `TransactionRead` interface that returns the current project content: tracks, clips (optionally filtered by track), assets, markers, the project metadata, and the current revision. Every read method SHALL return a `Promise` and SHALL defensively clone its result so that mutating a returned value does not alter the contract's internal state.

#### Scenario: Read returns tracks and clips after mutations

- **WHEN** an in-memory store has two tracks and three clips applied through `apply`
- **THEN** `read.tracks()` returns both tracks and `read.clips()` returns three clips
- **AND** `read.clips({ trackId })` returns only the clips on the specified track

#### Scenario: Read returns the current revision

- **WHEN** three batches have been applied successfully
- **THEN** `read.revision()` returns `3`

#### Scenario: Read results are defensively cloned

- **WHEN** a caller mutates the array returned by `read.tracks()`
- **THEN** a subsequent `read.tracks()` call returns the unmutated state

### Requirement: The apply interface submits atomic batches

The contract SHALL define a `TransactionApply` interface that accepts a batch of typed operations and applies them atomically. A batch SHALL be all-or-nothing: if any operation fails, the entire batch is rejected, the revision SHALL NOT increment, and no entity SHALL be created or modified. A successful apply SHALL return a `TransactionResult` containing the new revision, the IDs of changed entities, and the IDs of created entities.

#### Scenario: A batch of create operations applies atomically

- **WHEN** a batch containing `create-track` and `create-clip` is applied
- **THEN** both entities exist after the apply
- **AND** the revision increments by exactly one
- **AND** the result reports both IDs in `createdIds`

#### Scenario: A batch with one failing operation rolls back entirely

- **WHEN** a batch containing a valid `create-clip` and an invalid `delete-clip` (referencing a non-existent clip) is applied
- **THEN** the entire batch is rejected with a `TransactionError`
- **AND** the revision is unchanged
- **AND** neither the valid clip nor any other entity was created or modified

#### Scenario: Update operations apply partial patches

- **WHEN** an `update-clip` operation with a patch `{ duration: newDuration }` is applied
- **THEN** only the `duration` field changes on the targeted clip
- **AND** all other fields on that clip remain unchanged

#### Scenario: Operations are typed with a kind discriminator

- **WHEN** an `apply` call is authored
- **THEN** each operation carries a `kind` field that discriminates its payload structurally
- **AND** an `update-*` operation accepts a `patch` that excludes the entity's `id` field

### Requirement: Revisions are monotonic and conflicts are detected

The contract SHALL maintain a monotonic revision that starts at zero and increments by exactly one per successful `apply`. The `apply` interface SHALL accept an optional `expectedRevision`: when supplied and not matching the current revision, the batch SHALL be rejected with a `TransactionError` whose code is `"conflict"`, carrying both the expected and actual revision.

#### Scenario: Revision increments monotonically

- **WHEN** three sequential batches are applied successfully
- **THEN** the revisions observed are `1`, `2`, then `3`
- **AND** no revision value is ever reused or skipped

#### Scenario: Expected revision match succeeds

- **WHEN** the current revision is `2` and an `apply` supplies `expectedRevision: 2`
- **THEN** the batch applies successfully and the new revision is `3`

#### Scenario: Expected revision mismatch is rejected

- **WHEN** the current revision is `3` and an `apply` supplies `expectedRevision: 2`
- **THEN** the batch is rejected with `TransactionError { code: "conflict", expectedRevision: 2, actualRevision: 3 }`
- **AND** no state is modified

### Requirement: Idempotency keys deduplicate applies

The `apply` interface SHALL accept an optional `idempotencyKey: string`. When two `apply` calls supply the same key and the same batch of operations, the second SHALL return the same `TransactionResult` as the first without modifying state or incrementing the revision. When two `apply` calls supply the same key but different operations, the second SHALL be rejected with `TransactionError { code: "duplicate" }`.

#### Scenario: Same key and same operations returns the original result

- **WHEN** an `apply` with `idempotencyKey: "op-1"` and a `create-track` operation is called twice
- **THEN** the second call returns the same revision and `createdIds` as the first
- **AND** the revision increments only once

#### Scenario: Same key with different operations is rejected

- **WHEN** an `apply` with `idempotencyKey: "op-1"` and a `create-track` operation is followed by an `apply` with `idempotencyKey: "op-1"` and a `create-clip` operation
- **THEN** the second call is rejected with `TransactionError { code: "duplicate" }`

#### Scenario: An apply without a key is never deduplicated

- **WHEN** two `apply` calls supply no `idempotencyKey` with identical operations
- **THEN** both apply independently and the revision increments twice

### Requirement: Structured errors report failure detail

The contract SHALL define a `TransactionError` class extending `Error` with a stable `code` field drawn from a closed set: `"conflict"`, `"validation"`, `"not-found"`, `"duplicate"`, `"unsupported"`. The error SHALL carry an optional `operationIndex` identifying which operation in a batch failed, and `expectedRevision`/`actualRevision` where applicable.

#### Scenario: A not-found error identifies the failing operation

- **WHEN** the third operation in a five-operation batch references a non-existent track
- **THEN** the `TransactionError` has `code: "not-found"` and `operationIndex: 2`

#### Scenario: A negative duration is rejected at the domain constructor boundary

- **WHEN** a caller attempts to construct a clip duration from a negative tick count
- **THEN** `mediaTime` rejects the value with a `RangeError` and a non-empty message before `apply` is called

### Requirement: The getContext interface probes transaction metadata

The contract SHALL define a `TransactionGetContext` interface that returns the current revision, the set of supported operation kinds, and a capabilities object describing optional behaviour. Every method SHALL return a `Promise`.

#### Scenario: GetContext reports the current revision

- **WHEN** two batches have been applied
- **THEN** `getContext.revision()` returns `2`

#### Scenario: GetContext lists supported operation kinds

- **WHEN** `getContext.supportedOperations()` is called
- **THEN** it returns a list including `"create-track"`, `"update-track"`, `"delete-track"`, `"create-clip"`, `"update-clip"`, `"delete-clip"`

### Requirement: The watch interface subscribes to revision changes

The contract SHALL define a `TransactionWatch` interface that calls a subscriber when the revision changes. The subscription SHALL NOT fire for a no-op apply (an apply that is deduplicated by idempotency or rejected). Unsubscribing SHALL prevent further callbacks.

#### Scenario: Watch fires on a successful apply

- **WHEN** a subscriber is registered and a batch is applied successfully
- **THEN** the subscriber is called with the new revision

#### Scenario: Watch does not fire on a rejected apply

- **WHEN** a subscriber is registered and a batch is rejected due to a conflict
- **THEN** the subscriber is not called

#### Scenario: Unsubscribe prevents further callbacks

- **WHEN** a subscriber is registered, then unsubscribed, and a batch is applied
- **THEN** the former subscriber is not called

### Requirement: The contract contains no editor-internal types

A committed boundary check script (`script/check-transaction-boundary.mjs`) SHALL scan every module under `apps/web/src/editor/contracts/` and reject imports of OpenCut schema types, command classes, editor state stores, Zustand, IndexedDB types, OPFS handle types, and physical storage fields. The check SHALL include a negative control that materialises a fixture violating each rule and asserts each is caught.

#### Scenario: The boundary check passes on the contract modules

- **WHEN** the boundary check runs over the contract graph
- **THEN** it reports zero violations and scans at least one module
- **AND** an empty scan is a failure, not a pass

#### Scenario: The negative control proves every rule can fail

- **WHEN** the boundary check runs with `--negative-control`
- **THEN** each deliberate violation fixture is caught by its corresponding rule
- **AND** each rule is proven not to fire indiscriminately by converse fixtures

### Requirement: An in-memory fake implements every interface

The contract SHALL ship an in-memory fake (`createInMemoryTransactionStore`) that implements `TransactionRead`, `TransactionApply`, `TransactionGetContext`, and `TransactionWatch`. The fake SHALL be usable without React, Electron, or any Host port, and SHALL be the reference target of the conformance suite.

#### Scenario: The fake supports the full lifecycle

- **WHEN** the in-memory fake is exercised through create, update, delete, read, and watch
- **THEN** all operations behave according to the contract semantics
- **AND** no React, Electron, or Host-port dependency is required

### Requirement: A conformance suite validates any implementation

The contract SHALL ship a conformance suite (`runTransactionConformance`) as a plain async function returning a report with per-case pass/fail/skip status. The suite SHALL be runnable without React or Electron and SHALL cover read, apply, revision, conflict detection, idempotency, batch atomicity, watch, getContext, and defensive cloning. A case that executed no assertion SHALL be recorded as skipped, not passed.

#### Scenario: The conformance suite passes against the in-memory fake

- **WHEN** `runTransactionConformance` is pointed at `createInMemoryTransactionStore`
- **THEN** the report's `passed` field is `true`
- **AND** no case has status `"failed"`; cases that execute no assertion have status `"skipped"`

#### Scenario: A non-conforming implementation is reported as failed

- **WHEN** `runTransactionConformance` is pointed at an implementation that returns stale revisions
- **THEN** the report's `passed` field is `false`
- **AND** the failing case includes a detail string describing the mismatch
