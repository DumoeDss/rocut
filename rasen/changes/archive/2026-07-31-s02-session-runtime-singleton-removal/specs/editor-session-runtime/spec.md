## ADDED Requirements

### Requirement: A runtime session owns one explicit editor core

`createEditorSession` SHALL create and own exactly one `EditorCore` without changing the frozen C1
factory arguments or public `EditorSession` shape. A core SHALL be retrievable only by supplying its
own live session. Two sessions SHALL own distinct cores, managers and command histories.

#### Scenario: Two sessions receive distinct runtime ownership

- **WHEN** two sessions are created from explicit Hosts
- **THEN** their cores and each of their twelve manager objects are reference-distinct
- **AND** executing or undoing a command in one does not change the other's command history

#### Scenario: A disposed session cannot reveal a core

- **WHEN** a session has completed disposal
- **THEN** an internal lookup using that session fails with an actionable disposed/unknown-session
  error
- **AND** no lookup without a session key exists

#### Scenario: The C1 contract is unchanged

- **WHEN** the C1 session conformance and compile guards run
- **THEN** the factory arguments, public session shape, lifecycle and port roles are unchanged

### Requirement: Command execution uses explicit session context

Every command `execute`, `undo` and `redo` operation SHALL receive an explicit
`EditorCommandContext` from its owning `CommandManager`. Batch commands SHALL forward the same
context to each child. A command module SHALL not resolve an editor core from static or module-global
state.

#### Scenario: Execute targets the owning session

- **WHEN** a command manager executes a command for session A while session B is live
- **THEN** the command receives session A's context and mutates only session A's core-owned state

#### Scenario: Undo and redo preserve context

- **WHEN** a command is undone and redone
- **THEN** both operations receive the same owning-session context used for execution

#### Scenario: A batch forwards context

- **WHEN** a batch command executes, undoes or redoes its children
- **THEN** each child receives the batch manager's explicit context in the defined ordering

### Requirement: React and Host consumers resolve the explicit session

The editor React surface SHALL be rooted in an `EditorSessionProvider`. `useEditor()` SHALL resolve
the provider's explicit session and that session's core. Both Host roots, the Vite project-picker
flow and sounds flow SHALL use this route or receive the editor/session explicitly.

#### Scenario: A provider selects the correct editor

- **WHEN** two React trees are rendered with different session providers
- **THEN** `useEditor()` in each tree returns the editor owned by that tree's session

#### Scenario: Missing provider fails loudly

- **WHEN** `useEditor()` is called outside an `EditorSessionProvider`
- **THEN** it throws an actionable missing-session error rather than returning a default core

#### Scenario: Hosts use frozen placeholders before C3

- **WHEN** either Host creates a C2 session
- **THEN** it supplies C1's existing port implementations and unimplemented graphics/GPU providers
- **AND** it does not import, adapt or invoke a C0b export

#### Scenario: Ports are not exposed through a replacement hook

- **WHEN** the production graph and Host context are inspected
- **THEN** `EditorHostContext` still exposes only `EditorHostBase`
- **AND** no `useEditorPorts` or equivalent private port-resolving hook exists

### Requirement: Process definitions register once while session wiring remains per-session

Default effect, mask, graphics, parameter and sticker definitions SHALL be registered by an
idempotent process bootstrap rather than by the `EditorCore` constructor. Per-session diagnostics
and manager wiring SHALL run once for each created session.

#### Scenario: A second session does not re-register definitions

- **WHEN** two sessions are created in one process
- **THEN** every default-definition registration occurs once
- **AND** no existing definition is overwritten

#### Scenario: Session diagnostics remain distinct

- **WHEN** two sessions are created with distinct diagnostics ports
- **THEN** each core's transcription/session diagnostics are delivered only to its supplied port

### Requirement: Newly multiplied core side effects are cleaned up

The session lifecycle SHALL suspend, resume and stop the save subscriptions/timers owned by its
core. Disposal SHALL perform that cleanup before removing the session-core binding and SHALL remain
idempotent.

#### Scenario: Suspend and resume control only one save manager

- **WHEN** session A is suspended and resumed while session B remains mounted
- **THEN** only session A's save manager is paused and resumed

#### Scenario: Disposal stops core-owned effects once

- **WHEN** a session is disposed twice
- **THEN** its save manager and any C2-owned subscriptions are stopped once
- **AND** the second disposal completes without affecting another session

### Requirement: The process-global editor singleton cannot return

A committed boundary check SHALL scan the complete runtime graph of both Hosts and reject
`EditorCore.getInstance`, `EditorCore.reset`, a static core instance, module-scope core construction
and core construction outside the session-runtime ownership module. Every rule SHALL have a
deliberate negative control.

#### Scenario: The runtime graph contains no singleton path

- **WHEN** the singleton boundary check runs on the C2 tree
- **THEN** it finds no forbidden accessor, static instance or implicit construction path

#### Scenario: Each forbidden shape is detectable

- **WHEN** each deliberate violating fixture or isolated temporary-tree mutation is checked
- **THEN** the boundary command exits non-zero and identifies the corresponding rule

#### Scenario: The check cannot pass by scanning nothing

- **WHEN** the boundary command enumerates its runtime graph
- **THEN** it asserts both Host roots, the session factory, command graph, Vite picker and sounds
  path were included
- **AND** an empty or truncated enumeration exits non-zero

### Requirement: C2 preserves behavior while deferring C3 boundaries

C2 SHALL preserve the editing-parity fixture and pinned type-baseline ceiling. It SHALL not claim
isolation of the nine global stores, renderer/compositor state or persistence implementation, and
SHALL not edit Rust or generated WASM.

#### Scenario: Existing editing behavior remains green

- **WHEN** focused session/command tests, the full suite and the parity fixture run
- **THEN** editing behavior matches the C0+C1 integration baseline

#### Scenario: Deferred boundaries stay explicit

- **WHEN** the C2 product-source diff is reviewed
- **THEN** no Rust/generated-WASM file, global-store sessionization or C0b adapter is present
- **AND** `script/fixtures/type-baseline.json` is byte-identical to the baseline
