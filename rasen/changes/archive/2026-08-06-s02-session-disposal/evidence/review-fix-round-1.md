# C6 fix-round 1 independent delta review

Date: 2026-08-04 +08:00  
Reviewer: fresh non-author Sol reviewer (`/root/c6_sol_review_eval`)  
Reviewed product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c6`  
Baseline: HEAD `d6ed4166b5ffb13257d1924851f2fa57d73d349f`, tree `3875074383b41f622e5f32942091468cf8959b61`  
Review mode: report only; no product, task, author-evidence, commit, ship, integration, or archive mutation

## Verdict

**NOT CLEAN - 5 Blocker / 1 Major / 1 Minor / 0 Trivial.**

Fix round 1 closes initial B1 and B5. The exact type/build gates are green, and fresh Vite and Next browser runs now provide real, independent timer/Worker/audio/object-URL/GPU observations with correct ordinary/control polarity. Initial B2, B3, B4, and M1 remain open in narrower but still material forms. The round also has one deterministic new regression and one protected-boundary violation.

The frozen model evaluation remains unchanged with the exact verdict **`bounded-task only`**. Neither frozen first-review artifact was modified.

## Closed initial findings

### Initial B1 - CLOSED

`RendererManager` now declares its `editor` and `assetResolver` fields. Independent `node script/check-type-baseline.mjs` exits 0 with only the pinned identities, and `bunx tsc --noEmit -p apps/vite-example/tsconfig.json` exits 0. Fresh Vite and Next builds both complete.

### Initial B5 - CLOSED

Both independently served fresh Hosts pass the same evaluator:

- Vite marker `c6-review-fix1-vite-20260804-1` and Next marker `c6-review-fix1-next-20260804-2` each ran ordinary, missing-created, and leak controls for six cycles.
- Every ordinary cycle created timer=2 and Worker/audio/object URL/GPU=1, then produced residual series `[0,0,0,0,0,0]` for all five classes.
- The real Worker exchanged a message and stopped; actual audio moved `running -> closed`; the blob fetched before disposal and failed after revoke; timer callback/message counts did not advance after disposal; the real compositor moved `liveHandles [1] -> []`.
- Missing-created was non-clean for Worker creation in all six cycles. The deliberate leak was non-clean at cycle 6 with independent Worker residual 1 and real GPU residual 1. The runner enforced markers, `BrowserProjectStore`, no audio fallback, no unrelated console/page errors, six cycles, and polarity.

This closes the original counter-only/evaluator-polarity finding. It does not prove the suspended interval itself is quiescent; that remains B4 below.

## Open findings

### Blocker B2 - the checked boundary still cannot execute over fresh Next output and omits required rule families (confidence 1.00)

The source inventory is materially wider than in the initial review: it scans 711 modules and reports nonzero counts for all 15 named roots. The fresh Vite graph contains 2,889 modules and passes. However, `C6_VITE_DIST=apps/vite-example/dist-c6-fix1-vite-20260804-3 C6_NEXT_DIST=apps/web/.next node script/check-session-resource-boundary.mjs` exits 1 because the checker accepts only `<dist>/module-graph.json` (`script/check-session-resource-boundary.mjs:324-349`), which the fresh Next build does not produce.

The absence is not being accepted as an unknowable Next graph. A read-only independent parser followed the production `/editor/[project_id]/page` client-reference manifest, its route NFT, client/SSR/RSC chunk mappings, and the resulting JS source maps. It found 84 attributable JS files, 70 source maps, and 1,927 unique emitted source/module IDs. All required roots were present: components/editor 24, preview 25, selection 11, timeline 98, sounds 3, export 3, utils 8, core 13, editor 32, media 11, retime 6, renderer 22, transcription 1, video-cache 1, waveform-cache 1; missing roots `[]`. Thus current Next root inclusion is manually attributable, but the required repeatable boundary gate does not consume that valid emitted set.

The checker also defines only five rules (`:35-59`). It does not implement the required unkeyed/default compositor or second-acquisition-mediator checks. Its fixtures (`:288-305`) prove only those five rules and do not assert the expected path. Required-root omission controls prove that a named root can reach zero, but a one-file-per-root truncated emitted graph still passes. The exemption at `:108-115` also describes the in-memory audio construction as injected even though the current protected implementation reads ambient `globalThis.AudioContext`.

Impact: tasks 9.1, 9.2, 9.3, 9.5, 9.6, and 9.8 are not truthful as checked. The current source happens to be root-complete, including Next by the alternative module-ID audit, but the mechanically enforced complete-boundary scenario remains false.

Fix brief: teach the checker to ingest the Next route's attributable manifest/source-map module IDs (or generate an equivalent graph during build), require exact Host entries and `create-session.ts`, add compositor/default-key and second-mediator rules, and make every negative fixture assert both expected rule and expected path. Add a truncated-but-nonempty graph control.

### Blocker B3 - final-owner preview disposal is poisoned and async caches can survive their owner (confidence 0.99)

The active video and waveform consumers now receive distinct per-`MediaManager` cache objects, so the original singleton-identity defect is repaired. Deterministic drain is not:

- `effect-preview.ts:116-146` deletes its `services` entry on final release after calling `service.dispose()`. That disposal calls `EffectPreviewSource.dispose()`, but the separate resolver-indexed `sources` WeakMap at `effect-preview-source.ts:83-97` is never deleted. A later acquisition for the same resolver therefore creates a new service around the already-disposed source. The source's image was cleared at `:26-35`, and acquisition never reloads it. The only focused source test checks resolver identity; it has no acquire/release/reacquire final-owner case.
- `VideoCache.ensureSink()` can await initialization while `dispose()` clears the maps. The pending `initializeSink()` then unconditionally executes `this.sinks.set(...)` at `video-cache/service.ts:286-295`, repopulating the disposed cache with a live `Input`. There is no disposed/generation guard or cancellation.
- `WaveformCache.clearAll()` only clears its promise map. It neither cancels nor generation-guards an in-flight fetch/decode or a caller's later publication.

Impact: final-owner reacquisition, project replacement, and complete service-drain scenarios remain false. Tasks 7.6-7.10 are not supported as checked.

Fix brief: delete/reset the source WeakMap entry on final release (or make the source itself a correctly reference-counted recreatable lease); give video/waveform work a disposed/project generation and await or invalidate every in-flight operation before declaring drain. Add acquire/release/reacquire, dispose-during-initialize, project-replacement, and two-live-session tests using equal keys.

### Blocker B4 - suspend publishes state but does not close resource admission or quiesce mounted activity (confidence 1.00)

The transcription service is now core-owned, terminates on `EditorCore.suspend()`/dispose, removes listeners, and generation-guards its callbacks. That is useful partial remediation. The session-wide suspend contract remains open:

- `SessionResources.assertLive()` checks only `disposed` (`session-resources.ts:237-244`). All timer, RAF, Worker, audio, and object-URL acquisition methods remain callable while `session.state === "suspended"`.
- `EditorCore.suspend()` (`core/index.ts:119-124`) pauses save/playback/audio and terminates transcription, but it has no lifecycle signal for retained React/UI owners. Mediated RAF/interval callbacks therefore keep running while the root stays mounted. A transcription call made during suspension can lazily create a new Worker through the still-open registry.
- `SaveManager.pause()` only sets `isPaused` (`save-manager.ts:49-51`). It does not cancel an already queued `saveTimer`, and `saveNow()` (`:104-129`) does not reject paused state, so a queued save can publish during suspension.
- The browser driver itself creates an interval at `c6-disposal-harness.tsx:446-453`, then calls suspend/resume at `:499-508` without cancelling it or recording callback/message/save/render counts before, during, and after the suspended window. Its lifecycle assertion proves retained project/root/editor identity and a same-session post-resume timer operation, not zero suspended activity.

Impact: the defining "suspend stops active publications" and timer/save/Worker quiescence scenarios fail even though the literal Host cycle now includes suspend/resume. Tasks 2.8, 2.9, 4.3, 4.4, and 4.6 are not truthful as checked.

Fix brief: add a private lifecycle-generation/admission signal used by `SessionResources` and retained UI/service owners; cancel activity timers and queued save before `suspend()` resolves; refuse or defer new activity acquisition while suspended; restart only on post-resume demand. Extend both Host cycles to measure zero callback/message/save/render publication during a real suspended dwell, then prove a new generation works after resume.

### Blocker B6 - the full-suite baseline gained a deterministic media undo regression (confidence 1.00)

Fresh `bun test` reports 337 pass / 9 fail / 3 errors / 1,087 expectations across 346 tests and 67 files. The inherited placement and loader identities remain, but `media commands serialize execute and undo through the owning coordinator` is newly red. A dedicated rerun of `apps/web/src/core/managers/__tests__/media-persistence-rewire.test.ts` reproduces the same failure: `RemoveMediaAssetCommand.restoreLiveState()` calls `editor.resources.createObjectUrl()` at `remove-media-asset.ts:128`, while the established command harness's owning editor collaborator has no `resources`; the isolated child fails and its parent times out.

Impact: the explicit no-new-regression stop condition and checked task 12.10 fail.

Fix brief: keep URL creation behind the owning media/session seam without assuming a wider command test double, or update the canonical owning-editor harness to supply real `SessionResources`. Rerun the isolated test and full suite and require no identity beyond the frozen inherited set.

### Blocker B7 - protected C5 port and generated-artifact identities are no longer exact (confidence 1.00)

`git diff --quiet` across the protected paths exits 1. `apps/web/src/editor/ports/in-memory/index.ts` changed from blob `c28d9b0b...` to working blob `66382f98...`; its `InMemoryRuntimeResourceHost.createAudioContext()` now constructs and closes an ambient real `globalThis.AudioContext`. This is both a protected-tree mutation and a semantic change to the C5 in-memory Host. The production browser Hosts already override `runtimeResources` with `BrowserRuntimeResourceHost`, so the C6 oracle does not require this protected edit.

The ignored protected generated JS identity also differs from the design record: expected SHA-256 `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1`, current `63414885a3ffc631b9dcc28a9e83f2fb2554c6c1655ddbc27b10d80257098c1c`. The generated WASM remains exact at `15622cf...`, and the session-type, parity, type-fixture, and three Rust tree identities remain exact.

Impact: the frozen protected-boundary invariant and checked tasks 12.8 and 12.12 fail. This is a delivery stop independent of whether the port edit appears behaviorally convenient.

Fix brief: remove the C6 change from the protected in-memory port and keep real platform proof in the production browser adapter/independent probe. Restore or properly re-baseline the generated JS only through the authorized upstream protected-artifact workflow; then recompute every protected identity after all fresh builds.

### Major M1 - partial final-lease failures still retry through a freed WASM query (confidence 0.99)

The provider now caches concurrent release, preserves owner count on error, and retries wrapper-free failures. The real retry state is still unsafe:

- Every final release calls `gpu.liveHandles()` at `wasm-runtime-providers.ts:78-84`, even when a previous partial attempt already set `state.gpuReleased=true`.
- If `disposeGpu()` succeeds, `gpu.free()` succeeds, and `graphics.free()` fails, the owner is intentionally retained. The retry then calls `liveHandles()` on the already-freed GPU query.
- The generated binding proves `free()` first sets `__wbg_ptr=0` (`rust/wasm/pkg/opencut_wasm_bg.js:9-24`). The test mock at `wasm-test-mock.ts:192-204` does not model that terminal state, so the new single-wrapper-failure test is a false green.
- If `disposeGpu()` itself throws, the current code still proceeds to free both queries before throwing (`wasm-runtime-providers.ts:85-119`), leaving the same owner with no safe query for the promised retry. Acquisition also increments the lease before constructing both wrappers (`:131-134`), so a constructor failure can strand an owner.

Impact: checked tasks 8.2, 8.4, 8.9, and the claimed matrix in 8.10 remain incomplete. This is an uncommon failure path, so it remains Major rather than an ordinary-path Blocker, but it violates the explicit retryable final-owner contract.

Fix brief: do not free query wrappers after a failed shared teardown; once shared teardown succeeds, record that state so retries never query an already-freed wrapper and retry only the remaining wrapper frees. Construct usable wrappers before committing ownership, or roll ownership back on construction failure. Make mocks terminal after successful `free()` and add GPU-dispose, one-wrapper, constructor, concurrent, and fresh-generation failure/retry tests.

### Minor m1 - worktree and formatting hygiene remain red (confidence 1.00)

The worktree now has 3,444 status paths: 58 tracked modifications and 3,386 untracked files. Eleven Vite output directories contribute 307 files each; nine non-dist untracked paths remain. Ignored `.next` output is additional generated state. Modified-file Prettier checking fails on eight files, and modified-file ESLint reports 12 errors / 4 warnings; at least `use-raf-loop.ts` introduces a new positional-parameter rule violation, while several other lint identities are inherited lines in touched files. `git diff --check` itself exits 0.

Fix brief: format the eight named files, fix the changed-line lint violation, then remove only explicitly enumerated generated output paths after preserving accepted evidence. Re-audit status rather than using broad cleanup.

## Current task truthfulness audit

The current task file is **101 checked / 36 unchecked / 137 total**. The three newly checked literal browser-work items (4.5, 10.2, 10.5) now have concrete implementation/execution: source timer calls are mediated, both Hosts execute suspend/resume in each cycle, and each performs a same-session post-resume operation. Those facts do not satisfy the stronger quiescence scenario in B4.

At minimum, these checked claims are contradicted or materially incomplete in the current tree: **2.8, 2.9; 4.3, 4.4, 4.6; 6.5; 7.3, 7.6-7.10; 8.2, 8.4, 8.9, 8.10; 9.1-9.3, 9.5, 9.6, 9.8; 10.9; 12.8-12.10, 12.12, and 12.14.** Review/evaluation/delivery tasks 13-14 remain unchecked and were not advanced by this report.

## All 59 scenarios

`PASS` means independently reproduced or directly supported by a focused test plus inspected implementation. `FAIL` means current code/evidence contradicts the scenario. `UNVERIFIED` is not treated as pass.

| # | Scenario (spec order) | Status | Independent disposition |
|---:|---|---|---|
| 1 | Concurrent disposal joins one teardown | PASS | Inner ownership suite asserts promise identity. |
| 2 | Dispose wins over a queued resume | UNVERIFIED | Task 2.5 remains unchecked; no explicit queued-resume race exists. |
| 3 | Repeated suspend and resume are idempotent | PASS | Inner lifecycle suite passes repeated/no-op transitions. |
| 4 | Host replacement cannot publish from a stale generation | PASS | Deferred Host churn/generation test passes. |
| 5 | Suspend stops active publications | FAIL | Registry admission, UI activity, and queued save remain live. |
| 6 | Suspend retains non-activity identity | PASS | Unit plus both Host cycles retain project/root/editor identity. |
| 7 | Resume restarts only the owner | FAIL | Activity was never globally quiesced/closed to admission. |
| 8 | Retained resources are not falsely reported released | UNVERIFIED | No report is sampled during the suspended window. |
| 9 | Complete editor graph has one mediator | FAIL | Second-mediator/default-compositor rules are absent. |
| 10 | Direct acquisition fails mechanically | FAIL | Required compositor/default-key families are not scanned. |
| 11 | Empty/truncated scanning cannot pass | FAIL | One module per named root can satisfy the emitted check. |
| 12 | Operation-bounded offline rendering is classified | FAIL | Line regex/exemption cannot prove non-storage, non-export, or `finally`. |
| 13 | Fired timeout self-releases | UNVERIFIED | Code path exists; no focused firing/race execution exists. |
| 14 | Suspend cancels activity timers | FAIL | Save/UI/harness timers remain active through suspend. |
| 15 | Disposal cancels timeout/interval/RAF | UNVERIFIED | Real interval is proven; complete three-kind race matrix is absent. |
| 16 | Transcription Worker stops on suspend | PASS | Core calls tested listener-clean termination with generation invalidation. |
| 17 | Resume creates fresh Worker generation | UNVERIFIED | Lazy code exists; no terminate/resume/reacquire test. |
| 18 | Disposal observes platform Worker termination | PASS | Both Hosts exchange a message and prove no post-dispose message/residual. |
| 19 | Audio decode closes finite context | UNVERIFIED | Paths were migrated, but success/failure/cancel decode matrix is absent. |
| 20 | Audio playback quiesces and resumes | UNVERIFIED | No scheduling/publication lifecycle test covers both edges. |
| 21 | Disposal waits for terminal closed state | PASS | Delayed-close focused test passes. |
| 22 | Rejected close is not clean release | PASS | Rejected-release focused test preserves the failure. |
| 23 | Loaded media retains URL owner | PASS | Session-owned persistence test and inspected handle storage pass. |
| 24 | Replacement/removal revoke once | FAIL | The canonical undo/redo persistence test is newly red. |
| 25 | Transient processing revokes every exit | UNVERIFIED | Complete error/cancel exit matrix is absent. |
| 26 | Disposal drains retained URLs | PASS | Both Hosts prove fetch-before and failure-after revoke. |
| 27 | Two sessions do not share live cache identity | PASS | Inner ownership suite asserts distinct video/waveform cache objects. |
| 28 | Project replacement drains prior live state | FAIL | Preview source and pending cache work survive the declared drain. |
| 29 | Session disposal drains every service owner | FAIL | Async video work can repopulate; preview source index remains poisoned. |
| 30 | Shared resolver lease final-owner release | FAIL | Final service deletion does not delete/recreate its source lease. |
| 31 | Reverse acquisition terminal order | PASS | Lifecycle drain test and implementation await sequential reverse release. |
| 32 | One failure does not skip later cleanup | PASS | Rejected-audio focused test proves later Worker/URL cleanup. |
| 33 | Multiple failures are preserved | UNVERIFIED | Aggregate branch exists; no two-resource failure execution was found. |
| 34 | Repeated disposal preserves first outcome | PASS | Stable success/failure outcomes are focused-tested. |
| 35 | No acquisition after disposal closes | PASS | Registry synchronously refuses post-dispose acquisition. |
| 36 | First of two GPU owners releases only its compositor | UNVERIFIED | Owner-count test exists; two live compositor handles are not exercised. |
| 37 | Final owner tears down shared state | PASS | Two-owner counter test and ordinary browser generations pass. |
| 38 | Live handles prevent false final release | PASS | Real GPU leak control refuses final release and names handle 1. |
| 39 | Concurrent owner release calls one teardown | PASS | Concurrent repeated dispose increments `disposeGpuCalls` once. |
| 40 | Fresh generation initializes after teardown | PASS | Tests plus sequential real browser generations pass. |
| 41 | Query wrappers outlive reconciliation | FAIL | Partial retry calls `liveHandles()` through a freed real query. |
| 42 | Every ordinary cycle creates all five | PASS | Fresh Vite and Next each prove six all-five cycles. |
| 43 | Every ordinary cycle has zero exact residuals | PASS | Independent platform and registry series are all zero on both Hosts. |
| 44 | Residual growth assessed | PASS | Every class emits a series; deliberate Worker/GPU growth is named. |
| 45 | Missing creation fails before release proof | PASS | Missing Worker creation is non-clean in all cycles on both Hosts. |
| 46 | Deliberate leakage caught by same evaluator | PASS | Same evaluator catches independent Worker and real GPU residuals. |
| 47 | Fresh Vite evidence attributable | PASS | Fresh marker, owned port, production store, and controls reproduced. |
| 48 | Fresh Next evidence attributable | PASS | Fresh standalone marker/build/store and all controls reproduced. |
| 49 | Host fallback cannot pass | PASS | Runner enforces store and audio fallback; real compositor/Worker execute. |
| 50 | Process metrics cannot override exact leakage | PASS | Exact Worker/GPU residuals keep leak control non-clean. |
| 51 | Disposing one session preserves another | UNVERIFIED | Per-core identity improved; no live shared-resolver disposal-order test exists. |
| 52 | Durable data survives all disposal | UNVERIFIED | C5 paths pass, but no full browser dispose/reopen flow was rerun here. |
| 53 | Forced-none remains allocation-free | PASS | Protected C4 focused evidence remains green. |
| 54 | Backend capacity unchanged | PASS | Prior real WebGL proof plus fresh real WebGPU capacity=2 proof cover both. |
| 55 | Protected artifacts remain identical | FAIL | Protected port blob and generated JS SHA differ. |
| 56 | Existing regression identity does not grow | FAIL | Media undo/redo adds one deterministic root failure identity. |
| 57 | Capability corpus swept both ways | FAIL | Multiple added scenarios remain failed/unexecuted despite checked 12.9. |
| 58 | C7 and E1 remain out of scope | PASS | No C7/E1/D2/Rust-source product change was found. |
| 59 | Review/delivery stages remain independent | PASS | This review is report-only and all delivery leaves remain untouched. |

Scenario totals: **32 PASS / 15 FAIL / 12 UNVERIFIED = 59**.

## Independent command record

| Command / gate | Result |
|---|---|
| HEAD/tree identity | `d6ed4166...` / `38750743...`. |
| Exact five-file fix focus | 13 pass / 0 fail / 45 expectations. |
| All seven session suites | 18 outer pass; direct isolated lifecycle+ownership expansion 52 pass / 0 fail / 198 expectations. |
| Type baseline | exit 0; no diagnostic identity outside the pinned set. |
| Vite exact typecheck | exit 0. |
| Fresh Vite build | exit 0; 2,889 transformed modules, output `dist-c6-fix1-vite-20260804-3`. |
| Fresh Next build | exit 0 with required build env; Next 16.1.3, 19 routes, `/c6-disposal` and `/editor/[project_id]`. |
| Source + Vite + Next boundary | **exit 1** at missing `apps/web/.next/module-graph.json`; source and Vite portions pass. |
| Independent Next route source-map inventory | 84 attributable JS / 70 maps / 1,927 module-source IDs / all 15 roots present. |
| Fresh Vite browser oracle | exit 0; ordinary clean, missing-created non-clean, Worker+GPU leak non-clean. |
| Fresh Next standalone browser oracle | exit 0; same correct six-cycle polarity and real-platform proof. |
| `bun test` | **exit 1**; 337 pass / 9 fail / 3 errors / 1,087 expectations / 346 tests / 67 files; new media undo identity reproduced alone. |
| Port boundary normal/negative | exit 0; 34 contract modules; all existing controls pass. |
| WASM source/path/API gates | exit 0; 38 JS / 58 binary exports and structural compile pass. |
| Protected diff | **exit 1**; in-memory port changed; generated JS SHA also differs. |
| Modified-file Prettier | **exit 1**; 8 files unformatted. |
| Modified-file ESLint | **exit 1**; 12 errors / 4 warnings (mixed inherited and changed-line identities). |
| `git diff --check` | exit 0; line-ending notices only. |
| `rasen validate s02-session-disposal --project rocut --strict` | exit 0. |

## Scope and cleanliness

Scope Check: **VIOLATION / REQUIREMENTS MISSING**. No C7/E1/Rust-source expansion was found, but the protected C5 in-memory port was modified. Required suspend quiescence, deterministic final-owner/service drain, retryable WASM failure handling, complete executable boundary, protected identity, and regression acceptance remain missing.

Tree status: **NOT CLEAN** in both acceptance and worktree senses. No fix, task mutation, commit, ship, integration, spec sync, or archive was performed by this reviewer.
