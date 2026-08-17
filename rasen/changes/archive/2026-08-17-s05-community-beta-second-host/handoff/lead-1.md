# Session handoff: S05 portfolio LEAD — P0 and P1 delivered, P2 is the frontier

> Written 2026-08-14 at a clean stage boundary (P1 archived, nothing in flight).
> LEAD context at write time: ~68% of 1M. Relay is planned, not forced.

## Original intent (verbatim)

> `auto-decompose 阅读交接文档：rasen\handoff\rocut-s0304-delivered-s05-projected.md 继续推进S05的开发，implementer、ship、archive使用sonnet，其他使用opus。开始吧`

Run the `auto-decompose` pipeline, read the named handoff, **continue advancing S05 development**.
Models: implementer / ship / archive = **sonnet**; planner / reviewer / fixer = **opus**.
That sentence was also the human activation authorization S05 spec §9 required.

## Position

**Two of seven children delivered. Nothing in flight. Nothing pushed.**

| | |
| --- | --- |
| rocut branch | `feat/s05-community-beta`, **41 commits** ahead of `origin/main` `8e1f18ac`, **unpushed** |
| elftia governance | `dev/0.2.7`, S05 activated as `af37965ee` via worktree `elftia-wt-s05gov` |
| P0 `s05-package-boundary-freeze` | **archived** `2026-08-13-s05-package-boundary-freeze`, spec `sdk-package-boundary` 0→8 |
| P1 `s05-package-extraction` | **archived** `2026-08-14-s05-package-extraction`, spec `sdk-package-extraction` 0→7 |
| P2–P7 | pending, fully serial |
| delivery | `pending` — portfolio delivers ONCE at the parent after all seven |

**Read `../planning-context.md` first.** It is the context pack: the four ruled decisions, the
measured starting state, every durable finding from both children, and the corrections. Everything
below assumes it.

## Where things live (two repositories, easily confused)

- **rocut** `_others/rocut` — ALL implementation. Only registered worktree; **never create another**.
- **elftia** `elftia/elftia` — governance only (`rasen/work/opencut-agent-editor-sdk/`). Read the
  Slice spec/plan from **`dev/0.2.7`**, not the main worktree, whose copies are stale. A dedicated
  worktree exists at `elftia/elftia-wt-s05gov`.
- The main elftia worktree sits on another line with a concurrent session's WIP — **never switch its
  branch, never commit into it.**

## Next action

**Start P2 `s05-second-host`** — a minimal non-Elftia desktop reference Host: **Electron + Vite**
(B2, ruled), implementing its own ports over a filesystem-backed `ProjectStore` with explicit
runtime-asset loading. It must pass create / import / multi-track / edit / preview / save / reopen /
**automate** (the last through the S03 transaction API, not a Host-private path), plus migration,
disposal (reuse S02's harness) and provider-private round-trip.

Dispatch order: planner (opus) → implementer (sonnet) → reviewer (opus) → ship local (sonnet) →
archive (sonnet). Seed the implementer from `implementer-p1.md` **plus** P2's own artifacts; P2's
artifacts win where they speak.

## The single most important thing to carry into P2

**P2 walks straight into the region where both of P1's worst defects lived, and that region has no
oracle over it.** Anything requiring a live server, a capture run, or a browser: C7 headless, the
Playwright probes, `check-asset-manifest`, both headless checkers.

- P1's Blocker — the vite Host **completely non-interactive**, all ten parity interactions failing —
  was invisible to all 27 checkers, the type baseline, resolution-equivalence and `bun test`. Only
  the browser parity oracle caught it, and only because someone read the log instead of the exit
  code.
- The C7 react-control proof had **two** defects: its two arms silently resolved to the same module
  (so a react-vs-neutral proof proved nothing while reading as passing), and after that was fixed,
  the neutral arm turned out to be failing its own cleanliness bar from a bundler specifier-fold.
  The second was found **only by running both arms**.

P1 had a working control (the Next Host) that made diagnosis possible. **P2 has no equivalent.**
Treat that whole region as unverified until P2 runs those programs itself.

## Guardrails that are not negotiable

- **Children ship `local` (commit only). The portfolio delivers ONCE at the parent. Never push a
  partial portfolio.** Both P0 and P1 archived on the feature branch — that is the S02/S03+S04
  precedent and it is correct; the archive commits merge as part of the single eventual delivery.
- **Serialize every rocut-mutating worker.** One writer at a time.
- **No frozen S03+S04 public signature may change.** That is a `failed` condition for the Slice, not
  a patch — a finding that returns to the contract.
- **Parity fixture is the oracle.** Acceptance is *zero semantic rows outside the already-documented
  idempotency envelope* (spec §3.2) — not "zero semantic rows". Spec §5 forbids resolving that
  classification; I halted two attempts to edit `script/diff-parity-snapshots.mjs` and both were
  correct halts.
- **Send `{"kind":"standDown"}` to any parked worker the moment its loop goes clean.** A live
  keepalive heartbeat at `<changeRoot>/signals/.state/<role>.json` makes the archive ESTALE against
  its frozen plan baseline, and a bare retry can never recover. This cost P0 three failed attempts.
  **I stopped parking implementers after that; P1 archived first try.**

## Dead ends and traps (each cost real time)

- **`git status` is not a content check.** Racy stat cache reports clean on diverged bytes.
  `git hash-object` vs `git ls-tree HEAD` is the real check; `git show HEAD:path > path` is the only
  reliable repair — `git checkout HEAD --` silently no-ops on stale-stat files (fixed 1 of 12).
- **Background-task exit codes are unreliable.** A run whose log said `1 failed` was reported as
  exit 0. Log `REAL_EXIT_CODE:$?` and read the log.
- **The Write tool emits CRLF inconsistently.** rocut is LF-in-worktree. `tr -dc '\r' < f | wc -c` or
  `git ls-files --eol`; **never `grep -c $'\r'`** (returned 873 on a zero-CR file).
- **`grep -c` printing `0` exits non-zero** and silently breaks `&&` chains — this made one of my own
  verification runs report success while skipping every check.
- **`git ls-files "packages/*/src"` returns zero files** without `:(glob)` magic via `execFileSync`.
  My instruction to "add `packages/*/src` to the scan scope" would have produced a guard scanning
  nothing. Enumerate dirs with `readdirSync`.
- **ESLint v9's CLI does not expand a bare `packages/*/src` glob** the way its config `files:` does.
- **`%TEMP%` is unusable for scratch trees** — AV interception hangs `ln -s` and `mklink /J`
  indefinitely. Use a same-drive path outside Temp. **P3's tarball harness is exactly this
  operation.**
- **`--apply-plan` conflicts with `--project`/`--store`** — the token carries its own scope.
- **The archive preview prints `specSync.mode: "no-deltas"` / `specActions: []` even when it syncs.**
  Verify by counting `^### Requirement`. A MODIFIED delta changes content without changing the count.
- **`rasen archive` refuses a change-authored `## Archive` heading** — reserved.
- **`--latest` on `rasen agent context` can resolve to a PREVIOUS session's transcript.** My opening
  probe read 0.699 from the predecessor's file and I twice told the user a relay was imminent when I
  was near zero. **Check the returned `transcript` path is your own session id.**
- E: filled to 100% mid-run once. The user cleared it. rocut is not the consumer (1.6G).

## Eliminated hypotheses

- *"The vite Blocker is a CSS pipeline failure."* — **Ruled out with evidence.** The bundle contained
  the exact classes; the accessibility tree showed the whole editor rendered. It was one missing
  utility from a stale `@source` scan scope.
- *"The 18 semantic parity rows are a new defect."* — **Ruled out.** Byte-identical sorted path sets
  pre- and post-move; inherited, and spec §5 forbids resolving the classification.
- *"The +9/−9 test delta is the hardcoded-path fixes."* — **Ruled out by the implementer against my
  own hypothesis.** Those were move-introduced, so they dip and recover across the two endpoints and
  net ~zero. The real answer: exactly **8 named FAIL→PASS flips**, all boundary/corpus-isolation
  tests, plus **one named flake**.
- *"~19 checkers remain stale."* — **Ruled out.** A misreading of the original round-1 finding; all
  26/27 were triaged and swept green by task 8.5. Do not go looking for that backlog.

## Working set

- `rasen/changes/s05-community-beta-second-host/` — `planning-context.md`, `handoff/implementer-p0.md`,
  `handoff/implementer-p1.md`, `ephemera/portfolio-run.json`. **Untracked by design**; it is the
  portfolio's planning container, not any child's to commit.
- Archived children carry `evidence/{implementation-report,review-report,ship-log}.md` plus raw
  artifacts (`premove-baseline/`, `head-stability-recheck/`, `c7-dual-arm/`).
- `BOUNDARIES.md` §7–§11 — package boundary, consumer entry-mapping, checker scope audit, the
  Blocker write-up, and the anchor-vs-matched-pair rule.

## Genuinely open, deliberately unowned

**255 errors / 21 warnings of pre-existing lint debt in `packages/*/src`**, surfaced when P1 took
lint coverage from 59 files to 921. It predates P1 and was never checked. **Not P2's by proximity** —
assigning it is a human decision.
