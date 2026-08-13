## ADDED Requirements

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
