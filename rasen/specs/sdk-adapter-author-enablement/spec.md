# sdk-adapter-author-enablement Specification

## Purpose
TBD - created by archiving change sdk-ecosystem-enablement. Update Purpose after archive.
## Requirements
### Requirement: The adapter-author guide is sufficient from packed tarballs

The repository SHALL provide an adapter-author guide that starts from unmodified SDK tarballs,
materializes a project outside the repository and every Temp path, installs packages through
`file:` dependencies with no workspace links, identifies the port and conformance factory seams
an author implements, runs all five conformance surfaces, and explains the `0.x` surface classes.
The guide SHALL claim no registry publication or registry-specific behavior.

#### Scenario: A new author follows the tarball-only path

- **WHEN** an author follows only the guide's supported setup command from a clean checkout
- **THEN** four freshly packed artifacts are staged into a repository-external project and every
  installed SDK package is a real directory copy resolved from a `file:` tarball
- **AND** no dependency or lockfile entry resolves through `workspace:` or a repository link

#### Scenario: The guide explains ownership and compatibility

- **WHEN** the author chooses which scaffold modules to replace
- **THEN** the guide distinguishes author-owned ports, ProjectStore, transaction target, and
  conformance factories from OpenCut reference or fixture infrastructure
- **AND** every consumed public entry is documented with its `frozen`, `provider`, or
  `experimental` class and the inherited `0.x` consequence

### Requirement: A copyable adapter scaffold passes all five conformance surfaces

A committed adapter project scaffold SHALL be derived from P3's conforming flat-JSON-tuple
adapter, SHALL consume packages only through declared entries, and SHALL execute the ports,
transaction, engine, draft, and vectors conformance surfaces against its author-owned adapter
seams. Its supported materialization SHALL install freshly packed tarballs rather than workspace
packages, and its failures SHALL be formatted requirement first.

#### Scenario: The scaffold passes from a scratch install

- **WHEN** the scaffold runner materializes the project into a fresh marked scratch root,
  installs the staged tarballs, type-checks it, and executes its declared run entries
- **THEN** ports, transaction, engine, draft, and vectors each report a passing non-zero case
  population
- **AND** the process exits zero only when every exercised surface passes

#### Scenario: The scaffold proves the author's adapter

- **WHEN** the five suite invocations are inspected
- **THEN** the ports suite receives the scaffold's own roles and store, the transaction suite
  receives its own transaction target, and the remaining suites open over stores created by the
  scaffold
- **AND** a passing reference fake alone is not accepted as proof that the scaffold conforms

#### Scenario: A failure is requirement-first

- **WHEN** a documented failure demonstration runs a deliberately non-conforming seam
- **THEN** the output names the frozen requirement, case, and detail in that order
- **AND** the author is not instructed to diagnose the failure from an internal package stack
  trace

### Requirement: Adapter-author contract fakes are public and honestly classified

The contracts package SHALL expose a declared adapter-author fakes entry that assembles the
existing frozen engine, draft, and vector conformance factory interfaces over an author-supplied
fresh `ProjectStore`. The entry SHALL hide fixture-only implementation details, SHALL NOT
re-export internal vector drivers or private committed-state capture, and SHALL be classified and
marked `experimental` under the existing surface-label policy.

#### Scenario: An installed author imports the fake assembly

- **WHEN** the scaffold imports the fakes entry from an installed contracts tarball and supplies
  a factory for its own ProjectStore
- **THEN** it receives engine, draft, and vector factories compatible with the existing frozen
  conformance runners
- **AND** each factory/open obtains isolated state while engine reopen remains on its fixture's
  original store

#### Scenario: The fake surface stays narrow

- **WHEN** the fakes entry's exports are inspected
- **THEN** its interface accepts the author store factory and returns only the existing suite
  factory shapes plus the minimum named result type
- **AND** it exposes no vector-driver control, private engine capture, clock, filesystem path,
  registry setting, or parallel replacement for the already-public ports and transaction fakes

#### Scenario: The entry is classified at birth

- **WHEN** package exports, `surface.json`, and the entry source are checked
- **THEN** the declared entry, experimental classification with forcing reason, and exactly one
  matching `@opencutSurface experimental` marker agree
- **AND** the checker census grows by one non-empty contracts entry while both negative and
  converse controls remain green

### Requirement: Every documented executable step runs in CI

Every executable command in the adapter-author guide SHALL carry a stable command identifier and
map to a step exercised by the committed author runner. The existing `sdk-examples` CI job SHALL
run the author runner on Ubuntu with a `$HOME` scratch root, after building the self-sourced wasm
artifact, and SHALL publish nothing.

#### Scenario: Guide and runner commands cannot drift

- **WHEN** the guide-command check compares documented command identifiers with the author
  runner's executed step identifiers
- **THEN** every documented command has exactly one executed step and every author-facing runner
  step is documented
- **AND** an added prose command without an execution mapping fails the check

#### Scenario: CI executes the scaffold end to end

- **WHEN** the `sdk-examples` job runs for the change
- **THEN** it builds wasm through the repository build script and executes the author runner with
  a scratch root under `$HOME`
- **AND** the job observes the same tarball install controls, typecheck, five-suite populations,
  and exit rules as the local run

### Requirement: An independent author reproduces the documented result

Completion SHALL include an independent blind test by an agent that did not author the guide or
scaffold. The verifier SHALL receive the guide and scaffold entry point as its task context,
materialize a fresh project under a distinct scratch root, run the documented path, identify the
customization seams, and interpret a structured conformance failure. The transcript and any
corrective rerun SHALL be committed as evidence with real exit codes and population counts.

#### Scenario: Guide-only blind test succeeds

- **WHEN** the independent verifier follows the guide without relying on implementation notes or
  repository-internal test paths
- **THEN** the materialized scaffold passes all five conformance surfaces from tarballs and the
  verifier correctly identifies which modules an adapter author replaces
- **AND** the evidence records non-zero suite populations and self-logged zero exit codes

#### Scenario: Blind-test ambiguity is corrected and rerun

- **WHEN** the verifier encounters an ambiguous, missing, or unexecuted instruction
- **THEN** the author updates the guide or scaffold rather than coaching around the defect
- **AND** the independent verifier reruns the affected path before completion is claimed
