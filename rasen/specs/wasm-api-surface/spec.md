# wasm-api-surface Specification

## Purpose

Define the canonical WASM compositor, runtime graphics-query, GPU-resource-query, teardown, and generated-surface contracts.
## Requirements
### Requirement: The compositor surface is handle-keyed and backward compatible

The WASM package SHALL support explicitly created compositor instances identified by stable numeric
GPU handles. Resize, canvas access, texture upload/release, rendering and disposal SHALL target an
explicit handle. Existing no-handle compositor exports SHALL remain available and SHALL operate
through reserved handle `0`.

#### Scenario: Two WebGPU compositors are independent

- **WHEN** two compositors are created on a successfully initialized WebGPU runtime
- **THEN** they receive distinct non-zero handles
- **AND** resizing, rendering, texture mutation or disposal of one handle does not mutate the other

#### Scenario: The legacy surface retains single-preview behavior

- **WHEN** a caller uses only the existing no-handle compositor exports
- **THEN** those exports operate on reserved handle `0` with the same successful behavior and
  declaration signatures as before this change

#### Scenario: Capacity cannot be exceeded

- **WHEN** a caller creates more live compositor handles than the selected backend reports
- **THEN** creation fails without inserting a handle or replacing an existing compositor

### Requirement: Runtime graphics capability answers are truthful and typed

The generated WASM package SHALL provide a `WasmRuntimeGraphicsQuery` whose structural declaration
satisfies C1's `RuntimeGraphicsQuery`. Its selected backend SHALL be exactly
`"webgl" | "webgpu" | null`; its concurrent compositor capacity SHALL be a number with values `2`
for WebGPU, `1` for WebGL and `0` when no backend is selected.

#### Scenario: WebGPU reports the guaranteed concurrent count

- **WHEN** WebGPU initialization succeeds
- **THEN** `selectedBackend()` returns `"webgpu"`
- **AND** `concurrentCompositorInstances()` returns `2`

#### Scenario: WebGL reports its single-compositor limit

- **WHEN** WebGPU is unavailable and WebGL initialization succeeds
- **THEN** `selectedBackend()` returns `"webgl"`
- **AND** `concurrentCompositorInstances()` returns `1`

#### Scenario: No rasterizer is represented without fabrication

- **WHEN** initialization has not succeeded, has failed, or the shared runtime has been torn down
- **THEN** `selectedBackend()` returns `null`
- **AND** `concurrentCompositorInstances()` returns `0`
- **AND** `unavailableReason()` returns a non-empty diagnostic

### Requirement: Live GPU handles can be reconciled and released exactly

The generated WASM package SHALL provide a `WasmRuntimeGpuResourceQuery` whose structural
declaration satisfies C1's `RuntimeGpuResourceQuery`. `liveHandles()` SHALL return an ascending
readonly numeric snapshot of every live compositor handle, including reserved handle `0`, and
`release({ handle })` SHALL dispose only the named handle.

#### Scenario: Enumeration reflects creation and release

- **WHEN** compositor handles are created and one is released
- **THEN** `liveHandles()` contains every remaining live handle exactly once and does not contain
  the released handle

#### Scenario: An untracked allocation remains visible

- **WHEN** a compositor exists that a session registry did not record
- **THEN** it is still present in `liveHandles()`, allowing C1 disposal reconciliation to report it

#### Scenario: Handle release is idempotent

- **WHEN** `release({ handle })` is called twice for the same handle
- **THEN** the first call disposes that compositor and the second completes without affecting
  another handle

### Requirement: Shared GPU teardown cannot invalidate a live compositor

The WASM package SHALL expose shared GPU teardown. It SHALL refuse teardown while any compositor
handle is live and SHALL leave the runtime usable after that refusal. It SHALL tear down the shared
runtime only after all handles have been released.

#### Scenario: Teardown is refused with live handles

- **WHEN** shared teardown is requested while `liveHandles()` is non-empty
- **THEN** it fails with a diagnostic naming the live handles
- **AND** all live compositors remain usable

#### Scenario: The final owner can tear down shared state

- **WHEN** every compositor handle has been released and shared teardown is requested
- **THEN** the GPU runtime is dropped, the allocator is reset and the selected backend becomes
  `null`

### Requirement: The generated surface is precise and mechanically guarded

The committed WASM gate SHALL verify the exact added JavaScript and binary exports plus the emitted
TypeScript declarations. The provider declarations SHALL contain no `any`, boolean substitute,
out-of-domain backend or unkeyed release. Each rule SHALL have a deliberate negative control that
causes the gate to fail.

#### Scenario: The canonical generated surface passes

- **WHEN** the package is rebuilt through the canonical wrapper and the WASM surface gate runs
- **THEN** all required handle operations and both provider classes are present with their exact
  declarations
- **AND** no unexpected export, import or declaration delta remains unexplained

#### Scenario: A malformed provider is rejected

- **WHEN** a negative fixture substitutes a boolean count or handle collection, an invalid backend,
  `any`, or a release operation without a numeric handle
- **THEN** the declaration/compile gate exits non-zero for each mutation

#### Scenario: An unexpected generated delta is rejected

- **WHEN** the rebuilt package adds or removes a JS export, binary export/import, declaration or
  generated file outside the recorded C0b delta
- **THEN** the correspondence gate exits non-zero and identifies that delta

### Requirement: Existing editor parity is preserved after C3 explicit-handle wiring

C3 SHALL consume C0b's generated provider and handle-keyed compositor surface without editing Rust
or generated WASM. The production editor SHALL move off the no-handle compatibility path while the
legacy handle-0 exports remain available, and canonical editing parity SHALL remain unchanged.

#### Scenario: The production runtime uses explicit handles

- **WHEN** the Next and Vite editor graphs are searched transitively after C3 wiring
- **THEN** session renderers call the handle-keyed compositor surface with tracked nonzero handles
- **AND** no production caller uses the no-handle compatibility exports or default compositor

#### Scenario: The additive compatibility surface remains available

- **WHEN** the generated API contract and negative-control surface checks run
- **THEN** the legacy handle-0 exports and C0b explicit-handle/provider exports retain their exact
  names, arities and semantics

#### Scenario: No runtime implementation is fabricated in TypeScript

- **WHEN** the adapter and Host changes are inspected
- **THEN** backend, capacity and live-handle answers come from the generated C0b runtime
- **AND** no TypeScript shadow table or Host-stamped substitute is accepted

#### Scenario: Parity remains green after wiring

- **WHEN** canonical packages are rebuilt, both Hosts run the existing parity scenario and their
  snapshots are compared
- **THEN** editing output is unchanged from the exact C0b+C2 joint baseline
- **AND** the parity fixture itself was not re-baselined

### Requirement: The recorded surface covers both entries and their routing

The surface gate SHALL record the explicitly-instantiating entry alongside the bundler entry: its
exact bytes, that the two entries re-export the identical set, that it performs the initialization
it exists to perform, and the exact export-condition routing that decides which consumer reaches
which entry — including the order of those conditions, because order decides resolution. Each rule
SHALL have a deliberate negative control that causes the gate to fail.

#### Scenario: A drifted second entry is rejected

- **WHEN** the explicitly-instantiating entry re-exports a name the bundler entry does not, or
  omits one it does
- **THEN** the surface gate exits non-zero and names the parity rule

#### Scenario: An entry that resolves but never initializes is rejected

- **WHEN** the explicitly-instantiating entry no longer sets the glue's wasm handle or no longer
  runs the start function
- **THEN** the surface gate exits non-zero, because that is the exact shape of the original defect:
  it imports cleanly and dies on first call

#### Scenario: Swapped, dropped or added conditions are rejected

- **WHEN** a condition is pointed at the other entry, the declared explicit subpath is removed, the
  wildcard passthrough is removed, or a condition that bundlers also claim is added
- **THEN** the surface gate exits non-zero in each case and names the routing rule

### Requirement: Recorded values state how they were derived

Every pinned value in the surface contract SHALL be re-derivable by a reader from a written
procedure, and a value that is corrected SHALL carry the derivation that establishes the previous
value was wrong. Correcting a recorded value by weakening or removing the assertion that caught it
SHALL NOT be an accepted repair.

#### Scenario: A stale recording is corrected, not dropped

- **WHEN** a pinned hash no longer matches the artifact on every platform
- **THEN** the value is re-recorded and the contract states the derivation showing what the old
  value was a hash of
- **AND** the file remains pinned rather than being removed from the pinned set

#### Scenario: The contract names the commands that re-derive it

- **WHEN** a reader wants to check any recorded value
- **THEN** the contract file names the build and comparison commands that reproduce it

