## MODIFIED Requirements

### Requirement: Host-neutral domain types are frozen

The transaction contract SHALL define standalone TypeScript types for `Project`, `Track`, `Clip`, `Asset`, and `Marker` that contain no import of any OpenCut schema module, command class, editor store, Zustand store, or storage-service implementation. Every public time value — placement, duration, source trim, marker time — SHALL be a `MediaTime`: a non-negative branded integer at a fixed 120,000 ticks per second. The contract SHALL define `FrameRate` as `{ numerator: number; denominator: number }` and SHALL reject at construction time any rate that cannot produce an integer ticks-per-frame at the fixed tick rate.

#### Scenario: Domain types compile without editor-internal imports

- **WHEN** the contract module graph is inspected
- **THEN** no module under `packages/editor-contracts/src/` imports from `@/project`, `@/timeline`, `@/commands`, `@/core`, `@/stores`, `@/scenes`, `@/effects`, `@/masks`, `@/media`, `@/wasm`, `@/services/storage`, or `zustand`

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

### Requirement: The contract contains no editor-internal types

A committed boundary check script (`script/check-transaction-boundary.mjs`) SHALL scan every module under `packages/editor-contracts/src/` and reject imports of OpenCut schema types, command classes, editor state stores, Zustand, IndexedDB types, OPFS handle types, and physical storage fields. The check SHALL include a negative control that materialises a fixture violating each rule and asserts each is caught.

#### Scenario: The boundary check passes on the contract modules

- **WHEN** the boundary check runs over the contract graph
- **THEN** it reports zero violations and scans at least one module
- **AND** an empty scan is a failure, not a pass

#### Scenario: The negative control proves every rule can fail

- **WHEN** the boundary check runs with `--negative-control`
- **THEN** each deliberate violation fixture is caught by its corresponding rule
- **AND** each rule is proven not to fire indiscriminately by converse fixtures

### Requirement: A durable transaction engine consumes the frozen Host port

The system SHALL provide a transaction engine under `packages/editor-contracts/src/engine/**` that implements T0's `TransactionRead`, `TransactionApply`, `TransactionGetContext`, and `TransactionWatch` interfaces by consuming S02's existing `ProjectStore`. The engine MUST NOT redefine or widen `ProjectStore`, interpret the minimal transaction-domain types as the provider's persistence schema, or import an OpenCut schema, command, editor store, Zustand store, wasm module, or storage mechanism. An injected document adapter SHALL translate only through `ProjectRecord.data: unknown`, SHALL encode revision and idempotency metadata in the same replacement record as project content, and SHALL preserve provider-private fields it does not interpret.

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

- **WHEN** the transaction boundary check scans `packages/editor-contracts/src/draft/**`
- **THEN** no OpenCut schema, command class, editor core, Zustand store, browser-storage identifier, Rust, WASM, React, or Electron dependency crosses the contract seam

### Requirement: Donor candidates are explicit, projection-checked, and opaque-preserving

The concrete OpenCut transaction adapter SHALL live outside `packages/editor-contracts/src/**` and SHALL overlay the prior `ProjectRecord.data` rather than rebuild it. A staged UI donor candidate SHALL be bound to an explicit unique commit token, base revision, and previous-record identity. Before saving, the adapter MUST prove that projecting the donor candidate yields exactly the engine candidate for every frozen public field. A token, base, or projection mismatch SHALL reject before save. Provider-private fields owned by the edit MAY change in the same record; unrelated provider-private and opaque fields SHALL round-trip unchanged with revision and idempotency metadata.

#### Scenario: Public and provider-private state commit in one record

- **WHEN** a routed UI command changes a frozen clip field and related provider-private clip data
- **THEN** the adapter verifies the candidate's public clip projection against the typed engine document
- **AND** both changes plus transaction metadata are written by the engine's one replacement-record save

#### Scenario: A mismatched donor candidate is rejected

- **WHEN** a staged donor candidate's token, base record, or projected public entities do not match the engine candidate
- **THEN** the adapter rejects before `ProjectStore.save`
- **AND** no live state, revision, idempotency entry, history entry, selection change, or watcher notification is published

#### Scenario: Unowned opaque fields survive UI and automation commits

- **WHEN** the prior donor record contains unknown nested sentinels and UI and automation commits are applied in sequence
- **THEN** every sentinel outside the owned projection remains structurally unchanged after save and reopen

### Requirement: A versioned wire-safe transaction vector corpus is published

The system SHALL publish a conformance-vector corpus as committed data under
`packages/editor-contracts/src/vectors/corpus/`, carrying an explicit schema identifier and
version in every file. Every published value MUST be wire-safe: `MediaTime` as a non-negative
integer tick count, identities as strings, operation kinds and error codes as members of the
contract's closed unions, and no branded type, TypeScript-only construct, function, or module
reference at rest. The corpus SHALL declare exactly two families — document vectors carrying an
explicit initial document with one batch and its expected result or structured rejection, and
scenario vectors carrying an ordered step plan whose expectations are relative to the target's
own starting document. A manifest SHALL record every corpus file, its SHA-256, the declared
vector count, and a corpus digest; a corpus file whose bytes do not match the manifest MUST fail
to load.

The corpus SHALL be consumable from an installed package as well as from a checkout: a declared
export entry SHALL expose the manifest text and corpus file texts as exact file bytes, so a
consumer outside this repository can load and run the corpus without filesystem access to it.

#### Scenario: The corpus is self-describing and versioned

- **WHEN** a consumer parses any published corpus file with a plain JSON parser
- **THEN** it reads the schema identifier, the corpus version, the family of every vector, and a
  stable vector id for every vector
- **AND** no value requires a contract constructor, branded type, or module import to interpret

#### Scenario: Manifest drift fails to load

- **WHEN** a corpus file is edited without regenerating the manifest, or the manifest declares a
  vector count different from the files present
- **THEN** loading rejects with a structured drift failure naming the offending file
- **AND** no vector from that corpus is reported as passing

#### Scenario: A vector with no expectation is a load error

- **WHEN** a corpus contains a vector whose expectation set is empty or whose step plan asserts
  nothing
- **THEN** loading rejects that corpus
- **AND** the vector is not admitted as a skipped or passing case

#### Scenario: Non-wire-safe values are rejected

- **WHEN** a corpus contains a non-integer tick value, a non-finite number, an unknown operation
  kind, or an unknown error code
- **THEN** loading rejects with a structured validation failure identifying the vector id and the
  offending field

#### Scenario: The corpus loads from an installed package

- **WHEN** a consumer outside this repository imports the corpus entry from an installed package
  tarball and passes the returned texts to the published loader
- **THEN** the corpus loads and its recomputed digest matches the manifest's declared digest
- **AND** the bytes the entry returns are the exact committed file bytes rather than a
  re-serialization
