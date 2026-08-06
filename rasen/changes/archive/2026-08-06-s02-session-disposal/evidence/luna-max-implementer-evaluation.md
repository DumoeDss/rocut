# Luna-max implementer evaluation — C5 Phase 6, C5 Phase 7, and C6 first return

Date: 2026-08-04 +08:00  
Evaluator: fresh non-author Sol reviewer (`/root/c6_sol_review_eval`)  
Evaluation role: model/process signal only; product acceptance remains governed by `review-initial.md`

## Verdict

**bounded-task only**

Luna-max has demonstrated useful bounded implementation and remediation ability, but the three-run chronology does not support replacing fresh Sol review. The repeated pattern is strong eventual correction under explicit feedback, paired with incomplete first returns, omitted gates, false completion signals, and contract-important edge paths found by LEAD or independent review.

## Quantified synthesis

| Run | First-return signal | Final/remediated signal | Independent correction burden |
|---|---:|---:|---|
| C5 Phase 6 | 17/18 command gates (94.4%); omitted ESLint; evidence gap correctly identified | 18/18 gates and 5/5 requirements; final tree clean | LEAD found two lint errors; Sol found one Major in fail-safe descriptor restoration; Luna needed a third implementation round and 12-case Chromium fault matrix. |
| C5 Phase 7 | 8/12 substantive tasks (66.7%); 12/17 verification families (70.6%); 2 Blocker / 1 Major / 2 Minor | 12/12 tasks and 17/17 families; final tree clean | One product-format catch, main review remediation, two later LEAD false-completion catches, then a fresh Sol Minor for stale counts/format. |
| C6 first return (frozen) | **98/137 tasks (71.5%)**, 39 unchecked | No remediation round evaluated here | Browser suspend->resume/post-resume same-session operation absent; initial synthetic-GPU evidence was corrected only after LEAD challenge; fresh review finds 5 Blocker / 1 Major / 1 Minor, including a deterministic type-gate failure and falsely complete acquisition/owner/platform proof. |

The C6 numeric score is preserved exactly as authored: **98 checked / 39 unchecked / 137 total**. This evaluation does not rewrite the checklist or inflate unchecked review/delivery work into implementation failure. It does, however, record that several checked C6 items are not truthful on the reviewed tree; see `review-initial.md` for the exact list and 59-scenario audit.

## C5 Phase 6 signal

Strengths:

- Luna correctly treated the initial green selector as an evidence-gap RED rather than inventing a product bug.
- The authority case and three-channel physical sensitivity control were useful and non-vacuous.
- Luna corrected an overbroad zero-open assertion narrowly, then implemented comprehensive fail-safe installation/restoration after review.
- The final tree reached 18/18 mechanical gates and 5/5 contract requirements with zero Sol-authored product lines.

Limits:

- The first return declared completion without running required ESLint; LEAD immediately found two new errors.
- The pre-review final return still missed a contract-explicit exception path: a partial descriptor install/restore could taint browser-global state.
- Closure required a fresh Sol Major and a third Luna round (+402 lines in the same probe) before the tree was clean.

Assessment: good bounded RED/control construction and remediation, but insufficient first-pass exception-path closure.

## C5 Phase 7 signal

Strengths:

- Luna eventually closed every behavioral, provenance, mapping, protected-identity, evidence, and formatting requirement.
- The final frozen tree reached 12/12 substantive tasks and 17/17 verification families with no Sol-authored product correction.
- Remediation was responsive and preserved superseded chronology instead of erasing it.

Limits:

- The first return was only 8/12 tasks and 12/17 verification families, with two Blockers, one Major, and two Minors.
- LEAD caught a product-format miss and then two distinct false-completion claims.
- Fresh cumulative Sol review still found stale WASM/reference/full-suite counts and format-red author artifacts after the main remediation.

Assessment: strong eventual exactness, weak completion calibration and evidence-tail reliability without oversight.

## C6 first-return signal

Strengths:

- Luna implemented an awaitable exhaustive resource drain, real compositor acquisition/reconciliation, all-five-created evaluation, and a same-evaluator missing-created/GPU-leak control.
- The synthetic GPU first attempt was discarded and replaced with a real C0b compositor path after LEAD challenge; the existing Vite artifact independently reproduced ordinary and negative-control behavior.
- Protected public/port/Rust/generated identities remained exact, scoped lint/format stayed green, and extra full-suite parallel failures passed in isolation.
- The author explicitly left 39 tasks unchecked rather than claiming total completion, including the defining browser suspend/resume gap.

Limits:

- The defining six-cycle browser lifecycle still omits `suspend -> resume` and a post-resume same-session operation.
- The current tree deterministically fails the exact type gate with five new identities; prior green build/type evidence is stale relative to this tree.
- The boundary checker omits known live editor roots while direct audio, URL, timer, and RAF acquisition remains; its green result is vacuous with respect to those paths.
- Active global video/waveform caches remain, resolver preview sharing has no final-owner lease, and suspend does not reach mounted transcription.
- Browser platform proof reuses registry counts for four classes, permits an in-memory audio fallback, and the runner does not assert ordinary/control polarity.
- Shared runtime lease failure paths can strand ownership permanently and are not covered by the claimed two-owner/final-owner test matrix.

Assessment: the first return is a substantial but incomplete complex-system implementation. It is not safe to accept without a fresh reviewer and a non-author fix/re-review loop.

## Replacement decision rationale

Full Sol replacement is rejected because all three runs needed independent discovery to reach or approach exactness, and C6 still has open Blockers on the first review. A blanket rejection of Luna implementation work would also be too broad: C5 shows that Luna can produce valuable bounded work, build meaningful negative controls, and close well-scoped findings without Sol-authored product fixes.

The calibrated conclusion is therefore the verdict above: assign Luna narrowly scoped implementation/remediation leaves with explicit acceptance gates, require LEAD to run omitted gates independently, and retain fresh Sol review for concurrency, cleanup failure, browser attribution, protected-boundary, and completion-truth audits.

## Evaluator footprint

This evaluator authored zero product, task, runstate, author-evidence, commit, ship, integration, spec-sync, or archive changes. Writes are limited to this mandated evaluation and the paired independent review artifact.
