# C6 Session Disposal Planning Audit

## Outcome

The `s02-session-disposal` ONE_SHOT planning package is complete and apply-ready. Strict validation
passes with 14 ADDED requirements, 59 scenarios, and 137 unchecked implementation/verification
tasks. Planning changed no product source, generated artifact, integration worktree, parent portfolio
state, or execution runstate.

## Exact authority and base

- Target project: `rocut` at `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut`.
- Direction authority read: S02 target state, roadmap, corrected slice spec/plan, parent planning
  context, parent portfolio state, and the completed C5 change/archive evidence.
- Product base: HEAD `d6ed4166b5ffb13257d1924851f2fa57d73d349f`, tree
  `3875074383b41f622e5f32942091468cf8959b61`.
- C5-inclusive proof: product commit `0bfcf0457385b55de815c75ec712e9b9d69da242` is included by
  the base; planning from the older C4 product was rejected.
- Read-only integration verification used `rocut-wt-s02`; `git status --short` returned no paths.
- `rasen agent context --latest --runtime codex --json` found no matching transcript for this cwd;
  this was non-blocking because durable direction and parent handoff/state were available.

## C6 authority translated into acceptance

The package preserves the exact C6 objective: suspend/resume/dispose release five resource classes
(timer, Worker, AudioContext, object URL, session-owned GPU), the shared Vite/Next oracle runs at
least six cycles, every class is proven CREATED before release is asserted, residual monotonicity is
assessed, and a deliberate leak is rejected by the same evaluator.

The package adds only the `session-resource-disposal` capability. It does not falsely modify an
existing main spec: the 13 current main capability specs remain authoritative and are protected by a
two-way falsification sweep. Their exact ids are:

1. `browser-persistence-boundary`
2. `developer-reproducibility`
3. `editing-parity-fixture`
4. `editor-session-runtime`
5. `host-port-contract`
6. `host-service-boundary`
7. `inherited-defect-repair`
8. `next-free-distributable-boundary`
9. `runtime-asset-delivery`
10. `self-built-wasm-artifact`
11. `session-state-isolation`
12. `upstream-provenance`
13. `wasm-api-surface`

## Current-product findings that constrain implementation

- `SessionResources` and `DisposalReport` already name/count all five classes and shall remain
  publicly shape-stable.
- The current resource drain is synchronous; audio cleanup calls `void close()` and increments
  released before terminal completion. C6 therefore requires a private awaitable, exhaustive drain.
- Current suspend/resume covers only a subset of managers; a private lifecycle coordinator is
  required to serialize transitions and quiesce save/playback/audio/render/transcription activity.
- C4 already makes Worker construction Host-owned. C6 propagates the existing session resources
  through the actual editor graph; it does not add a Worker factory or new Host port.
- Video/waveform caches and effect-preview ownership still contain module/resolver lifetime that C3
  explicitly deferred to C6; they need deterministic session or final-owner disposal.
- Direct timer, live audio, and object-URL acquisitions remain in session-reachable code. Exact
  inventory and mechanical negative controls are required; a scan limited to ports/session is not
  sufficient.
- C0b exposes `disposeGpu()` and handle-keyed query APIs. C6 authors no Rust API: a serialized
  TypeScript process lease releases exact session handles and calls shared teardown only for the
  final owner after a live empty-handle check.
- `OfflineAudioContext` is classified as operation-bounded, not silently treated as a live-context
  exemption; it must remain local to an awaited operation with related inputs cleaned in `finally`.

## Locked design decisions

1. Keep the existing public session/Host/port/report surface; introduce one private serialized
   lifecycle coordinator.
2. Suspend retains identity/project/root/persistence while quiescing publishers and activity-bound
   resources; it is neither unmount nor a false release claim.
3. Dispose closes admission, returns one stable promise, awaits reverse-order terminal release,
   attempts all owners after failure, preserves attributed aggregate errors, and counts release only
   after success.
4. Pass the existing `SessionResources` through managers/services; reject a generic disposer escape
   hatch and a second acquisition mediator.
5. Use deterministic session ownership or an explicit resolver final-owner lease for caches and
   preview services.
6. Use a serialized reference-counted shared-WASM lease; never call `disposeGpu()` per session.
7. Use exact logical plus platform observations for all five classes; heap/listener metrics are
   supplemental and cannot overrule an exact leak.
8. Reuse one evaluator/driver on fresh uniquely marked Vite and Next artifacts through real C5
   production Host composition.
9. Preserve durable C5 data and topology; disposal removes live/transient ownership only.
10. Keep implementation, independent review, Sol synthesis, local ship, integration, and archive as
    separate stages.

## Protected identities and stop conditions

- `apps/web/src/editor/ports` tree: `efe499db6bec7afb8c35ac1a2aaa5fe851fac667`.
- public `session-types.ts` blob: `c67d9822a2a6c994be14f367e6980fbbaa6e454b`.
- parity fixture blob: `521d802e490956f38aa15d2b4024be9f6b53ee00`.
- type fixture blob: `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8`.
- Rust trees: `d782b046c0f39e85b8a5ed518b42389214c211e5`,
  `4da4fe82bd946d6ef3937ec0c25f10e77ba674f2`, and
  `cdaa2215e4b7bbe3f42d2e2c8db32e429cd5af34`.
- generated JS/WASM SHA-256: `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1`
  and `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`.
- inherited full-suite identity: 330 pass / 8 fail / 2 loader errors / 1,058 expectations across
  338 tests / 64 files; only six `ZERO_MEDIA_TIME` placement failures plus
  `wasm.__wbindgen_start` and `DEFAULTS` loader errors are accepted.
- inherited type ceiling: exactly three recorded diagnostic identities.

Any base drift, unexpected protected edit, new regression identity, vacuous acquisition scan,
missing CREATED observation, or unowned server/process is a stop condition, not permission to
rebaseline.

## Scope boundaries and remaining risks

- D2 remains deliberately unmade. C7 owns the emitted/headless no-React graph; E1 owns packaged
  Elftia true-unmount/React/no-rasterizer/CSS measurement.
- Browser platform observation for synchronous terminators must be deliberately instrumented; the
  session attempted-release count alone is insufficient.
- GPU final-owner correctness depends on preserving query-wrapper lifetime until session
  reconciliation and serializing concurrent releases.
- The direct acquisition inventory is broad. Exact classified coverage and nonzero fixtures are
  required to prevent both false exemptions and vacuous success.
- No open product-interface question remains for implementation. If exact code topology makes the
  expected write set incomplete, the implementer must amend the plan and obtain review before edit.

## Validation record

Command:

`rasen validate s02-session-disposal --project rocut --strict`

Result: exit 0, `Change 's02-session-disposal' is valid`.

Status command:

`rasen status --change s02-session-disposal --project rocut --json`

Result: `isComplete: true`; proposal, design, specs, and tasks all `done`; apply requires `tasks` and
the next workflow is `apply`.

Exact static counts:

- ADDED requirements: 14
- scenarios: 59
- unchecked tasks: 137

## Files written

- `.openspec.yaml` (Rasen change scaffold metadata)
- `proposal.md`
- `design.md`
- `specs/session-resource-disposal/spec.md`
- `tasks.md`
- `evidence/planning-audit.md`
- `handoff/planner.md`

All seven files are inside `rasen/changes/s02-session-disposal/**`. No matching `.rasen` execution-root
runstate was required or written.
