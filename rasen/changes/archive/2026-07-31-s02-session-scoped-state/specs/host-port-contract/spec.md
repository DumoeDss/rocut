## MODIFIED Requirements

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
