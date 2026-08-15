# sdk-published-examples Specification

## Purpose
TBD - created by archiving change s05-published-examples. Update Purpose after archive.
## Requirements
### Requirement: Four worked examples exist, one lesson each

The repository SHALL carry four worked examples under a top-level `examples/` directory, each an
independent project an adopter could copy whole, and each demonstrating exactly one thing:
installing the packages, embedding the Surface, supplying a custom storage implementation, and
driving the editor from an Agent through the transaction API. The examples directory SHALL NOT
be a workspace member, and no example SHALL import through a path that resolves only inside this
repository.

#### Scenario: The four examples are present as independent projects

- **WHEN** `examples/` is inspected at the ship commit
- **THEN** it contains the four example projects, each with its own manifest, tsconfig and README
- **AND** none of them is matched by the repository's workspace globs

#### Scenario: Each example demonstrates its named lesson

- **WHEN** each example's source and README are read together
- **THEN** the installing example resolves and imports from declared entries and reads the
  installed artifacts' versions and labels
- **AND** the embedding example mounts the editor Surface from the installed packages with its
  own stylesheet, assets and React dependencies
- **AND** the custom-storage example supplies its own `ProjectStore` with the published engine
  over it and runs the port conformance suite
- **AND** the agent example drives the published agent scenario through the transaction API over
  its own store with a reload-reopen durability assertion

### Requirement: Examples execute from installed tarballs outside the monorepo

A committed runner SHALL materialize each example into a scratch project outside the repository
tree, install the packed tarballs with no workspace linking, and execute the example there,
reusing the existing pack module and scratch lifecycle rather than rebuilding either. The
no-linking controls — location assertions, copy-not-link verification, and the
remove-the-install failure proof — SHALL be inherited by the examples runner, and their
re-inheritance SHALL be proven by re-running the existing conformance runner green after any
extraction shared code undergoes.

#### Scenario: Each example runs from the scratch install

- **WHEN** the runner executes an example inside the scratch project against the installed
  tarballs
- **THEN** the example's own execution entry completes with its assertions green and a
  self-logged exit code
- **AND** the run's evidence shows the no-linking controls passing for that install

#### Scenario: The shared harness extraction is behaviour-preserving

- **WHEN** the scratch lifecycle and controls are extracted for reuse
- **THEN** the pre-existing conformance runner re-runs green over the extracted code
- **AND** its control-assertion output is comparable to its pre-extraction run

### Requirement: The from-tarballs consumer view is a standing gate

The consumer-view checks SHALL exist as committed tooling executed by the examples runner on
every run: installed versions are `0.x`, the policy README ships with its anchor, the surface
manifest classifies exactly the export map's entries, and in-source markers are present in the
extracted source — with a declared-but-absent entry failing closed at any class. The standing
gate SHALL be runnable independently of the examples.

#### Scenario: The consumer view runs with every examples run

- **WHEN** the examples runner completes
- **THEN** the consumer-view checks have executed over the packed artifacts and passed
- **AND** a dangling declared entry introduced as a control fails the gate at any class

#### Scenario: The consumer view is independently runnable

- **WHEN** the consumer-view mode is invoked without running the examples
- **THEN** it packs (or consumes pre-packed tarballs), verifies the four clauses, and exits with
  its own self-logged code

### Requirement: The examples are executed in CI against installed tarballs

A CI job SHALL execute the examples runner on push, driving it entirely through its environment
seams, with the scratch root placed outside both the repository tree and any Temp directory via
environment. The job SHALL claim only what it runs: the four examples and the consumer view. The
repository's local-only static checkers SHALL NOT be claimed as CI-enforced by this change, and
the job's documentation SHALL say so.

#### Scenario: The CI job runs the runner through its seams

- **WHEN** the examples CI job executes
- **THEN** it invokes the runner with environment-provided scratch root and bun invocation
- **AND** the run's log carries per-example exit-code lines derived from the log itself

#### Scenario: The CI leg claims only itself

- **WHEN** the CI job's definition and its recorded statement are read
- **THEN** it names the four examples and the consumer view as what it executes
- **AND** it states that the local-only checkers remain local and that no OS-matrix extension or
  publish is claimed

### Requirement: Example documentation surfaces the labeled surface

Each example's README SHALL list every package entry the example imports with its surface class
and a one-line justification, and no example SHALL read the surface manifest as runtime machinery
for its own behavior — the installing example's manifest read is that example's demonstrated data
(requirement 1's own lesson), not machinery. The
custom-storage example SHALL state that its migration validation depends on an
experimental-labeled entry and that the example inherits that entry's instability, alongside the
honest pair itself: the production migration path running and recording its skip distinctly
while the migration chain is validated through the published mock entry.

#### Scenario: Consumed-surface tables name classes

- **WHEN** an example's README is read
- **THEN** every `@opencut/*` specifier the example imports appears with its class and a stated
  justification
- **AND** no example reads the surface manifest as runtime machinery for its own behavior —
  the installing example's manifest read is its demonstrated data, not machinery

#### Scenario: The custom-storage example states its experimental inheritance

- **WHEN** the custom-storage example's README is read
- **THEN** it names the experimental entry its migration validation depends on and states the
  inherited instability
- **AND** it describes the honest pair: the production path's distinct recorded skip and the
  validated chain through the published mock

### Requirement: Example non-coverage is stated

The change SHALL record what the examples do not prove, naming owners, so silence is not read as
coverage.

#### Scenario: Non-coverage is written down with owners

- **WHEN** the examples' documentation is read
- **THEN** it states that legal notice content in example files is the provenance child's to
  complete
- **AND** it states that the wasm-initialization defect is Direction-level and demonstrated, not
  repaired
- **AND** it states that no example covers the desktop Host shape, which the repository's
  electron application already covers

