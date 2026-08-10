## ADDED Requirements

### Requirement: Project metadata updates are typed end-to-end transactions

The transaction contract SHALL add `ProjectPatch = Partial<Pick<Project, "name" | "frameRate" | "canvasWidth" | "canvasHeight">>` and `UpdateProjectOperation = { readonly kind: "update-project"; readonly projectId: ProjectId; readonly patch: ProjectPatch }` as the twelfth member of the closed `TransactionOperation` union. The in-memory reference implementation, durable engine, Draft workflow, concrete UI routing, and Agent evidence MUST process this operation through the existing typed evaluator and commit protocol; they MUST NOT infer Project changes from assets or clips, accept a hidden companion delta or generic/provider-private payload, mutate public Project state inside an adapter, perform a second legacy save, or widen the engine/document-adapter interface or `ProjectStore`.

#### Scenario: The closed operation inventory exposes one Project update

- **WHEN** a caller inspects the public operation types and `supportedOperations()`
- **THEN** `update-project` accepts a `ProjectId` plus a patch limited to `name`, `frameRate`, `canvasWidth`, and `canvasHeight`, with no `id`, donor settings object, or generic payload
- **AND** the complete advertised inventory contains exactly twelve operation kinds including `update-project`

#### Scenario: The operation targets the selected non-null Project

- **WHEN** `update-project` is evaluated against a document with no Project or with a Project whose `id` differs from `projectId`
- **THEN** evaluation rejects with an attributable structured not-found failure at that operation index
- **AND** no Project/entity content, revision, idempotency entry, save, or watcher output changes

#### Scenario: Patch keys and the resulting Project are validated

- **WHEN** an untrusted Project patch contains `id`, a provider-private or otherwise undeclared own key, a symbol key, an empty name, a non-finite or non-positive canvas dimension, or a frame rate whose numerator/denominator are not positive integers or do not produce positive integer ticks per frame at 120,000 ticks/sec
- **THEN** the same evaluator used by apply, validation, dry-run, and Draft savepoints rejects the operation with an attributable validation issue
- **AND** the selected Project ID and every unpatched field remain unchanged

#### Scenario: Empty and same-value Project patches have distinct semantics

- **WHEN** a caller submits `update-project` with an empty patch
- **THEN** the operation is rejected without `changedIds`, revision, save, idempotency reservation, or watcher output
- **AND WHEN** a caller submits a non-empty patch whose declared values already equal the selected Project
- **THEN** the operation succeeds like the existing typed update operations, includes `projectId` in `changedIds`, adds nothing to `createdIds`, and produces one normal revision/save/watch transition

#### Scenario: A changed Project patch commits once and survives reopen

- **WHEN** a valid `update-project` changes one or more public fields and the durable save succeeds
- **THEN** the result includes `projectId` in `changedIds`, the persisted revision increments exactly once, `ProjectStore.save` runs exactly once, and transaction watchers fire exactly once after durability
- **AND** open-engine reads, the encoded record and summary, unrelated opaque data, and a reopened engine all expose the same updated Project

#### Scenario: Project patches participate completely in idempotency

- **WHEN** a keyed Project update is replayed with the same operation and patch but different object-property insertion order
- **THEN** the canonical fingerprint recognizes it as the same request and returns the original result without another save, revision, or watcher notification
- **AND WHEN** the same key is reused with any different Project patch
- **THEN** it is rejected as `TransactionError { code: "duplicate" }` without changing the committed Project

#### Scenario: Validation and dry-run are pure Project projections

- **WHEN** a valid or invalid Project update is passed to `validate` or `dryRun`
- **THEN** both methods use the same final-document evaluator and report the same Project result or structured rejection that apply would produce on that base revision
- **AND** neither method saves, reserves an idempotency key, increments revision, changes subsequent reads, or notifies watchers

#### Scenario: Frame-rate changes validate the complete final placement

- **WHEN** a Project frame-rate patch would leave any final clip time field or marker time misaligned to the new integer ticks-per-frame grid
- **THEN** validation, dry-run, Draft evaluation, and apply reject the batch atomically without implicitly retiming content
- **AND WHEN** typed clip or marker operations in the same ordered batch leave the complete final document valid on the new grid
- **THEN** the Project and placement repairs may commit together as one revision and one save

#### Scenario: Drafts classify, review, and roll back Project patches

- **WHEN** a Draft stages a valid `update-project`, alone or in the same tool call as other typed project-content operations
- **THEN** the exhaustive runtime register classifies it as Draft-safe, the private savepoint and review journal include `projectId` and the twelfth per-kind count, and a rejected call restores the exact prior working Project and journal
- **AND** non-stale approval flattens the Project operation with the journal into one parent-engine apply while stale approval remains a no-rebase conflict

#### Scenario: Project compensation is minimal and policy-closed

- **WHEN** an approved Draft changes any subset of the four patchable Project fields
- **THEN** its compensating batch contains one `update-project` inverse with only the changed fields' base pre-images, regardless of document collection size
- **AND** that inverse composes with other minimal repairs, is evaluated through the same final-document/provider-policy compensation preflight, and one non-stale undo restores the exact base Project

#### Scenario: UI settings routing preserves the public-private honesty boundary

- **WHEN** a routed settings command changes public Project fields only or changes them together with donor-private settings
- **THEN** projection emits exactly one typed `update-project` sibling for the public delta, retains owned private data only in the explicit staged donor candidate, and proves exact donor/engine public equality before the single save
- **AND WHEN** the command changes donor-private settings only
- **THEN** it remains an explicit provider-private gap and does not submit a no-op transaction, hidden delta, generic payload, or second save

#### Scenario: First-image canvas behavior is one durable root with baseline undo ownership

- **WHEN** established first-image insertion changes a new Project from 1920x1080 to the fixture's 320x180 canvas
- **THEN** the canvas patch and public asset/clip work commit through one root apply/save/revision/watch/history publication, and engine reads, live donor state, persisted record, persistence cache, and reopen all report 320x180
- **AND** a failed save leaves every surface at 1920x1080, while successful command undo preserves the baseline history policy that the nested `pushHistory: false` canvas change is not reversed

#### Scenario: Corrected UI routing retains audited parity safeguards

- **WHEN** T3 resumes after consuming the reviewed Project-operation correction
- **THEN** public fps/canvas mutations are no longer discarded, explicit routing identities remain stable under production minification, audio track projection still normalizes missing `hidden` to `false`, exact donor/engine equality remains mandatory, and transaction publication still causes no duplicate legacy save
- **AND** normalized before-routing versus after-routing behavior is compared on each Host separately from Vite-versus-Next equality, so a shared regression cannot pass as parity

#### Scenario: Agent evidence exercises the twelfth operation without inference

- **WHEN** T4 publishes transaction vectors and runs its third-party Agent scenario
- **THEN** the vectors advertise all twelve kinds and the Agent performs at least one typed Project patch, observes one revision/save/watch result, and verifies save/reopen Project equality
- **AND** same-key replay is mutation-free, same-key/different-patch reuse is rejected, and no donor inference or provider-private command is required
