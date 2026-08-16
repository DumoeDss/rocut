# self-built-wasm-artifact — delta

## ADDED Requirements

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
