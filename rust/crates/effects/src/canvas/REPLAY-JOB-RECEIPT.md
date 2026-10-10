# Canvas bounded incremental replay — CPU-only supplement

2026-10-10. Canvas remains N. No GPU, application, WASM, Cargo or shared effect
registration operation was performed by this worker. Old receipts/executables
are retained, not relabelled.

`CanvasReplayJob::new(config, strokes, source, local_ticks, numerator, denominator)`
admits the whole config/schedule and full-duration work estimate, validates source
and shared time, then allocates owned source/material/scratch/schedule. Pending
state is private. `advance(NonZeroU64)` budgets conservative cell/bristle visits;
`minimum_step_work()` supplies the minimum indivisible physical-step cost.
A smaller nonzero budget fails without mutation. Zero cannot inhabit the quota.
`progress()` returns monotonic completed/target ticks and executed-step count.
`finish(self)` refuses incomplete work; dropping a job cancels unpublished work.
Upper layers can yield or cancel between bounded calls. This is not a wall-clock
deadline guarantee or an in-step cancellation callback.

Numerical steps remain anchored at 6000 ticks, split at exact authored endpoints
and the final residue. The same deposition/diffusion functions are used; synchronous
`rebuild` completes this job rather than maintaining a separate replay algorithm.
No gesture, seed, timing, alpha or static-source/config semantics changed.

The complete new job estimate is `CanvasReplayJob::estimate().peak_bytes`:
128 bytes/cell for material/scratch/source payloads, plus owned stroke payload and
`size_of::<CanvasReplayJob>()` including all state/config/Vec/estimate headers.
`memory_bytes()` independently counts actual owned capacities. Caller input/output,
allocator metadata and stack are excluded. The earlier contract's core estimate
does not include the new job-owned schedule and extra headers; it must not be
reported as the complete job peak or measured RSS.

Actual local native tests: 34 passed, 0 failed, 0 ignored (25 existing core/pass/
catalog/clock, 4 actual raster tests, 5 new replay cases). Tests verify single-step,
multi-step and synchronous material f64 bit identity; unsorted/tied/off-grid paths,
rational FPS and final hold; premature finish, too-small quota, owned source/
schedule mutation isolation, exact capacity accounting, invalid admission and
request-local reverse seeks/drop cancellation.

Compilation used actual types.rs, the original current stylized_catalog.rs type
prefix, fresh native time rlib and real existing serde/serde_json/bridge dependencies.
The stdin wrapper excluded GPU pipeline and a duplicate facade raster_tests module,
while retaining real raster.rs and its nested tests. It is NOT a whole effects-crate
or GPU compile. Three unused-import warnings from the partial wrapper were recorded
(bridge export, raster facade exports, replay-progress facade export); none hidden.

New directory `C:/tmps/canvas-replay-sol-909c5c56` contains one executable,
1257472 bytes, no PDB (<10 MiB). Executable SHA256:
`112f28665ba0aae97fe43e5fc236a9ded4d2adfdee24aa94954818fedf22f60d`.
Source pins at execution:

```text
canvas/replay.rs 5c65bf298346b188fbd1477120403529b5c1ba284be0cd9b2d7f1bfb3bcc5bef
canvas/replay_tests.rs a20e2d4d1411aca4c4cd4c62571d68a976f6331d9f7dc25d7d8408f01bb31f5a
canvas/simulation.rs 7132e5b37c1c7d1920992e9a0a202c6623e0bfcfb197013cfee46f080cefc53e
```

Root owns subsequent facade duplicate-test cleanup, whole effects-crate metadata
compile, production asynchronous prepare/capture barrier and independent review.
This local result does not claim those steps or resource/video-history identity.
