# Review Cycle: s0304-ui-commit-routing

Rounds: 1/3   Tier: A   Status: CLEAN

| Round | Findings (B/Ma/Mi/T) | Triage | Fixed by | Confirmed by | Resolved |
|-------|----------------------|--------|----------|--------------|----------|
| 1 | 5/2/1/0 | all implementation-sized | `/root/t3_fixer_recovery` | independent Codex-native Round-1 delta re-review | 8/8 confirmed resolved |

## Round 1 fixes

- F1: UI candidates merge the adapter's committed asset catalog with attachment-backed live assets, preserving automation-only assets through UI save/reopen.
- F2: media removal now removes the attachment before the one routed project-record commit and restores the attachment when that commit fails; no referenced clips, catalog entry, or revision are published on either failure path.
- F3: projection emits clip moves/updates before parent track or asset deletion.
- F4: detached nested execution rejects non-transaction commands before invoking them.
- F5: split and duplicate APIs resolve command-produced references after durable execution; ripple split-left retains and seeks the right segment only after that result.
- F6: undo/redo rebase the entry-owned donor delta onto the current committed donor candidate, retaining later disjoint automation state.
- F7: provider-private composites keep multi-keyframe actions as one history entry and one undo/redo gesture.
- F8: removed the three exact Markdown trailing spaces and the terminal blank line named by the review.

## Regression evidence

The focused transaction/command/session suite passed: 38 tests, 237 expectations.

```text
bun test apps/web/src/core/managers/__tests__/transaction-command-routing.test.ts apps/web/src/core/managers/__tests__/transaction-persistence-coordination.test.ts apps/web/src/editor/transactions/opencut/__tests__/adapter-router.test.ts apps/web/src/editor/transactions/opencut/__tests__/routing-registry.test.ts apps/web/src/editor/session/__tests__/session-runtime-ownership.test.tsx apps/web/src/editor/session/__tests__/session-state-isolation.test.ts
```

Changed-file ESLint, type baseline (3 diagnostics, within ceiling), transaction boundary, and boundary negative control passed. `rasen validate s0304-ui-commit-routing --strict --project rocut --json` passed. The Vite production build passed. The Next build compiled but stopped at page-data collection because required build-time environment variables are unset (`NEXT_PUBLIC_MARBLE_API_URL`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, and service credentials).

`git diff --check` for the live delta passed. `git diff 4b7af6f224519d4c9f0d3f387faa7f8f79707af8 --check` remains blocked by pre-existing CRLF whitespace throughout unrelated archived artifacts already present in that baseline range; the two F8 paths are clean.

The evidence commands ran against HEAD commit `0f9b4ff5ef0c8e0a04522ce4369f47511a14dc47`, tree `9e2c8e08365bfb576c546bf5e0021b7642369442`, plus the uncommitted round-1 delta.

## Independent confirmation and final status

The non-author Round-1 delta re-review confirmed all five Blockers, two Majors, and the Minor as resolved. No accepted-known Minor/Trivial items remain.

- Re-review evidence: `evidence/review-report.md` — “Round-1 Delta Re-review — 2026-08-10”.
- Final focused gate: 22 tests / 177 expectations PASS; changed-file ESLint, type baseline (3), boundary + negative control, strict `rasen validate --project rocut`, and exact live-delta whitespace check PASS.
- Fingerprint: HEAD tree `9e2c8e08365bfb576c546bf5e0021b7642369442`; live product-delta SHA-256 `fe3ef159278fdeff901a83913485d4b08a07f04365f3a0127afbb95abd539882` (includes untracked `provider-private-composite.ts` and `history-rebase.ts`).
