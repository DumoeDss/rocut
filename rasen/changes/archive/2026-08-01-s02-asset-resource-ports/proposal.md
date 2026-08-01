## Why

The frozen C1 asset and runtime-resource ports are not yet used by production consumers: both Hosts still inherit reference-only asset/Worker implementations, editor code still constructs root-absolute URLs and a transcription Worker directly, and a no-rasterizer declaration can still reach compositor work. C4 must close those delivery paths before storage inversion and shared-resource lifetime work can build on a truthful Host boundary.

## What Changes

- Supply immutable, base-aware browser implementations of `AssetResolver`, `RuntimeAssetLoader`, and `RuntimeResourceHost` from both production Host composition roots, without widening the frozen ports or public session shape.
- Route first-party fonts (including CSS mask URLs), flags, effect-preview imagery, Host branding, editor WASM, and the transcription Worker/ORT sidecar through non-root-safe production delivery; keep external, generated, navigation, media, and object/data/blob URLs outside the static-asset resolver.
- Move transcription Worker construction through the owning session's runtime-resource registry, retaining Host URL rewrite, message round-trip, termination, and session ownership semantics.
- Strengthen the runtime-asset manifest and production graph gates with non-empty category coverage, MIME, exact byte length, SHA-256, source and emitted-URL scans, and deliberate negative controls.
- Prove fresh Vite and Next production builds boot and exercise the editor under exclusive non-root bases without root first-party requests or reference-port fallbacks.
- Drive the existing `RendererManager.setDegraded` state and editor-root banner from the negotiated `EnvironmentCapabilities`; a constructible forced-none Host must remain live, produce no asynchronous error, and create no compositor handle.
- Preserve C3's session compositor/provider ownership, full render/export transaction, Host teardown, store/selectors, and exact inherited-red/type ceilings. Leave physical software-raster timing and actual no-rasterizer-machine survival to E1, and full five-class resource cleanup to C6.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-asset-delivery`: production delivery becomes base-aware for both Hosts, covers nested Worker/WASM output, verifies real bytes and manifest completeness, and proves visible compositor-free degradation.
- `host-port-contract`: production Hosts must consume the frozen asset/runtime-resource roles, the transcription Worker must cross the session resource port, and forced-none capability negotiation must survive through the existing degraded UI without Host-stamped runtime facts.

## Impact

This affects both Next and Vite composition/build roots; browser asset and runtime-resource adapters; font, flag, sticker, effect-preview, branding, and transcription consumers; preview/degraded-renderer guards; the Vite asset manifest/checker; production-boundary and non-root browser harnesses; and upstream provenance inventories. It adds no storage implementation, BrowserHostAdapter, shared GPU/service lifetime policy, Rust/WASM API change, generated WASM edit, or parity-oracle rebaseline.
