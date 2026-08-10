## ADDED Requirements

### Requirement: Draft sessions capture isolated consistent base snapshots

The system SHALL open every Draft Session against one consistent project-content snapshot and its durable base revision. Drafts created for one editor session MUST share that session's transaction engine, maintain independent working state, and perform no durable mutation while opening or editing.

#### Scenario: Opening captures one revision-consistent document

- **WHEN** the revision before and after reading project, tracks, clips, assets, and markers is the same
- **THEN** the Draft opens with those entities and that revision as its immutable base
- **AND** its private working document starts as a defensive copy of that base

#### Scenario: Opening retries a torn snapshot

- **WHEN** the durable revision changes while a Draft's project content is being read
- **THEN** the system discards every entity from that attempt and retries the complete snapshot read within a bounded limit
- **AND** exhaustion returns a structured busy or conflict failure without creating a Draft

#### Scenario: Committed-state capability is explicit and fail-closed

- **WHEN** a public transaction-engine wrapper does not supply an exact committed-state capture capability
- **THEN** Draft opening returns a structured `committed-state-unavailable` failure
- **AND** no hidden Symbol, empty-idempotency fallback, Draft session, or durable mutation is created

#### Scenario: Wrapper capture includes the complete durable ledger

- **WHEN** a conforming wrapper supplies an explicit capture capability bound to its underlying provider state
- **THEN** the captured base includes the exact revision, content, private graph, and every prior idempotency entry
- **AND** compensation preflight and actual undo observe equivalent prior and forward ledger entries

#### Scenario: Capture loss before approval fails closed

- **WHEN** an opened Draft can no longer capture and match committed state at approval
- **THEN** approval becomes terminal with a structured committed-state failure before parent apply
- **AND** no forward content, revision, idempotency entry, save, or watcher event is published

#### Scenario: Concurrent Drafts remain isolated

- **WHEN** two Drafts open from the same engine revision and each accepts different Draft-safe operations
- **THEN** each Draft review and working snapshot contains only its own accepted operations
- **AND** neither Draft nor the durable project exposes the other Draft's unapproved content

### Requirement: Each Draft tool call has an atomic savepoint

The system SHALL evaluate every Draft tool call as one non-empty ordered batch against a savepoint of that Draft's current working document. A successful call MUST replace the working document and append its operations in order; a rejected or failed call MUST restore the exact pre-call working document and journal.

#### Scenario: Successful calls accumulate in order

- **WHEN** a Draft accepts several tool calls whose operations depend on content created by earlier calls
- **THEN** each call evaluates against the result of the preceding accepted calls
- **AND** the Draft journal preserves call order and operation order

#### Scenario: Mid-sequence failure rolls back only that call

- **WHEN** an operation in a multi-operation tool call fails validation, placement, or referential integrity after an earlier operation in the same call would have succeeded
- **THEN** none of that call's operations appear in the Draft working document or journal
- **AND** all operations accepted by earlier tool calls remain unchanged

#### Scenario: Draft evaluation is non-durable

- **WHEN** a Draft tool call succeeds or fails before approval
- **THEN** the parent engine performs no durable save, revision increment, idempotency mutation, or watch notification

### Requirement: Draft approval modes and reviews are explicit

The system SHALL require a Draft Session to select `manual` or `auto` approval when it opens and MUST keep that mode fixed for the Draft's lifetime. Review summaries MUST be generated deterministically from structured accepted operations rather than Agent-authored prose.

#### Scenario: Manual Draft accumulates until an explicit decision

- **WHEN** a manual Draft accepts one or more tool calls
- **THEN** it remains editable and reviewable without changing the durable project
- **AND** only explicit approval or rejection ends its lifecycle

#### Scenario: Auto Draft uses the normal approval path

- **WHEN** an auto Draft accepts a tool call
- **THEN** it immediately applies that call through the same retention, expected-revision, and single-batch approval path used by manual mode
- **AND** the Draft becomes terminal after that apply attempt

#### Scenario: Mode fallback is forbidden

- **WHEN** approval or apply fails for a manual or auto Draft
- **THEN** the system does not change its approval mode, silently approve it, or reopen it on another base

#### Scenario: Review is derived from the journal

- **WHEN** a caller requests a Draft review
- **THEN** the result reports operation kinds, affected entity ids, stable call/operation order, and aggregate counts derived from the accepted journal
- **AND** no free-form Agent summary is required or accepted as authoritative

### Requirement: Approval is one conflict-checked transaction and one undo unit

The system SHALL approve a non-empty Draft by flattening all accepted operations in original order into exactly one transaction batch. The batch MUST use the Draft's captured durable base as `expectedRevision`, and a successful application MUST return a structured receipt containing one compensating transaction that represents the Draft as one undo unit.

#### Scenario: Manual approval commits one durable batch

- **WHEN** a non-stale manual Draft with several accepted calls is approved
- **THEN** the parent engine receives exactly one apply containing every accepted operation in original order
- **AND** success causes exactly one durable save, one revision increment, and one watch notification

#### Scenario: Stale Draft is rejected without rebase

- **WHEN** the durable engine revision no longer equals the Draft's captured base revision at approval
- **THEN** approval returns a structured conflict with expected and actual revisions
- **AND** it performs no Draft rebase, durable save, revision increment, or watch notification

#### Scenario: Only one sibling Draft can win

- **WHEN** two Drafts share one engine and the same base revision and one Draft applies first
- **THEN** approving the second Draft fails the expected-revision check
- **AND** the first Draft's committed content remains unchanged

#### Scenario: Receipt supplies one compensating batch

- **WHEN** a Draft applies successfully
- **THEN** its receipt includes the base and applied revisions, structured review, forward result, and one inverse batch whose expected revision is the applied revision
- **AND** applying that inverse batch once restores the base project content when no later edit has advanced the revision

#### Scenario: Compensation is minimal and policy-closed before apply

- **WHEN** a provider policy accepts a local Draft update and its corresponding inverse but rejects unrelated create/delete operation classes
- **THEN** the planned inverse contains only operations needed for the affected entities or their observable ordered suffix
- **AND** the system evaluates that exact inverse with the same provider policy before the forward parent-engine apply
- **AND** a rejected or thrown compensation preflight leaves durable content, revision, idempotency, saves, and watchers unchanged

#### Scenario: Compensation preflight observes the complete forward commit projection

- **WHEN** a deterministic provider policy inspects the transaction document while evaluating both compensation preflight and the later published undo
- **THEN** both evaluations observe equivalent project content, revision, existing metadata, and the forward `:apply` idempotency entry with its canonical fingerprint and result
- **AND** an inverse accepted during preflight remains accepted when applied without intervening work

#### Scenario: Local update compensation does not scale with document size

- **WHEN** one field of one entity is updated in a document containing thousands of otherwise unaffected entities and the pre-image is expressible by the matching update operation
- **THEN** compensation construction uses linear collection passes and returns exactly one inverse update
- **AND** it does not synthesize whole-document delete/create reconstruction

#### Scenario: Ordered repair preserves exact base representation

- **WHEN** undo must reinsert an entity, restore an absent own property, or repair insertion order that T1 patches cannot express
- **THEN** the compensation recreates only the smallest required ordered suffix plus referentially dependent children
- **AND** one atomic inverse restores collection order, own-property presence, references, and provider-private pre-images exactly

#### Scenario: Provider-private alias topology is restored bijectively

- **WHEN** a reversible provider-private update changes two structurally equal references from distinct to shared or from shared to distinct
- **THEN** approval succeeds and the compensating transaction restores the base reference topology exactly
- **AND** equality used by repair planning and final proof rejects any many-to-one or one-to-many object mapping

#### Scenario: Alias repair spans the complete document graph

- **WHEN** aliases shared or split across two tracks, clips, assets, or markers change in one Draft batch
- **THEN** repair planning identifies every participating entity with one document-wide bijection
- **AND** the inverse operation graph restores exact reference identity across entity and collection boundaries

#### Scenario: Identity shortcuts and nested containers do not hide aliases

- **WHEN** compared graphs share one literal object at an early position or contain aliases through cycles, Maps, or Sets
- **THEN** every object pair is registered before identity can terminate comparison
- **AND** an unrelated reversible edit plus undo preserves the exact base topology by direct reference identity

#### Scenario: Undo refuses to overwrite later work

- **WHEN** the project revision advances after Draft application and before its compensating batch is applied
- **THEN** the normal transaction conflict behavior rejects that stale undo batch

#### Scenario: Parent-engine failure evidence is safe and useful

- **WHEN** a parent-engine failure carries known T1 errors or nested Map, Set, Date, RegExp, cyclic, accessor, or executable evidence
- **THEN** the Draft returns a deeply immutable evidence snapshot without invoking evidence-owned accessors or retaining executable/live mutable values
- **AND** known T1 error prototypes and standard built-in snapshot content remain observable

### Requirement: Draft-safe and immediate operations are formally separated

The system SHALL publish an exhaustive type-level and runtime classification of editing operation categories. Reversible track, clip, marker, and project-local asset transaction operations SHALL be Draft-safe; generation, export, source-package removal, external-resource deletion, and other external side effects MUST be immediate and MUST NOT enter a rejectable Draft.

#### Scenario: Closed transaction operations are Draft-safe

- **WHEN** a caller submits a valid track, clip, marker, or project-local asset `TransactionOperation` through the typed Draft interface
- **THEN** the runtime classification register identifies it as Draft-safe and permits savepoint evaluation

#### Scenario: Immediate operation is rejected before Draft mutation

- **WHEN** untrusted input for generation, export, source-package removal, external-resource deletion, or another registered immediate category is forced across the Draft runtime boundary
- **THEN** the Draft returns a structured `immediate-operation-required` rejection
- **AND** its working document, journal, durable revision, and watchers remain unchanged

#### Scenario: External deletion differs from reversible project deletion

- **WHEN** classification compares a reversible delete-track, delete-clip, delete-marker, or delete-asset transaction with source-package or external-resource deletion
- **THEN** the project-content deletion is Draft-safe and invertible
- **AND** the external deletion is immediate and non-rejectable

#### Scenario: No generic command escape hatch exists

- **WHEN** the public Draft and classification interfaces are inspected
- **THEN** they expose closed operation unions and named immediate categories
- **AND** they expose no generic command-name/payload invocation interface

### Requirement: Applied Draft resources survive source-package removal

The system SHALL require a retention preflight before applying a Draft and MUST apply only when every asset referenced by the final candidate clips has structured evidence of project-owned backing data independent of its source package. Source-package removal itself MUST remain an immediate operation outside the Draft.

#### Scenario: Referenced assets pass retention preflight

- **WHEN** every asset referenced by the approved candidate has project-owned retained backing data
- **THEN** the preflight succeeds and approval may call the transaction engine
- **AND** later source-package removal does not invalidate the applied project content

#### Scenario: Missing retained content blocks apply

- **WHEN** any candidate-referenced asset lacks retention evidence or the retention adapter fails
- **THEN** approval returns a structured retention failure before engine apply
- **AND** no durable save, revision increment, or watch notification occurs

#### Scenario: Rejection has no package side effect

- **WHEN** a Draft is rejected or a Draft call rolls back
- **THEN** the Draft performs no source-package removal or external-resource deletion

### Requirement: Reusable Draft conformance proves T2 semantics

The system SHALL provide a Host-neutral Draft conformance runner that tests any conforming manager/engine fixture through the public Draft interface. Assertion and result accounting MUST be local to each run so repeated, concurrent, and nested runs remain independent.

#### Scenario: Conformance covers the Draft lifecycle

- **WHEN** the conformance runner executes against the reference fixture
- **THEN** it proves consistent opening, multi-Draft isolation, per-call rollback, manual and auto transitions, structured reviews, stale rejection, one-batch application, compensating receipts, retention preflight, classification rejection, and terminal-state behavior

#### Scenario: Conformance is repeatable and generic

- **WHEN** the same generic fixture factory is used for repeated or concurrent conformance runs
- **THEN** each report contains only its own assertions and failures
- **AND** custom engine feature-name literal types remain usable without widening to `string`

#### Scenario: Draft contract remains Host-neutral

- **WHEN** the transaction boundary check scans `apps/web/src/editor/contracts/draft/**`
- **THEN** no OpenCut schema, command class, editor core, Zustand store, browser-storage identifier, Rust, WASM, React, or Electron dependency crosses the contract seam
