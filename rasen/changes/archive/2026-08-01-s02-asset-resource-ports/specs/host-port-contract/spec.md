## MODIFIED Requirements

### Requirement: The Host contract is one coherent surface

The editor SHALL obtain everything it needs from its Host through a single composed contract rather
than through independently evolving parameters. Every port role SHALL be reachable from that one
surface, and adding or implementing a role SHALL widen or supply it rather than introduce a
parallel object. Both production Hosts MUST supply production implementations for the frozen asset
resolver, asset loader, and runtime-resource roles; they MUST NOT silently fall back to their
in-memory reference counterparts for those roles.

#### Scenario: All port roles are reachable from one contract

- **WHEN** a Host author reads the contract's entry point
- **THEN** the storage, asset-resolution, runtime-resource, navigation, export, diagnostics,
  id-generation and environment-capability roles are all reachable from it

#### Scenario: The existing host seam is preserved, not replaced

- **WHEN** production asset/resource roles are supplied
- **THEN** the previously supplied project identity, navigation callbacks, server endpoints,
  branding and links keep their existing shape and meaning
- **AND** both Hosts build without a parallel port context or a widened public session/factory shape

#### Scenario: Production Hosts cannot inherit reference asset or Worker behavior

- **WHEN** the Next and Vite composition roots create sessions
- **THEN** their final `assets`, `assetLoader`, and `runtimeResources` properties are immutable
  browser implementations configured with that Host's base
- **AND** a composition/production-graph gate exits non-zero if an in-memory asset loader, default
  `assets/` resolver, or echo Worker satisfies any of those final roles

### Requirement: A worker is expressed so that a same-origin Host can implement it

Worker creation SHALL be expressed through the runtime-resource port in a form a Host can satisfy
under the browser's same-origin rule. The editor SHALL NOT construct a Worker itself, including in
the transcription service, and the location it supplies SHALL be a request the Host may rewrite
rather than a location the Host must use. The returned handle SHALL enter the requesting session's
resource registry.

#### Scenario: The Host constructs the worker

- **WHEN** transcription or a Worker fixture needs a Worker
- **THEN** it asks the owning session's runtime-resource registry with a logical identity, resolved
  URL, type, and optional name and receives a Worker handle
- **AND** only the production Host adapter constructs the platform Worker; no editor production
  module does so directly

#### Scenario: A Host serving from a different origin can conform

- **WHEN** a Host cannot execute a Worker from the editor-supplied location because that location
  is not same-origin for it
- **THEN** it may rewrite or obtain the script and construct the Worker from a same-origin location
- **AND** a functional fixture proves the rewritten Worker exchanges a message rather than merely
  accepting a URL

#### Scenario: Worker handles are disposable

- **WHEN** a Worker handle is returned, explicitly terminated, or its session is disposed
- **THEN** it exposes termination through the frozen handle and leaves the owning session registry
  exactly once
- **AND** two sessions cannot share the transcription service's mutable Worker/model state

### Requirement: Graphics capability is negotiated, and the report is produced by the runtime

The Host SHALL declare its graphics environment—either that it should be detected, or that it is to
be treated as having no rasterizer—and the session SHALL adapt the live C0b runtime query into the
capability report when detection is requested. A Host SHALL NOT assert the report's backend,
capacity, or runtime unavailability reason. A forced-none declaration SHALL use the existing
renderer degraded state and visible banner without consulting the live query or allocating a
session compositor.

#### Scenario: A Host with no rasterizer remains a C4 boundary

- **WHEN** a Host declares forced-none and the live runtime query methods would throw if consulted
- **THEN** the report has source `host-forced`, backend `null`, capacity `0`, and no fabricated live
  reason
- **AND** the existing `RendererManager.setDegraded`/editor-root banner path is visible, the session
  remains live without asynchronous error, and no compositor handle is created

#### Scenario: The report names the runtime-selected backend

- **WHEN** detection is requested, a rasterizer is available, and either Host asks its session for
  graphics capability
- **THEN** the report names the backend selected by the live C0b runtime
- **AND** a Host constant, launch expectation, or result that omits the observed backend is not
  accepted as backend evidence

#### Scenario: Both production Hosts supply the same live provider shape

- **WHEN** the Next and Vite Host composition roots create detecting sessions
- **THEN** both supply adapters implementing the frozen C1 query interfaces from C0b runtime answers
- **AND** neither composition root imports an unimplemented graphics/GPU fixture or stamps live
  backend/capacity values

#### Scenario: Forced-none does not replace E1 renderer measurements

- **WHEN** the forced-none Host gate passes
- **THEN** it proves only that the Host/session/UI contract is constructible without raster work
- **AND** software-raster timing and an actual no-rasterizer-machine observation remain unclaimed
