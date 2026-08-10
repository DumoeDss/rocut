## ADDED Requirements

### Requirement: UI and automation share one session transaction engine

For each loaded editor project, the system SHALL create one canonical session-owned transaction engine and SHALL route both transaction-routable UI commits and automation applies through that same ordered engine facade. The UI path MUST NOT open a sibling engine for the same loaded project, redefine `ProjectStore`, or expose a public generic command-invocation operation. Project switching or session disposal SHALL retire the prior project's routing state before another project becomes editable.

#### Scenario: Interleaved UI and automation commits share revision order

- **WHEN** an automation apply and a transaction-routable UI command are invoked against one loaded project
- **THEN** both enter the same engine ordering path
- **AND** their successful revisions are consecutive in invocation order
- **AND** each successful commit produces exactly one transaction watcher notification

#### Scenario: UI routing has no generic command escape hatch

- **WHEN** a consumer inspects the public transaction operations and the session engine facade
- **THEN** every public mutation remains one of the frozen typed operation kinds
- **AND** no `invokeAnyCommand`, command name string, donor command class, or opaque command payload is exposed

### Requirement: Transaction-routable commands are durable before publication

The command path SHALL prepare a complete donor candidate and a non-empty frozen-contract operation batch without mutating published editor state. It SHALL submit that batch once with the committed base revision through the shared engine. Only after the engine's durable save succeeds MAY the system adopt and publish the candidate, apply selection intent, or mutate undo/redo history. A command preparation, validation, adapter, or store failure MUST leave committed live state, selection, history stacks, engine revision, idempotency state, and watcher output unchanged.

#### Scenario: A successful UI command publishes after one durable save

- **WHEN** a transaction-routable command prepares a valid candidate
- **THEN** the shared engine performs exactly one project-record save and increments revision exactly once
- **AND** live project state, selection intent, and one history entry are published only after that save resolves

#### Scenario: A failed durable save publishes no UI state

- **WHEN** a valid prepared command reaches the engine but `ProjectStore.save` rejects
- **THEN** the command rejects with the structured store failure
- **AND** live project state, selection, history, redo, revision, idempotency, and watcher count remain exactly as before the command
- **AND** a later routed command can still run

### Requirement: Composite command work commits as one atomic transaction

One root command SHALL own one preparation lifecycle. Every transaction-routable child of a `BatchCommand`, nested no-history project edit, ripple adjustment, and registered command reactor SHALL mutate the same detached candidate and SHALL be represented in the one final typed batch. The command manager MUST submit at most one engine apply and publish at most one history entry for that root. A failure in any child or final validation SHALL discard the complete candidate.

#### Scenario: BatchCommand children commit together

- **WHEN** a `BatchCommand` contains several transaction-routable children whose final candidate is valid
- **THEN** all child changes commit in one engine apply, one durable save, one revision increment, and one history entry
- **AND** the latest explicit child selection intent remains the batch selection result

#### Scenario: A failing batch child commits nothing

- **WHEN** an early child prepares a change and a later child fails or makes the final candidate invalid
- **THEN** no child change reaches live state or durable storage
- **AND** revision, history, selection, and watcher output remain unchanged

#### Scenario: Ripple and reactors stay in the root transaction

- **WHEN** a root command causes ripple adjustments and the empty-track reactor removes a track
- **THEN** the clip adjustments and track removal are included in the same typed batch and donor candidate as the root command
- **AND** no follow-up save, revision, watcher notification, or history entry is created for reactor work

### Requirement: Donor candidates are explicit, projection-checked, and opaque-preserving

The concrete OpenCut transaction adapter SHALL live outside `apps/web/src/editor/contracts/**` and SHALL overlay the prior `ProjectRecord.data` rather than rebuild it. A staged UI donor candidate SHALL be bound to an explicit unique commit token, base revision, and previous-record identity. Before saving, the adapter MUST prove that projecting the donor candidate yields exactly the engine candidate for every frozen public field. A token, base, or projection mismatch SHALL reject before save. Provider-private fields owned by the edit MAY change in the same record; unrelated provider-private and opaque fields SHALL round-trip unchanged with revision and idempotency metadata.

#### Scenario: Public and provider-private state commit in one record

- **WHEN** a routed UI command changes a frozen clip field and related provider-private clip data
- **THEN** the adapter verifies the candidate's public clip projection against the typed engine document
- **AND** both changes plus transaction metadata are written by the engine's one replacement-record save

#### Scenario: A mismatched donor candidate is rejected

- **WHEN** a staged donor candidate's token, base record, or projected public entities do not match the engine candidate
- **THEN** the adapter rejects before `ProjectStore.save`
- **AND** no live state, revision, idempotency entry, history entry, selection change, or watcher notification is published

#### Scenario: Unowned opaque fields survive UI and automation commits

- **WHEN** the prior donor record contains unknown nested sentinels and UI and automation commits are applied in sequence
- **THEN** every sentinel outside the owned projection remains structurally unchanged after save and reopen

### Requirement: Command effects have an explicit routing class

Every command entry point SHALL be classified as transaction-routable project work, local preview, provider-private-only project work, or immediate external work before execution. Transaction routing SHALL require deterministic reversible project-record work and a non-empty batch in the frozen operation union. A private-only edit MUST NOT be disguised as a no-op public operation. Attachment, network, cache, media-processing, generation, export, and external-resource effects SHALL remain immediate and MUST NOT be included in an undoable transaction or mixed with transaction children in one `BatchCommand`.

#### Scenario: A mixed immediate and transaction batch is rejected before effects

- **WHEN** a `BatchCommand` contains a transaction-routable child and an attachment, network, cache, or external-resource child
- **THEN** the batch is rejected before any child runs
- **AND** no project mutation, external effect, durable save, revision, or history entry occurs

#### Scenario: A provider-private-only edit does not fake a transaction

- **WHEN** a reversible donor edit changes no field representable by the frozen operation union
- **THEN** the command is reported through its explicit provider-private routing class
- **AND** it does not submit a no-op batch or claim a transaction revision

### Requirement: UI Project settings consume the reviewed typed Project operation

Public Project settings changed by the UI SHALL be represented by the reviewed Host-neutral `update-project` operation in the same detached donor candidate and durable root as related content work. Settings routing MUST be classified per changed field: public-only and mixed public/private patches have exactly one real typed public sibling, while private-only patches remain an explicit provider-private gap. Public fps/canvas fields MUST NOT be removed from a candidate to force equality, inferred from an asset/clip inside the adapter, or persisted through a second legacy save. Settings explicitly nested with `pushHistory: false` SHALL remain part of the forward durable transaction but SHALL be excluded from the command inverse.

#### Scenario: First-image canvas selection is durable but not undo-owned

- **WHEN** inserting the first 320x180 visual asset changes a new Project canvas from 1920x1080
- **THEN** the canvas patch and content operations commit through one apply, save, revision, watcher notification, and history publication
- **AND** engine reads, live donor state, the exact persisted record, persistence cache, and reopen all report 320x180
- **AND** successful command undo removes the inserted content but retains the 320x180 canvas and its provider-private original-canvas sibling

#### Scenario: Settings routing is honest per changed field

- **WHEN** a settings patch changes public fps/canvas fields only or combines them with donor-private settings
- **THEN** the command routes through one typed `update-project` sibling and exact staged donor/engine equality remains mandatory
- **AND WHEN** a settings patch changes only donor-private fields
- **THEN** it remains provider-private and submits no empty transaction, revision, watcher notification, or second-save claim

#### Scenario: Import-time frame-rate work has an explicit history policy

- **WHEN** an attachment-backed imported video raises the public Project frame rate
- **THEN** the attachment effect completes first and the Project/catalog mutation uses an explicit historyless typed transaction through the shared engine
- **AND** final-document placement validation rejects an old-only time grid unless explicit typed repairs in that same batch make the complete candidate valid

### Requirement: Pointer preview is local and commits once at interaction end

Pointer-driven preview frames SHALL update only local preview state and SHALL NOT call transaction apply, save a project record, increment revision, notify transaction watchers, or create history. Ending an accepted interaction SHALL route the final candidate through one normal command transaction. Cancelling or discarding SHALL clear local preview with zero transaction commits. If the final durable commit fails, the committed editor and history SHALL remain unchanged and the local preview SHALL remain available for retry or discard.

#### Scenario: Many pointer frames create no transactions

- **WHEN** one interaction produces any positive number of pointer-move preview frames before pointer-up
- **THEN** apply count, project-save count, revision, transaction watcher count, and history count remain unchanged during those frames

#### Scenario: Pointer-up creates exactly one transaction

- **WHEN** the final preview candidate is valid and the pointer interaction ends
- **THEN** exactly one engine apply, one durable project save, one revision increment, one watcher notification, and one history entry occur
- **AND** the preview overlay is cleared only after success

#### Scenario: Cancel creates no transaction

- **WHEN** an active pointer preview is discarded or cancelled
- **THEN** the preview overlay is cleared
- **AND** apply count, save count, revision, watcher count, live committed state, and history remain unchanged

#### Scenario: Failed pointer-up retains local preview

- **WHEN** the final pointer commit reaches a durable store failure
- **THEN** committed tracks, revision, watchers, and history remain unchanged
- **AND** the final preview overlay remains local for retry or explicit discard

### Requirement: Undo and redo are routed transactions

Undo and redo of a transaction-routable history entry SHALL each submit one inverse or forward typed batch through the shared engine at the current revision. A successful undo or redo SHALL perform one durable save, increment revision once, notify watchers once, and only then move the history entry and publish selection restoration or forward selection intent. A failure SHALL leave both history stacks, selection, and live state unchanged.

#### Scenario: Undo commits one inverse transaction

- **WHEN** the latest routed command is undone successfully
- **THEN** its complete root change, including ripple and reactor effects, is reversed by one engine apply and one durable save
- **AND** revision increments once and the entry moves to redo only after durability succeeds

#### Scenario: Redo commits one forward transaction

- **WHEN** a successfully undone routed command is redone
- **THEN** its complete forward change is applied by one engine apply and one durable save
- **AND** revision increments once and the entry returns to history only after durability succeeds

#### Scenario: Failed undo preserves history and selection

- **WHEN** the inverse transaction's durable save rejects
- **THEN** live project state, selection, history, redo, revision, and watcher output remain unchanged

### Requirement: Transaction publication cannot trigger a duplicate or stale legacy save

After a routed commit succeeds, the system SHALL adopt the exact encoded `ProjectRecord` into the session persistence retained snapshot and decoded cache without calling `ProjectStore.save` again. Scene/timeline publications caused by adopting that already durable candidate MUST NOT mark a new save dirty. Transaction work and remaining coordinator project saves SHALL share one per-project session arbiter so a legacy save cannot derive its opaque overlay from a record older than a completed transaction. Non-transaction dirty paths SHALL retain their current debounce and retry behavior.

#### Scenario: Routed publication performs no second save

- **WHEN** one routed command commits and its donor candidate is published to scene and timeline subscribers
- **THEN** the underlying project-record save count is exactly one after the SaveManager debounce window
- **AND** the persistence retained snapshot and decoded cache match the exact transaction record

#### Scenario: A queued legacy save cannot erase transaction metadata

- **WHEN** a coordinator project save and a routed transaction target the same loaded project in either invocation order
- **THEN** the session arbiter serializes their complete mutation lifecycles
- **AND** the later replacement retains the latest committed revision, idempotency ledger, and unrelated opaque fields

#### Scenario: Non-transaction dirty work still saves

- **WHEN** an explicitly non-transaction project path marks the editor dirty outside a transaction publication scope
- **THEN** SaveManager retains its debounce, failure retry, and successful publication behavior
