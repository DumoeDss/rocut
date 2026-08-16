# self-built-wasm-artifact Specification

## Purpose
TBD - created by archiving change s02-wasm-self-built-canonical. Update Purpose after archive.
## Requirements
### Requirement: The wasm module the editor loads is built from this repository's sources

The `opencut-wasm` specifier SHALL resolve to the artifact produced by building `rust/wasm` from
this repository, in both Hosts, in development and in a served production build. A copy obtained
from a package registry SHALL NOT satisfy the specifier.

#### Scenario: The resolved package is the self-built one

- **WHEN** the wasm-source check is run after a successful install in either Host
- **THEN** every emitted file at the resolved `opencut-wasm` location has the same content as the
  corresponding file in the local build output
- **AND** the check exits non-zero if any file differs

#### Scenario: A registry copy is rejected rather than accepted silently

- **WHEN** the wasm-source check is run against a directory containing the published registry
  package instead of the local build output
- **THEN** the check reports failure
- **AND** this negative control is recorded, so a passing result is known not to be vacuous

#### Scenario: Stale build output is reported rather than consumed

- **WHEN** a source file under `rust/wasm/src` or `rust/crates/*/src` is newer than the emitted wasm
  binary
- **THEN** the check reports the output as stale and names the command that rebuilds it

#### Scenario: Both Hosts load the self-built module at runtime

- **WHEN** each Host is built for production and the parity scenario is run against the served
  output
- **THEN** the wasm module instantiates and wasm-backed time math returns correct values in both
  Hosts

### Requirement: The self-built artifact corresponds to the published package it replaces

The switch SHALL be evidenced by a comparison against published `opencut-wasm@0.2.10`, on the
artifact that is actually consumed. The correspondence criterion SHALL be equality of the exported
symbol set and of the type declaration, together with version equality. Binary hash equality of the
`.wasm` SHALL NOT be the criterion, because `wasm-pack` output is not reproducible across toolchain
versions.

#### Scenario: The consumed JavaScript export surface is identical

- **WHEN** the locally built package is compared against published `opencut-wasm@0.2.10`
- **THEN** the sorted list of symbols exported by the wasm-bindgen glue module — the surface every
  importer actually consumes — is identical between the two
- **AND** the emitted type declaration and the reported version are identical

#### Scenario: The binary's own export table is measured, not inferred from the glue

- **WHEN** the `.wasm` module's export section is parsed and compared against the published
  module's
- **THEN** the export count, the kind of each export, and the set of stably-named exports are
  identical
- **AND** any export name that differs is shown to differ only in a compiler-generated symbol hash,
  with the name identical once that hash is stripped, and is attributed to that cause
- **AND** the import table is compared as well, because a module that imports something new has
  changed its host contract even when its exports have not

#### Scenario: Every remaining difference is enumerated and attributed

- **WHEN** any emitted file differs from the published package
- **THEN** the record names the file, the nature of the difference, and the cause it is attributed
  to
- **AND** a difference with no named cause is a failure rather than a note

#### Scenario: Correspondence is measured on both sides of the licence addition

- **WHEN** a licence file is added to the wasm crate, which changes what the packaging tool emits
- **THEN** the comparison is performed both before and after that addition, and any manifest
  difference introduced by it is attributed to it explicitly

### Requirement: The switch changes no exported function and no editing behaviour

This change SHALL add, remove and alter no WASM export, and SHALL leave the editor's observable
behaviour unchanged. Divergence of the fork's wasm API from the published package is a later,
separately evidenced change.

#### Scenario: The export inventory is unchanged

- **WHEN** the exports of the artifact consumed after the switch are compared against those consumed
  before it
- **THEN** the JavaScript export surface is identical, and the binary's export table is identical in
  count, kind and stably-named entries
- **AND** the only differing entries are compiler-generated symbol-hash suffixes, named as such

#### Scenario: The parity fixture does not move

- **WHEN** the parity scenario is run on both Hosts against the self-built artifact
- **THEN** its snapshots are unchanged from the recorded baseline
- **AND** any movement is reported as a defect of this change rather than recorded as a result

### Requirement: The redistributed binary does not disclose the build machine

Because the built `.wasm` is now shipped to every user of the built application, it SHALL NOT embed
absolute paths identifying the machine that produced it. Source paths recorded in the binary SHALL be
remapped to stable, build-environment-independent prefixes.

#### Scenario: No build-machine identity is embedded

- **WHEN** the emitted `.wasm` is scanned for absolute filesystem paths, in both Windows and POSIX
  form
- **THEN** no path rooted at a user home directory or a checkout location is present, and no
  operating-system username is disclosed

#### Scenario: The scan is not trivially satisfied

- **WHEN** the same scan is run against the artifact built without remapping
- **THEN** it reports the paths, so a clean result is known to mean remapping happened rather than
  the scan looking for the wrong shape
- **AND** the remapped prefixes are shown to be present in the emitted binary

#### Scenario: The remapping applies wherever the artifact is built

- **WHEN** the wasm is built through the repository's documented build command, its watch loop, or
  continuous integration
- **THEN** all three route through the same build entry point, so the flags cannot differ between a
  local build and the one CI validates

#### Scenario: The absence of disclosure is enforced, not merely conventional

- **WHEN** an artifact produced by invoking the packaging tool directly, bypassing the repository's
  build entry point, is presented to the checks
- **THEN** a committed check fails on it
- **AND** that check runs in continuous integration after dependency installation, so routing every
  build through one entry point is a guarantee rather than a habit a contributor could depart from
  with every other gate still green

### Requirement: The wasm crate ships the licence it declares

A crate that declares a licence SHALL ship that licence's text, because the built package is
redistributed once it is the canonical artifact.

#### Scenario: The crate licence file is present and correct

- **WHEN** `rust/wasm/LICENSE` is compared against the repository root `LICENSE`
- **THEN** the two are byte-identical and carry the unmodified upstream MIT copyright notice

#### Scenario: The packaging tool no longer warns about a missing licence

- **WHEN** the wasm package is built
- **THEN** the build emits no warning that a licence key is set with no licence file found

### Requirement: The redistributed artifact initializes in runtimes without the WebAssembly/ESM integration

The `opencut-wasm` package SHALL be initializable by a consumer that is not a bundler. The
`--target bundler` entry initializes through `import * as wasm from "./opencut_wasm_bg.wasm"`,
which requires the host to implement the WebAssembly/ESM integration; a runtime that resolves a
`.wasm` import to an asset instead SHALL still be able to initialize the same binary. The package
SHALL therefore also ship an explicitly-instantiating entry, exposing the identical public export
set, and SHALL route to it the runtime conditions that need it. Bundler and browser consumers SHALL
keep resolving the `--target bundler` entry unchanged.

The explicitly-instantiating entry SHALL be generated from the bundler entry's own re-export block
rather than maintained by hand, so the two entries cannot come to expose different names.

#### Scenario: A non-bundler runtime initializes the artifact through its bare specifier

- **WHEN** a runtime that resolves `.wasm` imports as assets imports `opencut-wasm`
- **THEN** the specifier resolves to the explicitly-instantiating entry
- **AND** the module initializes and wasm-backed time math returns correct values

#### Scenario: Runtimes that need explicit instantiation but are not condition-routed have a declared entry

- **WHEN** a consumer cannot rely on a runtime condition of its own
- **THEN** a declared subpath resolves to the explicitly-instantiating entry
- **AND** importing it initializes the same binary with the same results as the bare specifier

#### Scenario: The two entries expose the same names

- **WHEN** the generated entries are compared
- **THEN** their re-export blocks are byte-identical
- **AND** the explicitly-instantiating entry both sets the glue's wasm handle and runs the start
  function, so an entry that resolves but never initializes is rejected

#### Scenario: Two runtimes agree on what the binary computes

- **WHEN** the same probe runs under each routed runtime
- **THEN** every probed value is equal across them
- **AND** a disagreement fails the check, because a binary that starts but answers differently per
  runtime is a defect no export-count assertion would detect

#### Scenario: The real migration chain loads without a test mock

- **WHEN** the provider's storage migration chain is imported with no module mock and no test-mock
  entry in the process
- **THEN** it loads and reports its transformers
- **AND** the transformer count equals the current project version, so a silently shortened chain
  is rejected

#### Scenario: The check is not vacuous

- **WHEN** the `--target bundler` entry is imported directly under the runtime that lacks the
  WebAssembly/ESM integration
- **THEN** it still fails with the original initialization error
- **AND** that control failing to fire is itself a failure, because it would mean the routed entry
  is no longer the thing making initialization work

#### Scenario: A condition that bundlers also claim is not routed

- **WHEN** the package's export conditions are inspected
- **THEN** no condition is routed to the explicitly-instantiating entry that a bundler targeting
  that platform would also claim
- **AND** a check rejects the addition of such a condition, because a bundler cannot serve an entry
  that reads its own binary from disk

#### Scenario: Adding export conditions does not seal previously resolvable paths

- **WHEN** any path that resolved inside the package before an `exports` map existed is resolved
  after it
- **THEN** it still resolves

### Requirement: The artifact is byte-reproducible on a pinned toolchain

The two tools that decide the emitted bytes — the Rust compiler and the wasm packaging tool — SHALL
be pinned, and the pin SHALL be asserted before a build runs rather than documented. On those pins,
two builds of the same commit SHALL produce byte-identical output for every emitted file, including
when the second build uses a different build directory at a different absolute path.

This does not contradict the existing requirement that binary hash equality is not the
correspondence criterion against the published package: that statement is about *different*
toolchain versions, and this one is about the *same* pinned one.

#### Scenario: A mismatched toolchain refuses to build

- **WHEN** a build is started with a compiler or packaging-tool version other than the pinned ones
- **THEN** the build refuses before producing an artifact and names the commands that install the
  pins

#### Scenario: The pin is applied by continuous integration, not merely declared

- **WHEN** the workflow is inspected
- **THEN** it installs the pinned toolchain through the command that applies the pin file, and
  installs the packaging tool at the exact recorded version rather than at a floating one
- **AND** a check fails if either is absent or names a different version

#### Scenario: Two builds of one commit produce identical bytes

- **WHEN** the artifact is rebuilt with a fresh build directory at a different absolute path
- **THEN** every emitted file is byte-identical to the first build
- **AND** the comparison reports the file count it compared, so an empty comparison cannot pass

#### Scenario: Reproducibility is claimed only where it runs

- **WHEN** the reproducibility check is registered
- **THEN** it is registered as a local gate and is absent from the set of checks the repository
  claims run in continuous integration

