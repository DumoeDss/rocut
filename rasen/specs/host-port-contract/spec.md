# host-port-contract Specification

## Purpose
TBD - created by archiving change s02-port-contract-freeze. Update Purpose after archive.

## Requirements

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

The Host SHALL declare its graphics environment—either that it should be detected, or that it is to
be treated as having no rasterizer—and C3 SHALL adapt the live C0b runtime query into the capability
report. A Host SHALL NOT assert the report's backend, capacity or unavailability reason.

#### Scenario: A Host with no rasterizer remains a C4 boundary

- **WHEN** C3 encounters a runtime reporting no selected backend and capacity 0
- **THEN** it preserves the typed unavailable reason and does not fabricate a rasterizer
- **AND** C3 does not claim C4's visible degraded-renderer delivery as completed

#### Scenario: The report names the runtime-selected backend

- **WHEN** a rasterizer is available and either Host asks its session for graphics capability
- **THEN** the report names the backend selected by the live C0b runtime
- **AND** a Host constant, launch expectation or result that omits the observed backend is not
  accepted as backend evidence

#### Scenario: Both production Hosts supply the same live provider shape

- **WHEN** the Next and Vite Host composition roots create sessions
- **THEN** both supply adapters implementing the frozen C1 query interfaces from C0b runtime answers
- **AND** neither composition root imports an unimplemented graphics/GPU fixture

### Requirement: Preview concurrency is a reported capability, expressed as a count

The capability report SHALL state how many live previews the runtime can drive. It SHALL be a count
rather than a flag, SHALL be derived from the live C0b runtime rather than asserted by the Host, and
SHALL be askable before the Host commits to a multi-preview layout. Over-capacity requests SHALL be
explicitly refused rather than silently degraded or used to replace an existing preview.

#### Scenario: A Host asks before laying out previews

- **WHEN** a Host considers creating a second live preview
- **THEN** it queries the live capability report before committing that layout

#### Scenario: WebGPU reports and demonstrates capacity two

- **WHEN** the asserted installed-Chrome run selects WebGPU
- **THEN** the report says 2 and the runtime simultaneously retains two distinct live compositor
  handles and visible previews

#### Scenario: WebGL reports and enforces capacity one

- **WHEN** the asserted bundled-Chromium run selects WebGL
- **THEN** the report says 1, the first preview remains live and a second request is explicitly
  rejected without creating another handle

#### Scenario: Silent degradation does not satisfy the contract

- **WHEN** reported capacity, live-handle count, visible-preview behavior or observed backend differ
- **THEN** the evidence fails instead of accepting a Host assertion, fallback, replacement or hidden
  second preview

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
