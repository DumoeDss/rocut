> Common base: `daef023b5a714088a6e629743cabb9e154d5cc30` (review-clean C0+C1
> integration). C0b and C2 may run concurrently only while their declared product-source write
> sets remain disjoint.
>
> Standing constraints: every Cargo/wasm-pack invocation uses `CARGO_TARGET_DIR` on `C:`; generated
> `rust/wasm/pkg/**` is ignored evidence and is never committed; rebuilding is followed by
> `bun install`; `script/fixtures/type-baseline.json` is never edited; type diagnostics stay at or
> below 3 and `PASS`; parity is not re-baselined.

## 0. Establish the exact baseline

- [x] 0.1 Create/verify an isolated C0b worktree and branch at exact commit
      `daef023b5a714088a6e629743cabb9e154d5cc30`; record `HEAD`, `HEAD^{tree}` and a clean
      `git status --short` before editing.
- [x] 0.2 Set and record a dedicated `CARGO_TARGET_DIR` on `C:`; verify every later `cargo`,
      `wasm-pack` and `bun run build:wasm` process inherits it and no Cargo target is created on
      `E:`.
- [x] 0.3 Run the measured fresh-worktree bring-up in order: with the C-drive
      `CARGO_TARGET_DIR`, run `bun run build:wasm` first so the gitignored
      `rust/wasm/pkg` exists; then run `bun install` so the file dependency and optimized `.wasm`
      are current. Export the nine values from planning-context §4.1 and run
      `npx turbo run build --filter=@opencut/web --force`; assert
      `apps/web/.content-collections/generated` exists; then run
      `node script/check-type-baseline.mjs` and record `3 diagnostic(s) ... PASS`.
- [x] 0.4 Run `bun run check:wasm`, `node script/check-port-boundary.mjs`,
      `bun --cwd apps/vite-example run build`, and the current focused Rust/WASM tests; record the C0
      package hashes, exported JS/binary surfaces, imports, generated declarations and file list as
      the immutable C0b before-state.
- [x] 0.5 Build both Hosts and run `bun --cwd apps/vite-example run test:parity`; archive the
      normalized parity snapshot for the post-change comparison. A baseline failure stops the child
      and is reported, not repaired or re-baselined here.

## 1. Make backend truth explicit

- [x] 1.1 Introduce a typed selected-backend fact in the narrowest Rust layer that already owns GPU
      initialization; preserve the existing WebGPU-first/WebGL-fallback order.
- [x] 1.2 Record a successful `"webgpu"` or `"webgl"` selection only after initialization
      completes; retain a non-empty failure/not-initialized/teardown reason separately.
- [x] 1.3 Implement the runtime query semantics `selectedBackend() -> "webgl" | "webgpu" | null`
      and `concurrentCompositorInstances() -> 2 | 1 | 0` for WebGPU, WebGL and no selected backend.
- [x] 1.4 Add focused tests for pre-initialization, successful WebGPU, fallback WebGL, total failure
      and post-teardown query states, including the required non-empty diagnostic whenever the
      backend is `null`.
- [x] 1.5 Prove the public query never emits a boolean, an out-of-domain string or a non-zero
      capacity with a `null` backend.

## 2. Implement handle-keyed compositor ownership

- [x] 2.1 Replace the optional single compositor runtime with a handle-indexed owner, reserving
      handle `0` for compatibility and allocating checked, monotonically increasing non-zero `u32`
      handles for explicit creation.
- [x] 2.2 Implement `createCompositor`, `resizeCompositorForHandle`,
      `getCompositorCanvasForHandle`, `uploadTextureForHandle`, `releaseTextureForHandle` and
      `renderFrameForHandle` with exact-handle lookup and actionable unknown-handle failures.
- [x] 2.3 Route every existing no-handle compositor export through reserved handle `0` without
      changing its declaration or successful single-preview behavior.
- [x] 2.4 Enforce the reported live-handle capacity: two on WebGPU, one on WebGL and zero without a
      backend; prove over-capacity creation inserts/replaces nothing.
- [x] 2.5 Implement idempotent `disposeCompositor(handle)` that drops only the named compositor,
      canvas/surface and texture ownership and never releases another handle.
- [x] 2.6 Add focused ownership tests for distinct handles, default/explicit capacity competition,
      per-handle resize/render/texture isolation, double release, unknown release and checked handle
      exhaustion without wraparound.

## 3. Export the frozen runtime providers

- [x] 3.1 Export `WasmRuntimeGraphicsQuery` with generated methods exactly
      `selectedBackend(): "webgl" | "webgpu" | null`,
      `concurrentCompositorInstances(): number` and `unavailableReason(): string`; every call reads
      live Rust state rather than a cached snapshot.
- [x] 3.2 Export `WasmRuntimeGpuResourceQuery` with generated methods exactly
      `liveHandles(): readonly number[]` and
      `release(input: { handle: number }): void`; enumeration is ascending, complete and unique.
- [x] 3.3 Implement `disposeGpu()` so it names/refuses every live-handle set without changing the
      runtime, then drops shared GPU state and resets allocation only when the set is empty.
- [x] 3.4 Add a compile-only structural assertion against local copies of C1's frozen
      `RuntimeGraphicsQuery` and `RuntimeGpuResourceQuery`; do not import or edit
      `apps/web/src/**`.

## 4. Make the surface mechanical and non-vacuous

- [x] 4.1 Add `script/check-wasm-api-surface.mjs` (or one equivalently named WASM gate) that checks
      the exact added JS exports, binary exports/imports, generated files and TypeScript declarations
      against the recorded C0 before-state.
- [x] 4.2 Make the gate assert both provider shapes, all explicit handle operations, compatibility
      declarations, nullable backend, numeric capacity, readonly numeric handles and keyed release;
      reject `any`, booleans and unexplained deltas.
- [x] 4.3 Add separate deliberate negative controls for missing/extra exports, changed binary
      imports, an invalid backend, boolean count/handles, `any`, unkeyed release and a truncated/empty
      file enumeration; record that every mutation exits non-zero for its own reason.
- [x] 4.4 Add the new gate to `check-wasm-source.mjs`'s explicit `GATED` list, root
      `package.json`'s `check:wasm` aggregate and `.github/workflows/bun-ci.yml`; prove removing any
      one registration makes the gate-registration assertion fail.
- [x] 4.5 Rebuild only through `bun run build:wasm` with the C-drive target, then immediately run
      `bun install`; verify resolved `node_modules/opencut-wasm` hashes exactly match the rebuilt
      ignored package.
- [x] 4.6 Run the focused Rust state tests, built-package runtime tests, structural compile check,
      new API gate and all negative controls; capture command/output mappings for every C0b scenario.

## 5. Record the deliberate provenance delta

- [x] 5.1 Update `UPSTREAM.md` without rewriting C0's before-state: preserve its correspondence
      conclusion and append the exact generated C0b export/import/declaration/file delta attributed
      to `s02-wasm-api-surface`.
- [x] 5.2 Add `PATCHES.md` entries for every behaviorally modified inherited Rust/root/workflow file,
      each naming the forcing requirement and verification; do not add patch rows for new files.
- [x] 5.3 Run `node script/generate-sbom.mjs`; verify dependency and known-defect dispositions are
      unchanged, and commit `SBOM.md` only if the deterministic generator produces a justified
      content change.
- [x] 5.4 Commit the source/provenance changes, run `node script/generate-source-inventory.mjs`,
      commit `SOURCE_INVENTORY.md` and `SOURCE_INVENTORY.json`, then rerun the generator and prove a
      clean result. Never hand-merge either generated file.
- [x] 5.5 Verify `script/fixtures/type-baseline.json` is byte-identical to `daef023b`; a diagnostic
      increase is a stop condition, never grounds for regeneration.

## 6. Run branch verification and touch-set proof

- [x] 6.1 With the rebuilt package reinstalled, run `bun run check:wasm` and every WASM negative
      control; run `node script/check-port-boundary.mjs` to prove C1's boundary still holds.
- [x] 6.2 Run focused Rust/package tests and `bun test`; record pass/fail and exact test counts.
- [x] 6.3 Export the nine verified build variables, run
      `npx turbo run build --filter=@opencut/web --force`, assert generated content exists, then run
      `bun --cwd apps/vite-example run build`.
- [x] 6.4 Run `node script/check-type-baseline.mjs`; require at most 3 diagnostics and `PASS`, and
      show the baseline fixture has no diff.
- [x] 6.5 Run `bun --cwd apps/vite-example run test:parity` and
      `node script/diff-parity-snapshots.mjs` against task 0.5; require zero semantic/incidental
      movement.
- [x] 6.6 Run the existing asset, storage, Next-import, distributable, reference, port, WASM-source
      and WASM-path gates, plus the new API gate, recording every result separately.
- [x] 6.7 Audit `git diff --name-only daef023b`: allow only the C0b Rust/WASM/tests/gates,
      root WASM-gate registration/CI, provenance documents and generated inventories; assert no
      `apps/web/src/**`, `apps/vite-example/src/**`, C1 contract or C2 runtime path changed.

## 7. Complete both required specification sweeps

- [x] 7.1 Perform a prose-and-scenario falsification sweep over all eight archived capability specs:
      `browser-persistence-boundary`, `developer-reproducibility`, `editing-parity-fixture`,
      `host-service-boundary`, `inherited-defect-repair`, `next-free-distributable-boundary`,
      `runtime-asset-delivery` and `upstream-provenance`; record every requirement made false and the
      evidence for every negative result.
- [x] 7.2 Confirm the only planned archived-capability falsification is the full, byte-exact
      `upstream-provenance` requirement delta in this change. If any other existing requirement is
      false, add its complete MODIFIED block and revalidate before implementation can be considered
      complete.
- [x] 7.3 Perform the full unimplemented-addition sweep over every ADDED/MODIFIED requirement and
      scenario in both C0b delta specs: map each to an implementation plus positive/negative
      evidence, and fail on any TODO, stub, placeholder, declaration-only provider, skipped scenario
      or uninvoked gate.

## 8. Freeze the C3 joint-gate handoff

- [x] 8.1 Record the review-clean C0b head, generated package hashes, exact provider class/method
      names, exact export delta and focused evidence in the C0b implementation record for C3.
- [x] 8.2 Record the combined-tree command order C3 must run:
      `bun run build:wasm` with C-drive target -> `bun install` -> regenerate both inventories ->
      `bun run check:wasm` -> C0b API controls -> C1 port controls -> C2 singleton controls -> forced
      web build -> Vite build -> type ceiling -> focused/full tests -> parity.
- [x] 8.3 State that C3 must additionally prove selected backend and reported concurrent-preview
      count on distinct WebGPU and WebGL runs before replacing C1's placeholders; C0b itself does no
      early wiring.
