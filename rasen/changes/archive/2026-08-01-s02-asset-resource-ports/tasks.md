## 1. Baseline and failing controls

- [x] 1.1 Confirm the implementation worktree is clean at the recorded C3 integration commit/tree and record the exact commit, tree, branch, Node/Bun versions, and protected-file hashes in C4 evidence.
- [x] 1.2 Re-run the frozen port, reference, storage, session-state, and distributable boundary checks before editing and record their exact commands and exits without changing `apps/web/src/editor/ports/**`.
- [x] 1.3 Reproduce and record the pinned type ceiling of exactly three diagnostics and the inherited full-suite result of 222 pass, 8 fail, 2 module errors, and 552 expectations with the known failure identities.
- [x] 1.4 Add focused failing tests that show both production Host compositions currently select the in-memory asset resolver/loader and echo Worker for their final C4 roles.
- [x] 1.5 Add failing two-base fixtures that expose the current font, flag/sticker, and effect-preview first-session/global-cache contamination.
- [x] 1.6 Add failing boundary fixtures for root `fetch`, CSS `url`, dynamic `/flags`, direct editor `new Worker`, root emitted entry/Worker/WASM/ORT URLs, and an empty/truncated graph; prove every fixture exits non-zero and names its violation.
- [x] 1.7 Add failing forced-none real-surface coverage that reaches the ordinary preview/effect schedule and demonstrates the current compositor/error risk while preserving the C3 session harness.

## 2. Browser asset and runtime-resource implementations

- [x] 2.1 Add a Host-side browser asset/resource adapter module outside `editor/ports/**`, configured by an immutable normalized base URL and injectable fetch/Worker factories.
- [x] 2.2 Implement `AssetResolver` for logical no-leading-slash paths, reject root/path-traversal inputs, and test relative, absolute-origin, encoded, query, and trailing-slash bases.
- [x] 2.3 Implement `RuntimeAssetLoader.loadBytes` through the resolver with abort propagation, non-success diagnostics, and exact returned bytes.
- [x] 2.4 Implement `RuntimeAssetLoader.loadJson` through the same resolver with attributable status/content/parse errors and focused malformed/HTML-fallback tests.
- [x] 2.5 Implement the browser `WorkerHandle` adapter, including stable logical/resource identity, message/error subscription teardown, transfer lists, idempotent termination, and optional same-origin URL rewrite.
- [x] 2.6 Complete the browser `RuntimeResourceHost` interface without claiming consumer mediation for AudioContext/object URL, and keep those broader acquisition/lifetime assertions explicitly assigned to C6.
- [x] 2.7 Add focused tests proving two adapter instances with distinct bases/factories remain immutable and cannot share path, Worker, listener, or termination state.

## 3. Production Host composition and base configuration

- [x] 3.1 Compose the browser `assets`, `assetLoader`, and `runtimeResources` as explicit final overrides in `ViteEditorHost` while leaving non-C4 reference roles untouched for C5.
- [x] 3.2 Compose the same three browser roles as explicit final overrides in the Next editor Host and audit every Next/Vite project-picker or session root for the same final-role guarantee.
- [x] 3.3 Add composition tests that fail if either Host's final three C4 roles are the default `assets/` resolver, empty in-memory loader, or echo Worker.
- [x] 3.4 Configure Vite's build-time `base`, base-aware favicon/entry behavior, and Host adapter input from one canonical environment value.
- [x] 3.5 Configure Next's build-time `basePath`/asset prefix and Host adapter public base from one canonical environment value without teaching editor modules about Next routing.
- [x] 3.6 Make Next `soundSearchEndpoint` and `feedbackEndpoint` base-path-aware while retaining them under `EditorHost.services`, and verify Vite still declares unsupported services absent.
- [x] 3.7 Resolve each Host's branding logo from the Host's own asset resolver instead of a root-absolute constant while preserving the existing branding contract.
- [x] 3.8 Add a production composition/graph assertion that permits reference implementations only for roles deferred to C5/C6 and rejects reference fallback for the three C4 roles.

## 4. Font atlas, chunk, and CSS URL delivery

- [x] 4.1 Refactor `google-fonts.ts` to load the logical atlas through the session's `RuntimeAssetLoader` and resolve preload/chunk images through its `AssetResolver`.
- [x] 4.2 Replace module-global path-sensitive atlas/load caches with loader/resolver-keyed or final-URL-keyed caches, retaining only immutable shared font metadata globally.
- [x] 4.3 Thread session asset access through `EditorProvider` and `use-font-atlas` without adding a port React context or widening the public session/factory types.
- [x] 4.4 Replace `font-picker.tsx` root CSS mask URLs with safely quoted/escaped resolver results and test spaces, quotes, encoded characters, and non-root prefixes.
- [x] 4.5 Add atlas-shape validation and tests for missing/invalid entries, HTML fallback, abort, chunk load/decode failure, and a successful non-root atlas/chunk sequence.
- [x] 4.6 Mount two sessions with distinct atlas bytes and bases and assert fetches, preloads, computed mask URLs, and visible font results stay session-specific.

## 5. Flags, stickers, effect preview, and Host chrome

- [x] 5.1 Remove the root `/flags` base from the flags provider and carry the owning session's resolver through search, browse, and `resolveUrl` without mutable global configuration.
- [x] 5.2 Thread asset resolution through sticker insertion, timeline display, scene building, and `StickerNode` loading while preserving persisted logical sticker IDs.
- [x] 5.3 Key sticker image promises by resolved URL plus relevant dimensions rather than by sticker ID alone and add two-base cache-isolation coverage.
- [x] 5.4 Refactor effect-preview image acquisition so it resolves `effects/preview.jpg` per immutable asset identity instead of loading a root URL in the module-singleton constructor.
- [x] 5.5 Preserve immutable effect definitions while keying path/image/canvas state by resolver/final URL; document that full service disposal remains C6.
- [x] 5.6 Update both effect-preview consumer surfaces to supply session resolution and add non-root load/decode/nonblank preview tests.
- [x] 5.7 Make Vite favicon and both Host logos resolve below their configured base and verify non-zero image dimensions/content rather than status alone.
- [x] 5.8 Add a classification control proving generated SVG/canvas/data previews decode without using `AssetResolver` or issuing a first-party network request.

## 6. Session-owned transcription Worker

- [x] 6.1 Refactor the transcription singleton into a session-bound service/factory receiving `SessionResources` and `WorkerHandle`, with no process-shared mutable model/Worker state.
- [x] 6.2 Request the bundler-resolved transcription script through `session.resources.createWorker` using a stable logical Worker id, module type, and diagnostic name.
- [x] 6.3 Replace raw Worker event/postMessage calls with the frozen handle API and preserve initialization progress, transcription progress/result/error, cancellation, and model-switch behavior.
- [x] 6.4 Replace initialization polling with an owned promise/listener path so C4 does not introduce an untracked timer while leaving the repository-wide timer migration to C6.
- [x] 6.5 Wire `Captions` to the current `EditorSession`, release its service handle on model replacement/component teardown, and retain session disposal as the final exact-once owner.
- [x] 6.6 Add a tiny local Worker fixture that proves the Host receives logical id/type/name/requested URL, may rewrite it, and round-trips a message without a model download.
- [x] 6.7 Add tests for explicit termination, session disposal, listener removal, initialization rejection, two-session isolation, and no double termination/resource-registry leak.
- [x] 6.8 Tighten the production source boundary so only the Host browser adapter may construct a platform Worker and the deliberate editor-graph constructor fixture fails.

## 7. Asset manifest and content verification

- [x] 7.1 Update the explicit copied-asset allowlist metadata to use logical/base-relative paths and accurate consumers for fonts, flags, effects, logos, and favicon.
- [x] 7.2 Extend copied manifest entries with stable category and expected MIME family while preserving exact byte length, SHA-256, source path, required-by, totals, and exclusion reasons.
- [x] 7.3 Extend emitted bundle inventory with kind, entry/dynamic flags, exact bytes, SHA-256, and enough classification to identify entry, editor WASM, transcription Worker, and ORT sidecar.
- [x] 7.4 Strengthen `check-asset-manifest.mjs` to resolve below a supplied base and verify status, expected MIME, byte length, and SHA-256 for every copied entry.
- [x] 7.5 Add non-empty/category-complete assertions that fail on a missing allowlist category, deleted output, truncated manifest, or omitted Worker/WASM graph layer.
- [x] 7.6 Parse the served atlas and decode every referenced chunk plus effect-preview imagery with non-zero dimensions; retain byte/MIME checks for flags/logo/favicon.
- [x] 7.7 Preserve exclusion probes under the tested base and verify excluded marketing/PWA paths do not resolve as copied non-HTML assets.
- [x] 7.8 Add and record negative controls for SPA HTML with 200, correct MIME with wrong bytes/hash, missing copied file, truncated category, and empty emitted graph.

## 8. Source and emitted-URL boundary gates

- [x] 8.1 Implement a source production-graph scan that covers both Host/session roots and recognizes root `fetch`, image/source literals, CSS `url`, dynamic asset prefixes, and direct Worker construction.
- [x] 8.2 Implement emitted-output scanning for Vite and Next HTML/CSS/JS/chunks that rejects first-party entry, `_next`, asset, Worker, and editor-WASM URLs escaping the configured base.
- [x] 8.3 Inspect the actual emitted transcription Worker and reject a nested ONNX Runtime WASM sidecar rooted at `/assets` even when the outer Worker URL is correct.
- [x] 8.4 Make every positive graph check assert both Host roots and the Worker/editor-WASM/ORT layers are present so an empty or truncated scan cannot pass.
- [x] 8.5 Add named negative fixtures for all source and emitted patterns and assert each exits non-zero with the violated file/layer and URL.
- [x] 8.6 Fix emitted Worker/WASM paths only through Host/bundler configuration or a narrow build transform; stop and escalate if generated or Rust WASM sources appear necessary.
- [x] 8.7 Record the source and emitted URL inventories, counts, configured prefixes, negative-control exits, and output hashes in C4 evidence.

## 9. Forced-none degraded renderer survival

- [x] 9.1 Preserve `deriveGraphicsReport`, the live C0b provider injection, and `EditorProvider`'s existing `RendererManager.setDegraded` call; add no Host-stamped backend/capacity or parallel degraded state.
- [x] 9.2 Make preview startup observe `renderer.isDegraded` and substitute a stable unavailable/non-raster surface before any compositor render transaction begins.
- [x] 9.3 Make both effect-preview consumer paths observe the same manager state and skip `gpuRenderer` work when degraded.
- [x] 9.4 Make snapshot/export entry points return a visible rasterizer-unavailable result before creating a renderer when the manager is degraded, without weakening C3's full normal render/export transaction.
- [x] 9.5 Update the existing editor-root degraded banner copy/accessibility only as needed to describe renderer unavailability; keep `RendererManager` as its sole state source.
- [x] 9.6 Add the production-like forced-none test with poisoned runtime queries, real providers/editor surface, banner assertion, settled preview/effect schedule, live-session assertion, zero page errors/unhandled rejections, and null compositor handle.
- [x] 9.7 Label forced-none evidence as constructibility only and leave software-raster timing plus actual no-rasterizer-machine survival as explicit E1 work.

## 10. Fresh Vite non-root production proof

- [x] 10.1 Build Vite from a fresh output at an exclusive `/c4-vite/` base with a C4 full-commit/tree marker and verify the marker in source and compiled output before serving.
- [x] 10.2 Start only that production preview on an exclusive recorded port/PID, serve an origin-root decoy, open the exact prefixed URL, and verify the marker in the DOM.
- [x] 10.3 Run the strengthened manifest/hash/MIME/completeness check against the prefixed server and record copied/emitted counts, totals, hashes, exclusions, and negative-control results.
- [x] 10.4 Exercise project boot, atlas/chunk masks, flags/stickers, effect preview, branding/favicon, generated graphics, Worker fixture, and editor WASM instantiation with network capture.
- [x] 10.5 Assert zero first-party request outside `/c4-vite/`, zero HTML fallback/wrong MIME, zero page error/unhandled rejection, and no production fallback to the three reference C4 roles.
- [x] 10.6 Stop only the recorded C4 Vite PID and retain the build log, URL, network log, console/page-error log, screenshots, marker, and artifact hashes as evidence.

## 11. Fresh Next non-root production proof

- [x] 11.1 Remove/recreate the C4 Next output, provide the nine recorded build variables plus an exclusive `/c4-next` base setting and C4 full-commit/tree marker, and run a forced fresh production build.
- [x] 11.2 Verify the marker and prefix in compiled output, then start only that standalone build on an exclusive recorded port/PID with an origin-root decoy.
- [x] 11.3 Open the exact prefixed editor route and exercise project boot, assets, Host branding, Worker fixture, editor WASM, and base-aware Host service locations with network capture.
- [x] 11.4 Scan Next emitted HTML/CSS/JS/Worker/WASM layers and assert zero root `/_next`, static asset, API-service, Worker, editor-WASM, or nested-sidecar URL.
- [x] 11.5 Assert the existing degraded force-none surface also passes in the production-like Host setup with no compositor handle, page error, or unhandled rejection.
- [x] 11.6 Stop only the recorded C4 Next PID and retain the forced-build log, environment-name list without secrets, URL, network/console logs, marker, screenshots, and output hashes.

## 12. Regression, provenance, and handoff

- [x] 12.1 Re-run frozen port/reference/storage/distributable/session-state checks and prove no protected C1 port/public session shape or C5 persistence behavior changed.
- [x] 12.2 Re-run C0b WASM source/path/API/binary-integrity and capability tests without rebuilding or editing Rust/generated WASM unless a separately approved stop-condition resolution exists.
- [x] 12.3 Re-run C3 compositor ownership, capacity, full render/export exclusivity, generation teardown, store-selector/state-isolation, and Vite boundary harnesses.
- [x] 12.4 Re-run the protected Next/Vite parity suites without changing parity fixtures/snapshots and classify every semantic/incidental delta against the C3 baseline.
- [x] 12.5 Re-run focused C4 tests, Vite typecheck, the exact three-diagnostic type ceiling, and the full suite; stop on any new diagnostic/failure identity rather than changing a baseline fixture.
- [x] 12.6 Append `PATCHES.md` rows for every behaviorally modified inherited file while preserving old rows and excluding newly created files; leave SBOM/upstream records unchanged unless their assertions actually changed.
- [x] 12.7 Regenerate `SOURCE_INVENTORY.json` and `SOURCE_INVENTORY.md` with the canonical script, run `git diff --check`, classify every changed/untracked path, and finish with a clean implementation worktree.
- [x] 12.8 Write the C4 handoff with exact commands/exits, commit/tree/build markers, ports/PIDs, artifact paths/hashes, requirement/scenario coverage, inherited-red classification, C5/C6 overlap, E1 unknowns, and every hard stop encountered or ruled out.
