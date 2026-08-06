# C6 fix round 2 — cache ownership and WASM failure-state remediation

Date: 2026-08-04  
Product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c6`  
Scope: review finding B3 plus Major M1 only

## Outcome

B3 and M1 are remediated in this leaf's owned product paths.

- The last effect-preview owner now removes the resolver's source lease from the source `WeakMap` before disposing the source. A later owner receives a new source and service.
- Video and waveform cache work is stamped with cache/source generations. Clear, project replacement, and dispose synchronously invalidate prior work and return a Promise that joins operations already in flight. Stale initialization, decode, seek, and prefetch work cannot repopulate a map or publish a result.
- Independent cache instances remain independent even when they use identical media/source keys.
- WASM final release is phase-aware. A failed `disposeGpu()` leaves both query wrappers live. Once shared teardown succeeds, retries do not reconcile through a freed GPU query and free only wrappers whose earlier `free()` failed.
- Runtime query wrappers are constructed before owner accounting. A partial constructor failure frees any wrapper already constructed and does not strand a process owner.
- The WASM test doubles become terminal after a successful `free()` and can inject constructor and shared-GPU-dispose failures.

## RED evidence

The focused tests exposed the pre-remediation behavior:

- Video dispose during a blocked `getPrimaryVideoTrack()` returned a frame after dispose rather than `null`; the pending initializer restored the sink.
- Both waveform invalidation tests resolved their old summary Promises after `clearAll()` rather than rejecting invalidated work.
- The WASM failure matrix showed that a failed shared GPU teardown still incremented both wrapper-free counters, a one-wrapper retry could not advance after the GPU query had been freed, and a GPU-query constructor failure did not roll back the graphics query. The first failure also contaminated later process-generation assertions, which is the unsafe state the review described.
- The preview test initially reached the repository's real WASM package before the assertion and failed in module setup. Its fixture was changed to register a local WASM mock before dynamically importing the service; no product conclusion was drawn from that harness error.

## GREEN evidence

| Command | Result |
| --- | --- |
| `bun test apps/web/src/services/renderer/__tests__/host-effect-preview.test.ts` | PASS, 2 tests / 8 expectations |
| `bun test apps/web/src/services/renderer/__tests__/effect-preview-ownership.test.ts` | PASS, isolated outer test; child final-release/reacquire test 1/1 with 5 expectations |
| `bun test apps/web/src/services/video-cache/__tests__/service-ownership.test.ts` | PASS, isolated outer test; child suite 3/3 |
| `bun test apps/web/src/services/waveform-cache/__tests__/service-ownership.test.ts` | PASS, 2 tests / 8 expectations |
| `$env:OPENCUT_SESSION_TEST_ISOLATED='1'; bun test apps/web/src/editor/session/__tests__/session-runtime-ownership.test.tsx -t "GPU teardown\|wrapper-free retry\|constructor failure\|concurrent owners\|fresh independently"` | PASS, 5 focused tests / 20 expectations |
| `$env:OPENCUT_SESSION_TEST_ISOLATED='1'; bun test apps/web/src/editor/session/__tests__/session-runtime-ownership.test.tsx` after the concurrent sound fixture landed | PASS, 16 tests / 103 expectations |
| targeted `bunx eslint` over the eleven leaf product/test files at the completed leaf checkpoint | PASS, zero diagnostics (only the repository pages-directory informational message) |
| `bunx prettier --check` over the eleven leaf product/test files at the completed leaf checkpoint | PASS, all files matched |
| `node script/check-type-baseline.mjs` at the completed leaf checkpoint | PASS, 3 current diagnostics, all inside the pinned baseline set |
| targeted `git diff --check` | PASS |

The first unfiltered `session-runtime-ownership.test.tsx` run was 15/16 because the concurrent sound fixture had not landed yet. After that owner added a scoped audio context, the exact isolated inner suite passes 16/16, including all five new WASM failure/retry cases. No core/in-memory/lifecycle product file was changed by this leaf.

One parallel test batch also triggered a Bun 1.2.2 native segmentation fault in the preview process after its first test. The preview ownership test was subsequently moved to its own subprocess so its WASM module mock cannot poison other test files. The original Host preview suite and the isolated ownership suite both pass independently.

## Focused coverage matrix

| Requirement | Focused proof |
| --- | --- |
| Final preview release/reacquire | Two owners share the first service; intermediate release retains it; final release causes both source and service identity to change on reacquire. |
| Dispose during video init | Track acquisition is held, dispose invalidates it, the caller receives `null`, the input is disposed once, and stats remain zero. |
| Project replacement | Video and waveform clears join stale work and allow a fresh generation under the same key. |
| Two sessions, equal key | Two VideoCache inputs and two WaveformCache decode generations remain distinct; disposing/clearing one does not affect the other. |
| `disposeGpu()` failure | First teardown rejects, wrappers remain callable and unfreed, retry invokes shared teardown again, then each wrapper frees once. |
| One-wrapper failure | Shared teardown runs once; the successful wrapper is terminal; retry touches only the unfinished wrapper and never queries the freed GPU wrapper. |
| Constructor failure | GPU-query construction failure rolls back the graphics wrapper; the next sole owner performs exactly one final shared teardown. |
| Concurrent owners | First owner frees only its wrappers; two concurrent calls on the last owner coalesce and issue one `disposeGpu()`. |
| Fresh generation | Two completed acquire/dispose generations each report a usable graphics query and exactly one shared teardown. |

## Integration note

`VideoCache.dispose/clearAll/clearVideo` and `WaveformCache.dispose/clearAll/clearSource` now return `Promise<void>` for deterministic joining. The core/lifecycle owner began wiring those Promises after the leaf checkpoint. An intermediate concurrent type-baseline rerun reported an out-of-scope `TS1064` where `clearCachedMedia` was changed to `async` while retaining `: void`; that owner corrected it to `Promise<void>`, and the exact type baseline is PASS again at 3 inherited diagnostics. Concurrent edits also added an audio fixture to the shared `session-runtime-ownership.test.tsx`. At the last integration check, lint still reports that new block's unsafe `AudioContext` assertion at line 279, and Prettier reports both the shared test and `media-manager.ts`. Those remaining static items belong to the concurrent owner. This leaf did not edit the core manager or the sound fixture block.
