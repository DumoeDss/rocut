# Ship Log: s0304-surface-mount-focus-lifecycle

**Date:** 2026-08-11T20:11:58+08:00
**Mode:** local
**Branch:** recovery/s0304-ui-commit-routing-final
**Commit:** fb14b5b1f15f46b557dedf7ab463a73233b5eff5
**Tree:** f493007837c4260876f6cac51625717a8e12b412
**Status:** Committed (delivery deferred to portfolio/parent level)

The commit above is the delivered R1 product/checker and canonical review delta. This ship log is carried in a separate local evidence commit so the recorded delivery identity is exact rather than self-referential.

## Pre-Flight Results

- Verification: PASS — fresh non-author Round 2 review resolved P1, P2, S2, P3, and S4; the bounded review loop resolved 7/7 findings with zero open Blocker, Major, Minor, or Trivial findings.
- Pipeline: PASS — `rasen pipeline resume s0304-surface-mount-focus-lifecycle --project rocut --json` resolved `next=ship`, with `review-loop` complete and `openFindings=[]`.
- Tasks: 50/50 complete.
- Scope: PASS — exactly 46 authorized paths committed: the reviewed 44-path product/checker receipt plus the two canonical review reports. `.rasen/**` was not staged.
- Reviewed live product/checker identity before commit: `2984b222baf7de5670c88209ff63296729af0d372c1c7fda4348a983dc16cf95` over 44 paths / 5,154 serialized UTF-8 bytes.
- Artifact integrity: PASS — final manifest SHA-256 `5fcc164278edd57388c9b70cb8eff6e52d8ba94611d07f30e20f25da19299b51`, 26/26 members matched, and 14/14 PNGs decoded during independent review.
- Whitespace: PASS — staged delivery passed `git diff --cached --check`; final worktree passed `git diff --check HEAD` before commit.

## Test Gate

- Fresh focused tests: `bun test --timeout 30000 apps/web/src/actions/__tests__/registry.test.ts apps/web/src/editor/surface/embedding/__tests__ apps/web/src/editor/host/__tests__/production-composition.test.ts apps/web/src/editor/session/__tests__/session-runtime-ownership.test.tsx` — PASS, 37 tests, 0 failures, 172 expectations across 8 files.
- Surface boundary: `node script/check-surface-boundary.mjs` — PASS, 10 Surface modules; all four rules clean.
- Transaction boundary: `node script/check-transaction-boundary.mjs` — PASS, 31 contract modules.
- Host-port boundary: `node script/check-port-boundary.mjs` — PASS, 53 contract modules; session-resource scan clean across 773 Web modules.
- Type baseline: `node script/check-type-baseline.mjs` — PASS, 3 current diagnostics versus 13 at pin `cf5e79e9`, no diagnostic outside the pinned set.
- Distributable boundary: `node script/check-distributable-boundary.mjs` — PASS, 2,931 modules (630 Web / 15 example Host / 2,282 dependencies / 4 other), 10/10 exclusions.
- Strict Rasen validation: `rasen validate s0304-surface-mount-focus-lifecycle --strict --project rocut --json` — PASS, 1/1 item, zero issues.
- Browser evidence: audited final hash-bound Vite Surface 2/2, Next Surface 2/2 on owned `127.0.0.1:3017`, C4 Next 1/1, and final parity 1/1 per Host.

## Accepted-Known Evidence Reconciliation

`spec-falsification-sweep.md:55` is frozen stale prose at **25/16/9**. The authoritative final parity evidence is **28/19/9**: 19 T3 idempotency-envelope rows, including three `createdIds` ordinal-order rows, plus 9 established Host-incidental rows. This is non-blocking because the final generated report enumerates and bounds every row, but the reconciliation must remain explicit through archive.

## Deployment

Status: Not requested. No push, PR, publish, merge, or parent portfolio delivery was performed. Delivery remains deferred until all nine portfolio children complete.

## Pre-Archive Decision

- Timing: separate child archive stage.
- Status: Not archived in ship.
- The archive stage must preserve the explicit 28/19/9 reconciliation above.
