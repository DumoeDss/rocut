## MODIFIED Requirements

### Requirement: React and Host consumers resolve the explicit session

The editor React surface SHALL be rooted in an `EditorSessionProvider`. Reactive consumers SHALL
resolve the provider's explicit session core through `useEditor(selector)`; intentionally imperative
consumers SHALL use `useEditorInstance()`. Both Host roots, the Vite project-picker flow and sounds
flow SHALL use this route or receive the editor/session explicitly. The production Host graph SHALL
supply C0b's live runtime graphics and GPU providers rather than C1's unimplemented fixtures.

#### Scenario: A provider selects and subscribes to the correct editor

- **WHEN** two React trees are rendered with different session providers and selected state changes
  in one session
- **THEN** each hook resolves the editor owned by its tree's session
- **AND** only the consumer whose selected session state changed re-renders

#### Scenario: Missing provider fails loudly

- **WHEN** either editor hook is called outside an `EditorSessionProvider`
- **THEN** it throws an actionable missing-session error rather than returning a default core

#### Scenario: Hosts use live C0b providers after C3

- **WHEN** either Host creates a C3 session after runtime initialization
- **THEN** it supplies live `WasmRuntimeGraphicsQuery` and `WasmRuntimeGpuResourceQuery` adapters
- **AND** its production dependency graph does not supply either C1 unimplemented provider

#### Scenario: Ports are not exposed through a replacement hook

- **WHEN** the production graph and Host context are inspected
- **THEN** `EditorHostContext` still exposes only `EditorHostBase`
- **AND** no `useEditorPorts` or equivalent private port-resolving hook exists

### Requirement: C2 preserves behavior while C3 closes its deferred state and renderer boundaries

C3 SHALL preserve the editing-parity fixture and pinned type-baseline ceiling while adding
per-session ownership for the nine editor stores, interaction cancellation and compositor state. It
SHALL consume C0b's exact generated surface without editing Rust/generated WASM, C1 public session
types or the type-baseline fixture.

#### Scenario: Existing editing behavior remains green

- **WHEN** focused session/command/state/renderer tests, the full classified suite and the parity
  fixture run
- **THEN** editing behavior matches the exact C0b+C2 joint baseline except for specified C3
  session-isolation and runtime-provider observations

#### Scenario: Deferred boundaries are closed without widening contracts

- **WHEN** the C3 product-source diff is reviewed
- **THEN** all nine stores and the compositor are session-owned and the C0b adapters are present
- **AND** no Rust/generated-WASM edit or C1 public type widening is present

#### Scenario: The pinned type and parity oracles are not re-baselined

- **WHEN** C3 validation completes
- **THEN** `script/fixtures/type-baseline.json` and the parity oracle are byte-identical to the joint
  baseline
