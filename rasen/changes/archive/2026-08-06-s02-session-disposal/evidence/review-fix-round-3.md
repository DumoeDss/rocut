# C6 fix-round 3 independent delta review

Date: 2026-08-04 +08:00  
Reviewer: fresh non-author Sol reviewer (`/root/c6_sol_fix3_review`)  
Reviewed product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c6`  
Baseline: HEAD `d6ed4166b5ffb13257d1924851f2fa57d73d349f`, tree `3875074383b41f622e5f32942091468cf8959b61`  
Review mode: report only; no product, task, author-evidence, run-state, commit, ship, integration, spec-sync, archive, or cleanup mutation

## Verdict

**NOT CLEAN — 3 Blocker / 2 Major / 2 Minor / 0 Trivial.**

Fix round 3 materially improves the implementation. The canonical project replacement path now drains old media/cache/audio ownership; finite decode closes in `finally`; transcription generations, timer/RAF cancellation, multiple cleanup failures, final preview ownership, runtime lease retry, protected identities, type gates, builds, parity, WASM, asset delivery, and the stable full-suite inherited-red identity all pass fresh review.

It still cannot advance to local ship. Fresh, uniquely marked Vite and Next ordinary browser runs both fail all six cycles because `postResumeActivity=false`. The five exact residual series are all zero, but zero residuals do not prove the required same-session resume activity. The resource boundary checker also accepts eight executable alias/computed/mediator counterexamples and self-approves its closure fixture. Finally, renderer suspension/disposal requests cancellation without awaiting an active exporter to settle. These are independent Blockers.

## Findings

### Blocker B1 — both production Hosts fail the ordinary resume lifecycle oracle (confidence 1.00)

Fresh production-shaped runs were made from unique outputs and markers:

- Vite output `apps/vite-example/dist-c6-review-fix3-sol-20260804-1`, marker `c6-review-fix3-sol-vite-20260804-1`, owned preview PID `22948`, port `4338`.
- Next output `apps/web/.next-c6-review-fix3-sol-20260804-1`, marker `c6-review-fix3-sol-next-20260804-1`, owned standalone PID `66268`, port `4340`.

Both ordinary controls execute six cycles with `BrowserProjectStore`, real WebGPU, `audioFallback=false`, stable marker/session/project/root identity, every class CREATED, and all five residual series exactly `[0,0,0,0,0,0]`. Nevertheless, every cycle on both Hosts reports `platformProof.suspendedDwell.postResumeActivity=false`; each ordinary report is `clean=false`, and the shared runner exits 1 with six “did not publish activity after the same-session resume” failures.

The missing-CREATED control remains non-clean and the deliberate-leak control catches Worker and GPU residuals. Those polarities do not repair the failed positive control. `postResumeOperation=true` only shows an operation was invoked; it does not replace the required activity observation.

Both owned servers were stopped by exact PID. Ports `4338` and `4340` are free. The earlier timed-out attempts were also stopped by exact verified PID (`40932` on `4337`); all reviewer ports `4173`, `4175`, `4337`, `4338`, and `4340`–`4346` are free at handoff.

Impact: scenario 7 and both Host acceptance scenarios 47–48 fail. Checked tasks 2.8–2.9 and 12.2 are not established by the current evidence. The ordinary positive oracle required by the change is red on both independent production Hosts.

Fix brief: make a retained real owner publish observable post-resume activity only after manager readiness, and keep that observation distinct from the harness's synthetic `postResumeOperation`. Rerun the same three controls for six cycles against new unique Vite and Next artifacts; the ordinary control must be clean without weakening the evaluator.

### Blocker B2 — the resource boundary is green on its own fixtures but accepts executable ownership escapes (confidence 1.00)

The formal source, Vite-emitted, Next-emitted, and supplied negative controls all exit 0. Fresh emitted inventories are non-empty and attributable: Vite reports 2,889 modules / 590 web source IDs; Next reports 82 attributable files / 78 maps / 2,557 module IDs / 596 source IDs. That is useful inventory evidence, but it is not semantic completeness.

An independent in-memory invocation of the checker's actual `scan()` returned `hits=[]` for all eight executable counterexamples:

1. `const schedule = globalThis.setTimeout; schedule(() => {}, 1)`
2. `globalThis["setTimeout"](() => {}, 1)`
3. `const WorkerCtor = Worker; new WorkerCtor(url)`
4. an aliased `AudioContext` constructor
5. `const { createObjectURL } = URL; createObjectURL(blob)`
6. a destructured/aliased `OfflineAudioContext` used inside an otherwise bounded async operation
7. an arbitrarily named single-resource wrapper over `resources.setTimeout(...)`
8. a destructured multi-resource mediator wrapping Worker plus audio acquisition

The direct rules are line regexes at `script/check-session-resource-boundary.mjs:59-73`. Structural acquisition recognition requires a property-access call at `:752-760`, and an arbitrary wrapper is reported only when `kinds.size >= 2` at `:840-880`; a single-resource second mediator therefore passes by design. The closure fixture is protected by a digest and hard-coded count at `:28-36` and `:295-326`, but the checker and fixture can be changed together. Provenance checks only that artifact/hash strings are present; they do not hash the referenced Vite/Next artifacts. The frozen fixture therefore approves itself rather than being anchored outside the mutable gate.

Impact: scenarios 9, 10, and 12 fail. Checked tasks 9.2–9.6 and the completeness claim in 12.9 are materially overstated. A direct live resource acquisition or second mediator can enter production while the authoritative gate remains green.

Fix brief: move the rules to AST/value-flow semantics that follow constructor/function aliases, computed properties, destructuring, and wrapper calls. Treat any new acquisition-capable wrapper as a second mediator, including one resource class. Add each counterexample above as a non-zero negative test. Anchor expected closure/provenance outside the checker+fixture co-change boundary and verify the referenced artifact digests, not just string presence.

### Blocker B3 — renderer lifecycle returns before an active exporter reaches terminal quiescence (confidence 0.99)

`RendererManager.drainProjectLiveState()` and `suspend()` are synchronous and only call `invalidatePublications()` (`apps/web/src/core/managers/renderer-manager.ts:126-135`). `invalidatePublications()` increments a publication generation and calls `exporter.cancel()` for each active exporter without awaiting exporter completion (`:432-435`). `dispose()` has the same synchronous pattern (`:387-390`).

The green test at `apps/web/src/editor/session/__tests__/session-state-isolation.test.ts:1021-1045` demonstrates the gap: it holds the next real canvas capture, starts export, awaits `session.suspend()`, and only then releases the held capture and awaits the still-pending exporter. The publication guard correctly prevents stale progress/success, but suspension has already returned while the renderer/capture owner is still in flight.

Impact: scenario 5 and the exhaustive service-owner portion of scenario 29 fail. This violates quiescence even if the stale result is later rejected. It can retain renderer, capture, encoder, audio preparation, or cache work past suspend/dispose completion.

Fix brief: give each active exporter one awaitable terminal promise, make cancel idempotent, and make renderer suspend/project-drain/dispose join all active exporters using all-settled attribution. Add a test that keeps capture held and proves the lifecycle promise remains pending until exporter settlement; then cover cancellation rejection without skipping later owners.

### Major M1 — `AudioManager.getAudioSink()` leaks a newly created media `Input` when track discovery rejects (confidence 1.00)

`apps/web/src/core/managers/audio-manager.ts:729-746` creates a Mediabunny `Input`, then awaits `input.getPrimaryAudioTrack()`. The no-track branch disposes it, and successful inputs enter `this.inputs`, but the catch branch returns `null` without disposing the local input. Because the input was never inserted into `this.inputs`, `disposeSinks()` and final session disposal cannot find it.

An independent runtime probe through the actual `AudioManager.getAudioSink` path forced `getPrimaryAudioTrack()` to reject. It observed one `Input` created, `disposeCalls=0` on return, and still `disposeCalls=0` after `await session.dispose()`.

Impact: scenario 29's “every service owner” claim fails on a normal rejected media path; checked task 7.9 is incomplete. A media input can keep file/parser resources outside session accounting indefinitely.

Fix brief: declare the local input before `try` and dispose it in `catch`/`finally` unless ownership has atomically transferred into `this.inputs`. Add reject-before-track, null-track, sink-constructor failure, success, project-drain, and session-dispose tests with exact one-dispose assertions.

### Major M2 — the session-state ownership gate has 12 current-tree violations (confidence 1.00)

`node script/check-session-state-boundary.mjs` exits 1 while its `--negative-control` exits 0. Current violations are:

- render-time imperative editor calls at `apps/web/src/preview/components/index.tsx:168` and `apps/web/src/timeline/components/timeline-element.tsx:1034`;
- unclassified imperative consumers in export button, sounds assets/search, timeline element, edge auto-scroll, and scroll-position modules;
- stale classifications for export button, sounds assets, and timeline element;
- `snapshot-does-not-reuse-renderer-manager-factory`.

These are modified C6 ownership paths, not a vacuous or broken negative control. The gate is the repository's mechanical protection against reintroducing render-time/static editor state while migrating lifecycle callbacks.

Impact: the C3/session-state invariant and checked static-gate/evidence claims in tasks 12.4, 12.9, and 12.14 are not clean for the reviewed tree.

Fix brief: remove render-time imperative manager reads, classify only legitimate event/effect consumers with exact current counts, and restore the snapshot factory invariant. Rerun ordinary plus negative control.

### Minor m1 — the port boundary gate is red because a new C6 test imports an editor internal (confidence 1.00)

`node script/check-port-boundary.mjs` exits 1 after scanning 35 contract modules. It reports `no-editor-internal-import` at `apps/web/src/editor/session/__tests__/session-disposal-c6.test.ts:7`, which imports `waitForNextPaint` from `@/media/upload-toast`. The proper `--negative-control` exits 0 and proves every rule can fail.

The violation is test-only, so runtime severity is Minor, but a required architecture gate cannot be reported green. Move the test helper behind an allowed fixture/test seam or test the public behavior without pulling an editor internal into the contract graph.

### Minor m2 — changed-tree formatting/lint and worktree hygiene remain red (confidence 1.00)

An exact changed/untracked source-like list checks 79 files with Prettier and 77 with ESLint. Prettier exits 1 on 19 files. ESLint exits 1 with 33 errors / 4 warnings, including unsafe assertions, object-parameter violations, render/effect state errors, and unused values. `git diff --check` exits 0.

The worktree has 64 tracked content-diff files, 67 tracked status entries, 83 untracked status roots, and 6,692 untracked files, predominantly accumulated build outputs/logs. This reviewer intentionally did not clean them. Two files (`apps/web/tsconfig.json` and the protected in-memory port implementation) are status-dirty but have no content diff; the fresh Next build's automatic `tsconfig` rewrite was restored exactly.

Fix brief: format and lint the exact final source list; attribute any inherited diagnostics rather than narrowing the list. After evidence retention is agreed, remove only enumerated generated outputs/logs under a separate authorized cleanup step.

## Non-finding observations

- The earlier project-replacement AudioManager suspicion is closed. An actual `ProjectManager`/media drain probe showed inputs/sinks `1/1 -> 0/0`, old input disposed once, and a fresh same-key sink after replacement. `media.clearAllAssets()` notifies AudioManager and disposes sinks.
- A fresh `node script/generate-sbom.mjs` would add `workers` to `SBOM.md`'s “Present directories” line and changes its SHA-256 from `1a55a158...` to `d29e6b...`. The reviewer restored the tracked file exactly. This appears to be pre-existing baseline drift rather than a C6-authored directory, so it is recorded but not severity-counted.
- Fresh C3 WebGPU fails twice waiting for `data-migrating=true` after the capacity/two-session/handle/frame/project assertions have already passed. The recorded base attribution reproduces the same failure at exact HEAD. C3 WebGL passes. This is an inherited browser-test red, not a C6 finding.
- The first complete Bun run had a child-Bun segmentation fault in the media capacity test. The isolated file immediately passed, and a second complete run reproduced exactly the accepted inherited eight placement failures plus two loader errors. It is not counted as a C6 regression.

## Task truthfulness audit

The task file remains **108 checked / 29 unchecked / 137 total**.

Unchecked IDs are exactly: `1.1, 1.4, 1.5, 1.6, 1.11, 1.12, 1.13, 1.14, 4.8, 6.6, 6.8, 7.12, 9.7, 11.10, 12.13, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8`.

At minimum, the current evidence contradicts or materially under-proves checked tasks **2.8–2.9; 3.3; 7.9; 9.2–9.6; 12.2; 12.4; 12.8–12.9; and 12.14**. The three explicitly incomplete behavioral matrices remain honestly unchecked at **4.8, 6.8, and 7.12**. Review/evaluation/delivery tasks 13–14 also remain correctly unchecked. This report does not mutate tasks.

## All 59 scenarios

`PASS` means the scenario is directly supported by fresh execution or by an attributable protected control plus implementation inspection. `FAIL` means current code/evidence contradicts it. `UNVERIFIED` is not treated as pass.

| # | Scenario (spec order) | Status | Independent disposition |
| ---: | --- | --- | --- |
| 1 | Concurrent disposal joins one teardown | PASS | Focused ownership/lifecycle matrix passes. |
| 2 | Dispose wins over a queued resume | PASS | Explicit queued-resume race passes. |
| 3 | Repeated suspend and resume are idempotent | PASS | Repeated/no-op lifecycle test passes. |
| 4 | Host replacement cannot publish from a stale generation | PASS | Host churn/generation controls pass. |
| 5 | Suspend stops active publications | FAIL | Active exporter remains in flight after suspend returns (B3). |
| 6 | Suspend retains non-activity identity | PASS | Focused test and both Hosts retain session/project/root identity. |
| 7 | Resume restarts only the owner | FAIL | Both Hosts report `postResumeActivity=false` in all six cycles (B1). |
| 8 | Retained resources are not falsely reported released | PASS | Suspended dwell retains identity/resources; terminal release is recorded later. |
| 9 | The complete editor graph has one acquisition mediator | FAIL | Arbitrary single- and multi-resource wrappers evade `scan()` (B2). |
| 10 | Direct acquisition fails mechanically | FAIL | Aliased/computed timer, Worker, audio, and URL acquisition all return no hits (B2). |
| 11 | Empty or truncated scanning cannot pass | PASS | Missing/padded-root controls fail; fixture independence remains a B2 provenance weakness. |
| 12 | Operation-bounded offline rendering is classified | FAIL | Destructured/aliased offline construction evades the semantic rule (B2). |
| 13 | A fired timeout self-releases | PASS | Focused timer accounting passes. |
| 14 | Suspend cancels activity timers | PASS | New interval/RAF/nested-paint controls pass. |
| 15 | Disposal cancels every remaining timer kind | PASS | Timer/interval/RAF terminal drain passes. |
| 16 | Transcription Worker stops on suspend | PASS | Pending generation termination/listener cleanup passes. |
| 17 | Resume creates a fresh Worker generation | PASS | Fresh generation and stale-event controls pass. |
| 18 | Disposal observes platform termination | PASS | Both Hosts create/message/terminate a real local Worker. |
| 19 | Audio decode closes its finite context | PASS | Success/reject/cancel/dual-failure matrix passes. |
| 20 | Audio playback quiesces and resumes | UNVERIFIED | Task 6.8 remains unchecked; no complete real scheduling/node transition matrix was produced. |
| 21 | Disposal waits for terminal closed state | PASS | Delayed close remains pending until terminal close. |
| 22 | Rejected close is not clean release | PASS | Rejection attribution and later cleanup pass. |
| 23 | Loaded media retains its URL owner | PASS | Persistence/ownership tests pass. |
| 24 | Replacement and removal revoke once | PASS | Undo/redo/replacement regression matrix passes. |
| 25 | Transient processing revokes on every exit | UNVERIFIED | Task 7.12's complete image/video/SVG/export/download success/fail/cancel matrix remains unchecked. |
| 26 | Disposal drains retained URLs | PASS | Both Hosts prove created-before-release and fetch failure after revoke. |
| 27 | Two sessions do not share live cache identity | PASS | Equal-key video/waveform/input generations are distinct. |
| 28 | Project replacement drains prior live state | PASS | Canonical replacement integration and direct AudioManager drain probe pass. |
| 29 | Session disposal drains every service owner | FAIL | Rejected audio track discovery orphans a local Input; exporter settlement is not joined. |
| 30 | Shared resolver lease releases only on the final owner | PASS | Final-owner recreation test passes. |
| 31 | Reverse acquisition order is terminal order | PASS | Registry drain records awaited reverse order. |
| 32 | One failure does not skip later cleanup | PASS | Later resources/owners are attempted. |
| 33 | Multiple failures are preserved | PASS | New two-failure reverse-order aggregate test passes. |
| 34 | Repeated disposal preserves the first outcome | PASS | Fulfilled/rejected outcome is stable. |
| 35 | No acquisition occurs after disposal admission closes | PASS | Synchronous admission rejection passes. |
| 36 | First of two owners releases only its compositor | PASS | Two-owner runtime matrix passes. |
| 37 | Final owner tears down shared state | PASS | Final-owner exact handle/runtime teardown passes. |
| 38 | Live handles prevent a false final release | PASS | Real leak remains named/non-clean. |
| 39 | Concurrent owner release calls one teardown | PASS | Serialized final release calls shared teardown once. |
| 40 | A fresh generation can initialize after final teardown | PASS | Fresh runtime generation control passes. |
| 41 | Runtime query wrappers outlive session reconciliation | PASS | Host/runtime failure-retry ordering passes. |
| 42 | Every ordinary cycle creates all five classes | PASS | Both Hosts create all five classes in all six cycles. |
| 43 | Every ordinary cycle has zero exact residuals | PASS | All five exact series are zero; this narrow pass does not override B1. |
| 44 | Residual growth is assessed across cycles | PASS | Series are emitted; deliberate Worker/GPU growth is caught. |
| 45 | Missing creation fails before release proof | PASS | Missing Worker remains non-clean. |
| 46 | Deliberate leakage is caught by the same evaluator | PASS | Same evaluator catches Worker and GPU residuals. |
| 47 | Fresh Vite evidence is attributable | FAIL | Attribution is strong, but the required ordinary positive run exits 1. |
| 48 | Fresh Next evidence is attributable | FAIL | Attribution is strong, but the required ordinary positive run exits 1. |
| 49 | Host fallback cannot pass | PASS | Browser store/runtime roles are real and enforced. |
| 50 | Supplemental process metrics cannot override exact leakage | PASS | Exact leak keeps negative control non-clean. |
| 51 | Disposing one session preserves another session | PASS | Cross-session manager/cache/runtime controls pass. |
| 52 | Durable data survives all session disposal | UNVERIFIED | Protected C5 evidence remains green, but no fresh C6 write/dispose-all/reopen browser execution was produced. |
| 53 | Forced-none remains allocation-free | PASS | Fresh C4 forced-none browser control passes. |
| 54 | Backend capacity behavior remains unchanged | PASS | Fresh WebGL capacity passes; WebGPU reaches/passes capacity assertions before inherited migration wait failure. |
| 55 | Protected artifacts remain identical | PASS | Exact protected diff/trees/blobs/generated hashes match base. |
| 56 | Existing regression identity does not grow | PASS | Type gate is exact; second full Bun run is exactly 360 pass / inherited 8 fail / 2 errors. |
| 57 | The complete capability corpus is swept both ways | FAIL | Nine scenarios fail and three remain unverified; the mapping cannot be accepted as complete green evidence. |
| 58 | C7 and E1 remain out of scope | PASS | No forbidden headless/Elftia/private-port/Rust/generated-WASM/durable-delete expansion. |
| 59 | Review and delivery stages remain independent | PASS | This reviewer wrote only the two requested planning reports; delivery remains untouched. |

Scenario totals: **47 PASS / 9 FAIL / 3 UNVERIFIED = 59**.

## Independent command and evidence record

| Gate | Fresh result |
| --- | --- |
| HEAD/tree | Exact `d6ed4166...` / `38750743...`. |
| Focused boundary tests | 7 pass / 0 fail / 60 expectations. |
| Focused product matrix | 37 pass / 0 fail / 134 expectations across 15 lifecycle/persistence/cache/audio/renderer/transcription files. |
| Full Bun, first sample | 359 pass / 9 fail / 2 errors; extra media-capacity child-Bun segmentation fault; isolated file immediately 1 pass. |
| Full Bun, confirmation | 360 pass / 8 fail / 2 errors / 1,222 expectations / 368 tests / 71 files; exactly six placement plus two loader identities. |
| Type gates | Baseline exit 0 with exactly 3 pinned diagnostics; Vite typecheck exit 0. |
| Fresh Vite build | Exit 0; Vite 7.3.6, 2,889 modules, 40.27 s, unique output/marker above. |
| Fresh Next build | Exit 0; Next 16.1.3, compile 19.0 s, `/c6-disposal` present, unique output/marker above. |
| Fresh Vite browser | **Exit 1**; ordinary non-clean solely plus six missing post-resume-activity failures; other control polarity correct; PID/port clean. |
| Fresh Next browser | **Exit 1** with the same ordinary failure and correct negative polarity; PID/port clean. |
| Source/emitted resource boundary | Exit 0; 711 source / 263 frozen closure; fresh Vite/Next inventories complete under the implemented rule. B2 counterexamples still pass. |
| Runtime asset gates | Source, distributable, emitted Vite/Next, manifest negative, and live Vite manifest all exit 0; 298 copied / 4,481,207 bytes and 7 emitted / 30,236,721 bytes. |
| Host composition/storage/singleton/Next/reference | Exit 0; 2 Hosts / 723 production modules; storage 726; singleton 723 runtime / 39 commands; Next 788 / 25 allowlisted. |
| Port boundary | **Exit 1** with one C6-test internal import; negative control exit 0. |
| Session-state boundary | **Exit 1** with 12 violations; negative control exit 0. |
| C3/C4 | C3 WebGL 1/1; C3 WebGPU inherited migration wait red twice after capacity assertions; C4 forced-none 1/1. |
| Protected parity | Vite 1/1, Next 1/1; diff 0 semantic / 9 incidental / 195 leaves. |
| WASM | `check:wasm`, source/path/API, runtime API, and reference/license gates exit 0; 38 JS / 58 binary exports / 609 imports. |
| Protected identities | Port tree `efe499...`; session type `c67d982...`; parity tree `e1fbb55...`; type tree `1aa6e2...`; Rust trees exact; JS SHA-256 `19714428...`; wasm SHA-256 `15622cf...`. |
| Prettier | **Exit 1**; 19 of 79 exact source-like files need formatting. |
| ESLint | **Exit 1**; 33 errors / 4 warnings across 77 exact source-like files. |
| `git diff --check` | Exit 0. |
| Strict Rasen validation | Exit 0; one valid change, zero issues. |

## Scope and cleanliness

Scope Check: **VIOLATION / REQUIREMENTS MISSING**. The product write set contains no C7 headless implementation, E1 Elftia/packaging work, D2 React decision, new private port, Rust/API/generated-WASM edit, main-spec sync, or durable-data deletion. Protected identities are exact. The scope violation is failure to satisfy the in-scope lifecycle, boundary, terminal-drain, and required static-gate contracts above.

Tree status: **NOT CLEAN** in both acceptance and worktree senses. No product fix, task mutation, author evidence mutation, commit, ship, integration, spec sync, archive, or cleanup was performed by this reviewer.
