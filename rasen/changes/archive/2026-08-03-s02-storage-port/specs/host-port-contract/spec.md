## ADDED Requirements

### Requirement: Storage operations have explicit failure and cancellation semantics

The store contract SHALL distinguish absence from failure, SHALL expose mechanism-neutral error
codes, and SHALL define a commit point for durable mutations. A caller-provided cancellation signal
MUST NOT produce a partially visible replacement or report cancellation after a destructive mutation
has committed.

#### Scenario: Missing data is not an infrastructure failure

- **WHEN** a caller loads an unknown project, attachment, or library-record key
- **THEN** the store returns `null` and does not report a storage error

#### Scenario: Platform failures do not cross the port by name

- **WHEN** browser storage reports quota exhaustion, unavailability, corruption, or a transaction
  conflict
- **THEN** the adapter maps it to the corresponding contract error code with operation and scope
  context
- **AND** no IndexedDB or OPFS error type appears in the public signature
- **AND** a topology or Host-configuration refusal crosses the port only as a stable
  mechanism-neutral code with logical operation/scope; neither the public error nor session
  diagnostics expose a physical database/store/directory identity, internal topology reason,
  payload, provider-private value, or raw cause
- **AND** the topology policy and its permits remain private browser-implementation details and do
  not appear in the public `ProjectStore` type

#### Scenario: A pre-aborted operation cannot mutate storage

- **WHEN** a replaceable write receives an already-aborted signal
- **THEN** it rejects as aborted and the previous project, attachment, or library record remains
  unchanged

#### Scenario: Attachment replacement is all-or-previous

- **WHEN** attachment persistence fails or is cancelled before its commit point
- **THEN** readers observe the complete previous attachment or absence, never mixed metadata and
  bytes
- **AND** a staging artifact is not exposed as a committed attachment

#### Scenario: Durable command ordering is preserved

- **WHEN** project, media, sound, or preset mutations target the same durable key
- **THEN** they commit in invocation order unless one fails before its commit point
- **AND** a UI latest-wins cancellation policy does not reorder or silently discard them

### Requirement: Durable storage scopes are isolated while intentional sharing remains visible

The store SHALL isolate records by project, attachment key, library namespace, and configured durable
store identity. Sessions sharing one store MAY observe committed durable updates, but SHALL NOT share
editor caches, retained opaque snapshots, listeners, pending commands, or transient resource handles.

#### Scenario: Equal attachment keys in different projects do not collide

- **WHEN** two projects save different attachments under the same attachment key
- **THEN** each project loads its own metadata and bytes
- **AND** deleting either project leaves the other's attachment intact

#### Scenario: Equal keys in different library namespaces do not collide

- **WHEN** saved sounds and graph presets use the same record key in different namespaces
- **THEN** reads, writes, and removals in one namespace do not affect the other

#### Scenario: Two sessions share only committed durable state

- **WHEN** two sessions use one store and one session commits a project update
- **THEN** the other session can observe that update on a fresh load
- **AND** the sessions retain independent decoded snapshots, caches, listeners, and command queues

#### Scenario: Disposable stores cannot affect a production identity

- **WHEN** browser conformance runs against a randomized, prefix-validated disposable identity
- **THEN** its records and teardown do not read, mutate, or delete any other configured identity

## MODIFIED Requirements

### Requirement: The Host contract is one coherent surface

The editor SHALL obtain everything it needs from its Host through one required composed contract.
Every port role SHALL be present on that surface; adding or implementing a role SHALL widen or supply
it rather than introduce a parallel object, context, or factory parameter. Both production Hosts
MUST explicitly supply production implementations for storage, asset resolution/loading, and
runtime resources and MUST NOT inherit their in-memory reference counterparts.

#### Scenario: All port roles are reachable from one contract

- **WHEN** a Host author reads the contract's entry point
- **THEN** the storage, asset-resolution, runtime-resource, navigation, export, diagnostics,
  id-generation and environment-capability roles are all required and reachable from it
- **AND** no optional resolution path casts a partial Host into the complete contract

#### Scenario: The existing host seam is preserved, not replaced

- **WHEN** the complete production role set is supplied
- **THEN** the previously supplied project identity, navigation callbacks, server endpoints,
  branding and links keep their existing shape and meaning
- **AND** both Hosts build without a parallel port context or a widened public session/factory shape

#### Scenario: Production Hosts cannot inherit reference asset or Worker behavior

- **WHEN** the Next and Vite composition roots create sessions
- **THEN** their final `store`, `assets`, `assetLoader`, and `runtimeResources` properties are explicit
  immutable browser implementations configured by that Host
- **AND** a composition/production-graph gate exits non-zero if an in-memory store or asset loader,
  default `assets/` resolver, echo Worker, or fallback expression satisfies a final role

#### Scenario: A private storage channel is rejected

- **WHEN** source adds a second storage/media port, storage React context, hidden Host property, or
  direct singleton path alongside `EditorHost.store`
- **THEN** the boundary gate exits non-zero and identifies the parallel dependency path

### Requirement: No port signature exposes an editor-internal or storage-mechanism type

A port signature SHALL NOT reference an OpenCut schema type, a command class, an editor state store,
an IndexedDB database name or an OPFS path. Project records, project-scoped attachments, durable
library records, and capacity status SHALL use opaque or mechanism-neutral contract values. The
mechanism a Host chooses to persist or fetch with SHALL NOT be observable in the contract.

#### Scenario: The boundary is enforced by a check, not by review

- **WHEN** the port-boundary check runs over the contract module's public surface and its import
  graph
- **THEN** it reports no reference to an editor schema type, command class or state store, and no
  storage-mechanism name or path literal
- **AND** it exits non-zero if any is found

#### Scenario: The check is proven able to fail

- **WHEN** the port-boundary check runs against a fixture that deliberately violates each rule
- **THEN** it reports a failure for each violation
- **AND** this negative control is recorded, so a passing result is known not to be vacuous

#### Scenario: Persisted project content crosses the boundary opaquely

- **WHEN** the store carries a project between the editor and a Host implementation
- **THEN** project content is carried as an opaque payload plus a small typed summary
- **AND** fields the Host does not understand survive a known edit, save, complete session restart,
  and reopen unchanged

#### Scenario: Attachments and libraries remain mechanism-neutral

- **WHEN** the store carries a project attachment or durable library record
- **THEN** it uses logical scope/key identifiers, opaque metadata/data, and portable binary bytes
- **AND** no public type reveals a database, object-store, OPFS path, or editor media/sound/preset
  schema

### Requirement: Every port has an in-memory reference implementation and a conformance suite

The contract SHALL ship a working in-memory implementation of every port and one reusable
conformance case matrix an adapter author can run against any implementation. The in-memory store and
the real browser store SHALL run that same unmodified storage matrix, including opaque records,
attachments, library records, capacity/errors, isolation, cancellation, removal, and opt-in
migration behavior. A port that cannot be implemented twice is not a port.

#### Scenario: The reference implementation passes conformance

- **WHEN** the conformance suite is run against the in-memory implementation
- **THEN** every port case passes, including all storage cases

#### Scenario: The browser implementation passes the same storage cases

- **WHEN** the exported storage case matrix is run in a browser against a prefix-validated disposable
  browser store
- **THEN** the same cases pass without being copied, weakened, skipped, or rewritten for that adapter

#### Scenario: The reference implementation is working, not stubbed

- **WHEN** the in-memory store is exercised through conformance
- **THEN** it defensively round-trips project content, attachment bytes and metadata, and library
  content, including fields it does not interpret, rather than returning fixed values

#### Scenario: Migration cases are opt-in

- **WHEN** an adapter author runs conformance without a disposable fixture and explicit migration
  opt-in
- **THEN** non-destructive storage cases still run and destructive migration/cleanup cases do not

#### Scenario: The suite is runnable by an adapter author outside this change

- **WHEN** an adapter author points the conformance suite at their own implementation
- **THEN** it runs without modification and reports pass or fail per port and per case

### Requirement: The port-shape decisions are recorded with their forcing evidence

A committed decision record SHALL state how a worker is constructed, how graphics capability is
negotiated, who owns disposal, who runs schema migrations, and why the existing store role was
deepened for attachments/libraries/capacity rather than supplemented by a private port—each with the
measurement or constraint that forced the choice and the alternative that evidence rules out.

#### Scenario: Each decision names what forced it

- **WHEN** a reviewer reads the decision record
- **THEN** each of the five decisions states the evidence behind it and the alternative shape it
  rejects, rather than stating a preference

#### Scenario: The C1 storage risk is resolved explicitly

- **WHEN** the storage decision is reviewed
- **THEN** it inventories the calls that the original project-only contract could not express
- **AND** it records the review gate accepting an in-place public amendment without a new port or
  private dependency path
