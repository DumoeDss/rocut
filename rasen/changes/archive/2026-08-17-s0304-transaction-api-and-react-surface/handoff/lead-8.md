# Handoff: s0304-transaction-api-and-react-surface — LEAD #8

## Original intent

User directive, carried from lead-4 through lead-7: continue the rocut `auto-decompose`
portfolio to completion. **All workers Claude Code Opus, 250k context, never Codex; never
create another worktree; serialize every rocut-mutating worker; children ship local-only;
never push a partial portfolio.** This session was authorised to ship+archive R2, then run T4,
then stop before any parent-level delivery.

## Position

- Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut` (the ONLY registered
  rocut worktree — do not create another).
- Branch `recovery/s0304-ui-commit-routing-final`, HEAD `8c8e5839` (R2 archive commit). Three
  R2 commits local-only, never pushed: `05befb57` (feat), `fd805714` (ship log),
  `8c8e5839` (archive + spec sync).
- Portfolio `s0304-transaction-api-and-react-surface`: **8 / 9 children archived.** Only
  **T4 `s0304-agent-transaction-evidence`** remains.
- T4 state: **implemented, browser-evidence green, independently reviewed → PASS WITH FINDINGS.**
  ONE MAJOR (T1) must be fixed before ship. 47/48 tasks ticked; 8.7 deferred (regenerate
  source inventory after the ship commit). Nothing committed for T4.
- All three background agents (reviewer, planner, implementer) were **stopped by the user** at
  end of session. No worker is in flight.

## Done / Remaining

**Done this session:**
- R2 `s0304-surface-css-react-a11y`: shipped + archived after 3-round independent review
  (FAIL → PASS WITH FINDINGS → PASS). Spec synced; `embeddable-react-surface` now 23 reqs.
- T4 `s0304-agent-transaction-evidence`: planned (6 req / 27 scenarios / 48 tasks, strict-valid),
  both LEAD open questions ruled (no Drafts; no export path — see design.md), implemented by a
  worker, browser leg run by LEAD on both Hosts, independently reviewed.
- `lead-7.md` written (supersedes lead-6's stale/misattributed rocut state).

**Remaining (T4 — in order):**
1. **Fix review finding T1 (the only major).** See "Next action" — it is ~30 lines of additive
   test coverage. Until it is fixed, T4's "not vacuous" argument rests on three failure codes
   that have zero test coverage and two tautological tests.
2. **Address the four minors (T2–T5) and one trivial (T6)** if cheap; or record them as
   accepted-known. T3 (throw on unknown `PARITY_SPEC`) is the one I'd not skip — T4 set that
   standard in its own checkers and then didn't apply it to the config it edited.
3. Re-run vector suites + the touched checkers after T1; re-freeze source manifest; re-run any
   gate whose bytes changed.
4. Ship T4 local-only (explicit `git add`; never `git add -A` from repo root — `.rasen/` is
   NOT gitignored and would sweep ~87 run-state files). Write ship log. Archive with `--yes`
   (47/48). **8.7: regenerate `SOURCE_INVENTORY.{md,json}` AFTER the commit** (generator sees
   tracked files only).
5. **Then 9/9.** Parent portfolio delivery is USER-GATED (see below).

## The one blocker — review finding T1, in full

The reviewer (PASS WITH FINDINGS) found that three runner failure codes the implementation
report cites as anti-vacuity evidence have **no test coverage at all**:

| code | defined | any test references it? |
| --- | --- | --- |
| `zero-comparison` | `apps/web/src/editor/contracts/vectors/runner.ts:683` | **no** |
| `count-drift` | `runner.ts:686` | **no** |
| `false-skip` | `runner.ts:679` | **no** |

The two tests that *appear* to cover the first two
(`apps/web/src/editor/contracts/vectors/__tests__/runner.test.ts:173-180` and `:189-194`) are
**arithmetic tautologies on object literals the test just wrote** (`expect(0 > 0).toBe(false)`,
`expect(n-1).not.toBe(n)`) — neither calls `runTransactionVectors`, neither touches
`failureCodes`, and **both would pass if those runner lines were deleted**. `false-skip` is
not even disclosed in the report.

**The fix (strictly additive, no gate weakening):**
- Export the rule evaluation the runner already performs as a pure function, e.g.
  `deriveFailureCodes(report): readonly string[]`, called from `runner.ts:685-690`.
- In `runner.test.ts`, feed the `zeroed` and `drifted` reports to it and assert
  `toContain("zero-comparison")` / `toContain("count-drift")`.
- For `false-skip`: add a stub target to `mutation-targets.ts` that advertises a capability and
  then skips a vector requiring it; assert the code on a live report.
- Then **correct the implementation report's "Why this evidence is not vacuous"** to match what
  is actually tested, and strike `false-skip` from the argued-without-testing list.

The reviewer's alternative (strike all three from the argument, record as
defined-but-unexercised) materially weakens the section; do the additive fix instead.

## Minors from review (address or record; do not silently ignore)

- **T2** — `mutation-matrix.test.ts:145` uses `toBe(5)` for the placement wrapper's expected set
  while the other five use `toBeGreaterThan(0)`. The report claims every set is derived; for
  placement a later vector makes the test *fail* rather than join. Reword the claim for that case
  or use `toBeGreaterThan(0)`.
- **T3** — `apps/vite-example/playwright.surface.config.ts:8-13`: an unrecognised `PARITY_SPEC`
  silently becomes `"surface"`. A typo'd `PARITY_SPEC=agnet` would run the R2 Surface matrix and
  overwrite R2's evidence. T4 set the higher standard in its own checkers (exit 2 on unknown
  flag) and then didn't apply it to the config it edited. **Throw on unrecognised `PARITY_SPEC`**,
  matching the existing `spec === "c4-next" && host !== "next"` throw two lines below.
- **T4 (finding)** — `surface-evidence-harness.tsx:662-663`: `data-scenario`/`data-phase` prove
  the agent path ran but are defaults on the surface path. Not vacuous today; add a comment or
  publish `reported` from the surface branch too.
- **T5** — "87 assertions, matching the Node drivers exactly" is **unasserted**. The browser
  side verifies it internally; no gate compares Host-to-Node. Pin the total in
  `agent-drivers.test.ts` or have the checker compare against a committed Node-driver ledger.
- **T6 (trivial)** — the re-frozen manifest silently changed meaning (now describes bytes as of
  re-freeze, not "the source that produced the artifacts"). One-line header note, or keep the
  22:53 copy alongside.

## Two things on the record, not buried

**Process incident — a source edit landed mid-frozen-cycle.** LEAD froze the source manifest at
22:53:01 and started the browser cycle; the implementer then edited
`script/check-agent-evidence.mjs` at 22:56:41 (adding `--converse-control`), breaking hash
equality at 30/31. Cause is shared: the LEAD offered optional work and began a frozen cycle
without telling the implementer to hold; the implementer saw browser artifacts appearing on disk
(direct evidence a cycle was running) and edited anyway. The browser artifacts stand — everything
that produced them predates the freeze by 20+ minutes, and the changed file is a checker in no
bundle. LEAD re-frozen and re-ran every gate against final bytes (31/31) rather than quietly
re-hashing. Recorded in `evidence/implementation-report.md`. **The serialization rule is the
LEAD's to enforce; during a final-source cycle the only mutating worker is the LEAD.**

**Pre-existing red gate, in nobody's set.** `node script/check-editor-singleton.mjs` fails
`command-module-count:40/39` at HEAD — `EXPECTED_COMMAND_MODULES = 39` while 40 modules under
`apps/web/src/commands` extend `Command`. Untouched by T4 *and* by R2; R2's gate list never
included it, so it was already red when R2 shipped. Do NOT bump the constant in T4 (that would
mean vouching for a command module T4 didn't write). It needs an owner, not another note.

## Key decisions (and why)

- **Independent non-author review before ship.** Chosen by the user over self-review when asked.
  Earned its cost on both R2 (found a runtime blocker + two false central claims) and T4 (found
  T1). Keep using it.
- **No Drafts in T4's Agent scenario** (LEAD ruling, design.md). Draft semantics are T2's.
- **No package export path in T4** (LEAD ruling, design.md). "Published" = committed, versioned,
  digest-manifested, consumable from a checkout. The planner cited "Slice §5" for the exclusion;
  **that document is not reachable from the rocut worktree, so the citation is unverified** — the
  ruling rests on the scope argument.
- **R2's parity argument is movement, not equality.** The semantic total ran 20,19,20,19 across
  pairings with no source change; the same-host control produced 18/18/0. Do not argue from
  equality with R1's 28/19/9 — that is a coincidence. See archived R2's
  `parity-nondeterminism-control.md`.
- **`useLayoutEffect` in `SurfaceDragProvider` is spec-driven, not failure-driven** — retained
  because the spec requires synchronous listener removal on unmount; no observed run produced the
  stale delivery. Do not "simplify" it back.

## Dead ends & gotchas

- **Playwright `locator.click()` emits a real bubbling `mouseup`** that finishes a live mouse
  drag *before* React sees the click. If you need to act without mouse events (e.g. unmount a
  Surface mid-drag), use `HTMLElement.click()` which dispatches only `click`. Cost R2 three
  cycles to diagnose.
- **EOL corruption recurs.** Editing tooling rewrites whole files LF→CRLF. After every batch:
  `git ls-files --eol $(git diff --name-only) | grep -v "i/lf    w/lf"`. Only `number-field.tsx`
  and `tooltip.tsx` are legitimately CRLF at HEAD.
- **`.rasen/` is NOT gitignored.** `git add -A` from the repo root sweeps ~87 run-state files.
  Stage explicitly: `git add -- apps script .gitignore bun.lock package.json` + `git add -f` the
  change dir (it's in `.git/info/exclude`).
- **`rasen archive` does NOT self-commit** and on Windows previously hit EPERM removing the
  source dir; this session it removed cleanly. Do a pathspec commit after.
- **`rasen validate` JSON has no top-level `valid`** — read `items[0].valid` / `.issues`.
- **Two sessions in one worktree is a hazard.** A concurrent session wrote `lead-6.md` mid-R2
  and misattributed three of this session's edits. Nothing was clobbered (hash chain held), but
  treat concurrent sessions as a real risk around staging/commits.
- **`bun install` ≈ 95 min** on this machine. Never system bun 1.2.2 (hangs behind proxy).
  `npx --yes bun@1.2.18` for everything.
- **`check-editor-singleton.mjs` is red at HEAD** (40/39) — see above; pre-existing, unowned.

## Eliminated hypotheses

- "T4's agent runner could run through the headless entry" — ruled out: `headless-editing` spec
  forbids exposing any transaction/revision/idempotency API on the headless surface.
- "The planner's no-Host-file-change claim needed verifying" — confirmed true by `git diff`; the
  harness-parameter approach compiled and held with no Host page / composition-root / Vite-entry
  change.

## Working set

- T4 planning: `rasen/changes/s0304-agent-transaction-evidence/{proposal,design,tasks}.md`,
  `specs/transaction-automation-api/spec.md`. LEAD rulings in design.md.
- T4 implementation (uncommitted, 3 modified + 5 untracked under apps/ and script/):
  `apps/web/src/editor/contracts/vectors/**` (corpus, loader, runner, coverage, drivers, tests),
  `apps/web/src/editor/surface/evidence/{agent-evidence-run.ts,surface-evidence-harness.tsx}`,
  `apps/vite-example/tests/parity/agent.pw.ts`, `apps/vite-example/playwright.surface.config.ts`,
  `script/{check-agent-evidence,check-transaction-boundary,generate-vector-manifest}.mjs`.
- T4 evidence: `rasen/changes/s0304-agent-transaction-evidence/evidence/`
  (`implementation-report.md`, `pre-browser-source-hashes.sha256`, `browser-agent/{vite,next}/`).
- Run-state: `.rasen/changes/s0304-agent-transaction-evidence/ephemera/auto-run.json`.
- Reviewer's full T4 findings are in the conversation, not on disk — the T1 fix spec above is the
  authoritative record.
- `lead-7.md` carries the R2 lessons; this document supersedes both lead-6 and lead-7 for
  current state.

## Next action

1. **Spawn (or hand to) an implementer to fix review T1**: export
   `deriveFailureCodes(report)` from `runner.ts:685-690`, assert `zero-comparison`/`count-drift`
   on the constructed reports, add a `false-skip` stub target + live assertion, and correct the
   implementation report's not-vacuous section. ~30 lines additive.
2. While there, apply T3 (throw on unknown `PARITY_SPEC`) and T2/T5 if cheap.
3. Re-run `bun test apps/web/src/editor/contracts/vectors` and the touched checkers; re-freeze
   the manifest if runner.ts bytes changed; re-run the affected gate.
4. Ship T4 local-only, write ship log, archive (`--yes`, 47/48), regenerate source inventory
   (8.7) after commit. **Then 9/9.**
5. **Stop.** Parent portfolio delivery (reconcile product line + archive spine, one user-approved
   push) is the user's decision, not the LEAD's. Never push a partial portfolio.

**Generation note:** LEAD generation 8. Supersedes lead-6 and lead-7 for current state.
Generation has exceeded the auto-relay cap — resume manually: fresh session, then
`rasen pipeline resume s0304-agent-transaction-evidence --project rocut --json`, read THIS
document first.
