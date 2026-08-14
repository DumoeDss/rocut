# P1 implementation report — `s05-package-extraction`

This is the file-based record team-lead asked for after finding that the report existed only as a
chat message. Everything below either restates that message's content against its primary source
(re-verified in `tasks.md`, not recalled), or adds the four sections team-lead specifically asked
for: P1's own Blocker, the reconciled checker count, a spec-falsification sweep, and the
housekeeping disclosure. Nothing here is asserted from memory alone where a live check was
available; each figure below was re-read from `tasks.md`, `BOUNDARIES.md`, or a fresh command this
session, not carried forward from an earlier draft.

## Closure identity

| item | value |
| --- | --- |
| Scope | Extract the S03+S04 frozen editor surface into three packages (`@opencut/editor-ports` L0, `@opencut/editor-contracts` L1, `@opencut/editor-classic` L2) and rewire both Hosts onto them |
| Baseline | `8437084b` (P0's last commit, S05 P0 `s05-package-boundary-freeze`, archived) |
| Commits, baseline → HEAD | 20 (`d5756c5b` .. `8f3a1e34`) — `git log --oneline 8437084b..HEAD` |
| Tasks | 56 / 56 complete (`tasks.md`) |
| Ship mode | local — commit only, not pushed; portfolio delivers once at the parent after all seven children |
| Frozen contract signature | unchanged — see "Frozen-signature audit" below |
| Static checkers | 27 at HEAD (see "Reconciled checker count") |

## Verification ledger

| gate | result |
| --- | --- |
| `check-package-boundary.mjs`, 5 rules | all PASS; `public-entry-only` and `no-internal-reexport` now examine a non-zero, non-vacuous scope for the first time (see spec-falsification sweep, §3.1) |
| Negative controls | 14/14 caught (5 rules) |
| Converse controls | 12/12 accepted the legal case |
| `acyclic-direction` edge census | 949 files / 341 edges (pre-move, design.md line 21) → 963 files / 329 edges (as of HEAD `af0a52ba`; task-time Group 7 reading was 962/329) — same order of magnitude, 12-edge shrink fully attributed to task 5.6's four ownership corrections, not a scope collapse |
| `check-type-baseline.mjs` | 933 repo files type-checked (4321 total) vs. 941 (4328) baseline; 2 pre-existing TS2769 diagnostics, byte-identical file:line:code to task 5.4's already-recorded finding, zero new diagnostics |
| All 27 `script/check-*.mjs` checkers | 25 green in task 8.5's direct sweep + type-baseline (8.4) + `check-asset-manifest.mjs` (N/A, needs a live server, matches its 2.4 classification) = 27 accounted for |
| `check-distributable-boundary.mjs` on a real production build | 3842 modules, all 10 rules PASS, composition 683 editor-package + 15 example-host + 3140 dependency + 4 other |
| `check-port-boundary.mjs` (flagged in 2.4 as vacuous-pass risk) | verified non-vacuous: 53 contract modules scanned, 5/5 rules PASS |
| `check-session-resource-boundary.mjs` | 765 web source modules scanned, 7/7 rules PASS |
| C5/C6/C7 companion suites (`bun test`) | 109 pass / 0 fail, after fixing a self-inflicted C6 fixture-pair drift mid-task (see below) |
| `DOMAIN_DOCUMENT_MEMBERS` (design E7) | zero additions; `react-free-base` PASS over 68 files, matching P0's own non-vacuous scan count exactly |
| Frozen-signature audit (8.7) | zero signature differences on the transaction contract barrel, engine, ports barrel, Surface embedding types — every diff on all four is import-specifier/doc-comment churn from the physical move |
| Parity (8.1/8.3) | 29 differences: 20 semantic (all inside the documented `__opencutTransaction.idempotency` envelope), 9 incidental — identical to a like-for-like pre-move rerun at `8437084b`, and the semantic/incidental path sets are byte-identical between the two runs |
| Agent spec (8.2) | both Hosts: `expected:1, unexpected:0`; all 9 `check-agent-evidence.mjs` predicates applied by hand, all pass; one incidental diff (`commitment.project.id`, a per-session UUID) |
| Full `bun test` (8.6) | 658 pass / 10 fail / 3 errors / 3082 expect() at HEAD, vs. 649 pass / 19 fail / 5 errors / 3039 expect() at the `8437084b` baseline — net +9 pass / -9 fail / -2 errors / +43 expect(), same 668-test/110-file total both times |

## The vite-host Blocker was found and fixed inside this scope; it is P1's own, not inherited

Team-lead's prior message pointed out that my report had documented P0's Blocker (D-8) where it
should have documented this child's own. D-8 is real P0 context — see
`rasen/changes/archive/2026-08-13-s05-package-boundary-freeze/evidence/review-report.md` — but it
is not what happened here, and this section exists so the two are never conflated again.

### Symptom

Every one of the ten Playwright parity interactions failed against the vite Host, at 12.2 minutes
wall time against Next's 41.0 seconds for the same scenario. `Select Main Track track` reported
`HIDDEN` 589 times across the retries. The timeline area rendered empty and the timecode display
was stuck at `00:00:00:00` for the whole run — not a slow host, a non-interactive one.

### Root cause

`.right-0{right:0}` was entirely absent from the served vite bundle's compiled CSS. The affected
row element was absolutely positioned with only `left` set — no `right`, no explicit `width` — so
it fell back to CSS2.1 §10.3.7 shrink-to-fit sizing. A `width:100%` in-flow child of that row then
resolved against a shrink-to-fit ancestor, a circular percentage that resolves toward zero,
cascading into a 0×0 box. Playwright correctly reports a 0×0 element as hidden; it was not
misreporting anything. The failure was scoped to that row specifically because its sibling rows'
ancestors compute their sizing from JS-set inline styles rather than from this CSS rule, so they
were unaffected while this one row's whole interaction surface collapsed.

### Actual cause

`apps/vite-example/src/styles.css:25` carries `@source "../../web/src"` — a Tailwind v4 directive
that tells the compiler which files to scan for utility-class usage. Stage C's `git mv` relocated
the scanned source out from under that path. The sibling `@import` directive on line 3 of the same
file was updated to the new location as part of the same Stage; this `@source` directive, three
lines away in the same small file, was not. Tailwind v4's compilation failure mode here is
**partial, not total**: `@import` still resolved and pulled in real CSS, so the build produced a
plausible-looking bundle that was simply missing every utility class whose only usage site had
moved out of the stale `@source` scope — `.right-0` among them, but not only it.

### Attribution correction

The stale `@source` line predates this Slice — it names a path that was already correct before
Stage C ran. **The line is old; the wrongness is new, and it is this child's**: Stage C's move is
what turned a previously-correct directive into a stale one, in the same commit that updated its
sibling `@import` and left this directive untouched.

### Pattern instance

This is the third occurrence, one level of abstraction further out, of the same sibling-sweep
failure shape this child kept repeating (see the housekeeping disclosure below for the full,
now-four-instance account): a fix correctly touches one of two co-located, same-purpose
directives and misses the other. Here the "siblings" are a build-pipeline directive pair rather
than a matching pair of literals or a matching pair of package names.

### Fix

Commit `84dfc088` repointed the `@source` directive at `packages/editor-classic/src`, the actual
post-move location of the scanned source. Two alternatives were considered and rejected: an
`inset-x-0` utility on the affected element would have fixed the one visible symptom without
fixing the class of missing utilities it was drawn from (the wrong layer — a patch on the
consumer of a broken build, not the build); a Tailwind safelist entry for `.right-0` would have
papered over the specific missing class without restoring the rest of the utility set the stale
`@source` was also silently dropping.

### Fix verified

Bundle size: 35,916 → 123,113 bytes. This value is the one corroborated independently by two
sources — the diagnosis recorded in `.rasen/changes/s05-package-extraction/ephemera/auto-run.json`
and team-lead's own account — and supersedes the less-corroborated 123,105 figure in the `84dfc088`
commit message itself, which this report treats as the less reliable of the two. Utility-set diff
between the vite and Next builds after the fix: 918 vs. 1063 classes, with the gap accounted for by
one asymmetric `next/font` entry rather than by any further missing vite-side class — i.e. nothing
else was silently dropped by the same mechanism.

### The finding that must not get lost

This defect was invisible to all 27 static checkers, the type baseline, the resolution-equivalence
check, and `bun test` — every mechanical gate this child runs said green over a Host that could not
be clicked. Only the parity oracle caught it, and only because the background task's own
self-logged exit status was read from its log file rather than trusted from the completion
notification, which itself reported exit 0 for a run whose log said `1 failed` (a separately-
tracked harness defect, already recorded in standing memory). This is direct, first-hand support
for spec §3.2's framing of the parity fixture as *the* oracle for "behaviour does not move" — a
green static-checker sweep alone would have shipped a Host a user could not use.

## Reconciled checker count: 26 vs. 27

Both figures are correct; they are measurements at different points in time, not a disagreement.

- **26** at task 2.4's checker-scope audit, run before Stage A. `evidence/group-2-checker-scope-audit.md` and the ephemera diagnosis record both carry this figure because that is genuinely what `ls script/check-*.mjs` returned at that moment.
- **27** at task 8.5's post-move sweep and at HEAD. Root cause: Stage A's commit `772e6ca5` added `check-resolution-equivalence.mjs` after task 2.4's audit had already run. `check-resolution-equivalence.mjs` was never part of 2.4's audited set and is deliberately absent from `BOUNDARIES.md` §9's per-checker classification table for that reason — it was not run through this child's classification process, only through 8.5's later aggregate sweep.
- `ls script/check-*.mjs` against current HEAD returns 27, confirming the figure is still current, not stale in the other direction.

**Ship-relevant figure: 27.** This is stated once, here and in `BOUNDARIES.md` §9 (committed as
`8f3a1e34`), specifically so a later reader who sees "26" in an earlier evidence file is not left
to guess whether it is an error or a snapshot from before Stage A.

## Spec-falsification sweep — which of spec §3's acceptance groups this child moved

Source: `dev/0.2.7:rasen/work/opencut-agent-editor-sdk/slices/05-community-beta-second-host/spec.md`
(the elftia repo's `dev/0.2.7` branch, per this portfolio's `planning-context.md` §"Authoritative
documents and a trap" — the main elftia worktree's copy is stale and was not used). Re-read in full
for this section rather than restated from an earlier summary.

### Advanced

- **§3.2 "Both Hosts consume packages, and behaviour does not move" — this child's chief target, and satisfied.** Both `apps/vite-example` and `apps/web` now consume the three published-shape packages rather than a path alias into another app's source (Stage-C/6 rewiring). The editing-parity fixture — spec §3.2's own named oracle — was run before and after extraction and shows zero semantic rows outside the already-documented `__opencutTransaction.idempotency` envelope (task 8.1/8.3). The type baseline did not grow (933 vs. 941 files checked, 2 pre-existing diagnostics, zero new). The alias removal is visible directly in the Stage-C/6 diff.
- **§3.1 "Package boundaries are declared, frozen, and enforced before anything consumes them" — P0 built this; P1 is the first real exercise of two of its five rules, closing a vacuity the portfolio's own tracking file names explicitly.** `.rasen/changes/s05-community-beta-second-host/ephemera/portfolio-run.json`'s P0 result record states: *"public-entry-only passes TRIVIALLY (zero @opencut/* specifiers exist); no-internal-reexport has scanned 0 files. P1 writes the first real consumers and is the first genuine exercise of both rules."* Tasks 7.1-7.4 proved exactly that transition by direct experiment: forcing a synthetic violation of each rule now produces a real `FAIL` over a non-zero scan (task-time Group 7 reading: 329 specifiers examined; 861 files scanned — as of HEAD `af0a52ba`: 328 specifiers; 862 files), and reverting produces a real `PASS` over that same non-zero scope — never the dormant zero-scan state either rule could previously only report. §3.1's other three rules (`acyclic-direction`, `react-free-base`, and the deliberate-inversion negative control referenced in its own Evidence line) were already non-vacuous under P0 and remain PASS; this child did not newly activate them, only re-verified they still hold at the larger post-move scan scope (7.5, 7.6, 8.8).

### Left untouched

- **§3.3 "A second non-Elftia Host runs the same scenarios."** No Electron+Vite reference Host exists yet. This is P2's scope entirely; P1 touches only the existing `apps/vite-example` and `apps/web`.
- **§3.4 "Elftia-absence is enforced by a mechanism, not by an absence."** This is the one import rule inside P0's own boundary checker (B3-ruled), already built and already non-vacuous at P0 per spec.md's own text ("today's baseline is clean"). P1's 27-checker sweep re-ran it and it stayed green, but P1 did not newly exercise it the way it newly exercised `public-entry-only`/`no-internal-reexport` — there was no synthetic-violation probe against this rule in this child's task list, unlike the two §3.1 rules above. Recorded here as a distinction worth keeping rather than folded into "advanced."
- **§3.5 "A third party can run the conformance suite against their own adapter."** No packaging-for-external-consumption or worked third-party adapter exists yet; that is P3's scope (and P6 reuses its harness). Task 9.3 recorded what P3 will find true about the current package shape (raw untranspiled TS, `npm pack --dry-run` verified, no build step) precisely so P3 does not have to re-derive it, but recording a fact for a future child is not the same as advancing this requirement.
- **§3.6 "The public API is versioned `0.x` and its experimental surface is labeled."** No version-policy statement or experimental-surface labeling was added or touched. P5's scope.
- **§3.7 "Installation, embedding, custom storage and Agent examples are published."** None of the four named examples exist yet, nor their CI execution against installed tarballs. P6's scope.
- **§3.8 "Legal and provenance closure sufficient for a beta."** `SOURCE_INVENTORY.{md,json}` and `PATCHES.md` were not regenerated by this child — task 9.2 explicitly recorded *why they cannot be, correctly, yet* (the generator's `AREAS` constant does not include `packages/*/src`, so every `git mv` out of `apps/web/src` currently misreports as a deletion) and handed that finding forward to P7, rather than regenerating a wrong inventory here. P7's scope.

### Incidental, not counted as "advanced"

- **§3.9 "Inherited-input closure"** names three bullets this child's own work happens to bear directly on, without §3.9 being what this child was scoped to satisfy: "both existing Hosts stay green" (both did, per the verification ledger above), "the frozen contracts are not redefined during extraction" (task 8.7's frozen-signature audit found zero signature differences on all four frozen surfaces), and "`apps/desktop` remains excluded" (untouched — not in this child's move set, and `check-distributable-boundary.mjs`'s `no-desktop-app` rule stayed PASS through the real production build in 8.5). Named here rather than silently folded into either the "advanced" or "untouched" list, because it is true and load-bearing but was not the requirement this child set out to move.

Being explicit about what P1 did *not* advance is, per team-lead's stated rationale for asking for
this section, as valuable as what it did — it is what stops a later reader assuming coverage that
was never claimed.

## The +9/-9/-2 attribution: resolved by per-test title diff

Team-lead rejected leaving this as a disclosed-but-unresolved residual and specified the method:
capture the per-test pass/fail title list at both endpoints and diff by title, sorted, either to a
stable named-test attribution or to an explicitly recorded flake set. Done below; both branches of
that method fired, on two different slices of the discrepancy.

**Method.** Console-log scraping was tried first and abandoned: a wrapper test
("C5 storage RED controls run in an isolated process") spawns a child `bun test` process, and when
that child fails unexpectedly bun embeds the child's own raw stdout — its own file-header and
`(pass)`/`(fail)` lines — inline inside the parent's `error:` diagnostic. A naive line-scraper reads
that nested dump as nine fresh top-level tests, producing a false "9 tests vanished" reading that
cost real time before being disproved by checking the file exists identically at both endpoints.
Switched to `bun test --reporter=junit`, which sources titles from bun's own test registry rather
than scraped console text and is immune to this contamination.

**Cross-endpoint result (`8437084b` baseline vs. current HEAD, JUnit-to-JUnit, one run each side).**
665 test cases at both endpoints — `comm` on the sorted full title sets shows **zero titles unique
to either side**: the move added, removed, and renamed nothing. Diffing the sorted FAIL-title sets:
zero titles newly failing at HEAD, and **exactly eight named tests flip FAIL(baseline) → PASS(HEAD)**:

- `C5 runtime asset boundary deleted-file regression > ignores deleted cached paths but still scans an existing production file`
- `C5 storage RED controls run in an isolated process`
- `C6 emitted boundary rejects a non-empty truncated Vite graph`
- `C6 emitted boundary rejects a padded graph that truncates each attributable root`
- `C6 resource boundary negative controls prove every rule can fail`
- `C6 resource boundary scans a non-empty inventory and stays clean`
- `corpus isolation > no module imports the committed corpus`
- `corpus isolation > no source imports a corpus JSON file by any relative path`

All eight are boundary-checker and corpus-placement tests — exactly the class P0's own
`vacuityCaveat` flagged as passing trivially before real consumers existed (`public-entry-only` and
`no-internal-reexport` had scanned zero `@opencut/*` specifiers). This child writes the first real
consumers; these eight going green is that rule finally being exercised for real, not noise. This
closes the arithmetic exactly: 650 baseline-pass + 8 = 658 HEAD-pass; 15 baseline-fail − 8 = 7
HEAD-fail; zero residue. The seven tests still FAIL at both endpoints are **one C5 dot-segment case
+ one editor-singleton case + five `resolveTrackPlacement` cases** (measured from JUnit; not six
`resolveTrackPlacement` cases as an earlier draft of this section stated) —
`C5 mounted-base dot-segment emitted-asset RED controls > rejects literal and encoded dot-segment
escapes after URL canonicalization`, one `editor singleton boundary > ...` case, and five
`resolveTrackPlacement > ...` cases — pre-existing and unrelated to the move.

**The informal "+9/-9" vs. this "+8/-8": one named flake, isolated by same-tree rerun.** The
baseline scratch tree was run twice with no code change between runs (console log, then JUnit).
Run 1: 649 pass / 19 fail / 5 errors. Run 2: 650 pass / 18 fail / 3 errors. Diffing those two runs'
FAIL sets against each other isolates exactly one title:
`project persistence rewiring runs with the wasm test double` — FAIL in run 1 (a 5000ms
subprocess-spawn timeout), PASS in run 2, same commit, same tree. That is the entire off-by-one: it
is a flaky test at the baseline endpoint, not a fixed-then-refound regression and not a third
untraced contributor. The baseline errors-count delta (5 → 3 across its own two runs) is fully
explained by two effects, not a new one: this same flaky test's timeout cascades into two distinct
top-level `error:` lines in run 1 that simply do not occur in run 2, and the pre-existing
`editor singleton boundary` failure changes **failure mode, not status** between the two runs (a
5000ms timeout plus a secondary assertion error in run 1, vs. a fast 782ms single assertion mismatch
in run 2) — still FAIL both times, unrelated to the move, just noisier under one run's timing.

**HEAD-side stability — corrected.** An earlier draft of this section claimed HEAD was run twice
(console, then JUnit) with FAIL-title sets matching exactly, and concluded "HEAD has zero run-to-run
instability." That comparison and that conclusion were both wrong, on two separate points, one
representational and one real.

First, the representational point (still valid, kept from the earlier draft): the PASS-title sets
between a console run and a JUnit run at the same tree do differ by line count — an 88/89-line
mismatch — but that mismatch is a rendering artifact, not an existence difference, and is fully
accounted for by two effects: (1) bun's own JUnit writer double-escapes and reverses the join order
for `classname` on any 2+-level nested `describe` (raw XML: `classname="getProjectId &amp;gt; V0 to
V1 Migration"`, i.e. inner-before-outer with a literally double-escaped separator) — every
nested-describe test's JUnit-derived title string differs cosmetically from its console-derived title
string; (2) one legitimate test (`invalid > prefer-object-params > function f(...)`) has a title
containing literal embedded newlines and a tab (it is a lint-rule fixture whose test name is a
source-code snippet), which a line-oriented text file splits into extra physical lines, inflating a
raw line count by one without adding a real test.

Second, the real point, which the earlier draft got backwards: **console-vs-JUnit is not a valid
stability control at all**, because switching reporters changes representation *and* is two separate
process invocations — it cannot distinguish "the tests are stable" from "the tests are flaky and I
happened to compare two different runs." The control that actually licenses a stability claim is
JUnit-to-JUnit, same reporter, two runs, at the same HEAD commit — and that control was run for this
correction (`bun test --reporter=junit`, twice, no code change between runs, at HEAD `af0a52ba`; the
two raw runs and the diff script that compared them are committed at
`evidence/head-stability-recheck/`). Result: the seven named pre-existing failures (one
C5 dot-segment case, one editor-singleton case, five `resolveTrackPlacement` cases) were byte-identical
in both runs — this is what licenses treating them as stable and unrelated to the move, not the
console-vs-JUnit comparison the earlier draft cited. But the two JUnit runs were **not** otherwise
identical: run 1 reported 8 failing testcases, run 2 reported 10, with exactly two testcases failing
in run 2 only — `C5 storage RED controls run in an isolated process` and `production Host composition
runs in an isolated wasm-mock process`. Both fail with a bare `AssertionError`, zero assertions
recorded, at ~5.0s — the same subprocess-spawn-timeout signature already documented above for the
baseline endpoint's own flake (`project persistence rewiring runs with the wasm test double`, a
5000ms timeout). These are wrapper tests that spawn a child `bun test` process each; that spawn is
timing-sensitive under system load and is a real, separate source of run-to-run instability at HEAD,
not a representational artifact and not a regression. **"HEAD has zero run-to-run instability" is
therefore not a true blanket claim and is withdrawn.** The narrower claim that does hold: the seven
named persistent failures are stable across same-reporter reruns at HEAD, and the cross-endpoint
8-flip decomposition above used the identical JUnit-based method on both endpoints, so the two
representational artifacts described above apply symmetrically to matching tests at both ends and
cancel out in that `comm` diff. One caveat on that 8-flip list follows directly from this
correction: `C5 storage RED controls run in an isolated process` — one of the eight named
baseline-FAIL → HEAD-PASS flips — is itself a member of the same flaky isolated-process-wrapper class
just found unstable at HEAD, so that one flip should be read as "usually PASS at HEAD, occasionally
times out under subprocess-spawn load," not as an unconditionally deterministic result. The other
seven flips are not isolated-process wrappers and are not implicated by this finding.

## The C6 catch, and the sibling-sweep lesson it is one instance of

Written up in full at task 8.6 (see the "One genuine regression was found and fixed mid-task"
paragraph): regenerating C6's build-provenance fixtures updated `assetManifestSha256`,
`observedBuildId` and `buildIdSha256`, correctly, via the repo's existing non-destructive generator
— but the two fixtures the checker cross-validates
(`c6-session-resource-closure-anchor.json` and `c6-session-resource-expected-closure.json`) are a
**matched pair from one regeneration run, not independent files**, and updating one without the
other's `provenance.next.buildId` broke the pair's own consistency check (1 fail → 5 fail). A third,
easy-to-miss value — the hardcoded `provenance.baseCommit` literal — deliberately does **not** move
with the rest of the block, because it is pinned to the last *reviewed* source-closure audit rather
than to "whenever the fixture was last regenerated"; a naive full-block overwrite would have traded
one mismatch for a different one. The fix touched exactly `provenance.next.buildId` and nothing
else in that block; `bun test script/__tests__/c6-session-resource-boundary.test.mjs` went from
5 fail to 0.

**This is the same shape as three other findings in this child, and it recurred a fourth time after
being written down the first time** — see the housekeeping disclosure immediately below for the
full four-instance account and why this is this child's central process lesson, not an incidental
one.

## Housekeeping disclosure

### The `.scratch-*` premature deletion

Reported to team-lead when it happened, no penalty assessed since the content survived in the
committed write-ups; recorded here in the file itself per team-lead's instruction, because a report
that discloses its own repeat failure is more trustworthy than one with nothing to disclose, and it
belongs where a reviewer will see it rather than only in chat history. Files prefixed `.scratch-*`
under `evidence/` were deleted as working scratch once their content had been folded into the
permanent evidence files — correct in principle, but done at a point where their content had not
yet been fully verified as folded in, repeating a pattern this child had already been warned about
once.

### The fourth instance: four non-`.scratch-*` leftover artifacts

Team-lead's newest message identified `apps/vite-example/only-in-A.txt`,
`apps/vite-example/only-in-B.txt`, `file-to-entry.json` and `rename-map.json` as leftover working
artifacts from this child's own file-move tooling, left in the tree because they are not
`.scratch-*`-prefixed — a literal reading of the cleanup instruction that missed its intent. All
four are deleted as part of this same round of fixes (plain filesystem deletion; they were never
git-tracked, so no git action is required beyond the deletion itself).

### Naming this as the child's central, four-times-recurring lesson

Team-lead named this the **fourth** occurrence, in this child alone, of one shape: fix (or clean up)
one of a pair or set of same-class, same-purpose things, and leave a sibling untouched because it
does not match the literal surface form of the instruction, rather than the class the instruction
was actually about.

1. **Package names fixed, arity literals left** (Stage-C repair class, task 3.5/4.x territory).
2. **Matching logic fixed, its message text left** (a checker-triage finding from Group 4/5).
3. **`@import` fixed, the sibling `@source` left** — this child's own Blocker, above: line 3 was
   updated, line 25 three lines away was not, for six days invisible to every mechanical gate.
4. **`.scratch-*`-prefixed files deleted, four same-class siblings left** — this section.

My own earlier refinement of this lesson (recorded as "sweep for siblings, but classify which are
anchors" after the first instance) was the correct diagnosis and was written down after instance
one — and it still recurred three more times, twice after being written down. That is the finding
worth stating plainly rather than softening: writing a lesson down is necessary but was not
sufficient here, because each recurrence was a *new* instance of the same abstract shape (a package
name vs. an arity literal; a matching rule vs. its message string; an `@import` vs. an `@source`; a
prefix convention vs. the class of thing the prefix was meant to denote) rather than a repeat of the
exact same concrete mistake a written-down lesson would catch by pattern-matching the literal case.
The operative instruction for future sweeps, restated once more because restating it a second time
plainly has not been enough on its own: **when an instruction or a fix names one member of a
same-purpose pair or set, treat every other member of that same class as in scope by default, and
require a stated reason to leave one out — not the reverse.**

## Task closure

56 / 56 tasks complete in `rasen/changes/s05-package-extraction/tasks.md`. Two items are worth
naming explicitly rather than left implicit in that count:

- Task 8.1's acceptance line was corrected in place, not silently reworded, to match spec.md's
  actual envelope-aware bar rather than a stricter envelope-free bar copied from a stale line in
  `design.md`'s Decisions §E8 (design.md's own Goals section already had the correct, envelope-aware
  wording — only §E8 was stale). `design.md` §E8 itself was subsequently restated too, in commit
  `6c4a4421`: it now reads "29 differences — 20 semantic, 9 incidental — across 275 leaf values" with
  the same idempotency-envelope language the Goals section already carried, plus an inline note
  explaining why the old "9 differences, 0 semantic, 195 leaf values" figure went stale (it predated
  the `__opencutTransaction` subtree landing six days after it was written). This was not this
  child's stated brief — `tasks.md`/`PARITY.md` was — but the correction was made anyway once the
  staleness was identified, so it is no longer an open item.
- Task 9.2 and 9.3 are explicitly forward-recording tasks for P7 and P3 respectively, not closures
  of §3.8/§3.5 — see the spec-falsification sweep above for why recording a fact for a later child
  is not counted as advancing that child's requirement.

## Limitations retained

- **Bucket-C checkers** from task 2.4's audit (`check-session-state-boundary.mjs`,
  `check-storage-boundary.mjs`, `check-transaction-boundary.mjs`, `check-port-boundary.mjs`) each
  independently reimplement `@/` specifier resolution — flagged in `BOUNDARIES.md` §9 as a
  duplication liability for P2, not fixed here.
- **`check-emitted-runtime-assets.mjs`'s relative-import-escape finding** on the raw-copied
  `worker.ts` Next places under `static/media/` is a pre-existing, non-regression finding (same
  import depth existed identically before the move) and is not fixed in this child.
- **The two TS2769 diagnostics** on `update-pipeline.test.ts`/`resolve.test.ts` are a pre-existing
  test-authoring defect, byte-identical to task 5.4's already-recorded finding, and are not fixed
  here for the reason 5.4 already gave.
- **§3.4's Elftia-absence rule was re-verified but not newly exercised** by this child in the way
  the two §3.1 rules were — see the spec-falsification sweep's "left untouched" reasoning for §3.4.
