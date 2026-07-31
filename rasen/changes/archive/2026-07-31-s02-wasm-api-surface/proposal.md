## Why

C0 made the fork's self-built WASM canonical without changing its API. S02 can now add the runtime
surface that the frozen C1 TypeScript contract already requires, while preserving C0's
correspondence evidence as the named before-state rather than retroactively folding the divergence
into the source switch.

This change must **export a live-handle enumeration satisfying RuntimeGpuResourceQuery, and make selectedBackend() able to return null.**
Without those two directions, disposal is blind to allocations the session did not register and a
no-rasterizer runtime can only fabricate a GPU answer. Both are exactly the failure shapes C1's
compile guards were created to reject.

## What Changes

- Add an **additive, handle-keyed compositor surface** over the one shared `GpuContext`. Explicit
  handles create, resize, render, upload/release textures, return the owning canvas and dispose one
  compositor. The existing no-handle exports remain operational through a reserved default handle,
  so C0b changes no existing call site and parity must remain unchanged.
- Add the runtime providers C1 froze:
  - selected backend as the `webgl | webgpu | null` domain, where `null` is a real answer before
    successful initialization, after teardown, or after an initialization failure;
  - concurrent compositor capacity as a **count** (`2` for the S02-guaranteed WebGPU path, `1` for
    WebGL, `0` for no backend);
  - live compositor/GPU handle enumeration and handle-keyed release, with generated declarations
    precise enough for an adapter to satisfy `RuntimeGraphicsQuery` and
    `RuntimeGpuResourceQuery` without `any`, a boolean substitute or an unkeyed teardown.
- Add teardown for one compositor and for the shared GPU runtime. Shared teardown refuses while a
  live compositor remains, so C6 can release session-owned handles first and the last session can
  release shared pipelines without invalidating another session.
- Keep all product-source additions on the Rust/WASM side. This change does not wire the exports
  into `createEditorSession`, edit a JavaScript/TypeScript session or renderer module, or consume
  C2's factory. C3 owns that join.
- Rebuild through C0's canonical wrapper, re-run `bun install` afterwards (bun's hard link to the
  optimized `.wasm` is not preserved across replacement), and extend the committed WASM surface
  gate. Any new `check-wasm-*` gate is added to C0's explicit gate register, the root package gate
  and CI rather than existing only as an uninvoked script.
- Preserve C0's correspondence record and deliberately supersede equality only by an exact,
  generated export/declaration delta attributed to this change. Generated `rust/wasm/pkg/**`
  remains gitignored evidence, not committed product source.
- Regenerate `SOURCE_INVENTORY.md` and `SOURCE_INVENTORY.json`; never hand-merge them. Do not edit
  `script/fixtures/type-baseline.json`.

## Capabilities

### New Capabilities

- `wasm-api-surface`: handle-keyed compositor ownership, backend/concurrency queries, live-handle
  reconciliation, explicit teardown, compatibility shims and the generated declaration/export
  evidence that freezes them as one Rust/WASM interface.

### Modified Capabilities

- `upstream-provenance`: the canonical self-built artifact now intentionally diverges from
  published `opencut-wasm@0.2.10`; the exact added JS and binary exports, declarations, imports and
  generated-file differences are enumerated and attributed without weakening C0's before-state.

## Impact

Both children in cohort 2 apply from the same review-clean integration commit
`daef023b` (C0+C1 plus regenerated derived inventories).

**Product-source write set:**

| Area | Allowed work |
| --- | --- |
| `rust/wasm/src/{gpu,compositor}.rs` | runtime state, additive exports, default-handle compatibility |
| `rust/crates/gpu/src/**` | a typed/readable selected-backend fact if the WASM boundary needs it |
| `rust/crates/compositor/src/**` | only if handle ownership requires a crate-level primitive |
| WASM-focused Rust tests and `script/check-wasm-*.mjs` | declaration/export/negative-control gates |
| root `package.json` and `.github/workflows/bun-ci.yml` | register each new WASM gate in the existing explicit aggregate and CI |
| `UPSTREAM.md`, `SBOM.md`, `PATCHES.md` | attributed API divergence and inherited-file patch log |
| `SOURCE_INVENTORY.{md,json}` | regenerated derived state |

Explicitly excluded: `apps/web/src/**`, `apps/vite-example/src/**`, C1 port/session contracts,
both Host composition roots, C2's singleton-removal check, and
`script/fixtures/type-baseline.json`.

The product-source intersection with C2 is empty: C0b writes Rust/WASM; C2 writes TypeScript/React
runtime code. The only planned common files are deterministic `SOURCE_INVENTORY` outputs, resolved
after integration by regeneration. If C0b discovers it needs a JavaScript session/renderer edit or
C2 discovers it needs Rust/generated-WASM source, the parallel proof has failed and the cohort
stops for serialization.

C3 may start only after both branches are review-clean and locally shipped, then combined on one
integration commit. That gate rebuilds WASM and both Hosts from the combined tree, reinstalls the
local WASM package, regenerates both inventories, runs the WASM source/path/API gates, type ceiling,
port boundary, singleton negative control, full focused tests and parity, and proves the selected
backend plus reported preview count on **distinct WebGPU and WebGL runs**. C3 then replaces C1's
explicit unimplemented placeholders with these providers; C0b does not wire them early.
