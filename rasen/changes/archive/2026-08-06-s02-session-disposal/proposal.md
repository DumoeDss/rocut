## Why

The C5-integrated runtime can count five session resource classes, but production editor code still acquires timers, audio contexts, and object URLs outside that mediator, `disposeAll()` can count an asynchronous audio close before it settles, and the WASM provider wrapper never performs C0b's shared GPU teardown. S02 therefore still lacks evidence that repeated session lifecycles release resources rather than merely invoke cleanup callbacks.

## What Changes

- Make `suspend` quiesce session-owned activity and `resume` restart only the same live session, while preserving its identity, project state, mounted root, C5 persistence topology, and another session's activity.
- Route production acquisition of timers, Workers, audio contexts, object URLs, and compositor handles through the owning session's resource seam; make direct acquisition in the editor runtime a mechanically enforced violation with deliberate failing controls.
- Make disposal an idempotent, concurrency-safe asynchronous drain: stop publications and services, unmount, release resources in defined order, await asynchronous teardown, reconcile live GPU handles, and report release failures instead of counting an attempted disposer as released.
- Add process-level shared-WASM ownership so disposing one of two sessions releases only its compositor, while the final owner invokes C0b's `disposeGpu()` after all handles are gone and leaves the runtime re-initializable.
- Add real-browser, multi-cycle Vite and Next leak evidence. Every cycle must show a positive CREATED count for all five classes before release is asserted, assess monotonic residual growth, and run a deliberately leaking negative control through the same oracle.
- Preserve the C3 one-handle-per-session and stale-generation rules, C4 asset/Worker/degraded-renderer ownership, C5 opaque persistence and Host topology, all protected parity/type/WASM artifacts, and the exact inherited regression identities.
- Leave C7's no-React headless entry and emitted-module check, E1's packaged Elftia measurements and React choice, and any new Rust/WASM surface out of scope.

## Capabilities

### New Capabilities

- `session-resource-disposal`: defines quiescent suspend/resume behavior, complete five-class owner-scoped disposal, shared-GPU last-owner teardown, and non-vacuous multi-cycle leak evidence on both Hosts.

### Modified Capabilities

None. The existing `editor-session-runtime`, `host-port-contract`, `session-state-isolation`, and `wasm-api-surface` requirements remain authoritative; this change implements and proves their disposal obligations without changing their public contract.

## Impact

- Affects the session resource implementation and lifecycle orchestration, core managers and session-owned services, media/audio/object-URL helpers, Host runtime-provider ownership, both Host browser harnesses, resource-boundary tooling, focused lifecycle tests, and architecture/provenance records.
- The public `EditorSession` lifecycle shape and Host port roles stay unchanged. Internal resource teardown becomes awaitable and failure-aware; callers of editor-internal media/audio helpers must receive the owning session resource seam instead of using platform globals.
- The only admissible implementation base is integration HEAD `d6ed4166b5ffb13257d1924851f2fa57d73d349f`, tree `3875074383b41f622e5f32942091468cf8959b61`, which includes C5 product commit `0bfcf0457385b55de815c75ec712e9b9d69da242` and its archive metadata.
