# Ship Log: s05-package-extraction

**Date:** 2026-08-14
**Mode:** local
**Branch:** feat/s05-community-beta
**Commit:** e2169f813d0f22f76dc6417ca16971ad25fa43d4 (pre-ship-log HEAD; this ship adds one further commit for this file)
**Tree:** b0a643d3b103d4d4c63b0039103cca140be0ddb7 (pre-ship-log HEAD tree)
**Status:** Committed (delivery deferred to portfolio level)

## Delivery mode and why

`local`. This is child P1 of a 7-child decomposed portfolio for Slice
`05-community-beta-second-host` (workstream `opencut-agent-editor-sdk`). Per
the portfolio's decomposition contract, children P0-P7 accumulate commits on
the shared branch `feat/s05-community-beta` and the portfolio delivers once,
as a single PR, after every child completes. Pushing or opening a PR from
this child individually would fragment that delivery, so this ship commits
locally only. No `git push`, no `gh pr create`, no `rasen archive` was run.

## Scope shipped

36 commits since the P0 boundary-freeze pin `8437084b` (`git rev-list --count
8437084b..HEAD` = 36, re-verified at ship time), spanning the package
extraction described in `rasen/changes/s05-package-extraction/{proposal.md,
design.md,tasks.md}` and its two delta specs
(`specs/sdk-package-boundary/spec.md`, `specs/sdk-package-extraction/spec.md`).
`tasks.md` groups 10.1-10.5: 57/57 tasks `[x]` (`grep -c '\[x\]'` = 57,
`grep -c '\[ \]'` = 0, re-checked at ship time).

## Pre-Flight Results

- Verification: `rasen/changes/s05-package-extraction/evidence/review-report.md`
  present — two rounds. Round 1 (delta `8437084b..af0a52ba`, 21 commits): 0
  Blockers, 2 Majors, 4 Minors, 2 Trivials. Round 2 re-review (delta
  `af0a52ba..1e5a337c`, 9 commits): clean — 0 open Blockers, 0 open Majors;
  4 new Minor/Trivial findings (N-1..N-4), all explicitly accepted-known at
  that report's own ship recommendation.
- Tasks: 57/57 complete.
- **Nuance not in the review report itself**: 6 further commits landed after
  `1e5a337c` (the round-2 tip) and before this ship, at HEAD `e2169f81`. Three
  of those commits (`823522be`, a second commit for N-2, and `f507ac56`) turn
  out to fix three of the four round-2 accepted-known items (N-1, N-2, N-3)
  even though review had already blessed shipping with them open. N-4 (the c5
  file having 10 tests instead of the reviewer's stated 9 — a description
  miscount, not a defect) remains as originally found. So "0 open
  Blockers/Majors" technically describes tree state at `1e5a337c`, not
  literally current HEAD — but current HEAD is strictly ahead of that
  clearance, not behind it or divergent from it. Re-verified below.

## Re-measured verification (independent re-run, not copied from brief/report)

**Boundary checker**, `node script/check-package-boundary.mjs`, plain run at
HEAD:
```
PASS acyclic-direction (964 files, 329 edges)
PASS public-entry-only (964 files, 328 specifiers)
PASS no-internal-reexport (863 files)
PASS no-elftia-import (1048 files)
PASS react-free-base (68 files)
```
Exit 0, "clean". Matches brief exactly.

**Negative control** (`--negative-control`): 14/14 PASS, exit 0. Matches
review-report.md's corrected count (round 1 MINOR-1 flagged the report's
stale "15/15" claim against an actual 14/14; 14/14 is confirmed live and is
the correct figure).

**Converse control** (`--converse-control`): 12/12 PASS, exit 0.

**`rasen validate s05-package-extraction --strict --project rocut --json`**:
`valid: true`, 0 issues, 1/1 passed.

**Rule-activation, P0 baseline vs P1 now — CORRECTED.** An earlier draft of
this section claimed P0's baseline was vacuous across all five rules. That
was wrong and has been replaced after checking P0's own archived evidence
directly (`rasen/changes/archive/2026-08-13-s05-package-boundary-freeze/
evidence/{normal-run.md,ship-log.md}`, both recorded at commit `8437084b` —
P0's final ship commit and the exact pin this child started from, so this is
the true starting baseline, not a stale intermediate one). P0's re-measured,
committed baseline was:
```
PASS  acyclic-direction     949 files scanned, 341 cross-package edges examined
PASS  public-entry-only     949 files scanned, 0 @opencut/* specifiers examined
....  no-internal-reexport  0 files scanned (packages/ holds no source yet)
PASS  no-elftia-import      1031 files scanned
PASS  react-free-base       68 files scanned
```
This is two distinct achievements, not one:

1. **Two rules went from genuinely vacuous to substantive.**
   `no-internal-reexport`: P0's scan set itself was empty (0 files — `packages/`
   held no source at all) → P1 now scans 863 files, dormant marker gone.
   `public-entry-only`: P0's file-scan already covered real source (949 files,
   widened during P0's own round-1 review fix for BLOCKER-1) but its
   *substantive* count — `@opencut/*` specifiers actually crossing into a
   package — was 0, because no package existed yet to import from. P0's own
   ship-log states this outright: "public-entry-only currently PASSes
   trivially... P1 writes the tree's first such specifiers, which is where
   this rule stops being vacuous." P1 now: 964 files scanned, **328
   specifiers examined** — the rule's core assertion has real work to check
   for the first time.

2. **Three rules were already substantively live at P0 and had to be
   preserved through a move that could otherwise have silently blinded them.**
   `acyclic-direction`: 949 files/341 edges → 964 files/329 edges.
   `no-elftia-import`: 1031 files → 1048 files. `react-free-base`: 68 files →
   68 files (unchanged count, same significance — the files it governs did
   not move). Left with an unwidened scope, these three would have kept
   scanning the pre-move `apps/web/src` tree after ~863 files moved out of
   it: `acyclic-direction` and `no-elftia-import` fail open (an emptied scan
   set still prints PASS, silently proving nothing), `react-free-base` fails
   closed (would have exited 2 against files that had simply moved, not
   files that violate anything). Holding real, non-collapsed counts across
   the move (964/329, 1048, 68) is the evidence the widening actually
   followed the source, not a rounding artifact.

| Rule | P0 baseline (commit `8437084b`) | P1 now (HEAD `bad9ce3b`) |
|---|---|---|
| acyclic-direction | 949 files, 341 edges (live) | 964 files, 329 edges (live) |
| public-entry-only | 949 files scanned, 0 specifiers (vacuous assertion) | 964 files, 328 specifiers (now live) |
| no-internal-reexport | 0 files scanned (vacuous) | 863 files (now live) |
| no-elftia-import | 1031 files (live) | 1048 files (live) |
| react-free-base | 68 files (live) | 68 files (live) |

**Edge-census as-of note.** 329 edges / 964 files is the figure this
correction independently re-ran live just now (`node script/check-package-
boundary.mjs` at HEAD `bad9ce3b`, 2026-08-14) — it also matches what
review-report.md records. An earlier in-progress task-time checkpoint
(`tasks.md` lines 340, 712, 723, 733, 760) recorded **962** files at the same
329-edge count; two further files entered the scan between that
mid-implementation checkpoint and current HEAD (later review-fix commits
adding files, not a discrepancy in measurement method). Unless stated
otherwise, every figure in this ship log is the live, current-HEAD figure,
not the task-time checkpoint.

**Frozen S03+S04 signature spot-check** (3 of the tracked files, content-diff
against pre-move commit `8437084b`): transaction contract barrel —
byte-identical (`diff` exit 0, confirming re-homing did not touch the public
signature); ports barrel — 7 changed lines (path/import updates, not
signature changes per task-log annotation); `engine.ts` — 4 changed lines.
All three match the reviewer's independently-derived figures exactly.

**Parity fixture**, `node script/diff-parity-snapshots.mjs` against
`evidence/premove-baseline/snapshot-vite.json` and `snapshot-next.json`:
```
29 difference(s): 20 semantic, 9 incidental. 275 leaf values compared.
```
All 20 "semantic" rows are `project.__opencutTransaction.idempotency[*]`
paths — i.e. every one of them falls inside the documented idempotency
envelope from spec §3.2 (UUID/ordering fields expected to vary run-to-run,
not true behavioural drift). Zero semantic diffs exist outside that envelope,
which is what §3.2 actually requires ("zero semantic rows outside the
already-documented idempotency envelope").

**Test suite** — `bun test` at HEAD, three independent runs:
- Run 1 (plain console reporter, cold start): 658 pass / 10 fail / 3 errors,
  3082 `expect()` calls, 668 tests, 110 files [60.47s]. Matches the brief.
- Run 2 (`--reporter=junit`, run immediately back-to-back after run 1, no
  pause): 655 pass / 13 fail / 6 errors [170.11s]; JUnit XML:
  `tests="665" failures="10"`. This **differs** from run 1 and from the
  brief. Flagging per instruction rather than silently reconciling.
- Run 3 (`--reporter=junit`, isolated — run after letting the machine settle,
  not immediately chained after another heavy `bun test`): 658 pass / 10 fail
  / 3 errors [100.98s]; JUnit XML: `tests="665" failures="7"`. This matches
  review-report.md's own authoritative decomposition ("665 cases, 7 HEAD
  failures") exactly.
- **Conclusion**: 2 of 3 independent runs (1 and 3) match the canonical
  figures exactly. The anomalous middle run is attributable to resource
  contention from launching two heavy `bun test` invocations back-to-back on
  this machine (run 2 took 170s vs run 1/3's 60-100s, with `c6-session-
  resource-boundary` alone taking 128.9s in that run) — not a new defect.
  This is the same *class* of timing-sensitive flakiness review-report.md's
  MINOR-3 already discloses and accepts by name (`editor singleton boundary`,
  `resolveTrackPlacement`, C5 dot-segment tests named as having genuine
  run-to-run instability under load). Treating this ship's anomalous run as
  a member of that same accepted class, not a new blocker — but recording it
  here rather than silently discarding the inconvenient data point.
- Pre-move baseline (read from committed evidence, not re-run — the pre-move
  tree no longer exists to re-run against): 649 pass / 19 fail / 5 errors,
  3039 `expect()` calls, 668 tests, 110 files [90.68s],
  `evidence/premove-baseline/bun-test-full-premove.log`.
- Net effect of the extraction on test outcomes: pass count 649→658 (+9),
  fail 19→10 (-9), errors 5→3 (-2), same total test count (668) and file
  count (110) both before and after — consistent with a refactor that moved
  code without adding or deleting test coverage, and fixed rather than broke
  tests along the way.

**Lint debt** (re-measured live, not copied from commit message):
`bun run lint:web` → `eslint apps/web/src packages/editor-classic/src
packages/editor-contracts/src packages/editor-ports/src --ext .ts,.tsx`:
```
✖ 276 problems (255 errors, 21 warnings)
```
Exit 1 (script exits non-zero because of ESLint's own error-count exit
convention, not a tooling failure). This matches commit `823522be`'s
self-reported "255 errors / 21 warnings" exactly. Predominant rule families
in the tail of the output: `@typescript-eslint/no-unsafe-type-assertion` and
`opencut/prefer-object-params`, concentrated in `editor-contracts/src`
(draft/, engine/, in-memory/) and `editor-ports/src`. This lint debt is
**pre-existing** — `823522be`'s own commit message states it is carried
forward from before the package move and was deliberately not remediated in
this round ("out of this round's scope"). Not a ship blocker; flagged below
as a durable finding for a later child to triage.

**Spec-falsification sweep** (independently read the full 301-line spec.md
from `dev/0.2.7:rasen/work/opencut-agent-editor-sdk/slices/05-community-
beta-second-host/spec.md` in the main elftia repo, cross-checked against
`tasks.md` and `review-report.md` section 6, group by group):
- §3.1 (package boundaries declared/frozen/enforced) — **directly advanced**,
  non-vacuous per the rule-activation table above.
- §3.2 (both Hosts consume packages, parity oracle) — **directly advanced**,
  this is P1's chief target; parity 29/20/9/275 confirms zero out-of-envelope
  semantic drift.
- §3.3 (second non-Elftia Host runs scenarios) — **untouched by P1**, belongs
  to P2.
- §3.4 (Elftia-absence enforced by mechanism) — **incidental, not claimed by
  P1**: satisfied only as a side effect of the `no-elftia-import` rule P0
  already wired into the checker; P1 did not set out to prove this and its
  1048-file pass count is a byproduct of extraction, not a feature P1 built.
  Matches review-report.md section 6's own characterization.
- §3.5 (third-party conformance) — **untouched by P1**, belongs to P3.
- §3.6 (0.x versioning/experimental labeling) — **untouched by P1**, belongs
  to P5.
- §3.7 (published examples) — **untouched by P1**, belongs to P6.
- §3.8 (legal/provenance closure) — **untouched by P1**, belongs to P7.
- §3.9 (inherited-input closure: both Hosts stay green, frozen contracts not
  redefined, `apps/desktop` stays excluded) — **incidental, not a P1
  feature**: satisfied as a side effect of the frozen-signature discipline
  (spot-checked above) and of P0's `no-desktop-app` rule surviving untouched
  in the checker (P1 did not modify that rule). No independent P1 evidence
  beyond what's already reused from P0's rule set.
- This sweep found no place where task descriptions or the review report
  overstate what P1 actually proves against §3 — the "incidental, not
  claimed" framing for §3.4/§3.9 in review-report.md section 6 holds up
  against a fresh, independent read of the spec text itself.

## The Blocker (full story)

Round 1 review's MAJOR-1: `apps/vite-example/vite.headless.config.ts` lines
8, 47, 50 injected a headless React control via a `find`-based path match
against the pre-extraction source layout. After the package move, the
directory the `find` targeted no longer existed at that path — the config
silently matched nothing (no error, no thrown exception; the `find` simply
returned an empty result and the injection became a no-op), so the Vite Host
build was **not exercising the headless C7 control it claimed to** — a false
"green" that would have shipped a claim the tree could not back up.
Companion MAJOR-2: `apps/vite-example/tests/probe/legacy-migration.pw.ts`
lines 47-50 resolved a path that the extraction had deleted outright,
meaning that probe would fail (or silently skip, depending on harness
behavior) rather than actually re-running the migration probe against the
new layout.

Both were fixed between round 1 and round 2 (delta `af0a52ba..1e5a337c`).
Round 2 re-verified the fix was genuine, not cosmetic, by diffing actual
config output: 37 substantive Vite-side fields differ from the broken state
and 24 Next-side fields differ, proving the injection now actually matches
real paths and produces real effect rather than continuing to silently
no-op against updated-but-still-wrong path strings. This ship independently
re-confirmed via the boundary-checker and parity re-runs above that current
HEAD carries the fix (parity's 275-leaf-value comparison includes both Host
snapshots, and a still-broken headless injection would show up as a
collapsed/empty Vite snapshot rather than the observed 29-diff comparison
against a full 275-value set).

## Accepted-known items at ship (not blockers)

- **N-1** (Minor, review round 2) — `package.json` `format:web`/`lint:web`
  scripts pointed into an emptied tree after the move (silent 93% coverage
  loss: only the four packages'-worth of source was still being linted/
  formatted while the tool reported success on nothing). **Fixed** at
  `823522be` — re-verified live above (921-file-scale lint run genuinely
  executes and reports 255/21, not a silently-empty pass).
- **N-2** (Minor, review round 2) — pre-move baseline restore artifacts
  crashed against the documented restore command due to a filename regex
  mismatch. **Fixed** — the parity fixture run above used the exact
  documented filenames (`snapshot-vite.json`, `snapshot-next.json`) and
  succeeded without incident.
- **N-3** (Trivial, review round 2) — the round-1 C7 fix rested on an
  unpinned `import type`. **Fixed** at `f507ac56` (2 files, +20 lines of
  explanatory comment above the type-only import per `git show f507ac56
  --stat`).
- **N-4** (Trivial, review round 2) — reviewer's task description said the
  c5 file has 9 tests; it actually has 10. Cosmetic description miscount,
  not a code defect. **Not fixed, not blocking** — remains open as a
  description-accuracy nit only.
- **Sweep category 6 remedy** — review-report.md's durable-findings section
  notes an existence-check gap in path sweeps (grep alone under-delivers;
  needs an `existsSync` filter). This ship's own re-verification followed
  that stricter standard (e.g. re-running the parity script against actual
  files rather than trusting a grep match), and found no further instances
  of the same category of defect.
- **255 errors / 21 warnings lint debt** — pre-existing, out of P1's stated
  scope, carried forward untouched. See durable findings below.

## Test Gate

- Required scope: focused — boundary checker (all 3 modes), `rasen validate
  --strict`, parity fixture, `bun test` (full suite; this repo's suite is
  small enough at 110 files/~100s that "full" is also "focused" here), and
  `bun run lint:web`. All re-run live in this ship rather than reused from
  stale evidence, per explicit re-measure instruction.
- Rationale: package-extraction is a structural/cross-cutting change (moved
  ~1000 files across new package boundaries, touches frozen S03/S04
  contracts, touches both Host build configs) — exactly the category of
  change project convention says should broaden past a narrow regression
  slice, so full-suite + full-tool-set re-run is warranted rather than a
  scoped subset.
- Tests: all commands above, fresh output, all green except the disclosed
  10-failure/3-error `bun test` baseline (itself an *improvement* over the
  19-fail/5-error pre-move baseline, and unrelated to this extraction per
  review-report.md's failure-by-failure classification).
- Tree: `b0a643d3b103d4d4c63b0039103cca140be0ddb7` (HEAD `e2169f81` before
  this ship-log commit).

## Deployment

Not applicable — `local` mode, no PR, no deploy step.
