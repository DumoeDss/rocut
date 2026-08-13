## ADDED Requirements

### Requirement: A versioned wire-safe transaction vector corpus is published

The system SHALL publish a conformance-vector corpus as committed data under `apps/web/src/editor/contracts/vectors/`, carrying an explicit schema identifier and version in every file. Every published value MUST be wire-safe: `MediaTime` as a non-negative integer tick count, identities as strings, operation kinds and error codes as members of the contract's closed unions, and no branded type, TypeScript-only construct, function, or module reference at rest. The corpus SHALL declare exactly two families — document vectors carrying an explicit initial document with one batch and its expected result or structured rejection, and scenario vectors carrying an ordered step plan whose expectations are relative to the target's own starting document. A manifest SHALL record every corpus file, its SHA-256, the declared vector count, and a corpus digest; a corpus file whose bytes do not match the manifest MUST fail to load.

#### Scenario: The corpus is self-describing and versioned

- **WHEN** a consumer parses any published corpus file with a plain JSON parser
- **THEN** it reads the schema identifier, the corpus version, the family of every vector, and a stable vector id for every vector
- **AND** no value requires a contract constructor, branded type, or module import to interpret

#### Scenario: Manifest drift fails to load

- **WHEN** a corpus file is edited without regenerating the manifest, or the manifest declares a vector count different from the files present
- **THEN** loading rejects with a structured drift failure naming the offending file
- **AND** no vector from that corpus is reported as passing

#### Scenario: A vector with no expectation is a load error

- **WHEN** a corpus contains a vector whose expectation set is empty or whose step plan asserts nothing
- **THEN** loading rejects that corpus
- **AND** the vector is not admitted as a skipped or passing case

#### Scenario: Non-wire-safe values are rejected

- **WHEN** a corpus contains a non-integer tick value, a non-finite number, an unknown operation kind, or an unknown error code
- **THEN** loading rejects with a structured validation failure identifying the vector id and the offending field

### Requirement: Vector coverage is derived from the frozen contract surface

Coverage SHALL be computed by comparing the parsed corpus against the contract's own exported operation-kind constant, exported transaction error codes, and exported engine issue codes — never against a list restated inside the vectors module or inside the corpus. A kind or code the contract exports for which no vector exists SHALL fail the corpus gate, naming the uncovered member. The coverage gate MUST NOT require an exact count match between corpus and contract, so that additional vectors covering the same member remain permitted.

#### Scenario: Complete coverage of the advertised surface passes

- **WHEN** the coverage gate runs over the published corpus
- **THEN** it reports every exported operation kind, every transaction error code, and every engine issue code as covered by at least one vector
- **AND** it names the vector ids providing each member's coverage

#### Scenario: A missing kind fails coverage

- **WHEN** the gate runs over a control corpus with every vector covering one operation kind removed
- **THEN** the gate fails and names that operation kind as uncovered

#### Scenario: The gate reads the contract, not the corpus

- **WHEN** the gate runs against a control in which the contract's exported constant set carries one synthetic additional member
- **THEN** the gate fails for that synthetic member
- **AND** the failure proves the gate derives its expectation from the contract rather than from the corpus's own self-description

#### Scenario: Redundant vectors do not fail the gate

- **WHEN** the corpus contains more than one vector covering the same operation kind or error code
- **THEN** the gate still passes, because coverage is a lower bound rather than an exact-count equality a contributor would have to hand-maintain

### Requirement: A published vector runner proves conformance without this repository's test runner

The system SHALL publish `runTransactionVectors` as a plain async function that accepts a parsed corpus and a target factory and returns a report with per-vector `passed`, `failed`, `skipped`, or `unsupported` status, an executed-comparison count per vector, and the coverage report. The runner MUST NOT require React, Electron, a Host port, a test framework, or file-system access. An empty corpus, a filter matching no vector, an executed count below the declared count, or a vector that performed no comparison SHALL be reported as a failure rather than a pass. A target that cannot accept a seeded document SHALL report that entire family as `unsupported`, and a run containing an `unsupported` family MUST NOT report an overall `passed` verdict for that family.

#### Scenario: The runner is green against the reference implementations

- **WHEN** the runner executes the published corpus against the in-memory transaction store and against a durable engine opened over the in-memory `ProjectStore`
- **THEN** every applicable vector passes, the executed count equals the declared count, and every executed vector performed at least one comparison

#### Scenario: An empty or fully filtered run is refused

- **WHEN** the runner is invoked with an empty corpus or with a filter that matches no vector
- **THEN** it reports a refused-empty-scan failure and does not return a passing verdict
- **AND WHEN** a filter matches exactly one vector
- **THEN** that vector runs, reports its own comparisons, and may pass

#### Scenario: The mutation matrix proves each vector can fail

- **WHEN** the runner executes the corpus against deliberately non-conforming targets that respectively return a stale revision, apply a batch non-atomically, ignore the idempotency key, notify watchers on a rejected apply, return uncloned internal state, and waive a base placement rule
- **THEN** each target fails exactly the declared set of vector ids recorded for it, neither fewer nor more
- **AND** the report names each failing vector with a detail string describing the mismatch

#### Scenario: A conforming variant is not over-constrained

- **WHEN** the runner executes the corpus against a conforming implementation that returns changed identities in a different order, includes additional optional fields, and stores state differently from the reference
- **THEN** every vector passes
- **AND** no vector fails on a detail the contract does not require

#### Scenario: A non-seedable target reports an unsupported family

- **WHEN** the runner executes the corpus against a target that cannot be opened over a supplied initial document
- **THEN** the document-vector family is reported `unsupported` as a whole and the run verdict is not `passed` for that family
- **AND** individual document vectors are not silently reported as skipped or passed

### Requirement: Published vectors carry no provider identity

The committed transaction boundary check SHALL scan published vector data in addition to contract modules, and SHALL reject any donor schema field name, command-class name, editor state-store name, Zustand identifier, IndexedDB or OPFS identifier, provider-namespaced key, or physical storage path appearing in a vector key or value. The check MUST include a negative control materialising a fixture violating each new rule, a converse control proving the rules do not fire on the contract's public vocabulary, and a refusal to report a pass when it matched zero corpus files.

#### Scenario: The extended check passes over the published corpus

- **WHEN** the transaction boundary check runs after the vectors are added
- **THEN** it reports the number of contract modules and corpus files scanned, both non-zero, and zero violations

#### Scenario: Each data rule is proven able to fail

- **WHEN** the check runs with its negative control
- **THEN** a fixture vector carrying a donor schema field name, one carrying an object-store or database identifier, one carrying a provider-namespaced private key, and one carrying a storage path are each caught by their corresponding rule

#### Scenario: Public vocabulary is not caught

- **WHEN** the converse control runs vectors containing the public terms `track`, `clip`, `asset`, `marker`, and `project`, and an asset declared with a video kind
- **THEN** no rule fires
- **AND** a rule that fires on public vocabulary fails the control

#### Scenario: An empty corpus scan is a failure

- **WHEN** the extended check matches zero corpus files
- **THEN** it exits non-zero rather than reporting a clean scan

### Requirement: One Host-neutral Agent scenario drives the public automation surface

The system SHALL define one Host-neutral Agent scenario executed unchanged by every driver. The scenario SHALL create tracks, assets, and clips; move, trim, and split clips; submit at least one typed `update-project` patch; replay one keyed batch; reuse one key with a different payload; and submit one stale `expectedRevision`. It MUST use only the public typed transaction surface — no donor schema import, no command class, no direct persistence save, and no provider-private invocation. Every driver SHALL emit one machine-readable ledger recording the declared step plan and, per step, the base revision, result revision, revision delta, apply count, durable-save count, watcher count, assertion count, and verdict. A step that asserted nothing, an executed step count differing from the declared plan, or a driver that produced no ledger SHALL fail the run.

#### Scenario: The scenario runs from three drivers on one definition

- **WHEN** the scenario definition is executed against the in-memory transaction store, against a durable engine over the in-memory `ProjectStore`, and against the real session transaction facade in a Host
- **THEN** all three drivers execute the same declared step plan from the same definition
- **AND** the in-memory and durable drivers complete without React, Electron, or a browser

#### Scenario: Per-step revision movement is asserted, not narrated

- **WHEN** an accepted scenario step commits
- **THEN** the ledger records its base revision, its result revision, and a revision delta of exactly one
- **AND** the entities that step created or changed are read back and compared field by field before the next step runs

#### Scenario: Rejected steps move nothing

- **WHEN** the scenario submits a stale `expectedRevision` and, separately, reuses a key with a different payload
- **THEN** the first is rejected with a conflict carrying the expected and actual revisions and the second with a duplicate code
- **AND** the ledger records a revision delta of zero, no durable save, and no watcher notification for those steps

#### Scenario: Keyed replay is mutation-free

- **WHEN** the scenario replays an accepted batch with the same key and canonically equivalent operations
- **THEN** the original result is returned with no additional revision, durable save, or watcher notification

#### Scenario: A step that asserts nothing fails the run

- **WHEN** a control run executes a step whose assertion count is zero
- **THEN** the run reports failure for that step
- **AND** the ledger does not report the run as passed

### Requirement: Agent durability evidence is dual-Host, reopened, and non-vacuous

Both production Hosts SHALL execute the Agent scenario against the real session transaction facade over that Host's durable store, through the existing shared evidence entry, without changing either Host composition root, Host page, or entry list. After the apply phase the driver SHALL perform a full page reload and open a fresh session over the same durable store, and SHALL assert that the reopened engine reports the exact revision committed before the reload and that every entity and Project field the scenario committed is present with the committed values. A Host that did not execute, a run with fewer executed steps than declared, or a run whose reopen assertion is not bound to the observed committed revision SHALL be a failure and MUST NOT be recorded as a skip.

#### Scenario: Both Hosts execute the identical scenario

- **WHEN** the Agent evidence run completes on the Vite and Next production builds
- **THEN** each Host writes its own ledger recording the same declared step plan, its own build marker, and a non-zero assertion count for every executed step
- **AND** a missing or empty ledger from either Host fails the run

#### Scenario: Save and reopen observe the exact committed revision

- **WHEN** the page is fully reloaded after the apply phase and a fresh session opens the same project from the same durable store
- **THEN** the reopened engine reports the exact revision recorded before the reload
- **AND** the tracks, clips, assets, markers, and patched Project fields the scenario committed are present with their committed values

#### Scenario: A stale reopen expectation fails the step

- **WHEN** a control run asserts the reopen against a revision one lower than the committed revision
- **THEN** the reopen step fails
- **AND** the failure proves the assertion is bound to the observed committed value rather than to whatever the store returns

#### Scenario: An injected durable failure changes nothing and is reported

- **WHEN** a declared control step's durable save is made to reject
- **THEN** revision, reads, and watcher count are unchanged after that step
- **AND** the run reports that step as failed rather than skipping it, and a later step can still commit

#### Scenario: A delayed store does not change the verdict

- **WHEN** the same scenario runs against a deliberately delayed durable save
- **THEN** every step reaches the same verdict as the undelayed run
- **AND** the driver reached those verdicts by waiting on observable committed state rather than on fixed delays
