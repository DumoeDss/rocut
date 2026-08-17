# Handoff: s05-community-beta-second-host — implementer-p1 #1

Reason: `retired-between-children`. P1 (`s05-package-extraction`) is finished and shipped (LOCAL
commits on `feat/s05-community-beta`, HEAD `74182a3e`, not pushed). It is **not yet archived** —
that is the LEAD's next step, and this document is deliberately written to the *parent* change
directory rather than into `rasen/changes/s05-package-extraction/` so that step can proceed without
the ESTALE hazard P0's archive hit three times (see `planning-context.md`'s "From P0's archive"
entry). Nothing under P1's own change directory was touched to produce this file. There is nothing
left to complete on P1 — this document carries forward what P2's implementer needs to know that
`planning-context.md`, `implementer-p0.md` and P1's own artifacts (`BOUNDARIES.md` §7-11,
`evidence/ship-log.md`, `evidence/review-report.md`) do not already say in one place.

## Original intent

P1's job was to physically relocate the source P0 had already assigned, on paper, to three package
layers — `@opencut/editor-ports` (L0), `@opencut/editor-contracts` (L1), `@opencut/editor-classic`
(L2) — out of `apps/web/src` and into `packages/*/src`, rewrite every specifier that crossed a new
boundary, and prove the move was behavior-preserving. P1 does not redesign the boundary (P0 already
froze it) and does not build a second Host (P2's job) — it is a refactor whose oracle is the parity
fixture: any semantic movement is a defect, not an accepted update, per the portfolio's own hard
constraint in `planning-context.md`.

## Position

Pipeline: `small-feature` (P1's own pipeline). Portfolio: `s05-community-beta-second-host`, fully
serial, P0 → P1 → P2 → P3 → P5 → P6 → P7. P1 is `done`; P2 (`s05-second-host`, an Electron + Vite
Host per ruled decision B2) is next and has not started.

## Done / Remaining

Done: all of P1. 39 commits since the P0 pin `8437084b` (`git rev-list --count 8437084b..HEAD` = 39,
range `d5756c5b..74182a3e`). Scale: 863 files moved (18 → `editor-ports`, 54 → `editor-contracts`,
791 → `editor-classic`); `apps/web/src` keeps 54 shell files; 2,179 `@/` specifier occurrences
rewritten across 544 files to relative or package-root specifiers. Two review rounds: round 1
(delta `8437084b..af0a52ba`, 21 commits) closed with 0 Blockers, 2 Majors, 4 Minors, 2 Trivials;
round 2 re-review (delta `af0a52ba..1e5a337c`, 9 commits) closed clean — 0 open Blockers, 0 open
Majors — with 4 new Minor/Trivial findings (N-1..N-4), 3 of which (N-1, N-2, N-3) were fixed anyway
after review had already blessed shipping with them open (commits `823522be`, `811202da`+`d76d612f`,
`f507ac56`). Final state at ship, independently re-measured (not copied from any report):
boundary checker 5/5 PASS (964 files, 329 edges; `public-entry-only` and `no-internal-reexport` both
went from vacuous/dormant under P0 to live and substantive under P1 — this is P1's central,
fully-earned claim); parity fixture 29 differences (20 semantic, all inside the documented
`__opencutTransaction.idempotency` envelope from spec §3.2, 0 outside it; 9 incidental; 275 leaf
values compared); `bun test` improved 649→658 pass / 19→10 fail / 5→3 errors on an unchanged 668-test,
110-file count (a refactor that fixed rather than broke tests along the way); `rasen validate
--strict` valid, 0 issues. Full numbers, re-measurement methodology and the three independent
`bun test` runs (one of which disagreed with the other two and was diagnosed as machine resource
contention, not a regression) are in `evidence/ship-log.md`.

Remaining: **none.** P1 is complete; nothing here is a task for P2 to finish on P1's behalf.
Everything below is knowledge, not a backlog.

## Key decisions (and why)

### 1. What the three packages look like from a consumer's side

**`@opencut/editor-classic`'s declared entry count is 18 today, not the 14 P0 froze before any
source moved** — both numbers are correct, at different times, and the growth is itself informative.
P0's original manifest (`5e3fc7cb`) declared exactly 14 subpath entries (everything in `exports`
except the boilerplate `"./package.json"` self-reference). Three additions since, each recorded with
the module that forced it, per P0's own monotone-growth rule:

- `./evidence/wasm-test-mock` (14→15, landed inside the Stage C extraction commit `c234042e`) —
  forced by two independent consumers hitting the same root cause: a `bun:test`-only side-effect
  module reachable only through the wide `./evidence` barrel's `export *`, which crashed
  `production-composition.test.ts` (barrel evaluation order) and then crashed `apps/web`'s
  production `next build` (Turbopack evaluates every route module and `bun:test` doesn't resolve
  under Node). See `BOUNDARIES.md` §8.
- `./storage/conformance` (15→16, commit `35950753`) — split out of the wide `./storage` barrel
  because it is harness/probe surface, not part of `BrowserProjectStore`'s production export set,
  and the wide barrel is what every bundler must evaluate in full.
- `./evidence/headless` + `./evidence/headless-semantic-fixture` (16→18, commit `1770d9b0`) — this
  is the fix for the second C7 defect, section 2 below. A specifier reachable both as a static value
  import and a dynamic import gets folded by Rollup/Vite into one chunk; splitting the barrel is what
  gave the dynamic-only semantic fixture its own specifier so the fold stopped happening.

`@opencut/editor-ports` declares 5 entries, `@opencut/editor-contracts` 9 — both untouched by this
growth, since the additions above are all Classic-side, provider/UI concerns.

**Barrels versus real modules.** Most of the 18 `editor-classic` entries are barrels of several
files (`./ui`, `./storage`, `./evidence`, and `.` the widest of all — `core` + `utils/*` + `wasm` +
`background/color` + `canvas/sizes` + `fps/defaults` + `feedback/types`). The entries that point at
exactly one file were all added *narrowly, on purpose, to escape a barrel* — `./evidence/wasm-test-mock`,
`./storage/conformance`, `./evidence/headless-semantic-fixture` are the three clearest instances,
each added specifically because folding that one file into its wide sibling barrel broke something
(a test crash, a production build crash, a false-positive DOM mutation). If you need to add a
narrow entry for a similar reason, that pattern — carve a value/effectful/test-only module its own
subpath rather than widen a barrel it doesn't belong in — is the one this package family already
uses three times.

**`./media` is declared and currently unconsumed.** `git grep "editor-classic/media"` outside the
manifest returns zero hits. `BOUNDARIES.md` §8's own entry-mapping table records it as "declared,
still unconsumed — no Host reaches it yet." **You are its likely first consumer.** When you write the
first `@opencut/editor-classic/media` import, that is new, unexercised ground — nothing today
proves this entry actually resolves to a working module from outside the workspace, only that the
manifest is syntactically well-formed.

**The packages ship raw TypeScript from `./src`, with no build step, and this is deliberate, not an
oversight to fix.** `npm pack --dry-run` against `editor-ports` (task 9.3, independently re-run, not
just read from the manifest) produced a tarball containing exactly `package.json` + 18 files under
`src/` — every `.ts` source file including `__tests__/*.test.ts` and `.compile-guard.ts`, nothing
compiled, nothing excluded, no `.npmignore` anywhere in any of the three packages. All three
manifests' `"files"` array lists `"dist"` first even though no package has ever had a build step and
no `dist/` directory exists on disk for any of them — a dead, inert entry (an absent glob is
silently skipped by `npm pack`), not a broken one, and not yours to explain away or "fix" by adding
a build step unless a later child (P5/P6, per the note already on record) decides to add one. What
this means for you concretely: **no `@/` alias can ever be resolved away at build time inside these
packages** — the manifests point `exports` at literal `./src/*.ts` files, so the alias replacement
had to be declared by the packages themselves (relative specifiers after the rewrite, not a Host
bundler config), and your Electron Host's own bundler has to resolve raw `.ts` imports directly, the
same way `apps/web` and `apps/vite-example` already do today. There is no "consume the built JS"
mode to fall back on.

### 2. The gate blind spot — where this child's two worst defects actually lived

**Anything requiring a live server, a capture run, or a browser sits outside every static check this
repo has**, and this is not a hypothetical: it is where P1's two worst defects — measured by how
close each came to shipping silently — actually lived, and neither was findable any other way.

**The vite Host went completely non-interactive**, and every gate short of the browser said green.
Root cause: `apps/vite-example/src/styles.css:25`'s Tailwind `@source "../../web/src"` directive was
correct before this child and was invalidated the moment Stage C's `git mv` relocated the source to
`packages/editor-classic/src` — the sibling `@import` three lines above *was* updated for the move,
this directive was not. Tailwind v4's stale-`@source` failure mode is partial, not total: most
utilities kept compiling through the still-working `@import` chain, so the gap stayed invisible
until `.right-0` — used by the Main Track row's width, `timeline/components/index.tsx:818` — dropped
out of the bundle, the row collapsed to a 0×0 box, and Playwright's actionability check correctly
called it hidden. Result: all ten interactions in the parity editing scenario failed, a 12.2-minute
run, against the Next Host's 41.0-second pass on the identical scenario. All 27 static checkers, the
type baseline and `bun test` were green over a Host whose editor could not be clicked at all — the
only thing that caught it was the parity oracle itself, and only because its own log was read
instead of trusting the run's background-task completion status (see section 4). Fixed by one line,
commit `84dfc088`. Full story: `BOUNDARIES.md` §10.

**The C7 headless proof's react-control injection was silently inert, so the two arms — the whole
point of having two — resolved to the same module.** `apps/vite-example/vite.headless.config.ts`
had its alias `replacement` halves updated for the move (commit `5ab8b192`) but not its `find`
halves, which matched a pre-extraction specifier form that no longer existed anywhere in the tree.
The alias silently matched nothing; the build succeeded; `check-headless-semantic-result.mjs`
compared two runs that were now identical by construction, and a discrimination proof that proves
nothing read as a passing proof. Task 6.5 had even run this exact build and logged "44 modules
transformed cleanly" — a green build that had already lost the property it existed to demonstrate.
This one was **reviewer-found** (round 1's MAJOR-1), by a single mechanical `git grep` for the old
path prefix across the tree, not by reasoning about the config. Fixed by deleting the stale alias
outright rather than repointing it (commit `d8159157` — a repointed catch-all would have silently
resolved any future stray `@/…` specifier into the wrong tree; deletion makes that a hard failure
instead).

**A second, subtler C7 defect surfaced only after the first was fixed and re-verified by actually
running both arms** (this is the self-caught one — see section 5). Once the react-control injection
worked again, the *neutral* (no-React) arm started failing its own zero-DOM-mutation bar: a false
positive on the exact control meant to prove zero React-family side effects. Cause: `evidence/index.ts`'s
barrel exported the same module both as a static type-only import and reachable via a dynamic value
import elsewhere in the same entry chain; Rollup/Vite folds a specifier reachable both ways into the
entry's own chunk, and the folded chunk emits a `modulepreload` link — a real DOM mutation the
runtime probe's `MutationObserver` correctly flagged. Fixed by giving the dynamic-only semantic
fixture its own declared subpath (`1770d9b0`, the third `editor-classic` entry-count addition in
section 1) so no specifier is reachable both ways. Round-2 review independently confirmed the fix is
substantive, not cosmetic — 37 Vite-side fields and 24 Next-side fields differ between arms
post-fix, and the neutral arm's zero is a *real* zero (its own probe reports `mutationRecords: 0`
across the board, while the react arm reports 2 from the same probe in the same session).

**The rest of the blind-spot region, by name, so you know what "unverified" means concretely**: the
Playwright probes under `apps/vite-example/tests/{parity,probe,c3,c5-storage}/*.pw.ts` (one of which,
`legacy-migration.pw.ts`, was round 1's MAJOR-2 — a hardcoded path the move deleted, `ENOENT` on
read, fixed by `0e538186`), `script/check-asset-manifest.mjs`, and the two headless checkers
`script/check-headless-graph.mjs` and `script/check-headless-semantic-result.mjs`. **You add a third
Host straight into this region.** Treat every program in it as unverified until you have actually run
it against your Electron Host yourself — a green run of every static checker, the type baseline, and
`bun test` says nothing about whether any of these programs still do what they claim once your Host
exists. This is not advice; it is what shipped a Host-breaking defect twice in this child alone with
every other signal green at the same moment.

### 3. The sibling-move pattern, refined to an executable check

P1's own housekeeping discipline — "when a fix touches one member of a same-purpose set, sweep for
its siblings" — was written down after catching four instances of exactly this shape (a hardcoded
path fixed with its sibling left stale, four separate times: package names/arity literals, matching
logic/message text, a CSS `@import`/its sibling `@source` — §10 above — and a `.scratch-*` cleanup
that left four differently-named siblings behind). **The reviewer then found three more instances
using one mechanical command** — `git grep -n "<old-path-prefix>" -- ':!*.md'` — including the
round-1 Blocker-adjacent MAJOR-1 itself, and two instances *inside this child's own documentation of
the pattern* (a corrected figure left standing in a later report; a resolved limitation still
claimed as unresolved). The diagnosis that matters: **"sweep for siblings" is a rule about intent,
and the actor in the moment is the person least able to audit their own intent.** Writing the lesson
down was necessary and was not sufficient. The grep is the executable form of the same rule; run it,
don't rely on remembering to.

**Round 2 sharpened the sweep itself.** A bare prefix grep over-collects — most hits are still-live
paths, not defects — and hand-triaging the raw list by eye is exactly where the next miss hides:
this child's own round-1 hand-triage put `package.json`'s three stale script targets in the bucket
labelled "fine." The fix: pipe the grep through an existence check on each target.

```sh
git grep -oE '<old-path-prefix>/[A-Za-z0-9_./-]+' -- ':!*.md' | sort -u \
  | while read -r p; do [ -e "$p" ] || echo "$p"; done
```

Applied post-fix, this turned **300 raw hits into 60 real candidates** and surfaced the
`package.json` miss (N-1) in a single pass that hand-triage had missed. Use the existence filter
from the start, not as a second pass after a raw grep looks clean.

**Your own C6 lesson, generalized, because a uniform sweep is also wrong.** Regenerating a fixture's
build-provenance fields via the repo's own generator is correct and expected after a real rebuild —
but a *matched pair* of fixtures produced by one regeneration run (`c6-session-resource-closure-anchor.json`
and its sibling `-expected-closure.json`) must move **together**: updating one alone broke the
checker's cross-fixture consistency check (1 fail → 5 fail). A third field in the same block,
`provenance.baseCommit`, must **not** move with the rest — it is deliberately pinned to the last
*reviewed* source-closure audit, not to "whenever the fixture was last regenerated," and a uniform
overwrite of the whole block would have traded the original mismatch for a new one against it. The
general shape, so it doesn't have to be re-derived per fixture family: each field in a
provenance/fixture block is either (a) tied to a sibling and must move in lockstep, or (b)
deliberately anchored to a slower-moving reference point and must not move just because a neighbor
did. Treating the whole block as one undifferentiated unit is wrong in both directions — diff the
regeneration's output field-by-field against what actually changed, and call out any explicitly
pinned field by name *before* running the regenerator, not after a second round of test failures.
Full account: `BOUNDARIES.md` §11. This is named as directly relevant to **you** (regenerating
provenance-adjacent surfaces for a second Host) and to P7 (regenerating the entire
`SOURCE_INVENTORY` record).

### 4. The open lint debt is disclosed, not owned — assigning it is a human decision

`bun run lint:web` at P1's HEAD reports **255 errors, 21 warnings** (276 problems) across
`apps/web/src packages/editor-classic/src packages/editor-contracts/src packages/editor-ports/src`.
This is not new debt P1 introduced — it is debt that existed before the move and was **invisible**
because the lint scope was silently narrowed by the same move that created it (see section 4's
tooling-traps entry on N-1 below for the mechanism). Restoring correct scope made it visible; it did
not create it. Predominant rule families in the tail of the output: `@typescript-eslint/no-unsafe-type-assertion`
and `opencut/prefer-object-params`, concentrated in `editor-contracts/src` (`draft/`, `engine/`,
`in-memory/`) and `editor-ports/src`. **This was reported to team-lead as a new item for a later
child to triage, not remediated here, deliberately** — out of P1's stated scope, and fixing 255
findings inside a behavior-preserving move commit would itself have been exactly the kind of
unattributed scope-blend this child's own review repeatedly flagged as the wrong move. Stating this
plainly for you: it predates P1, restoring visibility is not the same as creating an obligation, and
whether P2, a later child, or a dedicated cleanup owns triaging it is a call for a human to make, not
something you should treat as silently inherited just because your own change also touches these
directories.

## Dead ends & gotchas

- **The Write tool itself emits CRLF inconsistently — already documented in `implementer-p0.md`, and
  it recurred in P1.** A 114-line `eslint.config.mjs` edit came back fully CRLF despite a pure-LF
  source and pure-LF new content passed to the tool. Fixed with
  `node -e "fs.writeFileSync(path, fs.readFileSync(path,'utf8').replace(/\r\n/g,'\n'), 'utf8')"`.
  Treat every file the Write tool touches as suspect until verified, every time, not just once per
  session.
- **`grep -c $'\r'` is unreliable for CRLF detection — do not use it, not even as a spot check.**
  P0 already measured this returning a false positive; treat it as settled. The durable replacement,
  used throughout P1: two independent non-grep methods, both required — `tr -dc '\r' < file | wc -c`
  (want `0`) and `git ls-files --eol -- file` (want `i/lf w/lf`).
- **`grep -c` exits non-zero when the count is 0, silently truncating `&&` chains.** Also already in
  `implementer-p0.md`, and P1 worked around it correctly by capturing the count into a variable and
  comparing explicitly (`test "$(... | grep -c ...)" = "0" && echo OK`) rather than chaining
  `command && grep -c pattern file && next-command`, which never reaches `next-command` on the
  passing case.
- **`git status`/`git diff` can report a file clean while its bytes have genuinely diverged from the
  index — a racy stat-cache trust, not corruption.** Measured directly during P1: 12 files under
  `packages/editor-contracts/src/**` had confirmed byte-level divergence (different `wc -c`, `md5sum`,
  and `git hash-object` != `git ls-tree HEAD` blob hash) while `git status --porcelain`, `git diff`
  and even `git update-index --really-refresh` all reported clean. `git update-index --refresh`
  (plain, **not** `--really-refresh`) is git's own diagnostic — it printed "needs update" for the
  affected paths. **`git checkout HEAD -- <path>` is not a reliable repair here**: a batched checkout
  across all 12 paths silently fixed only the one file whose stat had genuinely been perturbed and
  no-op'd on the other 11, reporting no error — its own skip-if-unchanged fast path is fooled by the
  same stale stat. The only method that reliably worked: `git show HEAD:path > path`, a plain
  redirect with no git-side "is this needed" check at all. Verify by content, never by porcelain:
  `git hash-object <path>` vs `git ls-tree HEAD <path>`. And to check what is actually **committed**
  as opposed to what's on disk, read the blob — `git show <sha>:path` — a working-tree read measures
  the worktree, not the commit, and conflating the two produced a real false alarm during this
  portfolio (one agent told another a commit was corrupt when only the worktree had drifted).
- **Pathspec-limited `git commit --` can silently omit a staged rename's destination file.** N-2's
  own fix commit (`811202da`) renamed two files via `git mv` but invoked `git commit -- <old
  pathspecs> <unrelated files>` — listing only the *pre-rename* names. Git happily committed the
  staged deletion of the old names and never committed the new ones, because they weren't in the
  pathspec list — reintroducing, inside the very commit meant to fix it, the exact "neither old nor
  new filename present" regression N-2 existed to close. Caught on a routine post-commit `git status`
  (not a targeted audit) and repaired with a follow-up commit (`d76d612f`). When a commit's pathspec
  list is hand-typed rather than `-a`/`.`, re-check `git status` immediately after — pathspec
  omission is a silent, exit-0 failure mode.
- **A background task's reported exit code is not trustworthy in this environment.** Measured twice
  during P1, independently: a Playwright parity run that genuinely failed (its own log: "1 failed",
  "no interaction may fail", all ten interactions failing) was reported by the background-task
  completion notification as "completed (exit code 0)." A fully broken Host looked green. Have the
  command record its own status and read that (`some-command > run.log 2>&1; echo
  "REAL_EXIT_CODE:$?" >> run.log`, then grep the log) — never accept the harness's own completion
  status as evidence.
- **ESLint's CLI does not expand a bare `packages/*/src` glob in this version.**
  `eslint "packages/*/src" --ext .ts,.tsx` → `"No files matching the pattern..."`, confirmed
  empirically. Fixed by listing each of the three package directories as its own explicit CLI
  argument in `package.json`'s `lint:web`/`lint:web:fix` scripts, rather than relying on a glob
  argument.
- **`git ls-files "packages/*/src"` returns zero files without explicit `:(glob)` magic — and
  implementing an instruction that assumes otherwise produces a vacuous guard, not a working one.**
  A bare `packages/*/src` is not a working git pathspec by default; without `:(glob)` magic, git
  treats `*` as a literal character and matches nothing. This is the exact trap `8389be4e`'s
  `c5-storage-red-controls.test.ts` scope fix avoided — the literal instruction would have produced
  a guard scanning 0 files, a vacuous fix for a vacuity, which review independently confirmed by
  direct measurement. The implementation used `readdirSync` over `packages/`, filtered to existing
  directories, each passed as its own literal pathspec — and added a fail-closed
  `expect(files.length, "…must not be vacuous").toBeGreaterThan(0)` assertion specifically so a
  future silent-vacuity regression on this exact scan cannot happen unnoticed again. Copy that
  assertion pattern anywhere you write a scan that could legitimately go quiet.

## Working set

- `BOUNDARIES.md` §7-11 — the living design/lesson record for the package boundary and this child's
  findings. §7 is P0's freeze; §8 is the consumer entry-mapping table (section 1 above); §10 is the
  vite-Host Blocker full story; §11 is the sibling-fixture generalization (section 3 above).
- `rasen/changes/s05-package-extraction/evidence/ship-log.md` — the full re-measured ship record:
  every number in "Done" above, plus the three independent `bun test` runs and the spec-falsification
  sweep against `dev/0.2.7`'s actual §3 text.
- `rasen/changes/s05-package-extraction/evidence/review-report.md` — both review rounds in full.
  Round 1's `MAJOR-1`/`MAJOR-2` and round 2's "Priority 1"/"Priority 2" sections are the primary
  source for section 2 above, with field-by-field evidence tables.
- `packages/{editor-ports,editor-contracts,editor-classic}/package.json` — read the live `exports`
  map directly before citing an entry count in anything you write; it has grown three times already
  in this child alone and will grow again in yours.
- `eslint.config.mjs` (the `frontendFiles`/`packagesFiles` scoping, commit `823522be`) and
  `package.json`'s `lint:web`/`format:web` scripts — read before touching either; the comment block
  `823522be` added explains exactly why `packages/*/src` has to be threaded through by hand in two
  separate places (CLI target list and ESLint's own file-scoping array) rather than by a glob.
- `rasen/changes/s05-package-extraction/tasks.md`, Groups 9-10 — task 9.3 (the `npm pack --dry-run`
  evidence for the no-build-step claim in section 1), task 9.4 (the export-map addition writeup),
  task 9.5 (the round-2 disposition: sweep remedy, existence-check refinement, N-4 correction).
- `rasen/changes/s05-package-extraction/` itself, and its eventual archive path once the LEAD moves
  it — **read-only for you once archived, same as `rasen/changes/archive/2026-08-13-s05-package-boundary-freeze/`
  is for P0's record.** This document exists so you rarely need to open it.

## Next action

Read `planning-context.md` (already the standard seed for every planner in this portfolio; its
"Durable findings" section already carries several P1-authored entries this document deliberately
does not repeat) alongside this document, then proceed into P2 (`s05-second-host`)'s own `apply` —
read its proposal/design/specs/tasks the normal way. The first concrete trip-wire, restated from
section 2: the moment your Electron Host exists and you run the parity fixture, the Playwright
probes, or either headless checker against it for the first time, you are the first genuine exercise
of every program in the gate blind spot for a *third* Host. A green static-checker run, a green type
baseline, and green `bun test` prove nothing about that region — run the actual programs yourself
before trusting any of them, the same way this child's own worst defect was only caught because the
browser-level oracle happened to be run and its real log read instead of a completion status.

---

## One thing in my own words: the habit worth carrying forward is testing the instruction, not executing it

Twice in this child, the correct move was not to implement what was asked but to check whether what
was asked would actually work first — and both times, executing literally would have shipped
something that looked done and wasn't.

The clearest instance: a scan needed to cover `packages/*/src`, and the literal, obvious way to write
that is a `packages/*/src` pathspec. Running it first — `git ls-files "packages/*/src"` — returns
**zero files**, because git doesn't glob-expand a bare `*` without `:(glob)` magic. Writing the guard
the literal way would have produced a scan that always passes by finding nothing to scan, which is
the exact failure mode (a green check watching an empty set) this whole portfolio kept independently
rediscovering at every level — a checker, a test, a lint script, a build config. The guard that
actually shipped (`8389be4e`) enumerates real directories with `readdirSync` and asserts its own
result set is non-empty, so if it ever *does* go vacuous again, it fails instead of passing quietly.
Checking "does this literal instruction even do anything" before writing it caught the gap before it
existed rather than after a review round found it.

The second instance was smaller but the same shape: after fixing the C7 headless proof's inert
react-control injection, the obvious next step is to trust the build log and move on — task 6.5's
own prior run had already done exactly that, logged "44 modules transformed cleanly," and shipped a
proof that had silently stopped proving anything. The only way to find the *second* defect — the
neutral arm's false-positive DOM mutation from the barrel's specifier-folding — was to actually run
both arms and read the field-by-field output, not to reason from the fact that the build succeeded
and the alias now pointed somewhere real. Reasoning about the code said "fixed." Running it said
"fixed, and there's a second bug in the same file you haven't looked at yet."

**What I'd tell P2's implementer to do differently, stated as the imperative it deserves**: before
implementing an instruction that scans, sweeps, or verifies something, run the cheapest possible
version of it first and look at what it actually returns — not what you expect it to return. If a
scan finds nothing, that is not evidence of a clean tree; it is evidence the scan may not be running
at all, and the two look identical from the outside until you check. And when you fix something that
runs in two modes, two arms, two hosts, or two branches of a control — run *both*, every time, not
the one that's convenient or the one that was broken before. The gate blind spot in section 2 exists
precisely because "the build succeeded" and "the thing the build was supposed to prove is still
true" are different claims, and only one of them is checkable by a machine that isn't actually run.
