# Luna-max implementer experiment - final audit

Date: 2026-08-04 +08:00  
Auditor: fresh non-author Sol reviewer (`/root/c6_sol_review_eval`)  
Mode: attribution and model/process outcome only; no product, task, frozen-evaluation, delivery, or cleanup mutation

## Final decision

The Luna-max implementer experiment is concluded. Its final calibrated verdict remains exactly:

**`bounded-task only`**

The experiment does not support replacing Sol implementers or fresh Sol review. Luna produced valuable bounded implementation and remediation work, but repeated completion-calibration, edge-path, and evidence-tail failures required independent discovery. The C6 tree is still **NOT CLEAN - 3 Blocker / 1 Major / 1 Minor** after the second remediation round.

This audit does not modify or reinterpret `luna-max-implementer-evaluation.md`; that initial evaluation is frozen.

## Runtime provenance audit

The local Codex runtime database `C:/Users/Sayo/.codex/state_5.sqlite` was queried read-only. The relevant `threads` rows record the actual model, effort, role, source, and agent path:

| Work/thread identity                                          | DB row prefix  | Model / effort         | Role / source              | Audited attribution                                                                                                         |
| ------------------------------------------------------------- | -------------- | ---------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| C5 Phase 6                                                    | `019fc878-9b6` | `gpt-5.6-luna` / `max` | `luna_worker` / `subagent` | Luna-max.                                                                                                                   |
| C5 Phase 7, later reused for C6 boundary fix 2                | `019fc8ce-2de` | `gpt-5.6-luna` / `max` | `luna_worker` / `subagent` | C5 P7 and the C6 boundary leaf are Luna-max. The row's later `updated_at` and retained agent path corroborate thread reuse. |
| C6 first implementation and lifecycle/media integration fixes | `019fc9df-536` | `gpt-5.6-luna` / `max` | `luna_worker` / `subagent` | C6 initial work and lifecycle fix-round work are Luna-max.                                                                  |
| C6 cache/preview/WASM fix 2                                   | `019fc852-e3c` | `gpt-5.6-sol` / `max`  | `worker` / `subagent`      | Sol-max, not Luna. This leaf must not be credited to the Luna experiment.                                                   |

The associated rollouts and final agent-status record corroborate ownership: the reused C5 P7 thread reports the boundary checker/collector/tests; the Sol-max thread reports effect-preview, video cache, waveform cache, and WASM retry work; the C6 Luna thread reports lifecycle admission, browser dwell, media undo, protected-port restoration, and combined integration.

## Outcome chronology

| Stage                   | Observed outcome                                                                     | Calibration signal                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C5 Phase 6 first return | 17/18 command gates; ESLint omitted.                                                 | Useful bounded control construction, but LEAD found lint and fresh Sol found a Major exception-path defect before eventual closure.                                                                                                                                                                                     |
| C5 Phase 7 first return | 8/12 substantive tasks; 12/17 verification families; 2 Blocker / 1 Major / 2 Minor.  | Eventually closed, but required repeated LEAD/Sol correction and evidence-tail cleanup.                                                                                                                                                                                                                                 |
| C6 first return         | **98 checked / 39 unchecked / 137 total**.                                           | Frozen initial review: **5 Blocker / 1 Major / 1 Minor**. The author correctly left major work unchecked, but several checked claims were false.                                                                                                                                                                        |
| C6 fix round 1          | Current tasks became 101 checked / 36 unchecked.                                     | Independent delta review remained **5 Blocker / 1 Major / 1 Minor**: some original issues closed, while media regression/protected drift appeared and boundary/lifecycle/ownership defects remained.                                                                                                                    |
| C6 fix round 2          | Luna lifecycle/media integration + Luna boundary leaf + Sol cache/preview/WASM leaf. | Independent delta review is **3 Blocker / 1 Major / 1 Minor** with 42 PASS / 9 FAIL / 8 UNVERIFIED scenarios. Exact builds/browser/full-suite/protected identities are green, but project replacement, suspend/restart, mechanical boundary completeness, finite audio failure cleanup, and static hygiene remain open. |

## Credit boundary

Luna-max receives credit for:

- C5 Phase 6 and Phase 7 implementation/remediation;
- the C6 first implementation;
- the C6 lifecycle/admission, browser suspended-dwell, media-undo, protected-port restoration, and integration work performed on `/root/c6_luna_max_implementer`;
- the C6 boundary fix-round-2 work performed by the reused `/root/c5_phase7_luna_max` thread.

Luna-max does **not** receive credit for the C6 cache, effect-preview, or WASM retry fixes. Those were performed by `gpt-5.6-sol` at `max` effort on `/root/c5_phase5_review_fix`.

## Final bounded-scope judgment

The cumulative evidence supports Luna only for narrow, independently gated work where the acceptance surface is explicit and another agent owns completion truth. It does not support Luna as the default implementer for concurrency, lifecycle cancellation/restart, resource-drain integration, semantic boundary enforcement, or final verification/evidence closure.

The experiment's practical conclusion is stricter than its initial provisional recommendation because the second C6 remediation still leaves contract-defining Blockers and repeats a false static-gate completion claim. `bounded-task only` remains the exact verdict, but the implementation policy now moves on from the experiment.

## Policy after this audit

- All subsequent implementation leaves use **Sol**.
- Luna is not used for further product fixes or remediation in this change.
- Luna may be used only for separate, mechanically bounded **ship/archive** leaves, at **xhigh** effort, after product acceptance and explicit dispatch.
- Fresh non-author Sol review remains mandatory before delivery.

## Auditor footprint

This audit is durable report-only evidence. It does not edit the frozen initial evaluation, product worktree, task checklist, author evidence, runstate, commits, delivery, integration, spec sync, archive state, or generated-output cleanup.
