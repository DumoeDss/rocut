# transaction-automation-api Specification

## Purpose
TBD - created by archiving change s0304-transaction-contract-freeze. Update Purpose after archive.
## Requirements
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

### Requirement: A durable transaction engine consumes the frozen Host port

The system SHALL provide a transaction engine under `apps/web/src/editor/contracts/engine/**` that implements T0's `TransactionRead`, `TransactionApply`, `TransactionGetContext`, and `TransactionWatch` interfaces by consuming S02's existing `ProjectStore`. The engine MUST NOT redefine or widen `ProjectStore`, interpret the minimal transaction-domain types as the provider's persistence schema, or import an OpenCut schema, command, editor store, Zustand store, wasm module, or storage mechanism. An injected document adapter SHALL translate only through `ProjectRecord.data: unknown`, SHALL encode revision and idempotency metadata in the same replacement record as project content, and SHALL preserve provider-private fields it does not interpret.

#### Scenario: The engine opens over the frozen ProjectStore

- **WHEN** a Host supplies S02's `ProjectStore`, a project ID, and a conforming document adapter
- **THEN** the opened engine satisfies all four frozen transaction interfaces without a second persistence port or a private store definition

#### Scenario: Opaque provider fields survive a transaction

- **WHEN** the loaded `ProjectRecord.data` contains an unknown sentinel field and a valid batch is applied
- **THEN** the saved replacement contains the sentinel unchanged alongside the adapter's updated known transaction content and metadata

#### Scenario: A malformed persisted engine document is structured corruption

- **WHEN** the document adapter cannot decode a loaded revision, entity, or idempotency entry into the frozen contract types
- **THEN** opening rejects with a mechanism-neutral `ProjectStoreError { code: "corrupt", operation: "load-project" }`
- **AND** no raw provider payload, storage identity, or underlying cause crosses the engine interface

### Requirement: Apply commits one ordered durable batch

Every engine instance SHALL serialize `apply` calls in invocation order. It SHALL evaluate a complete batch against a working copy, encode one candidate project record, and await exactly one `ProjectStore.save` before publishing the candidate as committed. A successful durable save SHALL increment the persisted revision by exactly one, persist any idempotency result, update reads, and notify watchers once. An operation rejection, adapter rejection, or store failure SHALL leave committed content, revision, idempotency state, and watchers unchanged, and a rejected apply MUST NOT prevent a later queued apply from running.

#### Scenario: Concurrent applies commit in invocation order

- **WHEN** two valid applies are invoked without awaiting the first and the first durable save is delayed
- **THEN** the second apply does not evaluate or save ahead of the first
- **AND** the observed result revisions are consecutive in invocation order

#### Scenario: One durable failure publishes nothing

- **WHEN** every operation in a batch is valid but `ProjectStore.save` rejects before its commit point
- **THEN** the apply rejects with the structured `ProjectStoreError`
- **AND** reads, revision, the idempotency ledger, and watcher call count remain exactly as before the apply

#### Scenario: A rejected middle batch does not poison ordering

- **WHEN** a valid apply, an invalid apply, and another valid apply are queued in that order
- **THEN** the first and third batches commit in order, the middle batch commits nothing, and the third revision is exactly one greater than the first

#### Scenario: Revision and keyed replay survive reopen

- **WHEN** an engine commits a keyed batch, is discarded, and a new engine opens the saved record
- **THEN** the reopened engine reports the committed revision
- **AND** replaying the same key and canonically equivalent operations returns the original result without saving, incrementing revision, or notifying watchers
- **AND** reusing the key with different operations rejects with `TransactionError { code: "duplicate" }`

#### Scenario: Equivalent operation objects have one stable fingerprint

- **WHEN** a keyed batch is replayed with object properties inserted in a different order but with the same values and operation-array order
- **THEN** the engine recognizes the canonical operations as the same request and returns the original result

### Requirement: Validation and dry-run are structured and non-mutating

The engine SHALL expose `validate(batch)` and `dryRun(batch)` in addition to the frozen four interfaces. Both methods SHALL use the same evaluator and committed base revision as `apply`. Validation SHALL return a discriminated outcome with attributable domain, referential, operation, and placement issues. Dry-run SHALL follow the same idempotency, expected-revision, operation-order, and placement path as apply and return either the projected `TransactionResult` or a structured rejection. Neither method SHALL call `ProjectStore.save`, reserve an idempotency key, increment the committed revision, alter subsequent reads, or notify watchers.

#### Scenario: Dry-run predicts a later successful apply

- **WHEN** a valid batch is dry-run and then applied against the same base revision
- **THEN** the dry-run and apply report the same projected revision, created IDs, and changed IDs
- **AND** only the apply performs one save and one watcher notification

#### Scenario: Validation reports every attributable issue without mutation

- **WHEN** a batch contains multiple independently attributable invalid relations or placements
- **THEN** validation returns `valid: false` with stable issue codes, operation indexes, and involved IDs for each issue it can deterministically evaluate
- **AND** durable state, revision, idempotency, reads, and watchers remain unchanged

#### Scenario: Expected revision and idempotency are evaluated without reservation

- **WHEN** dry-run receives a stale expected revision or an idempotency-key collision
- **THEN** it returns the same structured conflict or duplicate rejection that apply would return
- **AND** a later corrected apply may use the key because dry-run did not reserve it

#### Scenario: Validation waits for an earlier queued commit

- **WHEN** validation is invoked while an earlier apply is awaiting its durable save
- **THEN** validation evaluates after that apply settles and reports the resulting committed base revision

### Requirement: Placement policy enforces deterministic timeline validity

The engine SHALL always enforce a non-replaceable base placement policy before a batch can commit. The policy SHALL require positive clip duration; alignment of clip and marker times to the project's integer ticks-per-frame; existing referenced tracks and assets; unique IDs; compatible asset/track lanes; source trims within a known asset duration; and no overlap between half-open clip intervals on one track. Adjacent intervals whose endpoints only touch SHALL be valid. Optional provider policies MAY add rejections but MUST NOT waive a base rule. Placement failures SHALL carry a stable issue code, the responsible operation index, and involved entity IDs, and apply SHALL expose the first blocking placement issue as `TransactionError { code: "validation" }`.

#### Scenario: A same-track collision is rejected atomically

- **WHEN** a batch creates or moves a clip so its half-open interval overlaps another clip on the same track
- **THEN** validation and dry-run report a `collision` issue with both clip IDs
- **AND** apply rejects at the responsible operation index without saving or changing revision

#### Scenario: Adjacent clips are accepted

- **WHEN** one clip ends exactly where another clip on the same track starts
- **THEN** the base collision policy accepts the placement because the half-open intervals do not overlap

#### Scenario: Timebase misalignment is rejected

- **WHEN** a clip placement or marker time is not an integer multiple of the project's validated ticks-per-frame
- **THEN** validation reports a `timebase-misaligned` issue and apply commits nothing

#### Scenario: Asset and lane kinds must be compatible

- **WHEN** an audio asset is placed on a video track or an image/video asset is placed on an audio track
- **THEN** validation reports a `lane-incompatible` issue identifying the asset and track

#### Scenario: Source bounds are enforced when duration is known

- **WHEN** a clip's `trimStart + duration + trimEnd` exceeds the referenced asset's declared duration
- **THEN** validation reports a `source-out-of-bounds` issue and no batch containing that placement can commit

#### Scenario: Provider policy composes without weakening the base policy

- **WHEN** an optional provider policy accepts a placement that violates a base collision or timebase rule
- **THEN** the base issue still rejects the placement
- **AND** provider-specific rejections are additionally reported for otherwise base-valid placements

### Requirement: Engine behavior is discoverable through typed features

The engine SHALL expose typed capability keys for its base guarantees and for literal optional provider features supplied when the engine opens. The base feature set SHALL report atomic batch, expected revision, durable revision, durable idempotency, validation, dry-run, placement policy, and cross-engine compare-and-swap support. T0's `supportedOperations()` SHALL remain the authoritative typed operation-kind probe. Optional behavior MUST NOT be inferred from method presence or an untyped invoke-any-command escape hatch.

#### Scenario: Base guarantees are probeable

- **WHEN** `capabilities()` is called on a transaction engine
- **THEN** the typed base keys report atomic batch, expected revision, durable revision, durable idempotency, validation, dry-run, and placement policy as supported

#### Scenario: The current store limitation is reported honestly

- **WHEN** the engine uses S02's `ProjectStore` without a compare-and-swap token
- **THEN** the typed `cross-engine-cas` capability is `false`
- **AND** the engine makes no claim that independent processes cannot replace the same project concurrently

#### Scenario: Optional provider features retain literal key types

- **WHEN** a provider opens the engine with a literal optional feature such as `provider-ripple-edit`
- **THEN** an engine-aware caller can probe that exact typed key and receive its declared boolean value
- **AND** T0-only callers can still consume the result as `Readonly<Record<string, boolean>>`

### Requirement: Reusable engine conformance proves T1 semantics

The engine SHALL ship `runTransactionEngineConformance(factory)` as a plain async conformance function under `engine/conformance/**`. It SHALL run T0's existing conformance unchanged against each target and SHALL add fresh-target cases for durable ordering, save-failure atomicity, reopen revision/idempotency, validation/dry-run purity, placement policy, opaque-field preservation, and typed feature discovery. Cases SHALL report pass/fail/skip individually; a case that executes no assertion MUST be skipped rather than passed.

#### Scenario: The transaction-native adapter passes the full matrix

- **WHEN** engine conformance opens targets over S02's `InMemoryProjectStore` and T1's transaction-native document adapter
- **THEN** every applicable T0 and T1 case passes and no executed case is silently skipped

#### Scenario: A non-conforming adapter loses opaque data

- **WHEN** conformance runs against an adapter that rebuilds `ProjectRecord.data` and drops an unknown sentinel
- **THEN** the opaque-round-trip case fails with detail identifying the lost field

#### Scenario: Engine files preserve the transaction boundary

- **WHEN** the transaction boundary check and its negative control run after the engine subtree is added
- **THEN** the check scans the engine modules and reports no donor schema, command, core, store implementation, Zustand, wasm, or storage-mechanism leak
- **AND** the negative control still proves every rule can fail

### Requirement: Draft sessions capture isolated consistent base snapshots

The system SHALL open every Draft Session against one consistent project-content snapshot and its durable base revision. Drafts created for one editor session MUST share that session's transaction engine, maintain independent working state, and perform no durable mutation while opening or editing.

#### Scenario: Opening captures one revision-consistent document

- **WHEN** the revision before and after reading project, tracks, clips, assets, and markers is the same
- **THEN** the Draft opens with those entities and that revision as its immutable base
- **AND** its private working document starts as a defensive copy of that base

#### Scenario: Opening retries a torn snapshot

- **WHEN** the durable revision changes while a Draft's project content is being read
- **THEN** the system discards every entity from that attempt and retries the complete snapshot read within a bounded limit
- **AND** exhaustion returns a structured busy or conflict failure without creating a Draft

#### Scenario: Committed-state capability is explicit and fail-closed

- **WHEN** a public transaction-engine wrapper does not supply an exact committed-state capture capability
- **THEN** Draft opening returns a structured `committed-state-unavailable` failure
- **AND** no hidden Symbol, empty-idempotency fallback, Draft session, or durable mutation is created

#### Scenario: Wrapper capture includes the complete durable ledger

- **WHEN** a conforming wrapper supplies an explicit capture capability bound to its underlying provider state
- **THEN** the captured base includes the exact revision, content, private graph, and every prior idempotency entry
- **AND** compensation preflight and actual undo observe equivalent prior and forward ledger entries

#### Scenario: Capture loss before approval fails closed

- **WHEN** an opened Draft can no longer capture and match committed state at approval
- **THEN** approval becomes terminal with a structured committed-state failure before parent apply
- **AND** no forward content, revision, idempotency entry, save, or watcher event is published

#### Scenario: Concurrent Drafts remain isolated

- **WHEN** two Drafts open from the same engine revision and each accepts different Draft-safe operations
- **THEN** each Draft review and working snapshot contains only its own accepted operations
- **AND** neither Draft nor the durable project exposes the other Draft's unapproved content

### Requirement: Each Draft tool call has an atomic savepoint

The system SHALL evaluate every Draft tool call as one non-empty ordered batch against a savepoint of that Draft's current working document. A successful call MUST replace the working document and append its operations in order; a rejected or failed call MUST restore the exact pre-call working document and journal.

#### Scenario: Successful calls accumulate in order

- **WHEN** a Draft accepts several tool calls whose operations depend on content created by earlier calls
- **THEN** each call evaluates against the result of the preceding accepted calls
- **AND** the Draft journal preserves call order and operation order

#### Scenario: Mid-sequence failure rolls back only that call

- **WHEN** an operation in a multi-operation tool call fails validation, placement, or referential integrity after an earlier operation in the same call would have succeeded
- **THEN** none of that call's operations appear in the Draft working document or journal
- **AND** all operations accepted by earlier tool calls remain unchanged

#### Scenario: Draft evaluation is non-durable

- **WHEN** a Draft tool call succeeds or fails before approval
- **THEN** the parent engine performs no durable save, revision increment, idempotency mutation, or watch notification

### Requirement: Draft approval modes and reviews are explicit

The system SHALL require a Draft Session to select `manual` or `auto` approval when it opens and MUST keep that mode fixed for the Draft's lifetime. Review summaries MUST be generated deterministically from structured accepted operations rather than Agent-authored prose.

#### Scenario: Manual Draft accumulates until an explicit decision

- **WHEN** a manual Draft accepts one or more tool calls
- **THEN** it remains editable and reviewable without changing the durable project
- **AND** only explicit approval or rejection ends its lifecycle

#### Scenario: Auto Draft uses the normal approval path

- **WHEN** an auto Draft accepts a tool call
- **THEN** it immediately applies that call through the same retention, expected-revision, and single-batch approval path used by manual mode
- **AND** the Draft becomes terminal after that apply attempt

#### Scenario: Mode fallback is forbidden

- **WHEN** approval or apply fails for a manual or auto Draft
- **THEN** the system does not change its approval mode, silently approve it, or reopen it on another base

#### Scenario: Review is derived from the journal

- **WHEN** a caller requests a Draft review
- **THEN** the result reports operation kinds, affected entity ids, stable call/operation order, and aggregate counts derived from the accepted journal
- **AND** no free-form Agent summary is required or accepted as authoritative

### Requirement: Approval is one conflict-checked transaction and one undo unit

The system SHALL approve a non-empty Draft by flattening all accepted operations in original order into exactly one transaction batch. The batch MUST use the Draft's captured durable base as `expectedRevision`, and a successful application MUST return a structured receipt containing one compensating transaction that represents the Draft as one undo unit.

#### Scenario: Manual approval commits one durable batch

- **WHEN** a non-stale manual Draft with several accepted calls is approved
- **THEN** the parent engine receives exactly one apply containing every accepted operation in original order
- **AND** success causes exactly one durable save, one revision increment, and one watch notification

#### Scenario: Stale Draft is rejected without rebase

- **WHEN** the durable engine revision no longer equals the Draft's captured base revision at approval
- **THEN** approval returns a structured conflict with expected and actual revisions
- **AND** it performs no Draft rebase, durable save, revision increment, or watch notification

#### Scenario: Only one sibling Draft can win

- **WHEN** two Drafts share one engine and the same base revision and one Draft applies first
- **THEN** approving the second Draft fails the expected-revision check
- **AND** the first Draft's committed content remains unchanged

#### Scenario: Receipt supplies one compensating batch

- **WHEN** a Draft applies successfully
- **THEN** its receipt includes the base and applied revisions, structured review, forward result, and one inverse batch whose expected revision is the applied revision
- **AND** applying that inverse batch once restores the base project content when no later edit has advanced the revision

#### Scenario: Compensation is minimal and policy-closed before apply

- **WHEN** a provider policy accepts a local Draft update and its corresponding inverse but rejects unrelated create/delete operation classes
- **THEN** the planned inverse contains only operations needed for the affected entities or their observable ordered suffix
- **AND** the system evaluates that exact inverse with the same provider policy before the forward parent-engine apply
- **AND** a rejected or thrown compensation preflight leaves durable content, revision, idempotency, saves, and watchers unchanged

#### Scenario: Compensation preflight observes the complete forward commit projection

- **WHEN** a deterministic provider policy inspects the transaction document while evaluating both compensation preflight and the later published undo
- **THEN** both evaluations observe equivalent project content, revision, existing metadata, and the forward `:apply` idempotency entry with its canonical fingerprint and result
- **AND** an inverse accepted during preflight remains accepted when applied without intervening work

#### Scenario: Local update compensation does not scale with document size

- **WHEN** one field of one entity is updated in a document containing thousands of otherwise unaffected entities and the pre-image is expressible by the matching update operation
- **THEN** compensation construction uses linear collection passes and returns exactly one inverse update
- **AND** it does not synthesize whole-document delete/create reconstruction

#### Scenario: Ordered repair preserves exact base representation

- **WHEN** undo must reinsert an entity, restore an absent own property, or repair insertion order that T1 patches cannot express
- **THEN** the compensation recreates only the smallest required ordered suffix plus referentially dependent children
- **AND** one atomic inverse restores collection order, own-property presence, references, and provider-private pre-images exactly

#### Scenario: Provider-private alias topology is restored bijectively

- **WHEN** a reversible provider-private update changes two structurally equal references from distinct to shared or from shared to distinct
- **THEN** approval succeeds and the compensating transaction restores the base reference topology exactly
- **AND** equality used by repair planning and final proof rejects any many-to-one or one-to-many object mapping

#### Scenario: Alias repair spans the complete document graph

- **WHEN** aliases shared or split across two tracks, clips, assets, or markers change in one Draft batch
- **THEN** repair planning identifies every participating entity with one document-wide bijection
- **AND** the inverse operation graph restores exact reference identity across entity and collection boundaries

#### Scenario: Identity shortcuts and nested containers do not hide aliases

- **WHEN** compared graphs share one literal object at an early position or contain aliases through cycles, Maps, or Sets
- **THEN** every object pair is registered before identity can terminate comparison
- **AND** an unrelated reversible edit plus undo preserves the exact base topology by direct reference identity

#### Scenario: Undo refuses to overwrite later work

- **WHEN** the project revision advances after Draft application and before its compensating batch is applied
- **THEN** the normal transaction conflict behavior rejects that stale undo batch

#### Scenario: Parent-engine failure evidence is safe and useful

- **WHEN** a parent-engine failure carries known T1 errors or nested Map, Set, Date, RegExp, cyclic, accessor, or executable evidence
- **THEN** the Draft returns a deeply immutable evidence snapshot without invoking evidence-owned accessors or retaining executable/live mutable values
- **AND** known T1 error prototypes and standard built-in snapshot content remain observable

### Requirement: Draft-safe and immediate operations are formally separated

The system SHALL publish an exhaustive type-level and runtime classification of editing operation categories. Reversible track, clip, marker, and project-local asset transaction operations SHALL be Draft-safe; generation, export, source-package removal, external-resource deletion, and other external side effects MUST be immediate and MUST NOT enter a rejectable Draft.

#### Scenario: Closed transaction operations are Draft-safe

- **WHEN** a caller submits a valid track, clip, marker, or project-local asset `TransactionOperation` through the typed Draft interface
- **THEN** the runtime classification register identifies it as Draft-safe and permits savepoint evaluation

#### Scenario: Immediate operation is rejected before Draft mutation

- **WHEN** untrusted input for generation, export, source-package removal, external-resource deletion, or another registered immediate category is forced across the Draft runtime boundary
- **THEN** the Draft returns a structured `immediate-operation-required` rejection
- **AND** its working document, journal, durable revision, and watchers remain unchanged

#### Scenario: External deletion differs from reversible project deletion

- **WHEN** classification compares a reversible delete-track, delete-clip, delete-marker, or delete-asset transaction with source-package or external-resource deletion
- **THEN** the project-content deletion is Draft-safe and invertible
- **AND** the external deletion is immediate and non-rejectable

#### Scenario: No generic command escape hatch exists

- **WHEN** the public Draft and classification interfaces are inspected
- **THEN** they expose closed operation unions and named immediate categories
- **AND** they expose no generic command-name/payload invocation interface

### Requirement: Applied Draft resources survive source-package removal

The system SHALL require a retention preflight before applying a Draft and MUST apply only when every asset referenced by the final candidate clips has structured evidence of project-owned backing data independent of its source package. Source-package removal itself MUST remain an immediate operation outside the Draft.

#### Scenario: Referenced assets pass retention preflight

- **WHEN** every asset referenced by the approved candidate has project-owned retained backing data
- **THEN** the preflight succeeds and approval may call the transaction engine
- **AND** later source-package removal does not invalidate the applied project content

#### Scenario: Missing retained content blocks apply

- **WHEN** any candidate-referenced asset lacks retention evidence or the retention adapter fails
- **THEN** approval returns a structured retention failure before engine apply
- **AND** no durable save, revision increment, or watch notification occurs

#### Scenario: Rejection has no package side effect

- **WHEN** a Draft is rejected or a Draft call rolls back
- **THEN** the Draft performs no source-package removal or external-resource deletion

### Requirement: Reusable Draft conformance proves T2 semantics

The system SHALL provide a Host-neutral Draft conformance runner that tests any conforming manager/engine fixture through the public Draft interface. Assertion and result accounting MUST be local to each run so repeated, concurrent, and nested runs remain independent.

#### Scenario: Conformance covers the Draft lifecycle

- **WHEN** the conformance runner executes against the reference fixture
- **THEN** it proves consistent opening, multi-Draft isolation, per-call rollback, manual and auto transitions, structured reviews, stale rejection, one-batch application, compensating receipts, retention preflight, classification rejection, and terminal-state behavior

#### Scenario: Conformance is repeatable and generic

- **WHEN** the same generic fixture factory is used for repeated or concurrent conformance runs
- **THEN** each report contains only its own assertions and failures
- **AND** custom engine feature-name literal types remain usable without widening to `string`

#### Scenario: Draft contract remains Host-neutral

- **WHEN** the transaction boundary check scans `apps/web/src/editor/contracts/draft/**`
- **THEN** no OpenCut schema, command class, editor core, Zustand store, browser-storage identifier, Rust, WASM, React, or Electron dependency crosses the contract seam

### Requirement: Project metadata updates are typed end-to-end transactions

The transaction contract SHALL add `ProjectPatch = Partial<Pick<Project, "name" | "frameRate" | "canvasWidth" | "canvasHeight">>` and `UpdateProjectOperation = { readonly kind: "update-project"; readonly projectId: ProjectId; readonly patch: ProjectPatch }` as the twelfth member of the closed `TransactionOperation` union. The in-memory reference implementation, durable engine, Draft workflow, concrete UI routing, and Agent evidence MUST process this operation through the existing typed evaluator and commit protocol; they MUST NOT infer Project changes from assets or clips, accept a hidden companion delta or generic/provider-private payload, mutate public Project state inside an adapter, perform a second legacy save, or widen the engine/document-adapter interface or `ProjectStore`.

#### Scenario: The closed operation inventory exposes one Project update

- **WHEN** a caller inspects the public operation types and `supportedOperations()`
- **THEN** `update-project` accepts a `ProjectId` plus a patch limited to `name`, `frameRate`, `canvasWidth`, and `canvasHeight`, with no `id`, donor settings object, or generic payload
- **AND** the complete advertised inventory contains exactly twelve operation kinds including `update-project`

#### Scenario: The operation targets the selected non-null Project

- **WHEN** `update-project` is evaluated against a document with no Project or with a Project whose `id` differs from `projectId`
- **THEN** evaluation rejects with an attributable structured not-found failure at that operation index
- **AND** no Project/entity content, revision, idempotency entry, save, or watcher output changes

#### Scenario: Patch keys and the resulting Project are validated

- **WHEN** an untrusted Project patch contains `id`, a provider-private or otherwise undeclared own key, a symbol key, an empty name, a non-finite or non-positive canvas dimension, or a frame rate whose numerator/denominator are not positive integers or do not produce positive integer ticks per frame at 120,000 ticks/sec
- **THEN** the same evaluator used by apply, validation, dry-run, and Draft savepoints rejects the operation with an attributable validation issue
- **AND** the selected Project ID and every unpatched field remain unchanged

#### Scenario: Empty and same-value Project patches have distinct semantics

- **WHEN** a caller submits `update-project` with an empty patch
- **THEN** the operation is rejected without `changedIds`, revision, save, idempotency reservation, or watcher output
- **AND WHEN** a caller submits a non-empty patch whose declared values already equal the selected Project
- **THEN** the operation succeeds like the existing typed update operations, includes `projectId` in `changedIds`, adds nothing to `createdIds`, and produces one normal revision/save/watch transition

#### Scenario: A changed Project patch commits once and survives reopen

- **WHEN** a valid `update-project` changes one or more public fields and the durable save succeeds
- **THEN** the result includes `projectId` in `changedIds`, the persisted revision increments exactly once, `ProjectStore.save` runs exactly once, and transaction watchers fire exactly once after durability
- **AND** open-engine reads, the encoded record and summary, unrelated opaque data, and a reopened engine all expose the same updated Project

#### Scenario: Project patches participate completely in idempotency

- **WHEN** a keyed Project update is replayed with the same operation and patch but different object-property insertion order
- **THEN** the canonical fingerprint recognizes it as the same request and returns the original result without another save, revision, or watcher notification
- **AND WHEN** the same key is reused with any different Project patch
- **THEN** it is rejected as `TransactionError { code: "duplicate" }` without changing the committed Project

#### Scenario: Validation and dry-run are pure Project projections

- **WHEN** a valid or invalid Project update is passed to `validate` or `dryRun`
- **THEN** both methods use the same final-document evaluator and report the same Project result or structured rejection that apply would produce on that base revision
- **AND** neither method saves, reserves an idempotency key, increments revision, changes subsequent reads, or notifies watchers

#### Scenario: Frame-rate changes validate the complete final placement

- **WHEN** a Project frame-rate patch would leave any final clip time field or marker time misaligned to the new integer ticks-per-frame grid
- **THEN** validation, dry-run, Draft evaluation, and apply reject the batch atomically without implicitly retiming content
- **AND WHEN** typed clip or marker operations in the same ordered batch leave the complete final document valid on the new grid
- **THEN** the Project and placement repairs may commit together as one revision and one save

#### Scenario: Drafts classify, review, and roll back Project patches

- **WHEN** a Draft stages a valid `update-project`, alone or in the same tool call as other typed project-content operations
- **THEN** the exhaustive runtime register classifies it as Draft-safe, the private savepoint and review journal include `projectId` and the twelfth per-kind count, and a rejected call restores the exact prior working Project and journal
- **AND** non-stale approval flattens the Project operation with the journal into one parent-engine apply while stale approval remains a no-rebase conflict

#### Scenario: Project compensation is minimal and policy-closed

- **WHEN** an approved Draft changes any subset of the four patchable Project fields
- **THEN** its compensating batch contains one `update-project` inverse with only the changed fields' base pre-images, regardless of document collection size
- **AND** that inverse composes with other minimal repairs, is evaluated through the same final-document/provider-policy compensation preflight, and one non-stale undo restores the exact base Project

#### Scenario: UI settings routing preserves the public-private honesty boundary

- **WHEN** a routed settings command changes public Project fields only or changes them together with donor-private settings
- **THEN** projection emits exactly one typed `update-project` sibling for the public delta, retains owned private data only in the explicit staged donor candidate, and proves exact donor/engine public equality before the single save
- **AND WHEN** the command changes donor-private settings only
- **THEN** it remains an explicit provider-private gap and does not submit a no-op transaction, hidden delta, generic payload, or second save

#### Scenario: First-image canvas behavior is one durable root with baseline undo ownership

- **WHEN** established first-image insertion changes a new Project from 1920x1080 to the fixture's 320x180 canvas
- **THEN** the canvas patch and public asset/clip work commit through one root apply/save/revision/watch/history publication, and engine reads, live donor state, persisted record, persistence cache, and reopen all report 320x180
- **AND** a failed save leaves every surface at 1920x1080, while successful command undo preserves the baseline history policy that the nested `pushHistory: false` canvas change is not reversed

#### Scenario: Corrected UI routing retains audited parity safeguards

- **WHEN** T3 resumes after consuming the reviewed Project-operation correction
- **THEN** public fps/canvas mutations are no longer discarded, explicit routing identities remain stable under production minification, audio track projection still normalizes missing `hidden` to `false`, exact donor/engine equality remains mandatory, and transaction publication still causes no duplicate legacy save
- **AND** normalized before-routing versus after-routing behavior is compared on each Host separately from Vite-versus-Next equality, so a shared regression cannot pass as parity

#### Scenario: Agent evidence exercises the twelfth operation without inference

- **WHEN** T4 publishes transaction vectors and runs its third-party Agent scenario
- **THEN** the vectors advertise all twelve kinds and the Agent performs at least one typed Project patch, observes one revision/save/watch result, and verifies save/reopen Project equality
- **AND** same-key replay is mutation-free, same-key/different-patch reuse is rejected, and no donor inference or provider-private command is required

