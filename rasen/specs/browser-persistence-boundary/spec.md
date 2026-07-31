# browser-persistence-boundary Specification

## Purpose
TBD - created by archiving change s01-vite-portability-baseline. Update Purpose after archive.
## Requirements
### Requirement: A single named boundary owns browser persistence

Browser-storage use by the editor SHALL be reachable through one named adapter boundary, so that a
later change can replace it without hunting call sites.

#### Scenario: Browser storage APIs are confined

- **WHEN** the source is scanned for direct IndexedDB and OPFS use in the distributable editor graph
- **THEN** all such use is located inside the storage adapter area behind the named boundary

#### Scenario: The Vite example depends on the boundary, not on storage internals

- **WHEN** the Vite example's host code is reviewed
- **THEN** it references the browser persistence boundary and does not call IndexedDB or OPFS
  directly

### Requirement: The persistence boundary is explicitly provisional

The adapter SHALL be documented and labeled in code as provisional, and SHALL NOT be presented as
the final Host port contract.

Once a Host storage port contract exists, the provisional label SHALL attach to the *adapter
implementation* rather than to the absence of a contract, and the boundary documentation SHALL point
at where the storage contract now lives instead of stating that none is published. The adapter
remains provisional until it is retired by the change that inverts the storage dependency; that
retirement is not this requirement's concern.

#### Scenario: Provisional status is stated in code

- **WHEN** a developer opens the adapter module
- **THEN** its header states that it is provisional and will be superseded, and that it is not a
  public Host port contract

#### Scenario: The documentation points at the published storage contract

- **WHEN** a reviewer reads the boundary documentation after a storage port contract has been
  published
- **THEN** it names where that contract lives and states that the adapter is a provisional
  implementation awaiting retirement
- **AND** it does not state that no storage contract is published, which would be false

### Requirement: Save and reopen survive a full page reload

A project saved through the boundary SHALL be recoverable with equivalent content after a full page
reload.

#### Scenario: Reopen after full reload restores the project

- **WHEN** a project with multi-track content is saved, the page is fully reloaded, and the project
  is reopened
- **THEN** the project's tracks, clips, placements, trims and media references are equivalent to
  those saved

#### Scenario: Media assets survive reload

- **WHEN** the project is reopened after a full reload
- **THEN** every imported media asset is available and renders in the media panel and on the
  timeline

### Requirement: Transient object URLs are never persisted as canonical locators

No persisted record SHALL store a `blob:` or otherwise session-scoped URL as the canonical locator
for a media asset or thumbnail.

#### Scenario: Persisted records contain no blob URL

- **WHEN** the persisted project and media metadata records are inspected directly after a save
- **THEN** no stored string value begins with `blob:`

#### Scenario: Playable URLs are regenerated on load

- **WHEN** a project is loaded
- **THEN** playable media URLs are regenerated from the persisted binary content rather than read
  from a stored URL string

### Requirement: The migration runner operates on the real projects database

The storage migration runner SHALL open the same database and object store the storage service uses
for projects. It SHALL NOT create or read any database whose name is derived from an undefined value.

#### Scenario: No database named after an undefined value exists

- **WHEN** a profile's IndexedDB inventory is read after the editor has created, saved and reopened a
  project
- **THEN** no database named `undefined` is present, and no object store named `undefined` is present
  in any database

#### Scenario: The runner sees the projects the service wrote

- **WHEN** the migration runner enumerates stored projects
- **THEN** it returns the same project records the storage service persists through its own projects
  adapter, rather than an empty list

#### Scenario: The defect's prior observable trace is used as the before-state

- **WHEN** the repair's evidence is assembled
- **THEN** it cites the recorded pre-repair database inventory containing the `undefined` database, and
  the matching post-repair inventory in which it is absent, from the same probe

### Requirement: A project written by an older schema version is brought to the current version

A stored project whose recorded version is below the current schema version SHALL be migrated to the
current version when the editor loads it, and the migration SHALL be reported through the runner's
progress channel.

#### Scenario: A seeded legacy project reaches the current version

- **WHEN** a project record written in an older schema shape is placed in the projects store and the
  editor is loaded
- **THEN** the stored record's version afterwards equals the current schema version
- **AND** the project's scenes, tracks and clips are present and structurally intact

#### Scenario: Migration is reported rather than silent

- **WHEN** a project requires migration
- **THEN** the runner's progress channel reports migration in progress with the source and target
  versions and the project's name, and reports completion afterwards

#### Scenario: Writing a migrated project back succeeds

- **WHEN** a migration step produces an updated project record
- **THEN** the record is written back to the projects store under the project's own identifier
- **AND** the write does not fail because the record's key is absent

#### Scenario: A current-version project is left untouched

- **WHEN** a stored project is already at the current schema version
- **THEN** no migration runs against it and its persisted record is unchanged

### Requirement: Legacy per-project databases are read before they are deleted

Where a migration reads data out of legacy per-project databases before deleting them, it SHALL open
those databases under their real names, so that data is carried forward rather than dropped.

#### Scenario: Legacy timeline data is carried forward, not discarded

- **WHEN** a migration that reads legacy per-project timeline data runs against a project that has
  such data
- **THEN** the tracks recovered from the legacy databases appear in the migrated project
- **AND** the legacy databases are deleted only after their contents have been read

#### Scenario: Legacy media metadata informs the migrated project

- **WHEN** the same migration resolves media types from the legacy per-project media metadata database
- **THEN** the types it resolves come from that database's real contents rather than from an empty
  result
