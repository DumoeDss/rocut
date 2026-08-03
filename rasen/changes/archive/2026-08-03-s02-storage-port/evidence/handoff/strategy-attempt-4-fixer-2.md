# Strategy attempt 4 — fixer 2 handoff

## Why this handoff exists

The fixer-1 successor turn hit an automatic context compaction immediately after its first bulk read. The `rasen-review-cycle` / `rasen-tdd` handoff trigger therefore fired before implementation began. This document intentionally stops the turn at that boundary so the next fixer can restart from complete, trustworthy instructions instead of relying on truncated context.

## Role and scope

- Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`
- Change artifacts: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut\rasen\changes\s02-storage-port`
- Authoritative implementation inputs after they are re-read completely:
  - `handoff/strategy-attempt-4-fixer-1.md`
  - `evidence/strategy-attempt-4-design.md`
- Implement only C5's centralized topology policy and the seams named by the attempt-4 design.
- Preserve the migrations subtree's additive/no-delete-preserved-data rules.
- Forbidden scope remains unchanged: no public `ProjectStore` changes, Host/session work, persisted v3 codec work, tasks/run-state changes, prior-review edits, or commit.
- Do not spawn subagents.

## Completed in this interrupted turn

- Announced use of `rasen-review-cycle` and `rasen-tdd`.
- Attempted one bulk read of all six required sources:
  1. `rasen-review-cycle/SKILL.md`
  2. `rasen-tdd/SKILL.md`
  3. worktree `AGENTS.md`
  4. migrations `AGENTS.md`
  5. `handoff/strategy-attempt-4-fixer-1.md`
  6. `evidence/strategy-attempt-4-design.md`
- The combined tool output was truncated and context compaction followed immediately. Treat none of those reads as complete. The next fixer must re-read every file in bounded chunks through EOF before taking task actions.
- The previous planner stage had already durably written and strictly validated `evidence/strategy-attempt-4-design.md` and `handoff/strategy-attempt-4-planner.md`.
- No product code, test code, implementation evidence, or implementation handoff was edited in this fixer turn.
- No RED, GREEN, browser, type-check, lint, formatting, baseline, boundary, or strict-validation command was run in this fixer turn.
- No process, database, OPFS state, or last-run artifact was created, so no cleanup was required.
- No commit was made.

## Carried-forward design anchors

These are only navigation aids from the already durable planner artifact; the next fixer must still use the full design document as authority.

- Add a centralized pure topology policy and wire every storage/migration destructive seam through it.
- Keep shared-database/different-store layouts legal only when the pair is not reserved.
- Reject protected whole-database deletion and cross-owner physical aliases before any mutation.
- Treat historical unsafe cascade and migration journals as fail-closed: retain them, perform no unsafe I/O, and do not claim convergence or same-ID reuse when it has not been proved.
- Preserve canonical stage self-cleanup only after proving that neither stage database aliases a protected namespace.
- Add the attempt-4 pure topology coverage and the 12 named round-2 result fields from the design, capturing a real failing RED before implementation.

## Eliminated hypotheses carried from the planner design

- Operation-local guards are not an adequate architecture: they drift and can miss retries, recovery, or less-obvious destructive paths.
- Store-scoped media clearing alone is insufficient because OPFS deletion, migration cleanup, and library/cascade maintenance can still damage aliased physical storage.
- A global durable topology registry is not the minimum correct change for this patch; a centralized pure policy evaluated at the existing seams is the selected design.
- No new implementation hypothesis was eliminated in this interrupted successor turn. Re-read fixer-1 and carry forward its own eliminated hypotheses verbatim or faithfully summarized in the next implementation handoff.

## Required continuation

1. Re-read both skill files, both applicable `AGENTS.md` files, fixer-1, and the attempt-4 design completely in bounded chunks. Do not rely on the truncated prior read.
2. Inspect `git status`, the worktree diff, and the relevant test/product files; preserve all unrelated/user changes.
3. Extract fixer-1's exact RED/GREEN requirements, prior failures, and eliminated hypotheses before editing.
4. Follow TDD: add the pure topology tests and all designed T1–T10/T1–T12 browser result fields first, then run and record a genuine RED.
5. Implement the centralized topology module and every product seam listed by the design, including cascade retry/recovery, media DB/OPFS deletion, library clear bindings, canonical naming, migration stage cleanup, and legacy cleanup.
6. Run and record GREEN evidence for focused unit tests and focused/full real-Chromium probes. Long browser commands must run in the background and be polled in the foreground at intervals no longer than 270 seconds.
7. Run the Vite TypeScript check, exact-three baseline, touched-file ESLint/Prettier, all four C5 boundary checks, worktree diff review, and strict Rasen validation.
8. Clean only disposable databases, OPFS roots, processes, and last-run artifacts created by this attempt. Do not remove preserved or user-owned data.
9. Write `evidence/strategy-attempt-4-implementation.md` and `handoff/strategy-attempt-4-implementation.md`, including commands, counts, RED/GREEN evidence, cleanup, open risks, and 1–3 durable findings.
10. Do not commit.

## Current risk

The only new risk is procedural: the previous bulk read was incomplete. Any implementation started without a complete re-read could violate the fixer-1 contract or the migrations subtree rules.
