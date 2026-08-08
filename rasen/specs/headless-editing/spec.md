# headless-editing Specification

## Purpose

Define isolated React-free headless project editing, shared migration and persistence semantics, attributable Vite and Next closure and runtime evidence, and preservation of inherited editor contracts.

## Requirements

### Requirement: A provider-private headless session exposes only data lifecycle operations
The system SHALL provide an isolated React-free headless session import that accepts a complete `EditorHost`, scopes itself to that Host's project, and exposes load, save, and asynchronous dispose without changing the public `EditorSession`, Host-port, project-store, or provider schema contracts.

#### Scenario: Headless factory creates a project-scoped owner
- **WHEN** a complete Host with project ID and non-browser store is passed to the isolated headless factory
- **THEN** the factory returns an owner with a Host-issued session ID and that exact project ID

#### Scenario: Isolated export does not traverse the React-bearing barrel
- **WHEN** a consumer imports the dedicated headless entry
- **THEN** it can create and use the headless owner without importing the general session barrel, provider, Host component, Surface, JSX, or `EditorCore`

#### Scenario: Frozen public surfaces remain unchanged
- **WHEN** the C7 product diff is compared with the accepted base
- **THEN** the public session type, Host ports, project-store contract, provider record format, Rust/WASM API, and generated artifacts are unchanged

#### Scenario: S03 behavior is not introduced early
- **WHEN** the headless surface is inspected
- **THEN** it contains no public transaction, revision, command-idempotency, draft, conflict, autosave, or generic mutable-store API

### Requirement: Headless editing survives save, disposal, and reopen
The headless path MUST load an existing project, permit a bounded edit to the detached loaded value, durably save that value, dispose the first owner, and let a newly created owner reopen the edit from the same store.

#### Scenario: Existing project loads as detached data
- **WHEN** the first headless owner loads its Host project
- **THEN** it receives the decoded project value without mounting or constructing a React Surface

#### Scenario: Known-field edit is durably saved
- **WHEN** the caller changes the fixture project's name and update timestamp and passes that project to save
- **THEN** the durable record reflects both known-field changes before save resolves

#### Scenario: A second owner reopens the edit
- **WHEN** the first owner is disposed and a second owner over the same store loads the same project
- **THEN** the second owner observes the saved edit rather than the seeded value or an in-memory cache artifact

#### Scenario: Missing project remains explicit
- **WHEN** the Host project ID has no durable record
- **THEN** load resolves to `null` without creating a replacement project, navigating, or mounting UI

#### Scenario: Cross-project save is rejected
- **WHEN** a caller asks an owner to save a project whose metadata ID differs from the Host project ID
- **THEN** save rejects before writing either project

### Requirement: Full and headless sessions share one migration gate
Both session factories MUST run one React-free, once-per-store migration gate before project data or a full editor is loaded, preserving the existing diagnostics, failure, concurrency, and retry semantics.

#### Scenario: Full and headless creation join one in-flight migration
- **WHEN** full and headless factories concurrently use the same store while migration is pending
- **THEN** both await one migration promise and neither proceeds to project/editor load early

#### Scenario: Two headless owners join one in-flight migration
- **WHEN** two headless factories concurrently use the same store
- **THEN** the store migration runs once and both factories observe its terminal result

#### Scenario: Different stores migrate independently
- **WHEN** headless owners use two distinct store identities
- **THEN** each store runs its own migration without sharing a memo entry

#### Scenario: Failed migration blocks creation and can retry
- **WHEN** a store reports a failed migration and a later creation attempt is made after the failure is corrected
- **THEN** the first factory rejects with the preserved migration failure identity and the later attempt reruns migration rather than inheriting a poisoned memo

#### Scenario: Existing full-session migration events do not drift
- **WHEN** the shared gate is exercised by the full session factory
- **THEN** migration started, progress, finished or failed diagnostics retain their accepted payload and ordering

### Requirement: The headless path uses only the non-browser store
Headless acceptance MUST use the C5 in-memory `ProjectStore` implementation and SHALL NOT instantiate, fall back to, or access browser persistence, filesystem persistence, network persistence, or UI navigation.

#### Scenario: Store identity is non-browser and explicit
- **WHEN** either Host headless fixture starts
- **THEN** its result identifies the in-memory store and rejects an absent, browser, or fallback store identity

#### Scenario: Throwing browser globals remain untouched
- **WHEN** the isolated headless entry is imported and run in a Node test with throwing `document`, `window`, IndexedDB, and OPFS sentinels where supported
- **THEN** load, save, dispose, and reopen complete without reading those globals

#### Scenario: No production Host fallback can pass
- **WHEN** a headless adapter silently replaces its intended store or Host with a default
- **THEN** runtime evaluation fails before editing acceptance

### Requirement: Opaque provider data and attachments survive the round trip
Saving a known project edit through the headless owner MUST preserve unknown provider-private project fields and MUST NOT alter, remove, or recreate unrelated attachment data.

#### Scenario: Unknown nested project data is preserved
- **WHEN** the seeded durable project contains an unknown nested sentinel and the known project fields are edited and saved
- **THEN** the reopened durable record contains an equivalent sentinel at the same provider-private location

#### Scenario: Attachment body remains byte-identical
- **WHEN** the seeded project has an attachment and only project data is edited
- **THEN** the attachment body digest after both owners dispose equals the seeded digest

#### Scenario: Attachment metadata remains equivalent
- **WHEN** the project is saved and reopened headlessly
- **THEN** the unrelated attachment's key, schema version, and opaque metadata remain equivalent

#### Scenario: Headless disposal does not delete durable data
- **WHEN** every headless owner has been disposed
- **THEN** the project and attachment still exist in the store and can be read by a fresh coordinator or owner

### Requirement: Headless ownership is serialized, terminal, and resource-free
The headless owner MUST serialize admitted data operations, make disposal idempotent and terminal, and SHALL NOT acquire the C6 UI session's timer, Worker, audio-context, object-URL, compositor, or shared-GPU owners.

#### Scenario: Dispose waits for an admitted save
- **WHEN** dispose races a save that was admitted first
- **THEN** disposal waits for the durable save outcome before destroying coordinator state

#### Scenario: Concurrent dispose joins one terminal run
- **WHEN** dispose is called more than once concurrently or sequentially
- **THEN** every caller observes the same terminal outcome and coordinator destruction runs once

#### Scenario: Post-dispose operations reject
- **WHEN** load or save is requested after disposal admission has closed
- **THEN** the operation rejects without touching the store

#### Scenario: One headless owner does not corrupt another
- **WHEN** two owners use the same store and one is disposed
- **THEN** the other owner and the store remain usable and its data operations retain ordering

#### Scenario: No C6 live resource class is acquired
- **WHEN** a complete headless round trip is observed
- **THEN** no timer, Worker, audio context, object URL, compositor handle, shared GPU lease, React root, or full editor core is created by the headless owner

### Requirement: Vite emits and executes a dedicated headless artifact
The Vite Host MUST produce a fresh single-purpose headless artifact whose exact emitted application closure and runtime result are attributable to one entry, accepted base, unique marker, output digest, and in-memory store fixture.

#### Scenario: Fresh Vite runtime proves the round trip
- **WHEN** the dedicated Vite headless artifact is freshly built and run in an isolated browser context
- **THEN** its structured result proves load, actual edit, durable save, first-owner disposal, second-owner reopen, opaque and attachment preservation, and zero React mounts

#### Scenario: Vite graph is tied to the executed artifact
- **WHEN** the Vite runtime result and module graph are evaluated
- **THEN** their entry, marker, base HEAD/tree, emitted files, and canonical digests identify the same fresh output

#### Scenario: Ordinary Vite Host remains independent
- **WHEN** C7 verification runs the ordinary Vite production build and Host/storage/runtime gates
- **THEN** they execute separately from the headless artifact and retain production Host and browser-store behavior

#### Scenario: Vite output cannot be reused across controls
- **WHEN** a negative-control output or stale Vite graph is supplied as clean evidence
- **THEN** marker, directory, entry, or digest validation rejects it

### Requirement: Next emits and executes a dedicated per-entry headless artifact
The Next Host MUST produce a fresh headless adapter and a module closure rooted at its exact emitted application entry; an aggregate route/file/source-map inventory without per-entry dependency reachability SHALL NOT satisfy this requirement.

#### Scenario: Fresh Next runtime proves the round trip
- **WHEN** the dedicated Next headless artifact is freshly built, served, and requested
- **THEN** its structured result proves the same semantic round trip as Vite with an independent Next marker, build identity, output, and process

#### Scenario: Next closure starts at the exact application root
- **WHEN** the Next graph is collected
- **THEN** the named headless application module exists exactly once, is assigned to emitted output, and every reported module is reachable from that root through emitted build dependency edges

#### Scenario: Aggregated zero-React inventory is insufficient
- **WHEN** a collector reports no React IDs but cannot prove the exact root, emitted closure, and required application modules
- **THEN** the checker rejects the inventory as vacuous rather than reporting a clean boundary

#### Scenario: Ordinary default Next build remains independent
- **WHEN** C7 verification runs the normal fresh Next production build and Host/storage/runtime gates
- **THEN** they retain their default build mode and production behavior independently of any proof-only graph instrumentation

#### Scenario: Next and Vite evidence cannot substitute for each other
- **WHEN** one Host's graph, result, marker, or digest is copied into the other Host's evidence
- **THEN** Host and attribution validation fails

### Requirement: The emitted closure contains the real headless implementation
Before evaluating forbidden modules, the shared graph checker MUST prove that each Host inventory is non-empty, complete, exact-entry attributable, and contains the critical modules that perform the accepted operation.

#### Scenario: Critical closure roots are present
- **WHEN** an ordinary Host graph is checked
- **THEN** it contains the isolated headless export/factory, shared migration gate, persistence coordinator, project codec/opaque overlay path, Host/store contract, in-memory store, and semantic fixture entry

#### Scenario: Empty or truncated graph fails closed
- **WHEN** the module list is empty, malformed, count-mismatched, or missing an emitted file/chunk/map required by its producer
- **THEN** the checker exits nonzero before reporting forbidden-module absence

#### Scenario: Unrelated entry fails closed
- **WHEN** a small React-free graph names a different entry or omits a critical root
- **THEN** the checker rejects it even though no forbidden module is present

#### Scenario: Artifact mutation invalidates attribution
- **WHEN** an emitted file, graph field, canonical module set, accepted base, or build marker changes after collection
- **THEN** digest or identity validation rejects the evidence

### Requirement: React-family dependencies are mechanically absent from the emitted closure
The shared checker MUST inspect normalized emitted module IDs, not source text, and SHALL reject any React-family dependency or React-bearing UI composition reachable from the headless entry.

#### Scenario: Clean Vite closure contains no React family
- **WHEN** the attributable Vite headless closure passes anti-vacuity checks
- **THEN** no `react`, `react-dom`, JSX runtime, React server runtime, React alias/virtual/query variant, provider, Surface, full session barrel, or `EditorCore` module is present

#### Scenario: Clean Next closure contains no React family
- **WHEN** the attributable Next headless application closure passes anti-vacuity checks
- **THEN** the same React-family and React-bearing editor rules have zero matches

#### Scenario: Source grep cannot satisfy the boundary
- **WHEN** source files appear React-free but no emitted module-id closure is available
- **THEN** C7 boundary verification fails as missing evidence

#### Scenario: Normalization cannot hide a forbidden dependency
- **WHEN** a forbidden ID uses Windows separators, case variation, a package-manager path, query suffix, alias, or virtual-module form
- **THEN** normalization retains enough identity for the applicable React rule to fail

### Requirement: Each Host proves React-detection sensitivity with the same path
Vite and Next MUST each run a fresh negative build of the same named headless entry with a deliberate React dependency injected through the proof configuration, and the ordinary collector/checker MUST identify that dependency.

#### Scenario: Vite React injection is detected
- **WHEN** the Vite proof entry is freshly built with the React-control alias enabled
- **THEN** the shared checker exits nonzero and names the forbidden React module and rule

#### Scenario: Next React injection is detected
- **WHEN** the Next proof entry is freshly built with the React-control alias enabled
- **THEN** the per-entry collector includes the reachable React dependency and the shared checker exits nonzero naming it

#### Scenario: Broken control is not sensitivity evidence
- **WHEN** a control fails to build, omits the injected module, uses a different root, or crashes before the checker evaluates it
- **THEN** the control is invalid and cannot establish React-detection sensitivity

#### Scenario: Accepted clean output is rebuilt after controls
- **WHEN** all negative builds have demonstrated sensitivity
- **THEN** each Host produces a new clean artifact in a distinct validated output directory before acceptance

### Requirement: Runtime evidence is truthful and independently attributable
The Host evaluator MUST require structured evidence of the actual semantic transition and reject stale, copied, fallback, incomplete, or aspirational results.

#### Scenario: Runtime result proves an actual edit and reopen
- **WHEN** a Host result is evaluated
- **THEN** it contains distinct seeded and saved values, first and reopened digests, two owner identities, store identity, disposal outcomes, opaque/attachment digests, and no unhandled error

#### Scenario: React mount absence is observed, not inferred
- **WHEN** the Vite browser or Next server headless fixture completes
- **THEN** the evidence reports zero React root/Surface mount attempts and the graph independently proves React-family absence

#### Scenario: Unique process and build ownership is recorded
- **WHEN** a Host harness starts and finishes
- **THEN** it records unique marker/build ID, output path, port/PID where applicable, exact base, cleanup outcome, and artifact digests without exposing environment secrets

#### Scenario: Owned cleanup runs on failure
- **WHEN** a positive or negative Host run throws
- **THEN** its harness terminates only recorded processes, releases owned ports, preserves diagnostic evidence, and still returns nonzero

### Requirement: C3 through C6 invariants and ordinary Host behavior remain protected
C7 verification MUST preserve the accepted session isolation, runtime-provider, asset/Worker, persistence, browser durability, resource-disposal, parity, type, provenance, and failure-identity obligations from every earlier S02 child.

#### Scenario: Full session behavior survives migration extraction
- **WHEN** existing full-session lifecycle and migration suites run
- **THEN** session creation, Host generation, isolation, mounting, suspension, resumption, disposal, and diagnostics retain accepted behavior

#### Scenario: Production browser storage remains durable
- **WHEN** the ordinary Vite and Next C5/C6 Host gates run
- **THEN** each uses its authorized production Host and `BrowserProjectStore`, and durable data survives UI session disposal

#### Scenario: Runtime and resource invariants remain green
- **WHEN** C3 graphics, C4 asset/Worker/degraded-renderer, and C6 resource/leak positive and negative gates run
- **THEN** they retain their accepted backend, ownership, allocation, release, and sensitivity results

#### Scenario: Protected identities remain equal
- **WHEN** final protected port/session/parity/type/Rust/generated identities are compared with the pre-edit record
- **THEN** every protected value is exactly equal

#### Scenario: Regression identity does not grow
- **WHEN** fresh builds, type verification, focused suites, and the full Bun suite run on the final child
- **THEN** no diagnostic, loader error, placement failure, or other red identity exists beyond the exact inherited baseline reproduced before editing

### Requirement: Verification, delivery, integration, and archive remain distinct
The change MUST map all existing and new capability assertions to executed evidence, obtain clean independent review, and keep product implementation, local ship, integration/spec sync, and archive as separate role-isolated stages.

#### Scenario: Complete capability corpus is swept both ways
- **WHEN** final verification reviews the fourteen inherited main specs and the new headless-editing delta
- **THEN** it records every existing assertion the diff could falsify and an executed evidence mapping for every added scenario

#### Scenario: Planning does not masquerade as execution
- **WHEN** proposal, design, specification, tasks, and planning audit are complete
- **THEN** implementation, runtime, negative-control, and regression tasks remain unchecked until their commands actually run

#### Scenario: Independent review closes material findings
- **WHEN** a non-author Sol reviewer examines the artifacts, product diff, emitted graphs, runtime evidence, controls, and regression record
- **THEN** no Blocker or Major remains open and accepted fixes receive focused re-review

#### Scenario: Luna ship is a separate leaf
- **WHEN** implementation verification and review are complete
- **THEN** a Luna-xhigh shipper may create only the verified local child commit and records its commit/tree without integrating or archiving

#### Scenario: Integration evidence is fresh
- **WHEN** LEAD integrates the child onto the portfolio base
- **THEN** conflict-sensitive headless, graph, migration, Host, storage, resource, type, and suite gates run on the integrated identity rather than reusing child evidence

#### Scenario: Archive follows accepted spec sync
- **WHEN** integration is accepted and the headless-editing main spec has been synced and strict-validated
- **THEN** a different Luna-xhigh archive leaf may archive the change with complete evidence and no aspirational scenario marked verified
