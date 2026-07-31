## ADDED Requirements

### Requirement: The Host contract is one coherent surface

The editor SHALL obtain everything it needs from its host through a single composed contract rather
than through independently evolving parameters. Every port role SHALL be reachable from that one
surface, and adding a role SHALL widen it rather than introduce a parallel object.

#### Scenario: All port roles are reachable from one contract

- **WHEN** a Host author reads the contract's entry point
- **THEN** the storage, asset-resolution, runtime-resource, navigation, export, diagnostics,
  id-generation and environment-capability roles are all reachable from it

#### Scenario: The existing host seam is preserved, not replaced

- **WHEN** the contract is widened
- **THEN** the previously supplied project identity, navigation callbacks, server endpoints,
  branding and links keep their existing shape and meaning
- **AND** both Hosts build without changing how they supply them

### Requirement: No port signature exposes an editor-internal or storage-mechanism type

A port signature SHALL NOT reference an OpenCut schema type, a command class, an editor state store,
an IndexedDB database name or an OPFS path. The mechanism a Host chooses to persist or fetch with
SHALL NOT be observable in the contract.

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

- **WHEN** the store port carries a project between the editor and a Host implementation
- **THEN** the project's content is carried as an opaque payload plus a small typed summary, so that
  fields the Host does not understand survive a save and reopen unchanged

### Requirement: A worker is expressed so that a same-origin Host can implement it

Worker creation SHALL be expressed through the runtime-resource port in a form a Host can satisfy
under the browser's same-origin rule. The editor SHALL NOT construct a worker itself, and the
location it supplies SHALL be a request the Host may rewrite rather than a location the Host must
use.

#### Scenario: The Host constructs the worker

- **WHEN** the editor needs a worker
- **THEN** it asks the runtime-resource port, supplying a logical worker identity and a resolved
  location, and receives a worker handle
- **AND** no module in the editor graph constructs a worker directly

#### Scenario: A Host serving from a different origin can conform

- **WHEN** a Host cannot execute a worker from the location the editor supplied, because that
  location is not same-origin for it
- **THEN** it may obtain the script and construct the worker from a location that is same-origin,
  and the contract treats that as conforming rather than as a workaround

#### Scenario: Worker handles are disposable

- **WHEN** a worker handle is returned
- **THEN** it exposes termination and is owned by the session that requested it

### Requirement: Graphics capability is negotiated, and the report is produced by the runtime

The Host SHALL declare its graphics environment — either that it should be detected, or that it is
to be treated as having no rasterizer — and the runtime SHALL produce the capability report. A Host
SHALL NOT assert the report's contents.

#### Scenario: A Host with no rasterizer is constructible

- **WHEN** a Host declares that it has no rasterizer
- **THEN** the session can still be created, the report states that there is no rasterizer with a
  stated reason, and the editor enters its visible degraded rendering state rather than failing to
  start

#### Scenario: The report names the selected backend

- **WHEN** a rasterizer is available
- **THEN** the report names which graphics backend was selected, so a test can record which one it
  observed
- **AND** a result that does not record the backend is not accepted as evidence about that backend

### Requirement: Preview concurrency is a reported capability, expressed as a count

The capability report SHALL state **how many** live previews the runtime can drive. It SHALL be a
count rather than a flag, because the Host's question is how many preview surfaces it may lay out.
The count SHALL be derived from the runtime, never asserted by the Host, and a Host SHALL be able to
ask before it commits to a layout.

#### Scenario: A Host asks before laying out previews

- **WHEN** a Host queries the capability report
- **THEN** it receives a live-preview count for the environment it is running in

#### Scenario: Silent degradation does not satisfy the contract

- **WHEN** the runtime can drive only one live preview
- **THEN** the report says so explicitly
- **AND** a build that merely happens to drive one preview, with no answer a Host can ask for, does
  not satisfy this requirement

#### Scenario: The runtime-side query the count derives from is declared before it is supplied

- **WHEN** the contract is frozen
- **THEN** it declares the runtime query it expects — the selected backend as an enumeration, and the
  number of concurrently drivable compositor instances — so that a later implementation satisfying an
  incompatible shape fails to compile rather than at runtime

### Requirement: Every port has an in-memory reference implementation and a conformance suite

The contract SHALL ship a working in-memory implementation of every port, and a conformance suite an
adapter author can run against any implementation. A port that cannot be implemented twice is not a
port.

#### Scenario: The reference implementation passes conformance

- **WHEN** the conformance suite is run against the in-memory implementation
- **THEN** every port's cases pass

#### Scenario: The reference implementation is working, not stubbed

- **WHEN** the in-memory store is exercised through the conformance suite
- **THEN** it round-trips project content, including fields it does not interpret, rather than
  returning fixed values

#### Scenario: The suite is runnable by an adapter author outside this change

- **WHEN** an adapter author points the conformance suite at their own implementation
- **THEN** it runs without modification and reports pass or fail per port and per case

### Requirement: The port-shape decisions are recorded with their forcing evidence

A committed decision record SHALL state how a worker is constructed, how graphics capability is
negotiated, who owns disposal, and who runs schema migrations — each with the measurement or
constraint that forced the choice and the alternative that measurement rules out.

#### Scenario: Each decision names what forced it

- **WHEN** a reviewer reads the decision record
- **THEN** each of the four decisions states the evidence behind it and the alternative shape it
  rejects, rather than stating a preference
