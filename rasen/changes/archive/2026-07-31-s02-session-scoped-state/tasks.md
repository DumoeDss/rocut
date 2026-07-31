## 1. Freeze the exact C3 baseline

- [x] 1.1 Create a dedicated clean C3 implementation worktree at commit `2df009c9e1729e2ac933c0bd54762d744433073b`; record `git rev-parse HEAD` and `git rev-parse HEAD^{tree}`, and stop if the tree is not `984bd269aef0f6c3a0060ff0573b65707b262c24` or if tracked/untracked product files are already present.
- [x] 1.2 Record the pre-change hashes of `script/fixtures/type-baseline.json`, the parity fixture/oracle and all generated API declarations; make later byte-identity checks fail rather than regenerate those fixtures.
- [x] 1.3 Rebuild the pinned WASM from the exact base with `$env:CARGO_TARGET_DIR='C:\Users\Sayo\cargo-target'; bun run build:wasm`, reinstall with `bun install --frozen-lockfile`, and stop on a Rust/generated-surface mismatch instead of editing generated or Rust source in C3.
- [x] 1.4 Run and record the exact-base `bun test` result, including each failure/error identity and signature (current joint-base expectation: 219 pass, 8 fail, 2 errors); stop if the observed baseline differs until the discrepancy is reconciled.
- [x] 1.5 Set the nine reproducible web-build variables (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_MARBLE_API_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `MARBLE_WORKSPACE_KEY`, `FREESOUND_CLIENT_ID`, `FREESOUND_API_KEY`) to the documented local/dummy values and run the exact-base Next and Vite builds plus `node script/check-type-baseline.mjs`.
- [x] 1.6 Mechanically inventory all nine module-created stores, every direct/static store consumer, every no-selector `useEditor()` call, `subscribeNone`/empty subscriber, `MigrationDialog` consumer, interaction-canceller user, default compositor/GPU readiness singleton and renderer construction site; commit the re-runnable oracle output or assertions, not a prose-only count.
- [x] 1.7 Trace both production Host roots transitively to `createEditorSession`, the C1 unimplemented providers, runtime initialization and compositor calls; record the before-state proving the two unimplemented providers and handle-0/default-compositor path are live before C3.

## 2. Establish falsifiable C3 boundary gates

- [x] 2.1 Add a session-state boundary checker that rejects module-created instances of any of the nine stores, an incomplete/duplicate registry, direct static store access, the default compositor, process-global interaction cancellers and module GPU readiness flags/promises in the production editor graph.
- [x] 2.2 Add positive and negative controls for the state checker, including aliased store creators, renamed imports, whitespace/comment variations and a deliberately missing ninth store; prove every negative control fails for the intended reason.
- [x] 2.3 Extend the editor-singleton boundary checker to reject no-argument/optional/aliased `useEditor()` calls, `subscribeNone`, empty `useSyncExternalStore` subscribers and an equivalent facade while accepting `useEditor(selector)` and `useEditorInstance()` positive controls.
- [x] 2.4 Extend the production dependency-graph gate to reject either C1 `UNIMPLEMENTED_RUNTIME_GRAPHICS`/`UNIMPLEMENTED_RUNTIME_GPU` provider, Host-stamped backend/capacity answers and no-handle/handle-0 compositor calls reachable from either Host.
- [x] 2.5 Add a committed ownership inventory for every C3-sensitive module-level value and make the gate reject a new mutable editor/renderer singleton that is neither session-owned nor present in the narrowly justified process-shared classification.

## 3. Build the per-session state registry

- [x] 3.1 Write red lifecycle tests for two complete, distinct nine-store registries, missing/duplicate registry rejection, lookup outside a provider and lookup after disposal.
- [x] 3.2 Introduce the private `EditorSessionStores` type, exhaustive nine-key constructor and WeakMap/session binding without changing `createEditorSession({ host, runtimeGraphics, runtimeGpu })` or the public `EditorSession` shape.
- [x] 3.3 Bind the registry during session creation, make partial creation rollback-safe, and remove the binding during idempotent session disposal so no disposed session resolves a default or another registry.
- [x] 3.4 Convert `panel-store.ts` to export a vanilla store factory/type, preserve `panel-sizes`, and migrate every panel consumer to the owning session store.
- [x] 3.5 Convert `editor-store.ts` to a vanilla store factory/type and migrate its bootstrap/loading consumers without retaining a module StoreApi.
- [x] 3.6 Convert `preview-store.ts` to a vanilla store factory/type, preserve `preview-settings`, and migrate playback/preview consumers to session ownership.
- [x] 3.7 Convert `timeline-store.ts` to a vanilla store factory/type, preserve `timeline-store`, and migrate timeline UI/interaction consumers to session ownership.
- [x] 3.8 Convert `sounds-store.ts` to a vanilla store factory/type; keep the underlying user library/storage service explicitly shared for C5, but isolate query/results/loading/error/request-generation state and migrate all consumers.
- [x] 3.9 Convert `stickers-store.ts` to a vanilla store factory/type, preserve `stickers-settings`, move `browseRequestVersion` into the store closure and migrate all consumers.
- [x] 3.10 Convert `keybindings-store.ts` to a vanilla store factory/type, preserve `opencut-keybindings`, separate durable preference hydration from session-live UI state and migrate all consumers.
- [x] 3.11 Convert `properties-store.ts` to a vanilla store factory/type and migrate all properties-panel consumers.
- [x] 3.12 Convert `assets-panel-store.tsx` to a vanilla store factory/type, preserve `assets-panel`, and migrate all assets-panel consumers.
- [x] 3.13 Add typed React selector hooks and explicit imperative accessors over the session registry; ensure all selectors call Zustand `useStore` with the owning StoreApi rather than copying state into React context.
- [x] 3.14 Add hydration tests proving two sessions seeded from the same persisted preferences have distinct StoreApi/listener identities, immediate live isolation and compatible later-session durable hydration.
- [x] 3.15 Add async-generation tests for sounds and stickers proving out-of-order completion, session disposal and cross-session requests cannot publish into the wrong store.

## 4. Close the editor subscription seam

- [x] 4.1 Write red hook tests for session-specific selector updates, no cross-session re-render, stable imperative core access and actionable missing-provider failure.
- [x] 4.2 Remove the no-argument `useEditor()` overload and `subscribeNone`; add `useEditorInstance()` for intentionally imperative/event-only access while keeping the selector overload's C2 manager subscriptions.
- [x] 4.3 Classify every inventoried no-selector call site: convert render-time reads to the narrowest `useEditor(selector)` and convert event/construction-only callers to `useEditorInstance()`; leave zero unclassified sites.
- [x] 4.4 Add render-count tests for representative selector and imperative consumers so the repair neither misses updates nor subscribes stable event plumbing to every manager.
- [x] 4.5 Change `MigrationDialog` to select `project.getMigrationState()` reactively; seed and defer a real legacy migration, assert the dialog appears/updates/disappears in session A, and assert session B remains unaffected.

## 5. Session-scope remaining mutable interaction state

- [x] 5.1 Replace the module interaction-canceller set with a registry owned by the explicit session and migrate transform, preview, mask/graph, resize, element-interaction and keyframe registrations/cancellation.
- [x] 5.2 Test simultaneous cancellers in two sessions, session-local cancellation and disposal cleanup that leaves the other session's callbacks usable.
- [x] 5.3 Reconcile the ownership inventory against actual code: retain only idempotent definitions, content-keyed image/sticker/frame caches, custom user presets, underlying sounds data and explicitly deferred C6 resources as process-shared; remove or session-scope every other mutable singleton.

## 6. Wire live C0b runtime providers into both Hosts

- [x] 6.1 Add TypeScript adapters that implement the frozen C1 graphics/GPU query interfaces by calling C0b's exact runtime exports for selected backend, concurrent compositor count, unavailability reason, live handles and exact release.
- [x] 6.2 Remove the JavaScript `gpuAvailable`/`initPromise` readiness singleton and rely on C0b's coalesced generation-safe initialization, keeping Host lifecycle generation checks around publication and disposal.
- [x] 6.3 Update the Next Host controller/composition root to await live runtime readiness and supply the two C0b adapters to `createEditorSession`; do not stamp backend, capacity or an expected launch result.
- [x] 6.4 Update the Vite Host controller/composition root through the same contract and prove the production transitive graph contains neither C1 unimplemented provider while the reference fixture exports remain unchanged.
- [x] 6.5 Add concurrent-initialization and stale-Host-generation tests proving C0b initialization coalesces, a replaced Host cannot publish a session and the resulting sessions still own distinct state/providers.

## 7. Make compositor ownership explicit per session

- [x] 7.1 Write red renderer tests for one nonzero handle per session, two distinct WebGPU handles, exact live-handle reconciliation, no handle-0 production call and release of only the disposed session's handle.
- [x] 7.2 Refactor `WasmCompositor` from a module instance to an injectable session-owned object that lazily calls `createCompositor`, immediately tracks the returned handle and uses handle-keyed resize/canvas/upload/render/release methods.
- [x] 7.3 Make allocation rollback- and disposal-safe: capture session generation, synchronously track a returned handle, reject stale continuations and release the exact handle once without calling shared `disposeGpu()`.
- [x] 7.4 Inject the owning compositor into `CanvasRenderer` and the renderer manager; remove all imports or construction paths that can fall back to a process default.
- [x] 7.5 Route live preview, renderer snapshots and project thumbnail generation through the owning session renderer without allocating extra compositor capacity.
- [x] 7.6 Route scene export and effect/mask preview renderer entry points through explicit session ownership; keep C4 asset/Worker delivery and C6 full shared-service disposal out of scope.
- [x] 7.7 Test preview/snapshot/thumbnail/export reuse of one handle inside a session, disposal during allocation/first render and rejection of stale work without affecting a concurrently live session.

## 8. Prove two-session isolation below the browser

- [x] 8.1 Add a two-session integration fixture with distinct in-memory Host ports, diagnostics and projects; assert distinct cores, managers, registries and compositor/provider ownership.
- [x] 8.2 Mutate a discriminating value in every one of the nine stores in A and then B, asserting symmetric live isolation and listener separation.
- [x] 8.3 Exercise project load, selection, command execution, undo, playback/playhead and save in A while B remains unchanged, then repeat the discriminating direction for B.
- [x] 8.4 Suspend, resume and dispose A while B renders/saves, and assert A's store bindings, cancellers and exact GPU handle are gone while B remains fully usable.

## 9. Add real backend-specific browser evidence

- [x] 9.1 Add a bounded Vite test route/harness that creates explicit sessions, asks live graphics capability before creating a second preview, exposes observed backend/capacity/live handles and renders visibly distinguishable projects/canvases without adding C4 asset behavior.
- [x] 9.2 Add a WebGPU Playwright job requiring an explicit executable-path environment variable; launch the exact installed Chrome executable (known path `C:/Program Files/Google/Chrome/Application/chrome.exe`) with `--enable-unsafe-webgpu --use-angle=d3d11` and fail rather than fall back when path/identity/flags differ.
- [x] 9.3 In the installed-Chrome job, require live backend `webgpu`, capacity 2, two distinct nonzero handles, two simultaneously visible/distinct frames and independent project visuals, selection and playheads.
- [x] 9.4 Add a separate bundled-Playwright-Chromium WebGL job requiring backend `webgl`, capacity 1 and one working first preview; request a second preview only after the first frame is observed.
- [x] 9.5 Assert the second WebGL request returns an explicit over-capacity rejection before layout, creates no second handle and leaves the first handle/canvas/frame intact; fail on backend mismatch, silent replacement, hidden preview or fallback.
- [x] 9.6 Keep browser source/config committed but all screenshots, traces, profiles, snapshots and probe output ignored; verify `git ls-files --cached --others --exclude-standard` cannot stage browser artefacts or persisted project records.

## 10. Run focused and full validation

- [x] 10.1 Re-run `node script/check-wasm-api-surface.mjs --negative-control`, `node script/run-wasm-api-contract.mjs` and `node script/test-wasm-runtime-api.mjs`; require exact C0b arities/semantics, backend/capacity answers and handle reconciliation with no generated edit.
- [x] 10.2 Run focused C1/C2 compatibility tests: `bun test apps/web/src/editor/ports/__tests__/conformance.test.ts apps/web/src/editor/session/__tests__/editor-singleton-boundary.test.ts`, then isolated lifecycle and runtime-ownership tests with `OPENCUT_SESSION_TEST_ISOLATED=1`.
- [x] 10.3 Run all new store, hook, migration, canceller, renderer and two-session integration tests, followed by `node script/check-editor-singleton.mjs`, `node script/check-port-boundary.mjs` and the new session-state/production-graph checker with all negative controls.
- [x] 10.4 Rebuild Vite with `bun --cwd apps/vite-example run build`; run the WebGL bundled-Chromium job and the explicit installed-Chrome WebGPU job, preserving backend/handle/frame evidence for review.
- [x] 10.5 Build Next fresh with the nine documented environment variables and `npx turbo run build --filter=@opencut/web --force`; assert `.content-collections/generated` exists, then run `node script/check-type-baseline.mjs` and stop if the current ceiling exceeds 3 or the pinned fixture changed.
- [x] 10.6 Run Vite parity and the separately hosted Next parity scenario, normalize both snapshots with the existing fixture, run `node script/diff-parity-snapshots.mjs ...`, and stop on semantic movement or any parity-oracle re-baseline.
- [x] 10.7 Run asset-manifest, storage-boundary, Next-import, distributable-boundary, reference-boundary, port-boundary, editor-singleton and session-state gates; C3 must not absorb C4 asset/Worker, C5 storage or C6 full-disposal work to make a gate pass.
- [x] 10.8 Run the eight legacy capability falsification sweep plus all four archived S02 capabilities against the committed implementation; for any now-false inherited requirement, add a complete `MODIFIED` delta before proceeding.
- [x] 10.9 Run the full unimplemented-addition sweep mapping every C3 requirement/scenario to executable evidence; reject TODOs, skipped tests, stubs, fixture-only providers and retained unimplemented objects reachable from the running graph.
- [x] 10.10 Run `bun test` and compare every failure/error identity and signature with task 1.4; stop for any new or changed red, record expected inherited red honestly and do not call the full suite green while failures remain.

## 11. Reconcile provenance and hand off C4/C5/C6

- [x] 11.1 Update `PATCHES.md` for every inherited source/test/config/document changed relative to the pinned reference, including behavior impact and the exact requirement/evidence that justifies each patch.
- [x] 11.2 Commit the implementation, then regenerate `SOURCE_INVENTORY.md`, `SOURCE_INVENTORY.json` and SBOM/provenance outputs from that committed tree; resolve inventory mismatches only through the generator and re-run the provenance checks.
- [x] 11.3 Verify the final diff contains no Rust/generated-WASM edit, public C1 contract widening, `script/fixtures/type-baseline.json` change, parity fixture change, C4 asset/Worker delivery, C5 storage inversion or C6 shared-GPU teardown/full five-class harness.
- [x] 11.4 Record final command results, exact browser executable/backend/capacity/handle observations, expected baseline-red classification and commit/tree identifiers in the C3 implementation/review handoff.
- [x] 11.5 Hand C4 the per-session renderer/provider seam plus unresolved asset-base/root URL, Worker runtime-resource, effect-preview asset and degraded-no-rasterizer obligations; hand C5 the isolated live stores over shared durable substrates; hand C6 exact compositor release ownership and shared GPU last-owner/five-class leak obligations.
- [x] 11.6 Stop delivery if any exact-base, browser identity/backend, handle-count, fixture-byte, parity, boundary, provenance or new-baseline-red condition is unresolved; otherwise request an independent review and ship C3 without folding in a later slice.
