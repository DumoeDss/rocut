# editor-session-runtime Specification

## Purpose
TBD - created by archiving change s02-port-contract-freeze. Update Purpose after archive.

## Requirements

### Requirement: An editor session is created from explicit dependencies

The runtime SHALL define a session value created from an explicit dependency object rather than
obtained from a process-global accessor. The session SHALL own what the editor's process-global core
owns today.

#### Scenario: A session is created from a dependency object

- **WHEN** a Host supplies the port contract to the session factory
- **THEN** a session value is returned, and creating a second one with different dependencies
  produces a second, independent session value

#### Scenario: The contract does not require a global accessor

- **WHEN** the session type and factory signature are reviewed
- **THEN** nothing in them requires or exposes a process-global editor instance

### Requirement: The session lifecycle is part of the contract

The session SHALL expose `create`, `mount`, `suspend`, `resume`, `unmount` and `dispose` as contract
operations with defined ordering and defined behaviour when called out of order.

#### Scenario: Lifecycle operations are declared with their ordering

- **WHEN** a Host author reads the session contract
- **THEN** each lifecycle operation states which states it is valid from and what it does when it is
  not

#### Scenario: Suspend and resume are distinguishable from unmount

- **WHEN** a session is suspended and later resumed
- **THEN** its identity and project state are retained, in contrast to unmount, which releases the
  mounted root

### Requirement: Mount returns a root handle that makes unmount triggerable

`mount` SHALL return a root handle to its caller, and it SHALL do so before mounting has completed,
so that a Host holds something it can unmount at every instant — including while mounting is still
in progress or has failed. Readiness SHALL be observable on the handle rather than by awaiting the
mount call.

#### Scenario: A handle exists before mounting completes

- **WHEN** a Host calls mount
- **THEN** it immediately receives a handle exposing the mounted container, the session identity,
  the current lifecycle state, and a separate readiness signal

#### Scenario: Unmount is callable during a slow or failed mount

- **WHEN** mounting has not completed, or has failed
- **THEN** calling unmount on the handle releases what was acquired and leaves the session in a
  defined state

#### Scenario: Unmount is idempotent

- **WHEN** unmount is called on a handle that is already unmounted
- **THEN** it completes without error

#### Scenario: Disposal implies unmount

- **WHEN** a session with a live mounted root is disposed
- **THEN** the root is unmounted as part of disposal, and a Host is not required to sequence the two

#### Scenario: A session has at most one live root

- **WHEN** a Host mounts a session that is already mounted
- **THEN** the operation is rejected with a stated reason rather than producing a second live root

### Requirement: Session-owned resources are acquired through the session, not registered afterwards

Timers, workers, audio contexts, object URLs and session-owned graphics resources SHALL be acquired
through the session's resource registry, so that acquisition and tracking cannot diverge. An API
that records resources only when a caller remembers to register them SHALL NOT be used.

#### Scenario: The five resource classes are acquired through the session

- **WHEN** the editor needs a timer, a worker, an audio context, an object URL or a session-owned
  graphics resource
- **THEN** it obtains it from the session's resource registry and receives a handle

#### Scenario: Direct acquisition is detectable

- **WHEN** the boundary check runs over the editor graph
- **THEN** direct construction of a worker or audio context, and direct object-URL creation, are
  reported as violations
- **AND** the check is proven able to fail by a deliberate violation fixture

#### Scenario: Each class is separately visible, including when empty

- **WHEN** the registry's contents are inspected
- **THEN** each of the five classes is reported separately, and a class with no entries reports zero
  rather than being absent

### Requirement: Disposal is owned by the session and reports what it released

The session SHALL own disposal of its resources; a Host SHALL NOT be required to release individual
resources. `dispose` SHALL be idempotent and SHALL return a report stating, per resource class, how
many were created and how many were released.

#### Scenario: Disposal releases in a defined order and is idempotent

- **WHEN** a session is disposed twice
- **THEN** the first call releases its resources in reverse acquisition order and the second
  completes without error

#### Scenario: The report states created as well as released

- **WHEN** a disposal report is produced
- **THEN** it gives both a created count and a released count for each of the five resource classes
- **AND** a class that was never created is distinguishable from a class that was created and
  released

### Requirement: Schema migration is owned by the store implementation and run once per session creation

Responsibility for running persisted-schema migrations SHALL belong to the store implementation,
which knows its own schema version, and the session SHALL invoke it exactly once during creation,
before any project is loaded. Migration progress SHALL be observable through the diagnostics port.

#### Scenario: The store declares its schema version and its migration

- **WHEN** a store implementation is supplied to the session
- **THEN** it declares the schema version it holds and, where it has legacy data, the migration that
  brings it forward

#### Scenario: Migration runs once, before any project load

- **WHEN** a session is created
- **THEN** migration is invoked once, before the first project is loaded
- **AND** creating a second session against the same store does not run it again

#### Scenario: Migration progress is observable

- **WHEN** a migration reports progress
- **THEN** that progress is delivered through the session's diagnostics channel, so a Host or a
  surface can observe it while it is running

#### Scenario: A store with no legacy data is not required to migrate

- **WHEN** a store implementation has no legacy data to bring forward
- **THEN** it declares no migration and session creation proceeds without one

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
