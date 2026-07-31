# developer-reproducibility Specification

## Purpose
TBD - created by archiving change s01-vite-portability-baseline. Update Purpose after archive.
## Requirements
### Requirement: A documented path takes a clean checkout to a running production build

The repository SHALL document a command sequence that installs the pinned toolchain, builds the
Vite example, serves its production output and runs the smoke check.

The sequence SHALL include building the wasm artifact from `rust/`, in its required position
**before** dependency installation, because the editor's `opencut-wasm` dependency resolves to that
build output rather than to a package registry. The Rust and `wasm-pack` toolchain is therefore a
required prerequisite of the developer path, not an optional correspondence check.

#### Scenario: Documented commands work from a clean checkout

- **WHEN** a developer follows the documented steps in a checkout with no prior build artifacts and
  no installed dependencies
- **THEN** install, build, serve and smoke all succeed without an undocumented manual step

#### Scenario: The wasm build is a documented, ordered step

- **WHEN** a developer reads the setup instructions
- **THEN** the wasm build appears as a required step, before dependency installation, with the
  command that performs it
- **AND** the instructions state where the Rust build directory is placed, so it does not land on a
  volume the developer did not choose

#### Scenario: Required toolchain versions are stated

- **WHEN** a developer reads the setup instructions
- **THEN** the required bun, Node, Rust and wasm-pack versions are stated explicitly, with Rust and
  wasm-pack stated as required rather than optional

#### Scenario: An incomplete wasm build fails with an actionable message

- **WHEN** dependency installation is attempted with the wasm build output present but incomplete —
  the state a failed or interrupted build leaves behind, because the packaging tool writes the
  package manifest before the binary
- **THEN** installation fails with a message naming the missing artifact and the command that
  produces it

#### Scenario: The limit of that guard is recorded rather than overstated

- **WHEN** dependency installation is attempted with no wasm build output present at all
- **THEN** the package manager's own unresolved-specifier error is what surfaces, because
  dependency resolution precedes any repository-controlled install hook
- **AND** the documentation records this limit, so the ordered developer path is understood as the
  thing that prevents it rather than a guard being credited with a case it does not cover

### Requirement: The developer path does not require Elftia

The instructions SHALL be completable without Elftia installed, running, or referenced.

#### Scenario: No Elftia dependency in the developer path

- **WHEN** the instructions and the example's manifests are reviewed
- **THEN** no step, dependency or configuration value requires Elftia

### Requirement: The parity scenario is runnable by a new developer

A developer following the documentation SHALL be able to run the parity scenario and read its
results.

#### Scenario: Parity scenario runs from a documented command

- **WHEN** a developer runs the documented parity command against the served production build
- **THEN** the scenario executes and reports pass or fail per step, and writes its snapshot and
  captures to a documented location

### Requirement: Known deviations are inspectable

The documentation SHALL point a developer at the recorded deviations from the pinned Classic
baseline.

#### Scenario: Deviations are discoverable from the entry documentation

- **WHEN** a developer reads the example's entry documentation
- **THEN** it links to the patch log, the deviation report and the per-feature handling record for
  degraded features

### Requirement: The distributable export surface is inventoried

The change SHALL record what the example consumes from the editor source, so the surface a future
package boundary must cover is known.

#### Scenario: Export inventory exists

- **WHEN** a reviewer opens the export inventory
- **THEN** it lists the modules and symbols the Vite example imports from the editor source, and
  notes any dependency that had to be declared explicitly rather than resolving through the
  workspace
