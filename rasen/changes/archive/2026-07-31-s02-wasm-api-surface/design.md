## Context

C0 made the artifact rebuilt from `rust/` the only canonical WASM input and recorded an exact
before-state correspondence with published `opencut-wasm@0.2.10`. C1 then froze two structural
runtime contracts:

- `RuntimeGraphicsQuery` reports `"webgl" | "webgpu" | null`, a numeric concurrent-compositor
  capacity and an optional diagnostic;
- `RuntimeGpuResourceQuery` enumerates live numeric handles and releases one exact handle.

The current WASM keeps one optional process-wide `GpuRuntime` and one optional
`CompositorRuntime`. The no-handle compositor functions replace or mutate that one value. This
cannot represent two simultaneous previews, cannot let session disposal reconcile untracked
graphics allocations, and cannot report the honest no-rasterizer state.

C0b is an additive Rust/WASM boundary change. It does not consume the C1 TypeScript contracts and
does not wire a running Host. C3 owns that join after C0b and C2 pass their joint gate. Both cohort
children start from integration commit `daef023b`.

## Goals / Non-Goals

**Goals:**

- Export a handle-keyed compositor API over one shared GPU context.
- Provide generated, structurally precise providers for C1's two runtime query contracts.
- Make backend absence observable as `null`, with a useful reason.
- Make one-handle disposal idempotent and shared-runtime teardown safe in the presence of other
  sessions.
- Preserve every existing no-handle export as a compatibility path.
- Preserve C0's correspondence result as the named before-state and enumerate only C0b's deliberate
  delta.

**Non-goals:**

- Wiring the new providers into `createEditorSession` or either Host.
- Editing any JavaScript/TypeScript editor or renderer source.
- Session-scoping the React stores or implementing C6's complete five-class resource disposal.
- Committing `rust/wasm/pkg/**` or treating a cross-machine binary hash as a correspondence oracle.
- Increasing the C1 contract or replacing its compile guards.

## Decisions

### 1. One shared GPU context owns a bounded map of compositor runtimes

`COMPOSITOR_RUNTIME: Option<CompositorRuntime>` becomes a handle-indexed map. Handle `0` is
reserved for the existing no-handle exports; explicitly created compositors receive monotonically
allocated non-zero `u32` handles. Handle reuse is forbidden within one GPU-runtime lifetime, so a
stale release cannot target a newly created compositor.

The public additive surface is:

- `createCompositor(width, height) -> GpuHandleId`
- `resizeCompositorForHandle(handle, width, height)`
- `getCompositorCanvasForHandle(handle)`
- `uploadTextureForHandle(handle, options)`
- `releaseTextureForHandle(handle, textureId)`
- `renderFrameForHandle(handle, options)`
- `disposeCompositor(handle)`

The existing `initCompositor`, `resizeCompositor`, `getCompositorCanvas`, `uploadTexture`,
`releaseTexture` and `renderFrame` functions delegate to handle `0`. Their signatures and successful
single-preview behavior do not change. Creating or replacing the default compositor still obeys
the same capacity rule as an explicit handle.

The runtime enforces the S02 guarantee rather than advertising an unbounded implementation detail:
WebGPU permits two live compositor handles, WebGL permits one, and no initialized backend permits
zero. A creation beyond that count fails without inserting a handle. This makes
`concurrentCompositorInstances()` a truthful capability rather than a boolean in disguise.

### 2. WASM exports provider classes whose declarations structurally satisfy C1

The generated package exports two zero-state provider classes:

```ts
class WasmRuntimeGraphicsQuery {
  selectedBackend(): "webgl" | "webgpu" | null;
  concurrentCompositorInstances(): number;
  unavailableReason(): string;
}

class WasmRuntimeGpuResourceQuery {
  liveHandles(): readonly number[];
  release(input: { handle: number }): void;
}
```

Methods read the live Rust runtime on every call; the classes do not cache a snapshot. Rust is the
implementation source. Where `wasm-bindgen` cannot infer a narrow union, readonly array or named
input object, its supported TypeScript custom-section/unchecked type annotations are used solely to
make the generated declaration match the validated runtime ABI.

A compile-only gate keeps local structural copies of the frozen C1 shapes next to the generated
surface check. It rejects `any`, a boolean backend/count/handle collection, an out-of-domain backend,
and an unkeyed `release`. C0b does not import from or edit `apps/web/src/**`; C3 can instantiate the
classes and pass them directly as C1 providers.

### 3. Backend truth comes from initialized runtime state

Successful GPU initialization stores the selected backend as a typed Rust enum/readable fact.
`selectedBackend()` returns:

- `"webgpu"` after successful WebGPU initialization;
- `"webgl"` after successful WebGL initialization;
- `null` before success, after shared teardown, and after a failed attempt.

The last initialization/teardown reason is retained separately.
`unavailableReason()` returns a non-empty diagnostic whenever the selected backend is `null`; while
a backend is live it returns an empty string. This avoids inventing a backend to preserve a
non-null type.

### 4. Handle release is idempotent; shared teardown is conditional

`disposeCompositor(handle)` and `WasmRuntimeGpuResourceQuery.release({ handle })` remove exactly that
compositor and drop its canvas/surface/texture ownership. Releasing an absent handle is a no-op, so
session disposal may be retried safely. `liveHandles()` returns an ascending snapshot of all
currently live handles, including reserved handle `0` when the legacy surface owns it.

`disposeGpu()` succeeds only when `liveHandles()` is empty. If any handle remains, it throws/returns
an error naming the live handles and leaves the shared context intact. Once empty, it drops the GPU
runtime and resets the handle allocator. Thus one session cannot invalidate another session's
pipelines, while C6 can release session-owned handles and let the last owner tear down shared state.

### 5. C0's before-state and C0b's deliberate delta are separate evidence

The canonical rebuild still runs only through `bun run build:wasm`, with `CARGO_TARGET_DIR` on the
C drive. `bun install` runs afterwards because rebuilding replaces the optimized WASM file that bun
had hard-linked into the workspace package.

The existing correspondence report remains the C0 before-state. A generated gate records the exact
C0b JS exports, binary exports/imports, TypeScript declarations and generated-file changes relative
to that state. `UPSTREAM.md`, `PATCHES.md` and `SBOM.md` attribute the divergence to
`s02-wasm-api-surface`; no unexplained delta is accepted. Generated `rust/wasm/pkg/**` is evidence
only and remains ignored.

Any new `check-wasm-*` command is inserted into C0's explicit WASM gate registry, the root
`check:wasm` command and CI. A script that is not invoked from those three places is not a gate.

### 6. C0b and C2 remain parallel only while their product write sets are disjoint

C0b is limited to Rust/WASM source, WASM checks/tests, the root WASM gate registration/CI steps and
provenance documents. C2 is limited to TypeScript/React session runtime source and its checks/tests;
its singleton check is exercised by the existing `bun test` CI path and does not edit the root
manifest or workflow. Neither edits
`script/fixtures/type-baseline.json`. `SOURCE_INVENTORY.md` and `SOURCE_INVENTORY.json` are the only
planned overlap and are regenerated from the combined committed tree rather than hand-merged.

If C0b needs an editor/Host JavaScript edit, or C2 needs Rust/generated-WASM source, work stops and
the cohort is serialized. C3 starts only after both children are independently review-clean and
locally shipped.

## Risks / Trade-offs

- **WebGL cannot host two independent compositor canvases.** The truthful capacity remains one and
  a second creation fails explicitly; C3 proves the WebGL answer in a separate run.
- **`RefCell` re-entry can panic.** No exported call may hold a mutable map borrow while invoking
  code that can re-enter JavaScript. Lookups and mutations are split into short borrow scopes and
  covered by handle lifecycle tests.
- **The declared narrow TypeScript type could drift from runtime values.** Runtime shape tests and
  deliberate compile-negative fixtures accompany the declaration check.
- **The legacy default handle can compete for capacity.** It is counted exactly like an explicit
  handle; this preserves old behavior when used alone and prevents hidden over-capacity state.
- **Monotonic `u32` allocation can exhaust.** Exhaustion is checked and fails creation rather than
  wrapping. Teardown of the whole GPU runtime resets the allocator.
- **Shared teardown may surprise an old caller.** Refusing teardown while live handles exist is
  intentional; destroying another session's renderer would be worse and would violate S02.

## Migration Plan

1. Branch from `daef023b` and establish a clean C0 gate/baseline reading.
2. Implement backend truth, handle ownership and exact provider declarations in Rust.
3. Add positive, compile-negative and runtime-negative gates; rebuild canonically and reinstall.
4. Update provenance with the generated exact delta, then regenerate inventories after the source
   commit.
5. Review and locally ship C0b without any C3 wiring.
6. Combine the review-clean C0b and C2 heads, regenerate inventories once, and run the C3 joint
   gate before C3 consumes the providers.

Rollback removes the additive exports/map and restores the C0 artifact from the C0+C1 integration
baseline. It must also restore the prior provenance delta record; the published package is never a
fallback.

## Open Questions

None. The provider names, handle domain, capacity, null semantics, default-handle compatibility and
teardown ordering are fixed by this design.
