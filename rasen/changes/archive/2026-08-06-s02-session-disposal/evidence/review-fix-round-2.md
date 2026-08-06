# C6 fix-round 2 independent delta review

Date: 2026-08-04 +08:00  
Reviewer: fresh non-author Sol reviewer (`/root/c6_sol_review_eval`)  
Reviewed product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c6`  
Baseline: HEAD `d6ed4166b5ffb13257d1924851f2fa57d73d349f`, tree `3875074383b41f622e5f32942091468cf8959b61`  
Review mode: report only; no product, task, author-evidence, commit, ship, integration, spec-sync, archive, or cleanup mutation

## Verdict

**NOT CLEAN - 3 Blocker / 1 Major / 1 Minor / 0 Trivial.**

Fix round 2 closes the round-1 media undo regression, protected-port/generated-artifact identity violation, final-owner preview/cache defects, and partial WASM-release retry defect. The exact type ceiling, fresh Vite and Next builds, both six-cycle browser polarities, protected identities, WASM gates, and inherited full-suite failure identity are independently green.

Three contract-defining defects remain: the emitted/source boundary can still accept a padded truncated graph and cannot enforce bounded offline ownership; real project replacement does not invoke the newly correct cache/media drain; and suspend suppresses still-live activity instead of cancelling/restarting it, which kills an ordinary retained RAF loop. A newly identified finite-audio failure path leaks its acquired live context. Changed-tree formatting/lint and worktree hygiene are also still red.

The frozen model evaluation remains unchanged with the exact verdict **`bounded-task only`**. The separate final experiment audit records attribution and policy without rewriting the frozen evaluation.

## Closed findings

### Round-1 Blocker B6 - CLOSED

The canonical media persistence/undo regression passes in isolation and in the complete suite. The fresh full suite reproduces exactly **346 pass / 8 fail / 2 errors / 1,141 expectations / 354 tests / 70 files**; the six `ZERO_MEDIA_TIME` placement failures and two loader errors are the inherited identities, with no C6 media-undo addition.

### Round-1 Blocker B7 - CLOSED

`git diff --exit-code` over the protected set exits 0. The protected port tree, session-type blob, parity fixture/tree, type fixture, and three Rust trees are exact. Working SHA-256 values are exact for `rust/wasm/pkg/opencut_wasm.js` (`19714428...`) and `opencut_wasm_bg.wasm` (`15622cf...`). The status-only `M` on the in-memory port is line-ending/stat dirt; its working Git blob and HEAD blob are both `c28d9b0b...`, and it has no content diff.

### Round-1 Major M1 - CLOSED

The WASM runtime now distinguishes shared GPU teardown from per-wrapper free progress. A failed shared teardown retains both live query wrappers; after successful shared teardown, a wrapper-free retry skips `liveHandles()`, `disposeGpu()`, and already-freed wrappers. Constructor failure rolls ownership back. The mocks become terminal after `free()`, and the focused failure/retry/concurrency/fresh-generation matrix passes.

### Round-1 Blocker B3 subparts - CLOSED, but the integration finding remains open below

Video and waveform caches invalidate generations and await pending work; equal logical keys in two owners remain isolated. Final effect-preview service release deletes and recreates both service and resolver source state. These leaf controls pass. The actual `ProjectManager.loadProject()` path still bypasses them, so B3 is narrowed rather than closed.

## Findings

### Blocker B2 - the boundary is executable but still not mechanically complete (confidence 1.00)

The fresh Vite and Next route graphs now execute through the checker and contain all fifteen named roots plus exact Host/session entries. That closes the missing-Next-graph part of round 1. The completeness and offline controls remain false proofs:

- `script/check-session-resource-boundary.mjs:29` defines one global minimum of 60 IDs.
- `:329-330` defines completeness only as `moduleIds.length >= 60`.
- `:433-452` then requires only one ID in each required root and the exact entries. A graph containing one file from each of the fifteen roots, the exact entries, and enough unrelated/padding source IDs reaches 60 and passes while most required-root modules are absent.
- The negative fixture exercises only a 17-ID graph. It proves the threshold fires, not that a non-empty padded-but-truncated required graph fails.
- `:69-70` recognizes bounded offline audio only as a line containing `new OfflineAudioContext(`. The four exemptions at `:216-253` are path/string pairs; they cannot detect storing/exporting the context, returning it, failing to await its render, or escaping it into session/module state.
- The alleged positive control at `:393-395` is the same raw constructor text placed at an exempt path. It does not prove the bounded lifetime described by the scenario.
- The second-mediator rule at `:81-85` recognizes selected constructor/function/class names, not the acquisition behavior. A differently named registry/factory can evade it.

Impact: scenarios 9, 11, and 12 remain failed. Checked tasks 6.5, 9.2-9.4, 9.6, and the complete evidence mapping claimed by 12.9 are materially incomplete. A future direct resource owner or truncated emitted graph can receive a clean gate result, so this remains a Blocker in the exact acceptance mechanism rather than a documentation concern.

Fix brief: derive expected emitted closure from the attributable route graph/source maps and compare required-root membership against that inventory, not a global constant. Add a padded truncated fixture that is above the global count and omits most modules from one or more required roots. Enforce offline boundedness through a reviewed helper/API or AST/value-flow rule that rejects storage, export/return, missing awaited terminal render, and lifecycle escape; add a separate negative for each. Make the mediator rule structural enough to catch acquisition-capable wrappers under arbitrary names.

### Blocker B3 - real project replacement overwrites live media without draining the prior owner (confidence 1.00)

`ProjectManager.loadProject()` at `apps/web/src/core/managers/project-manager.ts:107-136` loads the new project and calls `media.loadProjectMedia()` directly. It never calls the existing awaited `clearAllAssets()` path before replacement. `MediaManager.loadProjectMedia()` at `apps/web/src/core/managers/media-manager.ts:105-137` constructs new attachment URLs and assigns `this.assets = mediaAssets`; it does not revoke the old asset handles or clear/join VideoCache and WaveformCache. The path also does not drain preview or transcription state.

The new video/waveform tests call leaf `clearAll()` APIs directly. They demonstrate that the leaf implementation is usable, but they do not execute the canonical project-switch integration that scenario 28 and checked tasks 7.2, 7.3, and 7.8 require.

Impact: switching from one project to another can retain old object URLs, cache inputs/promises, preview ownership, and transcription work while publishing the new project. Durable C5 data is not deleted, but the C6 live-resource boundary is violated on an ordinary user path.

Fix brief: introduce one awaited project-live-state drain and invoke it in the canonical replacement transaction before publishing the new project. Invalidate generations before joining pending work; revoke the old asset handles exactly once; drain cache, preview, and transcription owners; preserve durable storage. Add an integration test through `ProjectManager.loadProject()` with an old retained URL, pending video/waveform work, preview owner, and transcription generation, then prove the new project is the only live generation.

### Blocker B4 - suspend suppresses still-live callbacks and permanently loses retained RAF loops (confidence 1.00)

The synchronous admission gate is valuable, and the browser reports prove stable harness counters, acquisition refusal, and a same-session post-resume operation. It is not the specified quiescence/restart implementation:

- `SessionResources.setInterval()` at `apps/web/src/editor/session/session-resources.ts:322-333` leaves the platform interval live and merely drops callbacks while admission is closed.
- `requestAnimationFrame()` at `:336-342` also drops the callback while suspended and never self-releases the fired one-shot entry.
- `useRafLoop()` at `apps/web/src/hooks/use-raf-loop.ts:11-27` schedules its next frame only inside the prior frame callback. If the due frame is suppressed during suspension, no next frame exists and React has no dependency change that restarts the effect on resume.
- `waitForNextPaint()` at `apps/web/src/media/upload-toast.ts:13-20` nests two mediated frames. A suspension before either callback can leave the promise unresolved; reacquiring the second frame while admission is closed can throw from inside the callback without resolving or rejecting the promise.
- `EditorCore.suspend()` at `apps/web/src/core/index.ts:124-129` pauses save/playback/audio and terminates transcription, but it has no renderer publication suspend/restart lifecycle.
- `getActivityGeneration()` is not consumed outside the registry. General renderer, event, subscription, and promise continuations therefore are not generation-guarded.
- The browser harness's `renderPublications` counter at `c6-disposal-harness.tsx:460-468` is a second harness interval, not an in-flight real renderer publication. Stable fake counters cannot establish real rendered-frame quiescence or restart.

An independent in-memory execution scheduled a recurring RAF, closed admission before its due callback, fired the platform callback, and reopened admission. The result was exactly `callbackCount=0`, `scheduledAfterResume=0`, and timer accounting `created=1/released=0`. A separate probe confirms ordinary fired timeout self-release and final cancellation of timeout/interval/RAF (`fired 1/1`; final timer `4/4`), so the defect is specifically suspend/restart and RAF live accounting rather than final disposal.

Impact: scenarios 5, 7, and 14 fail. Checked tasks 2.8, 2.9, 4.4, and 4.6 are contradicted; task 4.7 correctly remains unchecked. Retained preview/playback/UI RAF work can stop permanently after resume, activity handles remain platform-live during the suspended dwell, and asynchronous publications lack a general stale-generation guard.

Fix brief: make suspend terminally cancel/release every activity-bound timer/RAF/Worker handle before publishing the suspended state, while retaining explicitly non-activity resources. Give owners a serialized resume/generation hook so required loops are reacquired only after managers are ready. Self-release RAF handles when the platform callback fires. Propagate generation tokens through real renderer/event/promise continuations, settle frame-wait promises on suspension, and execute fake-clock plus real-renderer tests for suspend-before-fire, suspend-between-nested-frames, resume restart, and stale completion rejection.

### Major M2 - finite audio decode can leak its live context before entering `finally` (confidence 1.00)

`decodeAudioToFloat32()` acquires an audio handle at `apps/web/src/media/audio.ts:56-58`, but `await audioBlob.arrayBuffer()` occurs at `:63`, before the `try/finally` at `:65-69`. If Blob reading rejects or is cancelled, the acquired context is never closed until eventual whole-session disposal.

Impact: scenario 19 fails, and checked task 6.3 is false for the explicit failure/cancellation edge. This is a bounded failure path rather than the ordinary lifecycle, so it is Major rather than Blocker.

Fix brief: enter `try/finally` immediately after successful handle acquisition and include Blob reading plus decode inside it. Await close on every success/failure/cancellation exit, preserving both operation and close failures when both occur. Add rejecting/cancelled `arrayBuffer()` and rejecting `decodeAudioData()` tests that assert terminal platform state and exact registry accounting.

### Minor m1 - changed-tree hygiene and its recorded green claim remain false (confidence 1.00)

The current worktree has **4,403 status paths**: 60 tracked-status entries (58 content diffs plus two line-ending/stat-only entries) and 4,343 untracked files. Fourteen Vite output directories account for 4,298 untracked files; thirteen non-generated/non-log source/test/script files are also untracked.

A changed/untracked source Prettier check over 71 files fails on seven source files: assets view, `use-raf-loop.ts`, `use-paste-media.ts`, preview index, storage service, sounds store, and audio waveform. ESLint over 70 source files reports **10 errors / 4 warnings**. Most reported identities already exist on the same HEAD files, but `use-raf-loop.ts:4` introduces a new `prefer-object-params` error. `git diff --check` exits 0.

This contradicts `c6-fix2-lifecycle-remediation.md:73-74` and the implementer handoff claim that combined changed-file Prettier and ESLint both exit 0.

Fix brief: format the seven current source files, fix the changed-line lint error, and rerun the exact complete changed/untracked source list. Remove only explicitly enumerated build/output paths after accepted evidence is retained; do not use broad cleanup.

## Current task truthfulness audit

The task file remains **101 checked / 36 unchecked / 137 total**.

At minimum, these checked claims are contradicted or materially incomplete in the current tree: **2.8, 2.9; 3.10; 4.4, 4.6; 6.3, 6.5; 7.2, 7.3, 7.8; 9.2-9.4, 9.6; 10.9; 12.9 and 12.14.**

- Task 3.10 claims an aggregate-error-order GREEN test, but only a one-release rejection is executed in the resource-drain suite.
- Task 10.9 claims a missing-CREATED control for every class or one parameterized class control; the browser control omits Worker only.
- Task 12.14's saved static-gate outcome is not exact for the reviewed tree, as the independently complete changed-source Prettier/ESLint commands are red.

Review/evaluation/delivery items 13-14 remain unchecked. This report does not mutate tasks or advance delivery.

## All 59 scenarios

`PASS` means independently reproduced or directly supported by a focused execution plus inspected implementation. `FAIL` means current code/evidence contradicts the scenario. `UNVERIFIED` is not treated as pass.

|   # | Scenario (spec order)                                      | Status     | Independent disposition                                                                                                     |
| --: | ---------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
|   1 | Concurrent disposal joins one teardown                     | PASS       | Ownership suite asserts the same promise and one cleanup.                                                                   |
|   2 | Dispose wins over a queued resume                          | UNVERIFIED | Task 2.5 remains unchecked; no explicit queued-resume race executes.                                                        |
|   3 | Repeated suspend and resume are idempotent                 | PASS       | Lifecycle suite covers repeated/no-op transitions.                                                                          |
|   4 | Host replacement cannot publish from a stale generation    | PASS       | Deferred Host generation/teardown control passes.                                                                           |
|   5 | Suspend stops active publications                          | FAIL       | Real renderer/async publications are not generation-guarded; stable harness intervals are substitutes.                      |
|   6 | Suspend retains non-activity identity                      | PASS       | Unit and both browser Hosts retain session/project/root identity.                                                           |
|   7 | Resume restarts only the owner                             | FAIL       | A retained RAF due during suspend has no scheduled frame after resume.                                                      |
|   8 | Retained resources are not falsely reported released       | UNVERIFIED | No full disposal report is sampled and adjudicated during suspended dwell.                                                  |
|   9 | The complete editor graph has one acquisition mediator     | FAIL       | The name-pattern rule can miss an arbitrarily named acquisition-capable mediator.                                           |
|  10 | Direct acquisition fails mechanically                      | PASS       | All seven named negative rule/path fixtures are caught.                                                                     |
|  11 | Empty or truncated scanning cannot pass                    | FAIL       | A padded 60-ID graph with one file per required root can pass.                                                              |
|  12 | Operation-bounded offline rendering is classified          | FAIL       | Constructor path/string exemptions do not prove bounded ownership or awaited lifetime.                                      |
|  13 | A fired timeout self-releases                              | PASS       | Independent execution reports fired timeout `created=1/released=1`.                                                         |
|  14 | Suspend cancels activity timers                            | FAIL       | Interval/RAF platform handles remain live; callbacks are only suppressed.                                                   |
|  15 | Disposal cancels every remaining timer kind                | PASS       | Independent timeout/interval/RAF drain reports final timer `created=4/released=4` and zero frames.                          |
|  16 | Transcription Worker stops on suspend                      | PASS       | Termination/listener cleanup and generation invalidation pass.                                                              |
|  17 | Resume creates a fresh Worker generation                   | UNVERIFIED | Lazy code exists; no terminate/resume/reacquire execution was found.                                                        |
|  18 | Disposal observes platform termination                     | PASS       | Both Hosts exchange a Worker message and prove terminal absence.                                                            |
|  19 | Audio decode closes its finite context                     | FAIL       | Blob read rejection occurs before the close `finally`.                                                                      |
|  20 | Audio playback quiesces and resumes                        | UNVERIFIED | No real scheduling/node lifecycle execution covers both transitions.                                                        |
|  21 | Disposal waits for terminal closed state                   | PASS       | Delayed-close focused test passes.                                                                                          |
|  22 | Rejected close is not clean release                        | PASS       | Rejection preserves the failed release and stable outcome.                                                                  |
|  23 | Loaded media retains its URL owner                         | PASS       | Persistence test and retained handle implementation pass.                                                                   |
|  24 | Replacement and removal revoke once                        | PASS       | Canonical media undo/redo regression and full suite are restored.                                                           |
|  25 | Transient processing revokes on every exit                 | UNVERIFIED | Complete success/error/cancel matrix is still absent.                                                                       |
|  26 | Disposal drains retained URLs                              | PASS       | Both Hosts prove fetch-before and failure-after revoke.                                                                     |
|  27 | Two sessions do not share live cache identity              | PASS       | Distinct cache objects and equal-key generation controls pass.                                                              |
|  28 | Project replacement drains prior live state                | FAIL       | Canonical `loadProject()` overwrites without invoking the leaf drains.                                                      |
|  29 | Session disposal drains every service owner                | PASS       | Awaited media/cache drain, preview final release, and core disposal order are now present and focused-tested.               |
|  30 | Shared resolver lease releases only on the final owner     | PASS       | Two-owner/final-release source and service recreation test passes.                                                          |
|  31 | Reverse acquisition order is terminal order                | PASS       | Resource drain implementation/test observes sequential reverse release.                                                     |
|  32 | One failure does not skip later cleanup                    | PASS       | Rejected audio close still permits Worker/URL cleanup.                                                                      |
|  33 | Multiple failures are preserved                            | UNVERIFIED | Aggregate branch exists; no two-resource failure-order test was found.                                                      |
|  34 | Repeated disposal preserves the first outcome              | PASS       | Stable fulfilled/rejected outcomes are tested.                                                                              |
|  35 | No acquisition occurs after disposal admission closes      | PASS       | Registry synchronously rejects later acquisition.                                                                           |
|  36 | First of two owners releases only its compositor           | UNVERIFIED | Owner counter is tested, but the two-live-compositor-handle case is not directly executed here.                             |
|  37 | Final owner tears down shared state                        | PASS       | Two-owner final counter and ordinary browser generations pass.                                                              |
|  38 | Live handles prevent a false final release                 | PASS       | Deliberate real GPU leak remains non-clean and names the handle.                                                            |
|  39 | Concurrent owner release calls one teardown                | PASS       | Repeated concurrent final release calls `disposeGpu()` once.                                                                |
|  40 | A fresh generation can initialize after final teardown     | PASS       | Focused retry/fresh-generation tests and browser cycles pass.                                                               |
|  41 | Runtime query wrappers outlive session reconciliation      | PASS       | Terminal mocks and partial retry matrix now preserve usable wrapper ordering.                                               |
|  42 | Every ordinary cycle creates all five classes              | PASS       | Fresh Vite and Next each prove six all-five cycles.                                                                         |
|  43 | Every ordinary cycle has zero exact residuals              | PASS       | Registry and independent platform residual series are zero on both Hosts.                                                   |
|  44 | Residual growth is assessed across cycles                  | PASS       | Every class emits a series; Worker/GPU leak growth is named.                                                                |
|  45 | Missing creation fails before release proof                | PASS       | Missing Worker is non-clean in every cycle on both Hosts.                                                                   |
|  46 | Deliberate leakage is caught by the same evaluator         | PASS       | The same evaluator catches independent Worker and real GPU residuals.                                                       |
|  47 | Fresh Vite evidence is attributable                        | PASS       | Unique marker, fresh output, owned port, production store, and controls reproduced.                                         |
|  48 | Fresh Next evidence is attributable                        | PASS       | Unique marker, fresh standalone build, owned port, production store, and controls reproduced.                               |
|  49 | Host fallback cannot pass                                  | PASS       | Runner enforces production store/runtime roles; real Worker/audio/compositor execute.                                       |
|  50 | Supplemental process metrics cannot override exact leakage | PASS       | Exact Worker/GPU residuals keep the leak control non-clean.                                                                 |
|  51 | Disposing one session preserves another session            | PASS       | Session-B preservation, equal-key cache isolation, and two-owner preview lease controls pass.                               |
|  52 | Durable data survives all session disposal                 | UNVERIFIED | C5 gates remain green, but the C6 browser cycles use unique project IDs and do not write/dispose/reopen one durable record. |
|  53 | Forced-none remains allocation-free                        | PASS       | Protected C4 evidence remains green.                                                                                        |
|  54 | Backend capacity behavior remains unchanged                | PASS       | Recorded WebGL-one/WebGPU-two gates and fresh real compositor evidence remain green.                                        |
|  55 | Protected artifacts remain identical                       | PASS       | Protected diff and all recorded trees/blobs/SHA-256 values are exact.                                                       |
|  56 | Existing regression identity does not grow                 | PASS       | Full suite exactly matches the inherited eight failures/two loader errors.                                                  |
|  57 | The complete capability corpus is swept both ways          | FAIL       | Nine scenarios fail and eight remain unverified despite checked task 12.9.                                                  |
|  58 | C7 and E1 remain out of scope                              | PASS       | No C7/E1/D2/Rust-source/generated-WASM/durable-deletion expansion is present.                                               |
|  59 | Review and delivery stages remain independent              | PASS       | This review writes reports only; delivery leaves remain untouched.                                                          |

Scenario totals: **42 PASS / 9 FAIL / 8 UNVERIFIED = 59**.

## Independent command record

| Command / gate                                                        | Result                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HEAD/tree identity                                                    | `d6ed4166...` / `38750743...`.                                                                                                                                                                                                         |
| Combined focused C6 matrix                                            | 16 pass / 0 fail / 38 expectations across lifecycle, disposal, ownership, persistence, preview, cache, and WASM files.                                                                                                                 |
| Source boundary                                                       | Exit 0; 711 source modules, all 15 required roots, 7 rules with zero current violations.                                                                                                                                               |
| Boundary negative/focused                                             | Exit 0; all named fixtures pass; 5 tests / 45 expectations. Structural review still finds B2.                                                                                                                                          |
| Type baseline                                                         | Exit 0; exactly 3 current diagnostics, all in the pinned baseline.                                                                                                                                                                     |
| Vite exact typecheck                                                  | Exit 0.                                                                                                                                                                                                                                |
| Fresh Vite build                                                      | Exit 0; marker `c6-review-fix2-vite-20260804-1`, 2,889 modules, fresh `dist-c6-review-fix2-20260804-1`.                                                                                                                                |
| Fresh Next build                                                      | First incomplete-env attempt compiled then stopped at page data; rerun with the complete dummy build env exits 0, Next 16.1.3, 19 routes including `/c6-disposal` and `/editor/[project_id]`, marker `c6-review-fix2-next-20260804-1`. |
| Fresh emitted boundary                                                | Exit 0; Vite 2,889 modules / 590 source IDs; Next 82 files / 78 maps / 2,557 IDs / 596 source IDs; all roots and exact entries present.                                                                                                |
| Fresh Vite browser oracle                                             | Exit 0 on exclusive port 4317; ordinary clean, missing-created non-clean, Worker/GPU leak non-clean, six cycles, exact marker; port free afterward.                                                                                    |
| Fresh Next browser oracle                                             | Exit 0 on exclusive port 4318 with the same six-cycle polarity and exact marker; port free afterward.                                                                                                                                  |
| Suspended RAF probe                                                   | `callbackCount=0`, `scheduledAfterResume=0`, timer `created=1/released=0`; reproduces B4.                                                                                                                                              |
| Timeout/final timer probe                                             | Fired timeout `1/1`; final timeout+interval+RAF aggregate `4/4`; zero scheduled frames after disposal.                                                                                                                                 |
| `bun test`                                                            | Exit 1 with the exact accepted inherited identity: 346 pass / 8 fail / 2 errors / 1,141 expectations / 354 tests / 70 files.                                                                                                           |
| Port boundary normal/negative                                         | Exit 0; 35 contract modules; all controls pass.                                                                                                                                                                                        |
| WASM source/path/API                                                  | Exit 0; 38 JS / 58 binary exports, 609 imports, structural compile pass, no path/provenance drift.                                                                                                                                     |
| Protected identity audit                                              | Exit 0; exact port/session/parity/type/Rust identities and generated JS/WASM SHA-256.                                                                                                                                                  |
| Changed/untracked source Prettier                                     | **Exit 1**; 71 checked, 7 source files red.                                                                                                                                                                                            |
| Changed/untracked source ESLint                                       | **Exit 1**; 70 checked, 10 errors / 4 warnings; one new changed-line positional-parameter error.                                                                                                                                       |
| `git diff --check`                                                    | Exit 0; line-ending notices only.                                                                                                                                                                                                      |
| `rasen validate s02-session-disposal --strict --project rocut --json` | Exit 0; valid with zero issues.                                                                                                                                                                                                        |

## Scope and cleanliness

Scope Check: **VIOLATION / REQUIREMENTS MISSING**. The write set contains no C7 headless graph, E1 Elftia/packaging work, D2 React decision, new private port, Rust API/source change, generated WASM edit, or durable-data deletion, and all protected identities are exact. The violation is the missing C6 behavior/evidence required by B2, B3, B4, and M2.

Tree status: **NOT CLEAN** in both acceptance and worktree senses. No fix, task mutation, author-evidence mutation, commit, ship, integration, spec sync, archive, or cleanup was performed by this reviewer.
