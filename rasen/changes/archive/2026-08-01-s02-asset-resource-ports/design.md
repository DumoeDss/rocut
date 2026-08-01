## Context

C1 froze logical asset and runtime-resource ports, and C3 made their resolved Host available from each `EditorSession`. Production wiring has not caught up. Both Next and Vite currently spread `createInMemoryPorts()`, so the final `assets`, `assetLoader`, and `runtimeResources` roles are reference implementations unless explicitly replaced. Editor consumers also retain root-absolute font, flag, effect-preview, and branding paths, while transcription owns a process-global `Worker` constructed outside `SessionResources`.

The build boundary is wider than those source literals. Vite currently emits root-absolute entry URLs, the editor WASM, a transcription Worker, and an ONNX Runtime WASM sidecar referenced from inside that Worker. A source-only scan can therefore pass while a non-root production deployment still fails. The existing asset checker is better than a status-only smoke test—it rejects HTML fallbacks and checks byte length—but it does not verify the recorded hash, an expected MIME family, emitted URLs, or a non-empty category-complete graph.

Graphics capability is already derived from the Host declaration plus live C0b queries. `EditorProvider` already calls `RendererManager.setDegraded(...)`, and `EditorRoot` already renders the degraded banner. The remaining C4 defect is that preview/effect work can still reach the compositor/GPU after the manager becomes degraded. The forced-none path is a constructibility test only; packaged default rendering and GPU-context reachability are already measured, while software-raster timing and an actual no-rasterizer machine remain E1 unknowns.

The integration base for implementation is `feat/session-runtime-host-ports` at commit `507cecf456ed68007c60829be5c3c41bebf64a5d` (tree `2dd46187ff2d31b026010cb3d6573dcf099441d3`). C3's session compositor/provider ownership, full render/export transaction, Host generation teardown, store selectors, and state identities are protected behavior.

### Complete active-spec falsification sweep

The active main-spec set contains thirteen capabilities. Only two are falsified by C4 and receive deltas:

- `runtime-asset-delivery`: stale because it proves only the Vite root deployment, accepts weaker asset evidence, omits emitted/nested URLs, and defers the no-rasterizer behavior C4 now owns.
- `host-port-contract`: stale because reachability is not production consumption, transcription still constructs its Worker directly, and the no-rasterizer scenario still labels visible delivery as a future C4 boundary.

The other eleven remain unchanged: `browser-persistence-boundary` is C5; `editor-session-runtime` retains its broader five-resource-class C6 obligation even though C4 closes Worker acquisition; `host-service-boundary` keeps first-party APIs on Host services; `developer-reproducibility`, `editing-parity-fixture`, `inherited-defect-repair`, `next-free-distributable-boundary`, `self-built-wasm-artifact`, `session-state-isolation`, `upstream-provenance`, and `wasm-api-surface` keep their existing requirements. C4 executes their relevant gates/provenance duties but does not change their normative behavior.

## Goals / Non-Goals

**Goals:**

- Make both production Hosts supply real, immutable, base-aware asset/loader/runtime-resource implementations through the frozen C1 roles.
- Resolve every first-party editor/runtime asset from a logical path, including font CSS URLs, while keeping per-session/base caches isolated.
- Acquire transcription Workers through the owning session, permit Host same-origin rewrite, and validate both the outer Worker and nested ORT WASM URL after bundling.
- Boot fresh Vite and Next production outputs at exclusive non-root bases with no root first-party request, stale-server evidence, or reference-role fallback.
- Preserve and strengthen the manifest's content/anti-vacuity proof with MIME, length, SHA-256, category coverage, exclusions, and negative controls.
- Make a Host-forced no-rasterizer session show the existing degraded banner, stay live without asynchronous errors, and retain no compositor handle.

**Non-Goals:**

- No C5 persistence inversion, browser store, `BrowserHostAdapter`, or provider-private payload work.
- No C6 last-owner GPU policy, process-shared service ownership, five-resource-class closure, object-URL/audio/timer migration, or repeated-cycle leak claim.
- No C7 headless runner, D2 renderer replacement, Rust/generated WASM/API change, or parity/type oracle rebaseline.
- No repeat of facts already answered by C0b: the default packaged timeline works and WebGPU/WebGL contexts are reachable.
- No claim that forced-none emulates physical no-rasterizer hardware or measures software-raster performance; E1 owns those observations.

### Expected implementation touch set

- Host/build roots: `apps/vite-example/src/host/**`, any Vite picker/session composition root,
  `apps/vite-example/{index.html,vite.config.ts}`, `apps/web/src/app/editor/[project_id]/page.tsx`,
  any Next picker/session composition root, and `apps/web/next.config.ts`.
- New production adapters and focused tests: Host-side browser asset/resource modules outside
  `apps/web/src/editor/ports/**`, plus composition/conformance fixtures.
- Asset consumers: `apps/web/src/fonts/**`, `components/ui/font-picker.tsx`, flags/sticker resolver,
  timeline/scene/sticker-node call chains, `services/renderer/effect-preview.ts`, its two consumer
  surfaces, and Host branding/favicon inputs.
- Runtime/degraded consumers: `services/transcription/**`, captions assets view, preview surface,
  `core/managers/renderer-manager.ts`, and the existing degraded banner. The C3 session Host/runtime
  files are touched only if a minimal internal forced-none guard is proven necessary.
- Gates/evidence: `apps/vite-example/build/editor-assets.ts`, manifest/source/emitted checks under
  `script/`, C4 Playwright/unit fixtures and configs (not parity oracles), `PATCHES.md`, and generated
  `SOURCE_INVENTORY.{json,md}`.

Default-protected paths are `apps/web/src/editor/ports/**`, public C1 session shapes,
`script/fixtures/type-baseline.json`, `apps/vite-example/tests/parity/**`,
`script/diff-parity-snapshots.mjs`, `rust/wasm/**`, and generated `rust/wasm/pkg/**`.

## Decisions

### D1. Compose one immutable browser asset/resource bundle per Host instance

Add a Host-side browser implementation outside the protected `editor/ports/**` contract directory. Its constructor receives an immutable base URL (plus injectable fetch/Worker factories for tests) and returns complete `assets`, `assetLoader`, and `runtimeResources` roles. `AssetResolver` accepts only logical paths, resolves them below that base, and returns the result opaquely. `RuntimeAssetLoader` uses the same resolver and fails at the acquisition boundary on non-success or invalid JSON.

Both Host roots may retain reference roles that C5 has not yet replaced, but they SHALL assign the browser `assets`, `assetLoader`, and `runtimeResources` properties after the reference spread. A focused composition/graph gate asserts the final three values are production adapters and cannot fall back to the in-memory asset loader or echo Worker. This keeps C4 out of storage while making its three roles truthful.

**Alternative rejected:** a mutable `setAssetBase()` singleton. It makes the first mounted Host win and lets two sessions contaminate one another. A new asset React context is also rejected because C1 deliberately routes ports through `EditorSession`, not a parallel consumer surface.

### D2. Thread session asset access to consumers and key caches by immutable identity

React consumers read `useEditorSession().host.assets`/`assetLoader`; non-React rendering paths receive the resolver through existing session-owned manager/factory construction. Font atlas loading accepts the session loader, font chunks and CSS masks accept the resolver, sticker resolution carries the resolver through the existing registry/render call chain, and effect-preview acquisition becomes resolver-specific rather than constructor-time singleton work. Host branding resolves the same logical logo in each composition root.

Module caches may retain immutable datasets, but URL/byte/image promises SHALL be keyed by the loader/resolver identity or final resolved URL, never only by a logical id. CSS `url(...)` generation quotes and escapes the opaque resolved value. Tests mount two simultaneous sessions at distinct bases with distinct atlas fixtures and prove atlas, chunk masks, flags, logos, and effect preview never cross bases.

**Alternative rejected:** prefixing current strings with `window.location.pathname` or `document.baseURI` in editor modules. That guesses Host routing, cannot support custom schemes/archive loaders, and bypasses the frozen port.

### D3. Keep the asset classification narrow and explicit

First-party static inputs in C4 are fonts/atlas/chunks, flags, effect-preview imagery, branding/favicon, bundler entry/chunks, editor WASM, the transcription Worker, and its ORT sidecar. Google/gstatic font delivery, Hugging Face models, Brandfetch, Freesound results, imported media, OPFS/blob/object/data URLs, generated SVG/canvas previews, fragment URLs, and navigation destinations remain outside `AssetResolver`. `/api/sounds/search` and `/api/feedback` remain `EditorHost.services`; the Next Host only makes their locations base-path-aware.

The source boundary check uses this classification as an allow/deny inventory and includes negative fixtures for root `fetch`, CSS `url`, dynamic prefixes, and direct editor-graph `new Worker`. Generated graphics is exercised as a negative classification control: it must decode without causing a first-party request.

### D4. Make transcription a session-resource consumer, not a process owner

Refactor the transcription service into a session-bound instance/factory receiving `SessionResources`. It requests the bundler-resolved Worker URL with a stable logical `WorkerId`, type, and name through `session.resources.createWorker`; it communicates only through `WorkerHandle`. Initialization sharing uses an owned promise/listener rather than an untracked polling timer. Model change/cancel/termination releases the handle, and session disposal remains the final owner.

The browser RuntimeResourceHost is the sole production-adapter location allowed to call the platform `Worker` constructor and may rewrite the requested URL before construction. A tiny same-origin Worker fixture proves rewrite, module/classic metadata, round trip, termination, and session registry ownership without downloading a transcription model. The actual emitted transcription Worker and ORT sidecar are still inspected even though model inference is not a core C4 gate.

**Alternative rejected:** moving `new Worker` behind another editor service. That hides the constructor without crossing the Host same-origin boundary or entering session ownership.

### D5. Use build-time Host bases and test the exact prefixed routes

Vite derives `base` from one C4-capable environment setting, lets Vite rewrite entry/chunk/WASM URLs, makes favicon/source references base-relative, and supplies `import.meta.env.BASE_URL` to the Host adapter. Next derives `basePath`/asset prefix and its public base from one build-time setting, supplies the same value to its Host adapter, and keeps API service URLs below it. Router navigation remains owned by Next rather than being rewritten inside the editor.

Validation uses exclusive prefixes such as `/c4-vite/` and `/c4-next`, origin-root decoys, fresh empty output directories, exclusive ports/PIDs, and a C4 full-commit/tree marker present in source, DOM, and compiled output. Vite is tested from served production output; Next is force-built with the known nine environment variables and started from that exact output. C3 servers, markers, `dist`, and `.next` outputs are not reusable evidence.

**Alternative rejected:** a runtime-only base switch over already-built output. Next chunk/public paths and nested bundler URLs are decided during build, so runtime rewriting alone cannot prove the artifact.

### D6. Verify copied bytes and the complete emitted resource graph

Keep the explicit Vite copy allowlist as the copied-asset source of truth, but emit logical/base-relative manifest paths plus category, expected MIME, byte length, and SHA-256. Record equivalent hash/size/kind data for bundler outputs. The checker resolves every entry below the tested base, verifies status, MIME family, length, and SHA-256, parses the atlas shape, decodes every referenced chunk/effect image, preserves exclusion probes, and rejects empty or category-incomplete inventories.

A separate source/output boundary pass inspects both production dependency roots and emitted Vite/Next HTML, CSS, JS, Worker, and WASM references. It must name and reject root entry/CSS URLs, root Worker/WASM URLs, the nested ORT sidecar, direct editor Worker construction, and a graph that omits a Host or Worker/WASM layer. Deliberate fixtures prove HTML-200 fallback, same-MIME wrong bytes, deleted/truncated inventory, and every URL-pattern rule fail non-zero.

**Alternative rejected:** relying on network `404` counts. SPA fallback can return HTML with 200, and an unexercised lazy Worker/sidecar can remain broken without any request.

### D7. Use the existing degraded manager state as the only graphics gate

Retain `EnvironmentCapabilities` plus live C0b query derivation and `EditorProvider`'s existing `RendererManager.setDegraded` call. Do not add a Host backend/capacity constant or a second degraded store. Preview and effect consumers subscribe to `renderer.isDegraded` and skip GPU/compositor work, presenting a stable non-raster preview/unavailable result. Snapshot/export entry points fail visibly before raster work when degraded.

The forced-none test poisons runtime query methods, proving Host-forced negotiation does not consult or fabricate live backend/capacity. It mounts the real provider/editor surface, waits past ordinary preview/effect scheduling, asserts `source: "host-forced"`, `backend: null`, capacity `0`, the existing banner, a live session/page, zero page errors/unhandled rejections, and `getCompositorHandle() === null`.

**Alternative rejected:** catching compositor failures after allocation. A visible banner next to an unhandled render rejection is not degradation, and it does not prove the no-rasterizer Host is constructible.

### D8. Preserve C3 ownership and provenance while integrating

C4 may pass resolver/resource dependencies through session-owned constructors and add the minimum degraded guards, but it SHALL preserve one nonzero compositor per session, exact-once handle release, the full render/export exclusivity transaction, generation-safe Host teardown, and stable selectors/state. It SHALL not reintroduce `disposeGpu`, module-scoped live provider promises, Host-stamped runtime values, or shared mutable base/Worker state.

After implementation, regenerate `SOURCE_INVENTORY.json` and `SOURCE_INVENTORY.md`; append `PATCHES.md` rows for every behaviorally modified inherited file and no newly created file; preserve all existing rows. The type ceiling remains exactly three diagnostics and the inherited suite remains 222 pass, 8 fail, 2 module errors, 552 expectations with the recorded failure identities.

## Risks / Trade-offs

- **[Nested dependency emits a root ORT sidecar despite a correct outer Worker]** → Inspect the emitted Worker and configure/transform at the bundler/Host layer; stop if resolution appears to require editing generated or Rust WASM artifacts.
- **[Reference ports remain importable because C5 has not replaced storage]** → Assert the final production Host values for the three C4 roles and fail focused composition/graph tests on in-memory asset/Worker instances, while explicitly allowing unrelated reference roles until C5.
- **[Singleton caches leak the first Host base]** → Key all path-sensitive caches by resolver/loader/final URL and run two simultaneous bases in one process.
- **[A static fallback makes missing assets look healthy]** → Verify MIME, exact bytes, hash, parse/decode behavior, completeness, and deliberate corrupt/fallback fixtures.
- **[Degraded UI still schedules raster work]** → Observe the existing manager state at every preview/effect entry and assert zero compositor handle plus zero asynchronous errors after settling.
- **[C4 drifts into C6 cleanup work]** → Limit claims to Worker mediation, path delivery, and forced-none suppression; record remaining direct AudioContext/object URL/timer/full graphics lifetime work for C6.
- **[Non-root proof uses stale output or a root that accidentally serves assets]** → Use fresh build directories, exclusive prefixes/ports/PIDs, root decoys, and exact C4 source/DOM/bundle markers.
- **[C3 behavior regresses while dependencies are threaded]** → Re-run capability, session-state, compositor ownership/concurrency, WASM integrity, boundary, and parity gates without changing their oracles.

## Migration Plan

1. Add focused failing tests/negative fixtures for browser adapter composition, two-base isolation, direct Worker acquisition, emitted-root URLs, and forced-none compositor survival.
2. Add the Host-side browser asset/resource bundle and explicitly override the three C4 roles in both production Hosts.
3. Thread logical asset access through fonts, CSS masks, flags/stickers, effect preview, and branding; remove every classified root-absolute first-party acquisition.
4. Refactor transcription onto `SessionResources` and validate the rewrite-capable browser Worker handle with a tiny fixture.
5. Configure Vite and Next non-root builds, strengthen manifest/output checks, and fix nested Worker/WASM paths at bundler/Host boundaries only.
6. Apply degraded guards using the existing manager/banner path, then run the forced-none real-surface proof.
7. Run fresh production/browser, protected C3/WASM/parity, type-ceiling, and classified full-suite gates; regenerate provenance and finish with a clean classified tree.

Rollback is a single C4 revert: there is no persisted-data migration or port signature change. Stop rather than partially land if either Host retains a C4-role fallback, any first-party request escapes the prefix, the nested sidecar remains rooted, forced-none allocates a compositor/throws asynchronously, a protected oracle needs editing, or a new failure cannot be classified against the inherited ceiling.

## Open Questions

No product-contract question is open. Implementation must discover the narrowest bundler configuration needed to make the emitted ORT sidecar base-aware; if the only apparent solution changes generated/Rust WASM or dependency-owned output, that is a stop condition for LEAD review rather than permission to widen C4.
