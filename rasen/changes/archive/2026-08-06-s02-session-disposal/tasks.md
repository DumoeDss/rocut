## 1. Freeze the C5-inclusive base and capture RED evidence

- [x] 1.1 Verify the implementation worktree is clean at HEAD `d6ed4166b5ffb13257d1924851f2fa57d73d349f` and tree `3875074383b41f622e5f32942091468cf8959b61`; stop rather than rebasing the plan onto a different identity.
- [x] 1.2 Record that C5 product commit `0bfcf0457385b55de815c75ec712e9b9d69da242` is reachable and that the C5 final storage/Host topology is present.
- [x] 1.3 Record the protected port tree, public session-type blob, parity fixture blob, type fixture blob, three Rust tree identities, and generated JS/WASM SHA-256 values from the design before editing.

1.4 **Historical deviation (non-checkbox; permanently unmet):** The original requirement — "Run a complete `git diff --name-status` and attribute every pre-existing path; treat any unexplained protected-path change as a stop condition." — was not durably executed/preserved before implementation and cannot be completed retroactively. The accepted final 98-path attribution in `evidence/c6-integration-a9dbae62-20260805.md` bounds the resulting risk only; it is not reconstructed pre-edit prerequisite completion.

1.5 **Historical deviation (non-checkbox; permanently unmet):** The original requirement — "Check Bun, Node, browser, build tool, Rust/WASM tool, free-port, process-ownership, and disk-space prerequisites used by the inherited gates and new browser harnesses." — was not durably executed/preserved before implementation and cannot be completed retroactively. The later accepted environment and toolchain gates summarized in `evidence/c6-fix4-prerequisite-red-audit-20260804.md` and `evidence/c6-integration-a9dbae62-20260805.md` bound the resulting risk only; they are not reconstructed pre-edit prerequisite completion.

1.6 **Historical deviation (non-checkbox; permanently unmet):** The original requirement — "Perform the required fresh-worktree dependency/bootstrap and build-before-type sequence without using stale output as evidence." — was not durably executed/preserved before implementation and cannot be completed retroactively. The initial build-before-type attempt recorded in `evidence/phase1-baseline.md` and `evidence/phase1-build-before-type.log` exited 1, while the later fresh marked Vite/Next builds and type gate in `evidence/c6-integration-a9dbae62-20260805.md` bound the resulting risk only; neither result reconstructs the missing pre-edit dependency/bootstrap prerequisite.

- [x] 1.7 Reproduce and preserve the C5 full-suite baseline of 330 pass, 8 fail, 2 loader errors, and 1,058 expectations across 338 tests in 64 files, or stop on any new red identity.
- [x] 1.8 Reproduce the exact three inherited type-diagnostic identities and save machine-readable output before implementation.
- [x] 1.9 Inventory every live timer/RAF, Worker, `AudioContext`, `OfflineAudioContext`, object URL, compositor, cache, service, and weak owner index reachable from Vite and Next editor roots.
- [x] 1.10 Classify each inventory entry as session-mediated, exact Host/test/shell exemption, operation-bounded offline rendering, or violation; reject unknown and prefix-only exemptions.

1.11 **Historical deviation (non-checkbox; permanently unmet):** The original requirement — "Add failing lifecycle tests for concurrent dispose, dispose-versus-resume, repeated transitions, and stale Host-generation publication." — was not durably executed/preserved before implementation and cannot be completed retroactively. The later accepted lifecycle matrices in `evidence/review-scenario52-tail.md` and `evidence/c6-integration-a9dbae62-20260805.md` bound the resulting risk only; they are not reconstructed initial RED completion.

1.12 **Historical deviation (non-checkbox; permanently unmet):** The original requirement — "Add failing resource tests proving delayed/rejected asynchronous release, reverse terminal order, exhaustive cleanup, aggregate failure preservation, and stable repeated disposal outcome." — was not durably executed/preserved before implementation and cannot be completed retroactively. The later accepted resource matrices in `evidence/review-scenario52-tail.md` and `evidence/c6-integration-a9dbae62-20260805.md` bound the resulting risk only; they are not reconstructed initial RED completion.

1.13 **Historical deviation (non-checkbox; permanently unmet):** The original requirement — "Add failing tests that require all five classes to have `created > 0` before release assertions and that make one deliberate platform leak fail the ordinary evaluator." — was not durably executed/preserved before implementation and cannot be completed retroactively. The later accepted all-five-created, missing-created, and deliberate-leak controls in `evidence/c6-integration-a9dbae62-20260805.md` bound the resulting risk only; they are not reconstructed initial RED completion.

1.14 **Historical deviation (non-checkbox; permanently unmet):** The original requirement — "Save RED commands, exit codes, and failure excerpts attributable to the intended missing behavior rather than unrelated inherited failures." — was not durably executed/preserved before implementation and cannot be completed retroactively. As established by `evidence/c6-fix4-prerequisite-red-audit-20260804.md`, later accepted GREEN, negative-control, review, and integration evidence bounds risk only and is not, and will not be, relabeled as reconstructed RED evidence.

## 2. Implement the private serialized session lifecycle

- [x] 2.1 Add one private lifecycle coordinator behind `createEditorSession` without widening `EditorSession`, `EditorHost`, port roles, or `DisposalReport`.
- [x] 2.2 Publish transition/admission state synchronously before the first asynchronous yield and serialize suspend, resume, and dispose through one transition tail.
- [x] 2.3 Make repeated suspend and non-suspended resume idempotent without duplicating resources, subscriptions, or publications.
- [x] 2.4 Make disposal permanent and return the same promise/outcome to concurrent and repeated callers.
- [x] 2.5 Ensure a queued or concurrent resume cannot reopen admission once disposal starts.
- [x] 2.6 Reject stale asynchronous acquisition and publication with an actionable disposed-generation error before platform allocation.
- [x] 2.7 Preserve Host replacement ordering: detach generation ownership before invoking session/runtime cleanup and observe both failure paths.
- [x] 2.8 Extend the private `EditorCore` lifecycle so suspend quiesces save, playback, audio, renderer publication, and transcription activity while retaining session/project/root/persistence identity.
- [x] 2.9 Resume only the same live session, reopen admission after managers are ready, and lazily reacquire only required activity resources.
- [x] 2.10 Add focused GREEN tests for all lifecycle races, identity retention, no stale publication, and cross-session isolation.

## 3. Make session resource drain asynchronous and truthful

- [x] 3.1 Change the private session-resource implementation to accept synchronous or promise-returning terminal releases while preserving its public acquisition/inspection shape.
- [x] 3.2 Close acquisition admission before drain begins and reject every later tracked acquisition.
- [x] 3.3 Await terminal release in reverse acquisition order and record the observed terminal order in tests.
- [x] 3.4 Increment `released` only after successful terminal completion or an already-terminal idempotent observation; never increment when cleanup is merely invoked.
- [x] 3.5 Await `AudioContext.close()` and preserve `created > released` when close rejects.
- [x] 3.6 Attempt all later resource, service, root, wrapper, and runtime cleanup after one release throws or rejects.
- [x] 3.7 Attribute each cleanup error with class/id and preserve all causes in one stable error or `AggregateError`.
- [x] 3.8 Reconcile tracked, leaked, and untracked GPU handles while the live query wrapper is still usable.
- [x] 3.9 Ensure repeated drain/dispose never retries or double-releases resources after either fulfillment or rejection.
- [x] 3.10 Add GREEN tests covering one-shot timers, explicit early release, delayed audio close, rejection, aggregate error order, GPU reconciliation, and disposed admission.

## 4. Mediate timers, subscriptions, and asynchronous publication

- [x] 4.1 Inventory and migrate editor-runtime `setTimeout`, `setInterval`, `requestAnimationFrame`, and matching cancellation call sites to tracked session timer handles.
- [x] 4.2 Make fired one-shot timer handles self-release exactly once.
- [x] 4.3 Cancel save-manager debounce/retry timers on suspend and disposal before callbacks can publish.
- [x] 4.4 Cancel playback clocks, renderer polling/frames, and audio scheduling timers on suspend and disposal.
- [x] 4.5 Migrate session-reachable UI hooks, preview, timeline, sounds, upload-toast, and media-processing timers or classify exact shell-only exclusions.
- [x] 4.6 Tie every event/subscription callback to the owning lifecycle generation and remove subscriptions before weak owner indexes.
- [x] 4.7 Recreate only necessary activity timers after resume and prove the terminated generation cannot fire.
- [x] 4.8 Add unit/fake-clock tests for timeout, interval, RAF, cancellation races, fired-before-dispose, and no post-quiescence publication.

## 5. Complete Worker and transcription ownership

- [x] 5.1 Preserve the C4 rule that production Workers are constructed by the Host adapter through the requesting session resource seam.
- [x] 5.2 Make transcription initialization and request state explicitly session/generation owned.
- [x] 5.3 On suspend or dispose, terminate the Worker, remove every listener, and settle each pending promise exactly once with a lifecycle reason.
- [x] 5.4 Prevent messages from a terminated Worker generation from settling a resumed generation's requests.
- [x] 5.5 Resume by constructing a fresh tracked Worker only on the next transcription demand.
- [x] 5.6 Add a tiny local module-Worker fixture/probe that exchanges a message and exposes terminal platform-live/listener observations without network/model dependence.
- [x] 5.7 Add GREEN tests for pending initialization, pending transcription, duplicate terminal events, resume generation, Host replacement, and platform termination.

## 6. Complete live audio and bounded offline-audio ownership

- [x] 6.1 Route playback, decode, waveform, sounds, media processing, and export-preparation live `AudioContext` construction through the owning session resources.
- [x] 6.2 Make `AudioManager` stop scheduling/nodes/subscriptions on suspend and close/dispose its live context and sinks on final disposal.
- [x] 6.3 Wrap finite decode/processing contexts in awaited `try/finally` terminal close paths for success, failure, and cancellation.
- [x] 6.4 Keep operation-bounded `OfflineAudioContext` local to one rendering promise and dispose associated media inputs in `finally`.
- [x] 6.5 Add a gate/test that fails if an offline context is stored, exported, or escapes into module/session state.
- [x] 6.6 Ensure audio completions are generation-checked before publishing after suspend, replacement, or disposal.
- [x] 6.7 Exercise actual audio creation in the browser harness with small generated data and record CREATED before disposal.
- [x] 6.8 Add GREEN tests for suspend/resume scheduling, finite decode success/failure/cancel, delayed close, rejected close, cross-session isolation, and terminal closed state.

## 7. Give object URLs, media caches, and preview services deterministic owners

- [x] 7.1 Replace every editor-graph bare `URL.createObjectURL` owner with a session-owned object-URL handle while exposing only the opaque string to render consumers.
- [x] 7.2 Retain handles for loaded attachments/media until replacement, removal, project switch, or session disposal.
- [x] 7.3 Make replace, remove, undo/redo, and project-switch revocation idempotent and isolated from another session's equal logical asset.
- [x] 7.4 Revoke image, video, SVG, export, download, and processing transient URLs in terminal `finally` paths.
- [x] 7.5 Convert video-cache live state from an immortal module singleton to per-core ownership or an explicit final-owner lease.
- [x] 7.6 Convert waveform-cache promises/media inputs/context handles to per-core ownership and deterministic cancellation/drain.
- [x] 7.7 Replace effect-preview's immortal resolver-indexed value with one session lease or an exact reference-counted resolver lease and final disposer.
- [x] 7.8 Ensure project replacement drains prior media, waveform, preview, transcription, and URL live state without deleting durable C5 data.
- [x] 7.9 Dispose video, waveform, effect-preview, media, audio, renderer, and transcription owners before removing weak owner indexes.
- [x] 7.10 Prove equal logical media keys in two sessions do not share live inputs, promises, cancellation generations, or URL handles.
- [x] 7.11 Exercise retained and transient object URLs in the browser harness and expose an exact platform-live probe.
- [x] 7.12 Add GREEN tests for early revoke, double revoke, error/cancel exits, undo/redo, project replacement, two-session isolation, and service drain ordering.

## 8. Add a serialized shared-WASM runtime lease

- [x] 8.1 Keep `prepareWasmRuntimeProviders()` public behavior deep by delegating initialization/acquire/release to one private process-lifetime module.
- [x] 8.2 Increment shared ownership only after initialization returns usable distinct query wrappers and an idempotent lease release.
- [x] 8.3 Release and reconcile the disposing session's exact nonzero compositor before freeing its query wrappers.
- [x] 8.4 Free each session's backend/live-handle query wrappers exactly once after reconciliation.
- [x] 8.5 Preserve shared GPU state and the other session's renderability when a non-final runtime owner releases.
- [x] 8.6 On the final lease, use a still-live query to require zero tracked/leaked/untracked handles before calling C0b `disposeGpu()` exactly once.
- [x] 8.7 Reject and name live handles or teardown failures instead of reporting a clean final runtime release.
- [x] 8.8 Serialize concurrent acquire/release so owner count never goes negative and two apparent final owners cannot both tear down shared GPU state.
- [x] 8.9 Leave failure state explicit/retryable and allow a successful final teardown to be followed by fresh initialization of a new generation.
- [x] 8.10 Add GREEN tests for two sessions, first-owner release, final-owner release, leaked/untracked handle refusal, concurrent final release, wrapper order, cancellation, and reinitialization.

## 9. Widen and falsify the resource-acquisition boundary

- [x] 9.1 Extend `script/check-port-boundary.mjs` or add a narrowly named called checker that scans tracked plus uncommitted editor-runtime source and both emitted Host graphs.
- [x] 9.2 Fail direct live timers/RAF, `new Worker`, live `AudioContext`, `URL.createObjectURL`, unkeyed/default compositor calls, and a second acquisition mediator.
- [x] 9.3 Encode exact Host adapter, unit/conformance/fault fixture, shell-only, and bounded-offline classifications as reviewed data.
- [x] 9.4 Print scanned root/path counts, rule counts, and exemption counts so an empty or truncated inventory cannot pass.
- [x] 9.5 Add one targeted non-zero violating fixture for each resource rule and verify every fixture names the expected rule/path.
- [x] 9.6 Add positive controls for the permitted Host construction and bounded offline-audio pattern.
- [x] 9.7 Regenerate `SOURCE_INVENTORY.md` and append attributable inherited-file changes to `PATCHES.md` when the project contract requires them.
- [x] 9.8 Run the boundary against source, fresh Vite output, and fresh Next output; save commands and non-vacuous counts.

## 10. Build one six-cycle logical-plus-platform leak oracle

- [x] 10.1 Implement one shared evaluator and lifecycle-cycle driver reused by both Host adapters.
- [x] 10.2 Run at least six `create -> mount -> acquire all five -> suspend -> resume -> dispose` cycles per ordinary Host run.
- [x] 10.3 Force non-network-dependent creation of a timer, local Worker, live audio context, object URL, and real compositor in every ordinary cycle.
- [x] 10.4 Record `beforeDispose[class].created > 0` for all five classes before evaluating any release claim.
- [x] 10.5 Execute a post-resume operation and verify it belongs to the same session before disposal.
- [x] 10.6 Record the terminal disposal report, exact class counters, platform terminal state, GPU live handles, Host/build/base identity, cycle number, and unhandled errors.
- [x] 10.7 Require exact zero residual after every cycle and emit each class's residual series plus monotonic-growth assessment.
- [x] 10.8 Treat listener/task/heap observations as supplemental diagnostics that cannot override an exact leaked handle.
- [x] 10.9 Add a missing-CREATED control for every class or a parameterized class control and prove evaluation stops before release proof.
- [x] 10.10 Fault-inject at least one otherwise-valid platform terminator so the ordinary evaluator reports the leaked class and cycle as non-clean.
- [x] 10.11 Ensure the negative-control test passes only when leakage is detected and cannot be green because attempted-release counters say clean.
- [x] 10.12 Save a stable machine-readable schema and focused unit tests for clean, missing-creation, nonzero residual, monotonic growth, and deliberate-leak inputs.

## 11. Produce fresh independent Vite and Next browser evidence

- [x] 11.1 Create unique C6 build markers and fresh output directories for Vite and Next; reject stale or mismatched markers/base identities.
- [x] 11.2 Allocate exclusive ports and launch owned server/browser processes with recorded PIDs and isolated contexts.
- [x] 11.3 Run the Vite six-cycle ordinary oracle through the production Host composition and C5 `BrowserProjectStore`.
- [x] 11.4 Run the Vite missing-CREATED and deliberate-leak controls through the same evaluator.
- [x] 11.5 Run the Next standalone six-cycle ordinary oracle through the production Host composition and C5 `BrowserProjectStore`.
- [x] 11.6 Run the Next missing-CREATED and deliberate-leak controls through the same evaluator.
- [x] 11.7 Fail either Host before lifecycle acceptance if a C4 runtime role or C5 store falls back to an in-memory/default production role.
- [x] 11.8 Save per-Host JSON, browser console/network/error observations, selected backend, exact residual series, markers, base, ports, and PIDs.
- [x] 11.9 Terminate only owned processes, verify ports are released, and record cleanup even when a harness assertion fails.
- [x] 11.10 Independently review the Vite and Next artifacts for attribution, six complete cycles, all-five CREATED proof, negative-control sensitivity, and zero exact residuals.

## 12. Run the complete regression and provenance tail

- [x] 12.1 Run focused lifecycle, session-resource, manager/service, runtime-lease, Host-generation, and boundary test files and save exact totals.
- [x] 12.2 Rerun the fresh Vite and Next positive/negative disposal harnesses from clean marked artifacts.
- [x] 12.3 Rerun C3 WebGL-one-preview and WebGPU-two-preview distinct-backend jobs with exact handle disposal.
- [x] 12.4 Rerun C4 asset resolution, Host Worker, forced-none allocation-free, and production role-composition gates.
- [x] 12.5 Rerun C5 storage parity, opaque provider-field round trip, migration/cascade recovery, topology authorization, production store identity, and Host tests.
- [x] 12.6 Run fresh Vite and Next builds, then run type verification and require no diagnostic beyond the exact three inherited identities.
- [x] 12.7 Run protected parity and require the recorded fixture blob and unchanged semantic oracle.
- [x] 12.8 Rerun Rust/WASM source tests, generated artifact provenance, SBOM, and license gates without regenerating or editing protected artifacts.
- [x] 12.9 Sweep all 13 current main capability specs in both directions: identify assertions the C6 diff could falsify and map every added C6 scenario to executed evidence.
- [x] 12.10 Run the full Bun suite and require no red identity beyond the six inherited `ZERO_MEDIA_TIME` placement failures and two inherited loader failures.
- [x] 12.11 Audit the final product diff against the expected write-set groups and explain or remove every unattributed path.
- [x] 12.12 Recompute protected port/session-type/parity/type/Rust/generated identities and require exact equality with the design.
- [x] 12.13 Prove the final diff contains no C7 headless graph, E1 Elftia/packaging work, D2 React decision, new private port, Rust API, generated WASM edit, or durable-data deletion.
- [x] 12.14 Save exact commands, exit codes, totals, inherited-failure identities, hashes, and artifact paths in the child evidence directory.

## 13. Obtain independent review and the mandated model evaluation

- [x] 13.1 Give a fresh non-author reviewer the proposal, design, delta spec, tasks, exact base, product diff, focused evidence, both browser reports, and inherited-red manifest.
- [x] 13.2 Triage every finding with severity and evidence; do not advance while any Blocker or Major remains open.
- [x] 13.3 Apply accepted fixes with new focused RED/GREEN evidence and request a non-author delta re-review until the delta is clean.
- [x] 13.4 Have a fresh non-author Sol reviewer synthesize C5 Phase 6, C5 Phase 7, and the C6 first Luna-max return into `evidence/luna-max-implementer-evaluation.md`.
- [x] 13.5 Require the evaluation to choose exactly one verdict: `can replace Sol`, `bounded-task only`, or `not ready`, with cited evidence and no impact on product acceptance.
- [x] 13.6 Mark implementation verification complete only after all added scenarios are executed, the strict change validates, and review/evaluation artifacts are durable.

## 14. Keep ship, integration, spec sync, and archive as separate leaves

- [x] 14.1 Hand the verified child to a separate Luna-xhigh local-ship leaf; do not let implementation or review silently commit or deliver it.
- [x] 14.2 Reconfirm exact base, clean protected identities, no open Blocker/Major, and final verification evidence immediately before local ship.
- [x] 14.3 Create only the portfolio child's local commit and record commit/tree identities; do not push, open a PR, merge, or archive.
- [x] 14.4 Return control to the LEAD for portfolio integration ordering and conflict resolution against other S02 children.
- [x] 14.5 After integration, rerun conflict-sensitive lifecycle/runtime/storage/browser gates and record the integrated identity rather than reusing child evidence.
- [x] 14.6 Sync main specs only when the integrated delta is accepted and preserve the 13-spec two-way sweep record.
- [x] 14.7 Assign archive to another separate Luna-xhigh leaf after integration and spec-sync conditions are satisfied. `evidence/c6-archive-deferred-luna-xhigh-20260805.md` and corrected persisted `codex exec` thread `019fce16-9fe5-7853-8362-905a0f444e40` prove a `gpt-5.6-luna`/`xhigh` assignment after integration and spec sync; the external quota gate stopped execution before any repository action. This records assignment only, not pre-archive verification or archive execution.
- [x] 14.8 Have the archive leaf perform pre-archive verification only: confirm the proposal, design, delta spec, and tasks artifacts are complete; confirm every actionable prerequisite checkbox through 14.7 is complete; confirm the seven historical-deviation records remain truthful non-checkbox permanent deviations; audit accepted product, local-ship, integration, main-spec-sync, 59-scenario-realization, and strict-validation evidence; and record archive readiness without invoking the archive engine, editing product code, rewriting Git history, or inventing verification.

14.9 **Engine-owned archive postcondition (non-checkbox; evaluated only after 14.8):** Actual archive completion and return of control to LEAD are satisfied only when all three engine outputs exist and agree: the archived `archive.json`, the finalized `evidence/ship-log.md` `## Archive` section, and a successful archive-engine result recording the archive path/transaction identity. This postcondition is evaluated after the actionable checklist is complete, is not a prerequisite checkbox, and cannot be claimed from assignment or pre-archive readiness alone.

## Implementer execution map (2026-08-04)

The checked items in this 2026-08-04 snapshot are work that had been actually executed and had
durable evidence under `rasen/changes/s02-session-disposal/evidence/` or in the product diff. At
that snapshot, the task file contained **121 checked / 16 unchecked / 137 total** actionable
checkbox items. These counts are historical bookkeeping, not current task truth; later ship,
integration, spec-sync, assignment, and governance-remediation evidence is intentionally not
back-projected into this dated map. The checked ranges in that snapshot map as follows:

- 1.1–1.3, 1.7–1.10: `phase1-baseline.md`, `planning-audit.md`,
  `phase1-bun-test-baseline.log`, `phase1-type-baseline.log`,
  `c6-protected-identities-20260804-1.log`, and the boundary logs.
- 2.1–2.10 and 3.1–3.10: `create-session.ts`, `session-resources.ts`, manager/service
  diff, `c6-focused-final-20260804-1.log`, `c6-c4-unit-gate-20260804-2.log`,
  `c6-c5-unit-gate-20260804-3.log`, and the session lifecycle/ownership/C6 tests.
- 4.1–4.8; 5.1–5.7; 6.1–6.8; 7.1–7.12; and 8.1–8.10: the resource,
  audio, media/cache/preview, transcription, and runtime-provider diffs plus normal/negative
  boundary logs, C4/C5 tests, and `c6-browser-oracle-20260804.md`.
- 9.1–9.6, 9.8: `c6-boundary-tail-20260804-1.log`, `c6-boundary-negative-tail-20260804-1.log`,
  `c6-port-tail-20260804-1.log`, `c6-port-negative-tail-20260804-1.log`,
  `c6-asset-boundaries-20260804-1.log`, and emitted/manifest gates.
- 10.1, 10.3, 10.4, 10.6–10.12: `disposal-oracle.ts`, its focused tests, the shared browser
  harness/runner, and final Vite/Next JSONL captures.
- 11.1–11.10: final uniquely marked builds, owned preview/start processes and the final browser
  report. 12.1–12.12 and 12.14: the C3/C4/C5, build/type, parity, WASM/provenance/SBOM/license,
  13-spec, full-Bun, scope, identity, and evidence-tail logs named in `handoff/implementer.md`.

Fix-round additions: 4.5, 10.2, and 10.5 are covered by `evidence/c6-fix1-remediation-20260804.md`,
the fresh Vite/Next browser JSONL captures, and the boundary/type/test logs listed there.

Fix-round 3 additions: 2.5, 2.10, 4.7, 5.4, 5.5, 5.7, and 6.4 are covered by
`evidence/c6-fix3-sol-remediation-20260804.md`, the focused lifecycle/resource/transcription/media
tests, the semantic source/emitted boundary controls, and the unchanged-red full-suite replay.

Fix-round 4 additions: 4.8, 6.6, 6.8, and 7.12 are covered by
`evidence/c6-fix4-sol-remediation-20260804.md`, the focused timer/audio/media matrices, fresh
marked Vite/Next builds and browser oracles, and the complete regression/provenance tail.

Scenario 52 and final exclusion addendum: delta-spec Scenario 52 is now PASS in
`evidence/c6-spec-sweep-20260804.md` on the two host-separated FINAL3 JSONL records and
`evidence/c6-scenario52-durable-reopen-20260804.md`. Scenario 52 has no separate checklist leaf.
Task 12.13 is advanced on the dedicated 96-path base-relative exclusion audit recorded there:
zero C7/E1/D2 dependency paths, zero private-port/session-type or Rust diff, exact generated-WASM
identities, zero deleted product paths, and zero added durable-store deletion calls.

Post-CLEAN review/evaluation adjudication: tasks 11.10 and 13.1–13.6 are covered by
`evidence/c6-post-clean-task-truth-20260804.md`, the fresh non-author FINAL3 Scenario 52 review and
handoff, the CLEAN round-5 fix review, and the frozen Luna-max evaluation/final audit. The final
review independently replays both Hosts, reaches 59/59 PASS with no open Blocker/Major/Minor, and
records strict validity. The evaluation synthesizes C5 Phase 6, C5 Phase 7, and the C6 first return
with exactly the verdict `bounded-task only`.

Post-implementation provenance/prerequisite audit: 1.1 is advanced from the existing pre-edit
identity/status record in `phase1-baseline.md`. The exact 1.4–1.6 and 1.11–1.14 gaps, C6 patch-log
coverage, and the 9.7 post-commit inventory deferral are mapped in
`evidence/c6-fix4-prerequisite-red-audit-20260804.md`.

### Explicitly unverified or intentionally deferred in the 2026-08-04 snapshot

The following entries were deliberately left unchecked in that snapshot and were not claims of
completion at that time:

- **Base/RED evidence gaps:** 1.4 (complete pre-edit diff attribution), 1.5 (a single durable
  prerequisite/disk-space audit), 1.6 (fresh bootstrap sequence), and 1.11–1.14 (new failing RED
  lifecycle/resource/oracle tests and their saved excerpts) were unchecked. They are now retained
  as permanently unmet non-checkbox deviations, not converted into task credit.
- **Implementation/scenario gap:** 9.7 was a post-commit leaf. C6 inherited-file coverage was
  complete in `PATCHES.md` rows P-225–P-272, but the upstream-provenance contract required
  `SOURCE_INVENTORY.md`/`.json` regeneration _after_ the compared-set commit and requires untracked,
  non-ignored enumeration. This child was intentionally uncommitted, and the official generator's
  tracked-only drift scan would have omitted 17 then-untracked inventory-area files, so no misleading
  pre-commit derived inventory was written or checked off.
- **Oracle gaps (superseded by fix-round evidence):** 10.2 and 10.5 were previously open because the final browser harness proved six
  create/mount/acquire/dispose cycles but does not yet execute suspend→resume or a post-resume
  same-session operation. This historical note is superseded: fresh Vite and Next fix-round
  controls now execute suspend/resume, same-session post-resume work, and direct platform proofs.
- **Delivery gaps:** all 14.1–14.8 local-ship, integration, spec-sync, and archive tasks were pending
  in that snapshot.

Subsequent durable evidence advanced 9.7 and 14.1–14.7 where their requirements were actually
satisfied. The current governance-adjusted actionable accounting, with only 14.8 pending, is
recorded in `evidence/c6-delivery-governance-remediation-20260806.md`.
