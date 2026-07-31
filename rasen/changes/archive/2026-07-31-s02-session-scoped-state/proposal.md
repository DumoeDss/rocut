## Why

C0b and C2 now coexist on one review-clean baseline, but they are still deliberately unjoined: the
running Hosts use C1's unimplemented graphics providers, one module-level compositor, nine
process-global Zustand stores, and a `useEditor()` no-selector form that never subscribes. A second
session therefore has a distinct core but can still share UI, renderer and graphics state, and
`MigrationDialog` still cannot react to live migration progress.

C3 is the first integration child that may consume both prerequisites. It must turn the frozen
contracts into observable two-session isolation, including honest backend-specific preview capacity,
before asset delivery (C4) or storage inversion (C5) adds another dependency to the same seam.

## What Changes

- Give every `EditorSession` its own instances of all nine named editor-graph Zustand stores:
  panel, editor bootstrap, preview, timeline, sounds, stickers, keybindings, properties and assets
  panel. Preserve durable preference compatibility without sharing a live StoreApi, listener set,
  request generation or ephemeral state between sessions.
- Add a session-state owner/provider and migrate every React and imperative consumer away from the
  nine module-level stores. Session-scope the interaction-canceller registry; explicitly classify
  the remaining module-level renderer/cache/definition state as session-owned or deliberately
  process-shared with a falsifiable reason.
- Remove the non-reactive `useEditor()` overload and `subscribeNone`. Reactive reads use selectors;
  intentionally imperative consumers use an explicitly named stable-instance hook. A committed gate
  rejects a no-selector `useEditor()` call, an empty subscription, a static named store, an incomplete
  nine-store registry and either retained C1 unimplemented provider in the production Host graph.
- Replace `UNIMPLEMENTED_RUNTIME_GRAPHICS` and `UNIMPLEMENTED_RUNTIME_GPU` in both Host paths with
  C0b's live WASM providers. GPU initialization is generation-safe and runtime-derived; no Host may
  stamp a backend or preview count.
- Replace the JavaScript default compositor singleton with one explicit C0b compositor handle per
  live session. `CanvasRenderer`, preview, snapshot, thumbnail and export paths receive the owning
  session renderer; the session resource registry tracks and releases the exact runtime handle.
  The legacy handle-0 WASM API remains available for compatibility but is absent from the running
  editor graph.
- Repair `MigrationDialog` with a subscribed project-migration selector and prove it appears during
  a seeded legacy migration, updates from that session only, and disappears on completion.
- Add a two-session unit/integration harness proving independent core, all nine stores, project,
  selection, command/undo, playback/playhead, save and renderer state, including stale async
  completion and disposal ownership.
- Add a real-browser dual-preview harness. Installed Chrome is launched through an explicit
  executable-path environment variable with `--enable-unsafe-webgpu --use-angle=d3d11`; it must
  report WebGPU/capacity 2 and show two distinct live handles and two simultaneously visible frames.
  A separate real WebGL run must report capacity 1, render the first preview and explicitly reject
  the second without replacing or disguising the first. Backend mismatch or browser fallback is a
  failure, never acceptable evidence.
- Preserve both production Hosts and the existing parity oracle. Run fresh WASM/install/Next/Vite,
  type, asset, storage, Next-import, distributable, reference, port, singleton, state-isolation and
  parity gates; classify the full Bun baseline-red set instead of treating known failures as green.

## Capabilities

### New Capabilities

- `session-state-isolation`: per-session editor stores and interaction state, subscribed editor
  reads, migration visibility, independent renderer/compositor ownership and the two-session
  evidence contract on WebGPU and WebGL.

### Modified Capabilities

- `editor-session-runtime`: C3 replaces C1's graphics/GPU placeholders, attaches session-owned
  state and renderer resources to the explicit C2 session, and closes the no-selector subscription
  seam that C2 intentionally deferred.
- `host-port-contract`: preview concurrency becomes a live Host-askable runtime report proven honest
  on distinct WebGPU and WebGL executions, including explicit over-capacity refusal.
- `wasm-api-surface`: the running editor migrates from reserved handle 0 to explicit session-owned
  handles while retaining the additive compatibility surface; C0b's temporary "before C3 wiring"
  condition is superseded by integration evidence.

## Impact

**Exact base:** `2df009c9e1729e2ac933c0bd54762d744433073b`, tree
`984bd269aef0f6c3a0060ff0573b65707b262c24`. No earlier C0b or C2 head qualifies.

The primary write set is `apps/web/src/editor/{session,runtime,use-editor,panel-store,editor-store}`;
the other seven named store modules and all their consumers; `editor/cancel-interaction.ts`;
`services/renderer/{gpu-renderer,canvas-renderer,scene-exporter,compositor/wasm-compositor}`;
`core/{index,managers/renderer-manager,managers/project-manager}`; preview and migration consumers;
both Host composition roots; a bounded Vite two-session harness; focused tests and a new
session-state boundary check. `PATCHES.md` records every inherited file and
`SOURCE_INVENTORY.{md,json}` is regenerated from the committed tree.

No Rust or generated WASM source changes are allowed. C3 consumes C0b's exact generated API and
C1's existing public types without widening either contract. It does not take C4 asset-base,
Worker/runtime-resource delivery or degraded-renderer work; C5 storage inversion; C6's complete
five-resource disposal/leak harness; C7 headless editing; S03 transactions; or S04 Surface work.
`script/fixtures/type-baseline.json` and the parity fixture are not re-baselined.
