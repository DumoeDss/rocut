## Context

C6 starts only from the clean S02 integration identity `d6ed4166b5ffb13257d1924851f2fa57d73d349f`, tree `3875074383b41f622e5f32942091468cf8959b61`. That tree contains C0b's handle-keyed compositor and `disposeGpu()` surface, C3's per-session core/stores/compositor, C4's Host-owned Worker construction, and C5's final storage/Host topology. The C5 product is present through `0bfcf0457385b55de815c75ec712e9b9d69da242`; planning against the older C4 base would miss 122 C5 paths and recreate invalid ownership decisions.

The current session resource module already names and counts `timer`, `worker`, `audioContext`, `objectUrl`, and `gpuResource`, and reconciles GPU handles against `RuntimeGpuResourceQuery.liveHandles()`. It is not yet a complete disposal implementation:

- `script/check-port-boundary.mjs` deliberately scans only ports/session. Direct timer, audio-context, and object-URL acquisitions remain in the editor execution graph.
- `createSessionResources().disposeAll()` is synchronous. Its audio release calls `void handle.close()` and increments `released` before close fulfills or rejects.
- `EditorCore.suspend()` pauses only save; playback/audio/render/transcription activity is not governed as one lifecycle.
- `VideoCache` and `WaveformCache` remain exported module instances; effect-preview state remains resolver-indexed with a C6 disposal TODO; several finite audio decode paths create live `AudioContext`s directly.
- `prepareWasmRuntimeProviders()` owns only JS query-wrapper `free()` calls. It neither leases shared runtime ownership across sessions nor calls C0b's `disposeGpu()` when the final owner leaves.
- Existing unit tests prove the counter shape and exact compositor release with fakes, but there is no six-cycle Vite/Next browser oracle that forces all five classes to be CREATED, checks terminal platform state, assesses residual monotonicity, and proves sensitivity with a deliberate leak.

Direction authority is Target State > Roadmap > S02 slice spec > corrected slice plan > parent planning context. D2 (shared React 18 versus isolated React 19) remains deliberately unmade. C7 owns no-React headless load/save and the emitted no-React graph. E1 owns packaged Elftia true-unmount, no-rasterizer, CSS, and React-option measurements.

### Design-it-twice comparison

Three interfaces were compared:

1. Add `suspendAll`, `resumeAll`, and `disposeAll` to the public resource registry and make every resource implement all three operations. This is superficially uniform but shallow: object URLs and compositor handles do not have meaningful pause semantics, callers must learn per-class exceptions, and it widens C1's public contract.
2. Give every manager/service its own public lifecycle and make `create-session.ts` know their ordering. This avoids a public contract change but spreads ordering, failure aggregation, and race rules across many callers. Deleting the coordinator would not reintroduce much complexity because the complexity already lives everywhere.
3. Keep the existing public `SessionResources` acquisition interface, add one private lifecycle coordinator behind the session seam, and give internal activity owners the smallest lifecycle they actually support. The coordinator closes admission, serializes transitions, quiesces activity, drains resources, and releases the shared-WASM lease. Resource-specific construction and terminal verification remain behind deep internal modules.

Decision 3 is selected. It preserves the frozen public session/Host shape, concentrates ordering and error behavior, and lets tests exercise the same lifecycle seam as Hosts.

## Goals / Non-Goals

**Goals:**

- Make lifecycle transitions serialized, idempotent, owner-scoped, and safe under concurrent suspend/resume/dispose and stale asynchronous completion.
- Make suspend quiescent without pretending it is unmount or disposal: stop/cancel activity-bound timers and Workers, pause playback/audio/publication, retain identity/project/root, and allow only the same live session to resume.
- Make disposal await terminal teardown, attempt every owner even after failures, reconcile GPU state before freeing query wrappers, and return one stable result or rejection to concurrent/repeated callers.
- Ensure every production live timer, Worker, `AudioContext`, object URL, and compositor enters the owning session registry. Bounded `OfflineAudioContext` rendering is classified separately and must settle/dispose its media inputs inside the operation; it is not a live context exempted by accident.
- Replace process-global resource-holding caches/services with session ownership or an explicit resolver-scoped lease whose final release disposes it.
- Implement shared GPU last-owner teardown without changing Rust or generated WASM.
- Produce non-vacuous six-cycle evidence on fresh Vite and Next builds, including CREATED-before-released proof for every class and a fault-injected negative control that the ordinary oracle rejects.
- Preserve all C3/C4/C5 invariants, protected artifacts, and exact inherited red identities.

**Non-Goals:**

- No public transaction/revision/draft concept, new Host port, new Rust export, generated-WASM edit, or package extraction.
- No C7 headless entry/module graph, no E1 Elftia adapter or packaged measurement, and no decision on D2.
- No change to C5's `ProjectStore`, opaque codec, topology authorization, migration/cascade journals, production Host store identities, or durable-sharing semantics.
- No claim that noisy JS heap or listener metrics alone prove five-class release. They may be recorded as diagnostics only.
- No re-baselining of parity or type fixtures and no widening of accepted full-suite failures.

## Decisions

### 1. Freeze the implementation base and public surfaces before RED work

The implementer first verifies the exact HEAD/tree above, a clean worktree, and the protected identities below. It records the C5 full-suite baseline as `330 pass / 8 fail / 2 loader errors / 1,058 expectations` across `338 tests / 64 files`: six `ZERO_MEDIA_TIME` placement failures plus the inherited `wasm.__wbindgen_start` and `DEFAULTS` loader errors. Any different identity, extra red, or dirty protected path is a stop condition.

Protected unless an independently reviewed blocker proves otherwise:

- `apps/web/src/editor/ports` tree `efe499db6bec7afb8c35ac1a2aaa5fe851fac667`;
- public `session-types.ts` blob `c67d9822a2a6c994be14f367e6980fbbaa6e454b`;
- parity fixture blob `521d802e490956f38aa15d2b4024be9f6b53ee00` and unchanged parity diff oracle;
- type fixture blob `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8`;
- Rust trees `d782b046c0f39e85b8a5ed518b42389214c211e5`, `4da4fe82bd946d6ef3937ec0c25f10e77ba674f2`, and `cdaa2215e4b7bbe3f42d2e2c8db32e429cd5af34`;
- generated `opencut_wasm.js` / `.wasm` SHA-256 `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1` / `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`.

`create-session.ts`, `session-resources.ts`, `wasm-runtime-providers.ts`, and `editor-session-host.tsx` are expected implementation seams, not protected blobs. The public `EditorSession`, `EditorHost`, port-role, GPU-query, and `DisposalReport` shapes remain byte-stable.

### 2. Serialize lifecycle transitions behind one private coordinator

`createEditorSession` owns a private transition tail and an admission state. A lifecycle call publishes its state synchronously before its first await, then runs one ordered transition. Calls observe these rules:

- suspend from `created` or `mounted` is idempotent and retains the same session, project, store coordinator, and mounted root;
- resume is a no-op unless suspended, reopens admission only after the same session's managers are ready, and never resurrects a disposed generation;
- dispose wins permanently, concurrent callers join the same promise, and a queued resume cannot reopen the session;
- a Host-generation cancellation detaches ownership before invoking session or runtime cleanup and observes both failures, preserving C3's existing rule.

The coordinator delegates to an internal `EditorCore` lifecycle. Suspend pauses save, playback, audio scheduling, renderer publication, and transcription work; it cancels activity-bound tracked timers/Workers and invalidates their generations. Object URLs and the compositor may remain owned while suspended because the mounted root and project identity remain; they are reported as live, not falsely released. Resume recreates/restarts activity lazily. Dispose closes publication first, then performs service/core cleanup, unmount, resource drain, runtime lease release, and weak-index removal.

Alternative rejected: treating suspend as dispose-and-recreate for all five classes. Revoking media URLs and destroying the compositor while retaining a mounted root would require a hidden remount/rehydration protocol not present in C1 and would blur S04's future Surface lifecycle.

### 3. Make resource drain asynchronous, terminal, exhaustive, and stable

The private result of `createSessionResources` gains an awaitable drain; the public acquisition/inspection surface stays unchanged. A tracked release may be synchronous or return a promise. The drain walks reverse acquisition order and awaits each terminal operation. `released` increments only after the operation succeeds (or after an already-terminal idempotent handle is observed), never when cleanup is merely invoked.

Release failure does not stop later releases. The drain collects errors with resource class/id metadata, completes GPU reconciliation while the query wrapper is still live, and then rejects with one error or an `AggregateError`. The session returns the same settled promise on every later `dispose()` call. A failed class remains `created > released` in internal inspection/evidence and cannot be reported clean.

Audio handles await `close()`. Worker termination and object-URL revocation are verified by browser-Harness ownership probes in addition to session counters because their public handles have synchronous void terminators. Timers are cancelled before callbacks can publish. GPU `released` is corroborated by disappearance from `liveHandles()`; `untracked` or `leaked` is a failure.

Alternative rejected: add failure arrays to public `DisposalReport`. The existing report plus a stable rejection is sufficient and avoids widening C1's public session contract.

### 4. Resource acquisition is propagated through editor-internal ownership, not a new port

`EditorCore` owns the existing `SessionResources` and passes it to its managers/services. Live audio construction uses `resources.createAudioContext`; finite decoders close their handle in `finally`. Object-URL producers keep an `ObjectUrlHandle` until early revocation or session disposal instead of retaining an unowned string. Timer/RAF call sites use tracked timer handles and cancel on their local cleanup as well as session disposal.

The C3-deferred mutable services are made disposal-aware:

- video and waveform caches are constructed per `EditorCore` and drain media inputs/context handles;
- transcription remains a per-session factory, is terminated on suspend/dispose, and rejects pending initialization/transcription exactly once;
- effect-preview source/service ownership becomes one session lease (or a reference-counted resolver lease with an exact final disposer), never an immortal WeakMap value;
- `AudioManager` closes its live context and disposes sinks; all subscriptions/timers are stopped;
- media assets retain their object-URL handles inside session-owned media state so remove, project switch, undo/redo, and dispose cannot double-revoke or leak them.

`OfflineAudioContext` is operation-bounded: each instance is created and consumed entirely inside a rendering call, and every associated media input is disposed in `finally`. The boundary inventory records this classification explicitly. It must not become a stored field or escape its promise.

Alternative rejected: a generic `register(disposer)` escape hatch. It recreates the acquisition blindness the C1 contract exists to remove.

### 5. Widen the resource boundary to the real editor graph and prove each rule can fail

The resource-acquisition portion of `script/check-port-boundary.mjs` (or a narrowly named `check-session-resource-boundary.mjs` called by it) scans tracked plus uncommitted editor-runtime source and both emitted Host graphs. Exact exemptions are data, not prefix accidents:

- browser/in-memory Host adapters may construct the platform resource they implement;
- conformance, unit, and explicit browser probe fixtures may construct fault-injection resources;
- shell-only marketing/changelog/generic UI paths not in either editor graph are classified;
- operation-bounded `OfflineAudioContext` sites are enumerated separately and fail if the object escapes or becomes module/session state.

Rules reject direct live timers/RAF, `new Worker`, live `AudioContext`, `URL.createObjectURL`, unkeyed/default compositor calls, and a second acquisition mediator. Each rule has a targeted non-zero fixture plus positive controls. The check fails on an empty/truncated inventory and prints every scanned/exempted path count.

### 6. Shared WASM lifetime is a reference-counted lease with final-owner teardown

`prepareWasmRuntimeProviders()` delegates to one private process module that serializes initialize/acquire/release. Each successful preparation returns distinct query wrappers and one idempotent lease release. The shared owner count is incremented only after initialization yields usable wrappers.

On release:

1. the owning session has already drained and reconciled its exact compositor handle;
2. its two JS query wrappers are freed once;
3. if another lease exists, shared GPU teardown is not called and the other session remains queryable/renderable;
4. the final lease uses a still-live query to assert `liveHandles()` is empty, then calls C0b's `disposeGpu()` exactly once;
5. success leaves backend `null` and permits a later acquire to initialize a fresh generation;
6. live handles or teardown failure reject and are never relabeled as a clean final release.

Concurrent preparations share C0b's generation-safe initialization. Concurrent releases are serialized so two apparent final owners cannot both call teardown. A failed final teardown leaves the coordinator in a retryable/re-initializable explicit state rather than decrementing below zero.

Alternative rejected: call `disposeGpu()` from each `session.dispose()`. C0b correctly refuses while another compositor is live; turning that expected refusal into routine cleanup would make one session able to disrupt another and would conflate exact-handle ownership with shared-runtime ownership.

### 7. The leak oracle is logical plus platform-observed, not a heap-only heuristic

A shared C6 browser harness runs at least six complete `create -> mount -> acquire all five -> suspend -> resume -> dispose` cycles. It is reused by Vite and Next adapters rather than copied. Per cycle it records:

- `beforeDispose[class].created > 0` for all five classes;
- the exact terminal disposal report and `created === released` for each class;
- timer callbacks/publications after quiescence, live Worker handles/listeners, AudioContext terminal states, live object-URL handles, and WASM `liveHandles()`;
- post-cycle residual count per class and whether any residual series is monotonically increasing;
- selected graphics backend, Host identity, build marker/base, cycle index, and errors/unhandled rejections.

The acceptance oracle requires zero logical and platform residuals after every cycle, not merely a flat aggregate after the last cycle. It also proves resume by performing a post-resume operation before disposal. CDP `JSEventListeners`, task counts, and heap may be captured as supplemental diagnostics, but noisy process metrics cannot override a leaked exact handle.

The negative control uses the same acquisition sequence, report shape, and evaluator while fault-injecting one otherwise-valid Host resource terminator (minimum: a Worker remains platform-live). The evaluator must return non-clean/non-zero and name the class/cycle. A separate test proves that deleting or zeroing any class's CREATED observation fails before release assertions are evaluated. The test suite passes only because the negative control is detected, never because the leaking run is accepted.

### 8. Both Hosts use fresh marked artifacts and independent owned processes

Vite and Next runs use unique C6 build markers, fresh output directories, exclusive recorded ports/PIDs, and isolated browser contexts. The Next harness extends the existing editor route/probe pattern; the Vite harness extends the explicit query/harness pattern. Both consume production Host composition, including C5's `BrowserProjectStore`; neither substitutes `createInMemoryPorts()` for production roles.

The harness may use a tiny local Worker and small generated audio/blob data to guarantee creation without network/model dependence. GPU evidence uses the live C0b provider and records the selected backend; the five-class disposal claim does not require dual-preview capacity, but C3's WebGL-one/WebGPU-two behavior remains protected and is rerun in its existing distinct-backend gates.

### 9. Preserve C5 durable topology and do not let cleanup become storage deletion

Session disposal destroys live coordinators/caches/listeners and transient URLs. It does not clear projects, attachments, libraries, migrations, journals, databases, OPFS roots, or Host store instances. Two sessions may continue sharing one durable store while holding no shared live resource handles. Storage mechanisms remain behind `ProjectStore`; C6 adds no storage disposer or private Host channel.

### 10. Verification, ship, integration, and archive remain separate evidence stages

Implementation uses sensitive RED/GREEN evidence for asynchronous close, suspend race, stale continuation, exact GPU last-owner behavior, five-class CREATED enforcement, and the deliberate leak. After implementation, a fresh non-author Sol reviewer must write `evidence/luna-max-implementer-evaluation.md`, synthesize the recorded C5 Phase 6, C5 Phase 7, and C6 first return, and rule exactly one of `can replace Sol`, `bounded-task only`, or `not ready`. Open Blocker/Major findings prevent delivery; fixes require non-author delta re-review.

The verification tail reruns focused lifecycle/service/boundary tests, six-cycle Vite and Next harnesses, both C3 backend jobs, C4 asset/forced-none/Worker gates, C5 storage/Host gates, fresh Vite/Next builds, protected parity, exact type ceiling, WASM/source/provenance/SBOM/license gates, the complete 13-main-spec two-way falsification sweep, and full Bun failure-signature comparison. Every added scenario must be run, not inferred.

Ship is local only for the portfolio child. It is a separate Luna xhigh leaf, followed by portfolio integration at the LEAD's direction. Archive is another separate Luna xhigh leaf after integration/spec sync conditions are satisfied. This plan does not commit, ship, integrate, or archive.

## Expected Write Set and Serial Overlap

The implementer must start with a complete `git diff --name-status`; paths outside these groups require explicit attribution and plan/review amendment before edit.

Expected core seams:

- `apps/web/src/editor/session/create-session.ts`, `session-resources.ts`, and focused tests under `editor/session/__tests__/`;
- `apps/web/src/editor/runtime/wasm-runtime-providers.ts` plus a private shared-runtime lifetime module/test if separation keeps the interface deep;
- `apps/web/src/editor/session/editor-session-host.tsx` and its Host-generation ownership tests;
- `apps/web/src/core/index.ts` and managers `audio-manager.ts`, `media-manager.ts`, `playback-manager.ts`, `renderer-manager.ts`, `save-manager.ts` plus focused tests.

Expected resource owners/callers:

- `apps/web/src/services/video-cache/service.ts`, `waveform-cache/service.ts`, `transcription/service.ts`, `renderer/effect-preview.ts`, `renderer/effect-preview-source.ts`, and their tests;
- `apps/web/src/media/audio.ts`, `audio-mastering.ts`, `processing.ts`, `persistence.ts`, `upload-toast.ts`, `use-paste-media.ts`, and related tests;
- `apps/web/src/retime/audio-stretch.ts`, `sounds/sounds-store.ts`, `sounds/use-sound-search.ts`, `sounds/components/assets-view.tsx`;
- `apps/web/src/commands/media/remove-media-asset.ts`, `apps/web/src/export/index.ts`, `apps/web/src/utils/browser.ts`;
- editor/timeline timer consumers currently named by the inventory: `components/editor/export-button.tsx`, `components/editor/editor-header.tsx`, `preview/components/index.tsx`, `selection/selectable-surface.tsx`, `selection/hooks/use-box-select.ts`, `timeline/components/index.tsx`, `timeline/controllers/zoom-controller.ts`, `timeline/hooks/use-scroll-position.ts`, `timeline/hooks/use-edge-auto-scroll.ts`, and `timeline/hooks/element/use-element-interaction.ts` where their live calls remain in the emitted editor graph.

Expected gates/harness/docs:

- `script/check-port-boundary.mjs` and targeted fixtures/tests, or one new `script/check-session-resource-boundary.mjs` wired into the same gate;
- `apps/vite-example/src/app.tsx`, a new shared C6 harness/module, Vite/Next probe entry wiring, Playwright specs/config, and minimal HTML/build configuration only where the existing harness pattern requires it;
- `BOUNDARIES.md`, `FEATURE_HANDLING.md`, `PATCHES.md`, `SOURCE_INVENTORY.md`, and `SOURCE_INVENTORY.json`; `SBOM.md`/`UPSTREAM.md` only if their generators or inherited-file attribution require a real change.

Explicit non-write paths: `apps/web/src/editor/ports/**`, `session-types.ts`, `script/fixtures/type-baseline.json`, protected parity fixture/oracle, all Rust crates, generated WASM, C5 topology/store/migration/cascade modules except a separately reproduced C6 blocker, C7 headless files, and every Elftia/E1 path.

C6 is serial after C5 and before C7 because it overlaps the session factory, Host controller, resource-holding managers, and Host harnesses. E1's true-unmount measurement waits for C6; E1 may not feed private disposal behavior back into this contract. D2 remains unmade.

## Risks / Trade-offs

- **[Async cleanup can hang disposal]** -> Bound browser-test resources, settle Worker listeners on termination, use explicit per-owner timeouts in the harness, and surface a timeout as a failed release rather than marking it released.
- **[Closing an audio context can race decode/playback]** -> Close admission and invalidate activity generation first; dispose nodes/sinks; await close; reject stale decode publication.
- **[Suspend policy can accidentally become unmount]** -> Assert mounted root, project identity, stores, and C5 persistence coordinator survive suspend/resume while activity is quiescent.
- **[A module cache can outlive its session]** -> Prefer per-core construction; where resolver sharing is retained, require an explicit lease count and final disposer test.
- **[A resource count can be true while the platform resource leaks]** -> Require platform observers for Worker/audio/object URL/GPU and a fault-injected negative control; do not trust counters alone.
- **[Last-owner teardown can race a new acquire]** -> Serialize acquire/release in one coordinator and assert fresh-generation reinitialization after final teardown.
- **[A broad timer scan produces irrelevant shell churn]** -> Define and test exact editor-graph and shell classifications; never use a blanket directory exemption.
- **[Full-browser metrics are noisy]** -> Make exact handle residuals authoritative and retain heap/listener deltas only as diagnostics.
- **[C5 storage cleanup is mistaken for session cleanup]** -> Protect store/topology modules and assert durable reopen after session disposal.
- **[The Luna implementation experiment overstates success]** -> Preserve first-return evidence and require the fresh Sol synthesis/fix loop before ship.

## Migration Plan

1. Verify base/protected identities, capture exact current call-site inventories and inherited reds, and add failing tests for async close, lifecycle races, final-owner teardown, missing CREATED evidence, and deliberate platform leakage.
2. Implement the private lifecycle coordinator and awaitable resource drain without changing public session/port types.
3. Rehome session resource owners and route live acquisitions through `SessionResources`, one class at a time; widen the boundary gate only after each class has a green implementation and a red fixture.
4. Add the shared-WASM lifetime lease and exact two-owner/final-owner/reinitialize tests.
5. Build the shared six-cycle harness, run its deliberate leak first to prove the oracle fails, then run ordinary Vite and Next cycles.
6. Run the complete verification/review tail and update derived provenance from the final committed product tree.
7. Ship locally, integrate through the portfolio, rerun the joint gate, then archive/sync `session-resource-disposal` separately.

Rollback is code-only and must not delete durable C5 data. Before delivery, revert C6 source/docs/tests together. After a local product commit but before portfolio delivery, revert that commit on the C6 branch. Never roll back by editing protected fixtures, deleting browser databases/OPFS roots, or restoring module singletons. A failed runtime teardown is reported and left for explicit retry/reload; cleanup never guesses at durable targets.

## Open Questions

No product-shape question is intentionally open. Implementation may discover an unclassified direct acquisition; it must either route it through the existing session seam or stop for plan review. It may not answer the discovery by adding a generic disposer, widening a Host port, changing Rust/WASM, entering C7/E1, or deciding D2.
