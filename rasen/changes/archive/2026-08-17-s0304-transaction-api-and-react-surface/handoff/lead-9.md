# Handoff: s0304-transaction-api-and-react-surface — LEAD #9

## Original intent

User directive, carried from lead-4 through lead-8: drive the rocut `auto-decompose` portfolio to
completion. **Never create another worktree; serialize every rocut-mutating worker; children ship
local-only; never push a partial portfolio.** This session was authorised (explicitly, in-session)
to fix the T4 review findings and then commit + archive T4 locally.

## Position

- Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut` (the ONLY registered
  rocut worktree).
- Branch `recovery/s0304-ui-commit-routing-final`, HEAD **`e85cee6a`**. Seven commits local-only,
  **never pushed**: `05befb57`, `fd805714`, `8c8e5839` (R2), `b8decbeb`, `815b2cfc`,
  `253da781` (T4), `e85cee6a` (archive-aware evidence paths).
- Portfolio: **9 / 9 children archived.** T4 archived to
  `rasen/changes/archive/2026-08-13-s0304-agent-transaction-evidence` at **48 / 48 tasks**;
  `transaction-automation-api` synced 34 → 40 requirements.
- Working tree clean apart from `?? .rasen/` (run state, never committed).
- **Nothing is in flight. No worker was spawned this session** — the LEAD did all of it, so the
  serialization rule held trivially and the source freeze closed 31/31 unbroken.

## What this session did

Fixed all six independent-review findings on T4, re-ran the full browser cycle against the new
bytes (marker `t4-final-source-20260813-a`), and shipped + archived.

- **T1 (major)** — `deriveFailureCodes(report)` extracted and exported from `runner.ts`; the two
  tautological tests replaced with assertions through the shipped rule; a **live** control added
  for `zero-comparison` (a step-less scenario vector is recorded `passed` with 0 comparisons and
  the run still fails). **Mutation-measured**: with the three rules replaced by no-ops, exactly
  four tests fail and no others.
- **T2–T6** — all applied; disposition table is in the archived `implementation-report.md`.
- **A gate T4 had broken, found here, not by the review**: `check-storage-boundary` was green
  before T4 and red because of it (T4's `agent-evidence-run.ts` localStorage use). Closed with a
  separate `EVIDENCE_LOCALSTORAGE_FILES` classification — *not* by adding it to the UI-preference
  list, which would have been a false label. Exactness proven by mutation.
- Full browser leg re-run because `runner.ts` is in the emitted graph: Agent spec 1/1 per Host,
  R2 Surface matrix 2/2 per Host, full parity 1/1 per Host (**27 / 18 / 9**, all semantic rows
  inside the T3 idempotency envelope), c5-storage 5/5, distributable boundary 2,943 modules
  (unchanged, so the fixes added no module).

## Open items for the parent pass

Items 1 and 2 below — the hardcoded change-directory paths — **are fixed**, commit `e85cee6a`.
Items 3 and 4 remain and need an owner, not another note.

### FIXED in `e85cee6a` — change-evidence paths are resolved, not frozen

Six sites across five files hardcoded `rasen/changes/<change>/evidence/`, a path that only
exists while the change is active. New `apps/vite-example/tests/parity/evidence-path.ts`
resolves the destination: active change → its own evidence directory (unchanged); archived →
`tests/parity-artifacts/regression/<change>/`, because a run after the ship is a regression
check, not new evidence for a closed change. Activeness is decided by the `.openspec.yaml`
manifest, so a directory the resolver created cannot later pass as a live change.
`check-agent-evidence.mjs` prefers the active change, falls back to the newest
`archive/*-<change>`, and prints which it read.

Verified: all three resolver branches; the gate green off the archive **and** still red when
evidence is genuinely absent; both specs re-run on both Hosts, writing to the regression path,
with no change directory resurrected and the committed archives untouched. The superseded
`rasen/changes/s0304-surface-css-react-a11y/` litter was removed after confirming all 22 of its
files exist in the committed archive and none was tracked.

Note for anyone auditing: the archived source manifests still list the pre-fix bytes of
`agent.pw.ts`, `playwright.surface.config.ts`, `surface.pw.ts` and `check-agent-evidence.mjs`.
That is correct — they record the bytes that produced the artifacts, which is a historical
claim and remains true. They are not a "HEAD must match" gate.

### STILL OPEN — two unowned red checkers

3. **`check-editor-singleton.mjs`** — `command-module-count:40/39`, pre-existing, also red when
   R2 shipped. Untouched by R2 and T4. Bumping the constant means vouching for a command module
   neither wrote. **Still needs an owner.**
4. **`check-session-state-boundary.mjs`** — 13 unclassified module-level mutable singletons.
   **Eleven are in six files T4 did not write**; two are T4's `TICK_FIELDS`/`REQUIREMENTS` in
   `loader.ts`, the same shape as the pre-existing `PROJECT_PATCH_KEYS` rows. Removing T4's two
   would leave it red at 11 and cost a rebuild of both Hosts (`loader.ts` is in the emitted
   graph). Needs the same owner as #3.

## Also on the record

- **This session's delta was not independently reviewed.** The prior review covered the 08-12
  bytes; the T1 fix, the five minor fixes and the storage-boundary classification were authored
  and verified by one actor. Recorded in the ship log under "Review". If the parent pass wants
  the author≠verifier property to hold end to end, this delta is the gap.
- **One unexplained Surface-matrix failure on the Next Host** (1 in 6 runs). Error context was
  destroyed by Playwright's output cleaning before it was read, and it did not reproduce — not
  even under a fresh rebuild followed immediately by a run, which was the original condition. The
  spec observes none of the attributes T4 changed. Recorded as a flake with no diagnosis.
- **The agent screenshots are not evidence.** `01-agent-apply.png` and `02-agent-reopen.png` are
  byte-identical within each Host and show only harness chrome; task 6.3 deliberately routes the
  ledger to a `data-testid` element instead. They are run receipts.
- **Task 8.7's regeneration absorbed 95 entries of drift left by earlier changes** that never
  regenerated the inventory; only 26 of the 121 newly-listed entries are T4's. The attribution
  table is in the ship log so the diff is not misread as T4's footprint.

## Gotchas confirmed or added this session

- **EOL corruption is real and hit once.** Editing `script/check-storage-boundary.mjs` flipped it
  to CRLF (563 pairs). Caught by `git ls-files --eol` before commit and normalised. **Run
  `git ls-files --eol $(git diff --name-only)` after every edit batch.**
- **`rasen archive` refuses a change-authored `## Archive` heading** — that heading is reserved;
  the archive transaction appends its own. My ship log had one and the first `--yes` was blocked.
- **The archive preview reports `specSync.mode: "no-deltas"` and `specActions: []` even when it
  will sync.** It synced 6 requirements correctly. Do not read the preview as "nothing will
  change" — verify by counting `^### Requirement` in the main spec before and after.
- **`rasen archive` removed the source dir cleanly** on Windows this time (no EPERM).
- **No git hooks exist in rocut** (`.husky` absent, no `lint-staged`). `--no-verify` is a no-op
  here; don't bother passing it.
- Timings on this machine: Vite build ~45 s, Next build ~40 s, agent spec ~10 s/Host, Surface
  matrix ~25 s/Host, full parity ~45 s/Host, c5-storage ~60 s. The whole browser cycle is well
  under 15 minutes — cheaper than lead-8 implied.
- `.rasen/` is still NOT gitignored. Stage with explicit pathspecs; verify
  `git diff --cached --name-only | grep -c '^\.rasen/'` is 0 before every commit.

## Next action

**Parent portfolio delivery, and it is USER-GATED.** Reconcile the product line and the archive
spine, then one user-approved push. Never push a partial portfolio — and it is only "complete" at
the child level; the four open items above are unresolved. Recommended order:

1. User decides whether the two remaining red checkers (#3, #4) block delivery or ship as
   recorded debt. Both need an owner naming the correct constants; neither is T4's or R2's.
2. Reconcile product line + archive spine, then one push.

**Generation note:** LEAD generation 9. Supersedes lead-8 for current state. lead-8's remaining
list is fully discharged.
