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
