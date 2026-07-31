## ADDED Requirements

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

### Requirement: Existing editor parity is unchanged before C3 wiring

C0b SHALL not edit or wire a JavaScript/TypeScript session, Host or renderer caller. Rebuilding the
additive surface SHALL preserve the current single-preview parity fixture.

#### Scenario: The existing runtime remains on the compatibility surface

- **WHEN** the C0b branch is searched for product-source changes
- **THEN** no file under `apps/web/src/**` or `apps/vite-example/src/**` is changed
- **AND** existing callers still use the no-handle exports

#### Scenario: Parity remains green

- **WHEN** the canonical package is rebuilt, reinstalled and the existing parity fixture runs
- **THEN** its output is unchanged from the C0+C1 integration baseline
