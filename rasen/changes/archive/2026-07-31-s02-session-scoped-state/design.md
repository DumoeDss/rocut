## Context

C0b and C2 share the exact base `2df009c9e1729e2ac933c0bd54762d744433073b` (tree
`984bd269aef0f6c3a0060ff0573b65707b262c24`), but their contracts are not yet joined. C2 gives each
`EditorSession` an explicit `EditorCore`; the React graph still reaches nine module-created Zustand
stores, a process-wide interaction-canceller set and a process-wide compositor. C1's two
unimplemented graphics providers are still supplied by the production Hosts. The no-selector
`useEditor()` overload returns a stable core through an empty subscriber, so `MigrationDialog` and
other apparent reactive consumers do not update.

The nine stores that form the C3 boundary are:

| Store | Current durable substrate | Session-owned live state after C3 |
| --- | --- | --- |
| panel | `panel-sizes` | panel sizes, listeners |
| editor bootstrap | none | bootstrap/loading state, listeners |
| preview | `preview-settings` | playback, playhead and preview state |
| timeline | `timeline-store` | timeline UI and interaction state |
| sounds | storage service | query/results/loading/request generations |
| stickers | `stickers-settings` | browse results/loading/request generation |
| keybindings | `opencut-keybindings` | live shortcut/UI state and preference view |
| properties | none | active properties-panel state |
| assets panel | `assets-panel` | tab/filter/panel state |

Several other module-level values touch the same graph. The interaction-canceller registry,
`gpuAvailable`/`initPromise`, the default `WasmCompositor`, and stickers' browse generation are
mutable session state and cannot remain process-global. Default definition registries, immutable
asset promise caches, compositor frame-descriptor identity bookkeeping, custom preset preferences
and the shared underlying sounds library are deliberately process-scoped. C3 records and gates that
classification; C5 still owns storage inversion, and C6 still owns full five-class shared-resource
teardown.

The C0b runtime surface is already exact. `WasmRuntimeGraphicsQuery` reports selected backend,
concurrent compositor capacity and unavailability reason; `WasmRuntimeGpuResourceQuery` reports and
releases live handles. Explicit compositor handles start at 1 while handle 0 remains the legacy
compatibility path. WebGPU capacity is 2, WebGL capacity is 1 and unavailable capacity is 0. C3 may
consume those providers and handle-keyed calls but may not change Rust, generated WASM, the C1
public session signature or the generated type fixture.

## Goals / Non-Goals

**Goals**

- Make two simultaneous sessions independent across core, all nine stores, project, selection,
  command/undo, playback/playhead, save and renderer state.
- Make all React editor reads either genuinely subscribed through a selector or explicitly
  imperative through a named stable-instance hook.
- Supply both Hosts with live C0b graphics/GPU providers and give each live session one exact,
  tracked compositor handle.
- Prove honest WebGPU capacity 2 and WebGL capacity 1 in real browser executions, including an
  explicit over-capacity rejection that leaves the first WebGL preview intact.
- Preserve inherited provenance, parity, type, boundary and baseline-red contracts.

**Non-goals**

- C4 asset-base URLs, Worker/runtime-resource delivery, effect-preview asset delivery or the
  no-rasterizer degraded UI.
- C5 persistence/storage inversion or making durable user libraries session-private.
- C6's complete five-resource disposal/leak accounting and shared GPU last-owner teardown.
- Rust/generated-WASM changes, C7 headless editing, S03 transactions or S04 Surface work.

## Decisions

### 1. A private session-state registry owns vanilla Zustand StoreApi instances

The nine modules export store creators and state/action types, not process-created React hooks.
Session creation constructs all nine `StoreApi` instances and records them in a private registry
keyed by the explicit `EditorSession`. `EditorSessionProvider` makes that registry available beside
the C2 session, and typed hooks call Zustand's `useStore(store, selector)`. Imperative code receives
the explicit session registry or a named store accessor; it never imports a static store.

The frozen public `createEditorSession({ host, runtimeGraphics, runtimeGpu })` signature and public
session shape do not widen. Registry binding is internal, is removed during session disposal and
fails loudly for a missing or disposed session. A complete-registry assertion and a boundary gate
make omission of any of the nine stores a failure.

### 2. Durable persistence is shared input, not a shared live StoreApi

Existing persist keys and versions remain unchanged so user preferences survive C3. Every session
hydrates its own live StoreApi from that shared substrate and owns its listeners, transient state
and async request generations. Updating session A's live state cannot synchronously mutate session
B; later sessions may naturally seed durable preferences written by an earlier session.

The sounds library/storage service and custom preset preference collection remain shared data
sources until C5. Their per-session query/cache/loading view is isolated. Stickers'
`browseRequestVersion` moves into the store closure. Every async store completion checks its own
generation and disposed state before publication.

### 3. No-selector editor access is removed instead of subscribing to everything

`useEditor(selector)` remains the only reactive overload and subscribes to the managers read by the
selector. A new deliberately named `useEditorInstance()` returns the stable session-owned core for
event handlers and imperative orchestration. The no-argument `useEditor()`, `subscribeNone` and any
equivalent empty subscriber are removed. All existing no-selector call sites are classified:
render-time reads become selectors; event-only or construction-time users become
`useEditorInstance()`.

Subscribing every imperative consumer to every manager was rejected because it would turn stable
event plumbing into broad render churn while still hiding intent. A syntax-aware boundary gate has
negative controls for aliases, whitespace, optional calls and empty subscriber helpers.

### 4. Mutable interaction state follows the session; documented caches may remain shared

The interaction-canceller set becomes a session-owned registry used by transform, preview,
mask/graph, resize, element-interaction and keyframe hooks. Cancelling in session A cannot invoke a
canceller registered by session B, and disposal clears only the owning registry.

A committed ownership inventory classifies the other C3-sensitive module state. Process definition
registries remain idempotent bootstrap state; source-image/sticker promise caches and frame identity
tables remain content-keyed process caches; custom presets and the underlying sounds library remain
user-level persisted data. New unclassified mutable editor/renderer singletons fail the boundary
check rather than silently growing the allowlist.

### 5. C0b runtime providers are adapted once per Host lifecycle without a JS readiness singleton

The Next and Vite Host controllers initialize the WASM runtime and construct live
`WasmRuntimeGraphicsQuery` and `WasmRuntimeGpuResourceQuery` adapters. Session creation receives
those exact providers. Backend, capacity and unavailability reason are always queried from the
runtime; neither Host stamps expected values.

C0b already coalesces initialization and rejects stale generations, so C3 removes
`gpuAvailable`/`initPromise` rather than layering a second process-global promise over it. Host
lifecycle generation guards prevent a stale initialization from publishing a session after
replacement or disposal. C1's unimplemented provider constants remain legal reference fixtures,
but no production Host-to-session path imports or supplies them.

### 6. One explicit compositor handle is owned and shared inside each session

The module singleton `wasmCompositor` is replaced by an injectable instance/factory. A session
allocates one explicit compositor handle lazily through C0b, immediately tracks the exact returned
handle in `session.resources`, and routes resize, canvas, upload, render and release calls through
handle-keyed exports. `CanvasRenderer`, preview, snapshot, thumbnail and export paths resolve the
owning session's renderer instead of constructing or importing a process default.

Multiple render views inside one session share that session's compositor handle; capacity describes
live compositor sessions, not JavaScript renderer objects. Disposal is idempotent and releases only
the owning handle. C3 does not call shared `disposeGpu()`; C6 owns last-owner shared teardown. The
legacy handle-0 exports remain for compatibility but are absent from the production editor graph.

Async renderer work captures the session lifecycle generation. Once disposal starts, stale work
cannot publish a frame, allocate a replacement handle or operate on another session's handle. An
allocation is tracked in the same synchronous turn that returns the handle, leaving no unowned gap.

### 7. MigrationDialog becomes a real subscribed consumer

`MigrationDialog` reads `project.getMigrationState()` through `useEditor(selector)`. A test seeds a
legacy storage migration, holds completion, observes the dialog in session A, completes the
migration and observes it disappear. Session B remains unaffected throughout. This repairs the C2
subscription seam without redesigning project storage, which remains C5 work.

### 8. Browser evidence is capability-first and backend-specific

A bounded Vite harness creates two explicit sessions and exposes their reported backend/capacity,
live handles, visible canvases and independent editor state. It queries capability before laying
out a second preview.

The WebGPU job requires an explicit executable-path environment variable pointing to installed
Chrome (known path `C:/Program Files/Google/Chrome/Application/chrome.exe`) and launches it with
`--enable-unsafe-webgpu --use-angle=d3d11`. It fails on missing/mismatched executable, fallback,
backend mismatch, capacity other than 2, non-distinct handles, or absence of two simultaneous
visible frames. The WebGL job uses Playwright's bundled Chromium, requires backend `webgl` and
capacity 1, proves the first preview renders, then proves the second request is explicitly rejected
while the first handle and frame remain intact. These jobs cannot substitute for each other.

### 9. Validation preserves the inherited evidence chain

C3 begins from the exact joint base, rebuilds WASM into the approved external Cargo target and
reinstalls dependencies before collecting evidence. It runs focused lifecycle/state/renderer tests,
both real-browser jobs, both Host builds and parity, the type ceiling, generated/API contracts,
all boundary checks, the eight legacy capability falsification sweep plus all S02 archived
capabilities, and the complete unimplemented-addition sweep.

`PATCHES.md` is updated for every inherited file relative to the pinned reference;
`SOURCE_INVENTORY.md` and `SOURCE_INVENTORY.json` are generated only from the committed tree.
`script/fixtures/type-baseline.json` and the parity oracle are byte-identical. The full Bun suite is
classified against the exact-base failure identities/signatures; expected red is recorded, never
called green, and no new failure/error is accepted.

## Risks / Trade-offs

- Keeping durable persist keys shared means two live sessions can race to save a user preference.
  That is intentional user-level persistence, while live StoreApi identity remains isolated; tests
  distinguish immediate isolation from later hydration.
- One compositor per session constrains internal multi-canvas ambitions, but it matches C0b's
  capacity contract and prevents snapshot/export helpers from accidentally consuming extra global
  capacity. A later Surface design may introduce explicit sub-surfaces without reviving a singleton.
- Installed Chrome WebGPU is environment-sensitive. The harness therefore treats launch identity,
  flags, backend and capacity as assertions and cannot silently fall back to bundled Chromium.
- Removing the no-selector overload touches many call sites. The classification test and gate reduce
  accidental non-reactive reads, while focused render-count tests guard against broad subscriptions.
- C3 releases compositor handles but deliberately does not own shared GPU shutdown. The boundary is
  documented so C6 can add last-owner teardown without undoing C3 ownership.

## Migration Plan

1. Establish exact-base evidence, nine-store/useEditor/singleton inventories and negative-control
   gates before changing production wiring.
2. Introduce the internal session-state registry, per-store factories and provider hooks; migrate
   consumers one store at a time while preserving persistence keys.
3. Remove the no-selector editor seam, session-scope cancellers and repair MigrationDialog.
4. Wire live C0b providers and explicit session compositor ownership through renderer callers.
5. Add two-session unit/integration and backend-specific real-browser evidence.
6. Run full falsification, parity, build, boundary, provenance and baseline-red gates; regenerate
   inventories from the committed tree.

Rollback is a normal commit revert. No persisted schema, Rust artifact or generated API changes,
and no destructive migration, are introduced by C3.

## Open Questions

None. C4 receives the per-session renderer/provider seam but still owns asset-base/root URL
resolution, Worker runtime resources, degraded no-rasterizer presentation and effect-preview asset
delivery. C5 receives unchanged shared durable substrates behind isolated live stores. C6 receives
the exact per-session compositor ownership/release seam and adds shared GPU last-owner teardown plus
the complete five-class leak harness.
