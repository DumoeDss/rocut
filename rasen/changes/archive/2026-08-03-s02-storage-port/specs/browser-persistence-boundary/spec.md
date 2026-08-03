## MODIFIED Requirements

### Requirement: A single named boundary owns browser persistence

Browser-storage use by the editor SHALL be implemented by the production browser `ProjectStore`
inside the named storage boundary. Editor production modules and Host composition roots SHALL depend
only on the Host store contract and SHALL NOT import the process-global storage service, a browser
storage adapter, or IndexedDB/OPFS mechanisms directly.

#### Scenario: Browser storage APIs are confined

- **WHEN** the source is scanned for direct IndexedDB and OPFS use in the distributable editor graph
- **THEN** all production use is located inside `apps/web/src/services/storage/` behind the browser
  store
- **AND** only the three individually named parity/seed/legacy-migration probes may use a direct
  mechanism outside that area

#### Scenario: The Vite example depends on the boundary, not on storage internals

- **WHEN** the Vite example's host code is reviewed
- **THEN** it supplies the production browser store through `EditorHost.store`
- **AND** it does not call IndexedDB, OPFS, the process-global service, or a provisional adapter
  directly

#### Scenario: Both examples depend on the final store contract

- **WHEN** the Vite and Next Host composition roots are reviewed
- **THEN** each explicitly supplies the production browser store through `EditorHost.store`
- **AND** neither Host calls IndexedDB, OPFS, the process-global service, or a provisional adapter
  directly

#### Scenario: Former direct consumers are inverted

- **WHEN** project, media, scene, processing, saved-sound, custom-preset, and storage-provider
  production modules are scanned
- **THEN** none imports the browser storage service or `BrowserHostAdapter`
- **AND** each obtains persistence from its owning session's Host store path

#### Scenario: The boundary gate is proven able to reject regressions

- **WHEN** the storage-boundary gate is run against fixtures containing a direct service import, a
  direct browser mechanism call, and a production in-memory fallback
- **THEN** it exits non-zero for every fixture and identifies the violated rule

### Requirement: Save and reopen survive a full page reload

A project saved through the browser store SHALL be recoverable with equivalent known content and
semantically identical provider-private content after a full page reload. Project attachments SHALL
remain associated with their own project and SHALL be reconstructed without persisting transient
object URLs.

#### Scenario: Reopen after full reload restores the project

- **WHEN** a project with multi-track content is saved, the page is fully reloaded, and the project
  is reopened
- **THEN** the project's tracks, clips, placements, trims and media references are equivalent to
  those saved

#### Scenario: A known edit does not discard unknown provider data

- **WHEN** opaque private sentinels exist at project, scene, track, clip, media, attachment, and
  library-record levels, a known timeline field is edited, the project is saved, and a new
  Host/session reopens it
- **THEN** every retained object's unknown sentinel is semantically unchanged
- **AND** the edited known field has its new value

#### Scenario: Media assets survive reload

- **WHEN** the project is reopened after a full reload
- **THEN** every imported media asset is available and renders in the media panel and on the
  timeline
- **AND** an asset with the same attachment key in another project remains isolated

### Requirement: The migration runner operates on the real projects database

The browser store's migration runner SHALL open the same configured durable database and records the
store uses for projects. It SHALL NOT create or read any database or object store whose name is
derived from an undefined value, and two store wrappers for the same durable identity SHALL NOT race
the migration.

#### Scenario: No database named after an undefined value exists

- **WHEN** a disposable browser profile's IndexedDB inventory is read after the editor has created,
  saved and reopened a project
- **THEN** no database named `undefined` is present, and no object store named `undefined` is present
  in any database

#### Scenario: The runner sees the projects the service wrote

- **WHEN** the migration runner enumerates stored projects
- **THEN** it returns the same project records the browser store persists through its projects
  adapter, rather than an empty list

#### Scenario: One durable identity migrates once

- **WHEN** two sessions use distinct browser-store wrapper objects configured for the same durable
  database identity concurrently
- **THEN** one migration transaction runs and both sessions observe its result
- **AND** a failed attempt is retryable on a later session creation

#### Scenario: The defect's prior observable trace is used as the before-state

- **WHEN** the repair's evidence is assembled
- **THEN** it cites the recorded pre-repair database inventory containing the `undefined` database,
  and the matching post-repair inventory in which it is absent, from the same probe

### Requirement: A project written by an older schema version is brought to the current version

A stored project whose recorded version is below the current schema version SHALL be migrated to the
current version by the store before the editor consumes it. Migration SHALL report progress and SHALL
preserve the readable legacy source until the transformed result has been read back and validated.
Destructive conformance cases MUST require an explicit opt-in and a verified disposable namespace.

#### Scenario: A seeded legacy project reaches the current version

- **WHEN** a project record written in an older schema shape is placed in an opted-in disposable
  projects store and the editor is loaded
- **THEN** the stored record's version afterwards equals the current schema version
- **AND** the project's scenes, tracks, clips, attachments, and opaque private sentinels are
  structurally intact

#### Scenario: Migration is reported rather than silent

- **WHEN** a project requires migration
- **THEN** the progress channel reports migration in progress with the source and target versions
  and the project's name, and reports completion afterwards

#### Scenario: Writing a migrated project back succeeds

- **WHEN** a migration step produces an updated project record
- **THEN** the record is written back under the project's own identifier
- **AND** the write does not fail because the record's key is absent

#### Scenario: Validation failure leaves the source readable

- **WHEN** a migration's staged result fails key, version, count, or opaque-sentinel validation
- **THEN** migration rejects with an attributed error and the original project and attachments remain
  readable
- **AND** no legacy database or record is deleted

#### Scenario: Migration conformance is opt-in and disposable

- **WHEN** the conformance suite is invoked without `exerciseMigration: true` or without a namespace
  under the declared disposable test prefix
- **THEN** no destructive migration fixture runs and no existing profile storage is changed

#### Scenario: A current-version project is left untouched

- **WHEN** a stored project is already at the current schema version
- **THEN** no migration runs against it and its persisted record is unchanged

### Requirement: Legacy per-project databases are read before they are deleted

Where a migration reads data out of legacy per-project databases before deleting them, it SHALL open
those databases under their real names, stage and validate all carried-forward records, and delete a
legacy source only after the current representation has committed successfully.

#### Scenario: Legacy timeline data is carried forward, not discarded

- **WHEN** a migration that reads legacy per-project timeline data runs against a project that has
  such data
- **THEN** the tracks recovered from the legacy databases appear in the validated migrated project
- **AND** the legacy databases are deleted only after the committed result has been read back

#### Scenario: Legacy media metadata informs the migrated project

- **WHEN** the same migration resolves media types and attachment bodies from legacy per-project
  storage
- **THEN** the types and bodies come from that storage's real contents rather than from an empty
  result
- **AND** failure or cancellation before commit leaves those legacy sources intact

## ADDED Requirements

### Requirement: Physical cleanup authority is topology-safe

The browser store SHALL centrally authorize every current or historical physical operation at its
actual mutation granularity before logical commit or physical access. Library authority SHALL be an
exact `(database, store)` pair, media cleanup authority SHALL cover a whole database and one exact
OPFS root, and migration cleanup authority SHALL cover whole databases. Authorization SHALL include
all current and strictly retained media/library claims, SHALL freeze the permitted target set, and
SHALL fail closed without widening the public store contract or persisted journal format.

#### Scenario: Library ownership is an exact store pair

- **WHEN** the configured library pair equals the projects public store or its cascade,
  media-ownership, library-clear-binding, or migration-maintenance control store
- **THEN** the first store operation rejects before database or store creation, descriptor writes,
  logical clear, or physical clear
- **AND** every project, control, and library record remains unchanged

#### Scenario: A distinct library store may share the projects database

- **WHEN** the configured library database equals the projects database but the library store is
  distinct from the public store and all four control stores
- **THEN** ordinary library record operations and authorized library clear remain functional
- **AND** the topology policy does not reject the configuration solely because the database names
  match

#### Scenario: Ordinary media first access includes current and retained libraries

- **WHEN** attachment list, load, save, remove, or ownership refresh derives a media database that
  equals a current or retained library database, including a same-database/different-store case
- **THEN** the operation rejects before owner, descriptor, or certificate writes and before any
  IndexedDB database/store open or upgrade or OPFS access
- **AND** a collision-free media claim remains usable

#### Scenario: Media cleanup cannot own a protected whole database or another owner's exact root

- **WHEN** a current or retained media claim equals the projects database, a current or retained
  library database, either canonical migration-stage database, a migration-owned legacy timeline
  database, or a different media owner's exact database or OPFS root
- **THEN** registration, remove, clear, and retry refuse the conflicting claim at whole-database or
  exact-root granularity
- **AND** a different store name inside the same database does not make whole-database deletion safe

#### Scenario: Current remove and clear refuse before logical commit

- **WHEN** a current project remove or projects/all clear proposes any topology-conflicting target
- **THEN** refusal occurs before media-owner registration, project deletion, tombstone or journal
  commit, store clear, database deletion, directory deletion, or other target I/O
- **AND** reopening with a collision-free configuration can save the same project identifier

#### Scenario: Historical cascade conflict is retained fail-closed

- **WHEN** a strictly decoded and authenticated historical cascade journal contains an unsafe
  target after one or more otherwise safe targets
- **THEN** no target executes, the complete journal and every target remain byte-for-byte unchanged,
  and the journal is not shrunk or rewritten
- **AND** maintenance reports a fixed nonretryable mechanism-neutral topology diagnostic while any
  existing same-project save block remains in force

#### Scenario: Migration authorizes the complete cleanup batch before discovery

- **WHEN** a migration candidate or cleanup target conflicts with projects, current or retained
  libraries, current or retained media, canonical stage ownership, or another protected database
- **THEN** the entire batch rejects before candidate IndexedDB/OPFS discovery or upgrade, media-owner
  registration, staging, recovery or cleanup intent, deletion, or journal shrink
- **AND** no earlier safe candidate or target is allowed to mutate because a later target conflicts

#### Scenario: Historical migration cleanup cannot partially advance

- **WHEN** a historical recovery or cleanup journal lists a safe target before an unsafe target
- **THEN** authorization executes zero deletes and retains the exact complete journal
- **AND** no cleanup target or source record is changed and a fixed nonretryable generic diagnostic
  is reported

#### Scenario: A safe same-owner exact retry remains idempotent

- **WHEN** a historical media or migration retry belongs to the same logical owner and names the
  same exact topology-safe physical tuple
- **THEN** full-batch authorization permits the existing cleanup to complete idempotently
- **AND** unrelated current and retained project, library, media, stage, and OPFS state remains
  unchanged

## REMOVED Requirements

### Requirement: The persistence boundary is explicitly provisional

**Reason**: C5 replaces the provisional `BrowserHostAdapter` with the production browser
`ProjectStore`; retaining a provisional label or adapter would describe a false architecture and
leave a second persistence path available.

**Migration**: Host composition roots supply `BrowserProjectStore` through the existing
`EditorHost.store` role. All former adapter/service consumers use the owning session's store path,
and the boundary documentation points to `editor/ports/project-store.ts` as the public contract.
