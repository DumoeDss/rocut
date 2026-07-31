## MODIFIED Requirements

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
