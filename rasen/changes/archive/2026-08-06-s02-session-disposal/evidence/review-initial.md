# C6 initial independent review

Date: 2026-08-04 +08:00  
Reviewer: fresh non-author Sol reviewer (`/root/c6_sol_review_eval`)  
Reviewed product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c6`  
Baseline: HEAD `d6ed4166b5ffb13257d1924851f2fa57d73d349f`, tree `3875074383b41f622e5f32942091468cf8959b61`  
Review mode: report only; no product, task, author-evidence, commit, ship, integration, or archive mutation

## Verdict

**NOT CLEAN — 5 Blocker / 1 Major / 1 Minor / 0 Trivial.**

The frozen Luna first return remains exactly **98 checked / 39 unchecked / 137 total**. Its principal disclosed miss is preserved: the browser harness does not execute `suspend -> resume` or a post-resume same-session operation. The first synthetic-GPU attempt was corrected only after LEAD challenge; the existing final Vite artifact independently reproduces a real WebGL compositor and both evaluator controls, but it does not close the lifecycle or evidence gaps below.

## Findings

### Blocker B1 — the current tree fails the exact type gate (confidence 1.00)

`apps/web/src/core/managers/renderer-manager.ts:21-39` assigns `this.editor` and `this.assetResolver` without declaring either property. The current exact gate reports five new diagnostic identities (18 diagnostics now versus 13 at the pin): ten uses at `renderer-manager.ts:37`, two at `:38`, and consumer failures at `project-manager.ts:675`, `c6-disposal-harness.tsx:124`, and `preview/components/index.tsx:120`.

Impact: the protected type ceiling is exceeded and current-source Next/type acceptance cannot ship. The previously recorded type/build logs are not attributable to this exact current tree.

Fix brief: restore explicit `RendererManager` fields with the intended visibility (`private readonly editor: EditorCore` and public/readonly `assetResolver: AssetResolver`, or equivalent parameter properties), then rerun the exact type baseline and fresh Vite/Next builds from the fixed tree.

### Blocker B2 — the “complete editor graph” boundary is a false green (confidence 1.00)

`script/check-session-resource-boundary.mjs:17-26` scans selected roots and omits known session-reachable roots such as `components/editor`, `preview`, `selection`, `timeline`, `sounds`, `export`, and `utils`. It also exempts whole files whose fallback behavior violates the stated invariant. Independent whole-tree search found, among others:

- `apps/web/src/sounds/sounds-store.ts:413` — direct live `new AudioContext()`;
- `apps/web/src/media/audio.ts:62-72` — `decodeAudioToFloat32` constructs a live context and never closes it;
- `apps/web/src/commands/media/remove-media-asset.ts:127` — undo creates an untracked object URL;
- editor/timeline RAF/timer calls in `components/editor/editor-header.tsx:191`, `preview/components/index.tsx:275,303`, `selection/hooks/use-box-select.ts:165`, `selection/selectable-surface.tsx:232`, `timeline/controllers/zoom-controller.ts:222`, `timeline/hooks/use-scroll-position.ts:26`, `timeline/hooks/use-edge-auto-scroll.ts:37,77,80`, and `timeline/components/index.tsx:253`.

The normal and negative checker commands both pass because the fixtures are injected only inside an included synthetic path. Removing an omitted Host/editor root would also leave `files.length > 0`, so the “empty or truncated scan” guard is not root-complete.

Impact: required acquisition mediation, finite-audio closure, timer quiescence, object-URL ownership, and non-vacuous boundary scenarios are missing while tasks 4.1, 6.1, 7.1, and 9.1-9.4 are checked.

Fix brief: derive the scan from both emitted Host entry graphs (plus tracked/untracked source), require every mandated root/owner to be present, replace file-wide compatibility exemptions with exact construct-level classifications, and route every live acquisition above through the owning `SessionResources`. Add negative fixtures at each omitted root and prove removing any required root fails.

### Blocker B3 — resource-holding caches and preview ownership remain cross-session globals (confidence 0.99)

`apps/web/src/services/video-cache/service.ts:344` and `waveform-cache/service.ts:99` still export immortal instances. They remain active consumers through `services/renderer/resolve.ts:22,205,429` and `timeline/components/audio-waveform.tsx:14,277`; the new per-`MediaManager` caches are not the caches used by those paths.

Effect preview is also shared by resolver identity (`effect-preview.ts:111-130`). `EditorCore.dispose()` calls `disposeEffectPreviewService` unconditionally (`core/index.ts:122-128`) without a lease count or WeakMap deletion. Two sessions sharing one resolver therefore share one service, and disposing either session clears the other session's callbacks/image/canvas state.

Impact: the explicit two-session cache identity, project replacement, service drain, final-owner lease, and “disposing one session preserves another” scenarios are false; checked tasks 7.5-7.10 are not truthful.

Fix brief: inject the per-session video/waveform instances into renderer resolution and waveform UI and remove active global exports. Make effect preview either per-session or a real reference-counted resolver lease that deletes/disposes only on final release. Add two-live-session tests that exercise equal media keys and shared resolver disposal in both orders.

### Blocker B4 — suspend does not quiesce transcription, and the defining browser lifecycle is absent (confidence 1.00)

The mounted caption component creates its own transcription service (`subtitles/components/assets-view.tsx:95-104`) and terminates it only on React unmount. C6 suspend deliberately retains the mounted root, while `EditorCore.suspend()` (`core/index.ts:111-115`) reaches only save, playback, and audio. It never terminates transcription or generation-checks the subsequent caption publication.

The browser cycle (`editor/session/c6-disposal-harness.tsx:203-337`) performs create, mount, direct acquisition, render, and dispose. It never calls `session.suspend()` or `session.resume()` and performs no post-resume same-session operation. This preserves the frozen first-return miss in tasks 10.2/10.5 and also contradicts checked task 2.8/5.3.

Impact: a pending Worker/result can continue while the session is suspended, and neither Host has executed the defining `create -> mount -> acquire -> suspend -> resume -> same-session operation -> dispose` acceptance path.

Fix brief: register transcription as a session lifecycle owner, terminate/listener-clean/reject pending work on suspend, create a new Worker only on post-resume demand, and generation-guard UI publication. Extend the shared browser cycle to assert retained id/project/root/store identity, zero suspended publications, same-session post-resume work, and cross-session non-interference on both Hosts.

### Blocker B5 — browser “platform” proof is counter-only for four classes and the runner does not enforce polarity (confidence 0.99)

`c6-disposal-harness.tsx:150-179` derives timer, Worker, audio, and object-URL platform terminal state from the same registry `created - released` counters. It does not observe timer callbacks, Worker liveness/listeners/messages, actual `AudioContext.state`, or URL fetch/revocation. Only GPU uses an independent runtime observer. `withAudioFallback` (`:48-72`) can substitute the in-memory audio port; the evaluator does not fail that fallback. The negative control leaks GPU, not the design-mandated minimum Worker platform terminator.

`script/run-c6-browser-oracle.mjs` only prints `result.clean`; it never asserts ordinary `clean === true`, controls `clean === false`, Host/store/marker identity, `audioFallback === false`, or console/page error emptiness. The independent run exited 0 while printing both intentionally non-clean controls, demonstrating that command success is not the acceptance gate.

Impact: a no-op Worker terminator, rejected audio close, still-fetchable URL, fallback audio implementation, or inverted control could pass the command. Tasks 10.6, 10.8, 11.3-11.8, and the exact-platform scenarios are not fully supported.

Fix brief: expose independent per-class Host probe ledgers and assert them in the evaluator; fault-inject the same Worker terminator used by the ordinary run; remove/fail production audio fallback; and make the runner return non-zero unless ordinary/control polarity, identities, all-five creation, zero residuals, and browser errors match the contract.

### Major M1 — failed final WASM lease release is permanently poisoned (confidence 0.95)

`wasm-runtime-providers.ts:54-112` decrements `lease.owners` and clears `sharedLease` only after `disposeGpu()` and both wrapper frees succeed. `prepareWasmRuntimeProviders().dispose()` sets its local `disposed = true` before awaiting release (`:129-133`). A live-handle refusal, GPU teardown error, or wrapper-free error therefore leaves a positive owner in `sharedLease`, may free one/both query wrappers, and cannot be retried by the same provider; a later acquire increments the stale lease without reinitializing.

The only new provider test (`session-runtime-ownership.test.tsx:831-868`) expects second dispose to be a no-op after wrapper failure; there are no tests using the added `disposeGpuCalls()` counter for two owners, concurrent final release, live-handle refusal/retry, or fresh generation.

Impact: an uncommon teardown failure can permanently strand process ownership and prevent a clean reinitializable generation, contrary to the explicit retryable/final-owner contract and checked task 8.10.

Fix brief: model lease release states explicitly, cache the in-flight/settled release promise, preserve a retry path while queries are usable (or reconstruct safe queries), and make ownership accounting reach a defined terminal/recoverable state for every error combination. Add two-owner/concurrent/failure/retry/reinitialize tests that assert the `disposeGpuCalls` counter.

### Minor m1 — generated-output hygiene is not clean (confidence 1.00)

`git status --porcelain=v1 --untracked-files=all` reports 1,872 paths: 21 tracked product modifications, 9 non-dist untracked paths, and 1,842 files across six `apps/vite-example/dist-c6-vite-20260804-{2..7}` directories, plus `.pw-output-c5-storage/.last-run.json`. These are disclosed in the implementer handoff but remain easy to stage accidentally.

Fix brief: after preserving the exact accepted evidence, remove only the explicitly enumerated generated outputs with guarded exact-path cleanup and re-audit status before ship. Do not delete product-source untracked files.

## Frozen task truthfulness audit

The numeric first return is preserved exactly at **98/137**, not rescored. The following checked claims are not supported by the current tree: 2.8; 4.1; 5.3; 6.1; 7.1, 7.3, 7.5-7.10; 8.10; 9.1-9.4 and 9.8; 10.6 and 10.8; 12.6, 12.9, and 12.14. The unchecked principal browser gap (10.2/10.5) remains correctly unchecked. Review/evaluation/delivery tasks 13-14 remain unchecked and were not advanced by this review.

## All 59 scenarios

`PASS` means independently reproduced or directly supported by a focused test plus inspected implementation. `FAIL` means the current tree/evidence contradicts the scenario. `UNVERIFIED` means no adequate independent execution exists; it is not treated as pass.

| # | Scenario (spec order) | Status | Independent disposition |
|---:|---|---|---|
| 1 | Concurrent disposal joins one teardown | PASS | Runtime-ownership test asserts promise identity. |
| 2 | Dispose wins over a queued resume | UNVERIFIED | Explicit task 2.5 remains unchecked; no race test found. |
| 3 | Repeated suspend and resume are idempotent | PASS | Isolated lifecycle suite covers repeated/no-op calls. |
| 4 | Host replacement cannot publish from a stale generation | UNVERIFIED | Existing Host cancellation tests do not cover all C6 transitions. |
| 5 | Suspend stops active publications | FAIL | Mounted transcription and omitted UI timers remain active. |
| 6 | Suspend retains non-activity identity | PASS | Lifecycle test retains id/project/root. |
| 7 | Resume restarts only the owner | FAIL | Shared caches/preview ownership can affect the other session. |
| 8 | Retained resources are not falsely reported released | UNVERIFIED | No suspend-retained URL/compositor execution found. |
| 9 | Complete editor graph has one mediator | FAIL | Scanner omits live editor roots and active globals. |
| 10 | Direct acquisition fails mechanically | FAIL | Direct acquisitions outside selected roots/exempt files pass. |
| 11 | Empty/truncated scanning cannot pass | FAIL | Only aggregate nonzero file count is guarded. |
| 12 | Operation-bounded offline rendering is classified | FAIL | Regex only checks exported/`this` contexts; no finally/escape proof. |
| 13 | Fired timeout self-releases | UNVERIFIED | Code path exists; no executed fired-timeout scenario found. |
| 14 | Suspend cancels activity timers | FAIL | Multiple editor/timeline timers bypass session ownership. |
| 15 | Disposal cancels timeout/interval/RAF | UNVERIFIED | No complete three-kind/no-publication test found. |
| 16 | Transcription Worker stops on suspend | FAIL | Component terminates only on unmount. |
| 17 | Resume creates fresh Worker generation | FAIL | Suspend never terminates the current service Worker. |
| 18 | Disposal observes platform Worker termination | FAIL | Browser “platform” value is registry count, with no listener/liveness probe. |
| 19 | Audio decode closes finite context | FAIL | `decodeAudioToFloat32` never closes its direct context. |
| 20 | Audio playback quiesces and resumes | UNVERIFIED | Manager stops demand-driven playback; no resume-generation/browser test. |
| 21 | Disposal waits for terminal closed state | PASS | Independent delayed-close unit passes. |
| 22 | Rejected close is not clean release | PASS | Independent rejection/exhaustive unit passes. |
| 23 | Loaded media retains URL owner | PASS | Production `MediaManager` passes session resources. |
| 24 | Replacement/removal revoke once | FAIL | Undo recreates a bare untracked URL. |
| 25 | Transient processing revokes every exit | FAIL | Direct transient URL constructors remain outside the session seam. |
| 26 | Disposal drains retained URLs | FAIL | Browser has no independent URL observer and omits real retained media flows. |
| 27 | Two sessions do not share live cache identity | FAIL | Active video/waveform singleton consumers remain. |
| 28 | Project replacement drains prior live state | FAIL | Global render/waveform/preview/transcription state is not owned by project manager. |
| 29 | Session disposal drains every service owner | FAIL | Global caches and mounted transcription escape `EditorCore.dispose`. |
| 30 | Shared resolver lease final-owner release | FAIL | Resolver cache has no refcount and first session disposes shared state. |
| 31 | Reverse acquisition terminal order | UNVERIFIED | Sequential code exists; test covers synchronous GPU order, not async terminal order. |
| 32 | One failure does not skip later cleanup | PASS | Independent rejected-audio unit verifies later Worker/URL cleanup. |
| 33 | Multiple failures are preserved | UNVERIFIED | Aggregate branch exists but no two-failure test was found. |
| 34 | Repeated disposal preserves first outcome | PASS | Independent stable failed outcome plus lifecycle idempotence pass. |
| 35 | No acquisition after disposal closes | PASS | Resource admission test and inspected synchronous close pass. |
| 36 | First of two GPU owners releases only its compositor | UNVERIFIED | No concrete two-provider final-owner test found. |
| 37 | Final owner tears down shared state | PASS | Existing real-compositor browser cycles show backend teardown/reinit behavior. |
| 38 | Live handles prevent false final release | PASS | Real GPU leak control refuses final runtime release. |
| 39 | Concurrent owner release calls one teardown | UNVERIFIED | No `disposeGpuCalls` concurrency assertion found. |
| 40 | Fresh generation initializes after teardown | PASS | Six sequential real browser generations complete. |
| 41 | Query wrappers outlive reconciliation | UNVERIFIED | Ordering is designed but failure/cancellation matrix is incomplete. |
| 42 | Every ordinary cycle creates all five | PASS | Existing final Vite artifact independently reproduced six cycles. |
| 43 | Every ordinary cycle has zero exact residuals | FAIL | Exact platform proof exists only for GPU; four classes reuse counters. |
| 44 | Residual growth assessed | PASS | Independent browser output emits all residual series. |
| 45 | Missing creation fails before release proof | PASS | Missing-Worker control independently reproduced non-clean. |
| 46 | Deliberate leakage caught by same evaluator | PASS | Real GPU no-op release is named non-clean. |
| 47 | Fresh Vite evidence attributable | PASS | Marker/store/backend/control output independently reproduced on owned port 4236. |
| 48 | Fresh Next evidence attributable | UNVERIFIED | Artifact exists; reviewer did not rerun current-source Next (type gate already red). |
| 49 | Host fallback cannot pass | FAIL | In-memory audio fallback is allowed and not evaluator-fatal. |
| 50 | Process metrics cannot override exact leakage | PASS | GPU exact residual overrides otherwise clean counts. |
| 51 | Disposing one session preserves another | FAIL | Active global caches and resolver disposal violate the scenario. |
| 52 | Durable data survives all disposal | UNVERIFIED | C5 unit paths pass; no independent full disposal/reopen browser flow. |
| 53 | Forced-none remains allocation-free | PASS | Protected C4 path is unchanged and its focused coverage remains green. |
| 54 | Backend capacity unchanged | UNVERIFIED | WebGL evidence exists; WebGPU browser job remains inherited-red before capacity proof. |
| 55 | Protected artifacts remain identical | PASS | Exact tree/blob/hash audit reproduced. |
| 56 | Existing regression identity does not grow | FAIL | Exact type gate has five new C6 identities. |
| 57 | Capability corpus swept both ways | FAIL | The table maps logs but many added scenarios above were never executed. |
| 58 | C7 and E1 remain out of scope | PASS | Full path/diff inspection found no C7/E1/D2/Rust/generated-WASM product change. |
| 59 | Review/delivery stages remain independent | UNVERIFIED | Review is independent, but blockers remain and no delivery may advance. |

Scenario totals: **21 PASS / 23 FAIL / 15 UNVERIFIED = 59**.

## Independent command record

| Command | Result |
|---|---|
| `git show -s --format=%H` / `%T` | exact base HEAD/tree `d6ed4166...` / `38750743...`. |
| `git diff --name-status d6ed4166 --` plus `git ls-files --others --exclude-standard` | 21 tracked modified files; 9 non-dist untracked; 1,842 dist files; 1,872 status paths total. |
| Focused Bun: C6 resource drain, disposal oracle, transcription service, boundary tests | exit 0; 10 pass / 0 fail / 43 expectations. |
| `node script/check-session-resource-boundary.mjs` and `--negative-control` | exit 0; reported 102 modules and all rules PASS; independently shown incomplete by whole-tree search. |
| `node script/check-port-boundary.mjs` and `--negative-control` | exit 0; 34 contract modules; all controls PASS. |
| `node script/check-type-baseline.mjs` | **exit 1**; 18 diagnostics, five new identities (RendererManager/consumers). |
| Targeted ESLint | exit 0; 0 errors / 4 warnings (Vite file ignored plus three inherited warnings). |
| Targeted Prettier | exit 0; all matched files formatted. |
| `git diff --check d6ed4166 --` | exit 0; line-ending notices only. |
| Existing `dist-c6-vite-20260804-7` preview + `node script/run-c6-browser-oracle.mjs` on owned `127.0.0.1:4236` | exit 0; ordinary clean six cycles; missing-worker and real-GPU leak non-clean; no suspend/resume; port verified free after exact owned child PID termination. |
| `bun test` | exit 1; 334 pass / 11 fail / 4 errors / 1,084 expectations across 345 tests / 67 files. Six placement + two loader identities are inherited; media-capacity crash and two isolated-process timeouts were extra in this parallel run. |
| Three extra full-suite identities rerun separately | exit 0; processing capacity 1/1, media persistence rewire 1/1, production composition 1/1. They are parallel/resource flakes, not accepted new baseline and not the deterministic type regression. |
| `rasen validate s02-session-disposal --project rocut --strict` | exit 0; change structure valid. |
| Protected identity audit | ports tree `efe499db...`; session types `c67d9822...`; type fixture `1aa6e2d...`; parity tree `e1fbb55b...`; Rust WASM/GPU/compositor trees exact; generated SHA-256 exact; protected diff exit 0. |

## Scope and cleanliness

Scope Check: **REQUIREMENTS MISSING**. The diff is C6-scoped, with no C7/E1/D2/Rust/generated-WASM/public-port expansion, but required lifecycle, complete mediation, deterministic owner, exact platform-oracle, and current type acceptance are missing.

Tree status: **NOT CLEAN** in both review and worktree senses. No Blocker/Major is accepted for delivery; no fix, commit, ship, integration, spec sync, archive, or task completion was performed by this reviewer.
