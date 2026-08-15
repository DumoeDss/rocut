# Review report — `s05-package-extraction` (S05 P1)

Reviewer: independent non-author reviewer (the same reviewer who ran P0 across four rounds).
Date: 2026-08-14. Scope: the 21 commits `8437084b..af0a52ba` on `feat/s05-community-beta` in rocut.

**Verdict: `findings` — 0 Blockers, 2 Majors, 4 Minors, 2 Trivials.**

Neither Major falsifies an acceptance claim this child makes. Both are stale build-configuration
paths left behind by the move — the same defect class as this child's own Blocker, in files adjacent
to the one it fixed, and both undisclosed. The child's central acceptance claim (the two vacuous
rules became non-vacuous) is **confirmed**, the frozen-signature audit is **confirmed independently**,
and the parity ruling is **upheld**.

---

## Method

Everything below was executed unless marked *unproven*. Live runs against the real repo; five
independent re-derivations (frozen-signature content diffs, two full `bun test` runs plus a third
JUnit run as a stability control, a boundary-checker diff audit, a build-config path sweep). rocut's
working tree was not modified — only this report file is written.

---

## 1. Rule activation — the acceptance that actually matters — **CONFIRMED**

Live at HEAD:

```
PASS  public-entry-only  (963 file(s) scanned, 328 @opencut/* specifier(s) examined)
PASS  no-internal-reexport (862 file(s) scanned)
```

Both assertions the LEAD named are satisfied, and I checked the right thing — the **revert** state,
not the failure:

- `public-entry-only` passes at exit 0 **with a non-zero specifier count (328)**. At P0 this was
  literally `0 @opencut/* specifier(s) examined`. The vacuous state does not reproduce.
- `no-internal-reexport` no longer prints the `....` dormant marker at all; it reports `PASS` over
  **862 real files**. Task 7.4's reasoning is correct and I verified its mechanism: `no-internal-reexport`
  is *still* listed in `DORMANT_RULE_IDS`, so the script would print the dormant line if the scan set
  were empty. It does not, because `packagesSourceFiles()` now returns real files. The rule genuinely
  activated rather than merely stopping its announcement.

**The activation was not bought by weakening anything.** P1 modified P0's checker (+109/−32,
`2552ddc8`), which I audited line by line. Every change is **scope-widening**: `resolveSpecifier`
gains bare `@opencut/*` resolution through manifest `exports` (previously it returned `null`, so
package edges were invisible); `ownerOfPath` gains `packages/*/src/` ownership from the manifest
list; `acyclicDirectionRule` and `reactFreeBaseRule` extend their scope filters to
`packages/*/src/`; and — importantly — `guardUnownedFiles` was extended to fail closed over
`packages/*/src` as well, so the fail-closed guard followed the source rather than being left behind.
**No rule was removed, no predicate relaxed, no exemption added.** Without these changes the 863
moved files would have fallen out of scope entirely and the edge census would have collapsed toward
zero while still printing `PASS` — the exact failure P0's design named as the thing to watch for.

Controls at HEAD: **14/14 negative, 12/12 converse** (see MINOR-1 for the report's "15/15").

## 2. Frozen S03+S04 signatures — **CONFIRMED INDEPENDENTLY, no `failed` condition**

I did not rely on task 8.7. I content-diffed each frozen surface against its pre-move location in
`8437084b` myself:

| frozen surface | changed lines | nature |
| --- | ---: | --- |
| transaction contract barrel → `packages/editor-classic/src/editor/transactions/opencut/index.ts` | **0** | byte-identical |
| engine → `packages/editor-contracts/src/engine/engine.ts` | 4 | `@/editor/ports` → `@opencut/editor-ports`, same imported names |
| ports barrel → `packages/editor-ports/src/index.ts` | 7 | doc-comment path prose; `NavigationHost` re-export `from` `../host/editor-host` → `./host` |
| `editor-host.ts` → `packages/editor-ports/src/host/index.ts` | 2 | `@/editor/ports` → `..`; `EditorHostNavigation` body byte-identical |
| Surface embedding types → `packages/editor-classic/src/editor/surface/embedding/types.ts` | 4 | `@/editor/session*` → relative, same type names |

Every difference across all five files is import-specifier or doc-comment churn from the physical
relocation. **No exported name, type shape, or member composition changed on any frozen surface.**
The `NavigationHost` re-export changed only its `from` path, and `./host` resolves to
`packages/editor-ports/src/host/index.ts`, which the manifest also declares as `"./host"` — the
exported name and type are identical. Task 8.7's audit is accurate as written.

## 3. Parity — **the ruling is upheld, and the runs rest on a working Host**

- **Spec §3.2 verbatim** (read from the governance worktree, `dev/0.2.7`): *"The
  S01/S02/S03+S04 parity comparison must show zero semantic rows outside the already-documented
  idempotency envelope."* All 20 semantic rows sit inside
  `project.__opencutTransaction.idempotency[*]`. Zero fall outside. **The requirement is met as
  written, not approximated.** The LEAD's ruling is correct.
- **The classifier is untouched.** `script/diff-parity-snapshots.mjs` and
  `apps/vite-example/tests/parity/snapshot.ts` are byte-identical to `8437084b` **and** to HEAD
  (`git diff` empty in both directions). The working tree is clean — the stale ` M` from the
  stat-cache effect has cleared, so there is no residual ambiguity. Both refusals to permit that
  edit held.
- **The final parity result rests on runs from a working Host, and this is checkable rather than
  assumed.** Two independent facts establish it: (a) the pre-move side was built from a
  `git archive` of `8437084b`, which predates Stage C — at that commit `@source "../../web/src"`
  was still *correct*, so the baseline Host was never broken; (b) the post-move side's evidence
  commit `6c4a4421` is **newer than the fix commit `84dfc088`** in the log order. So neither side of
  the comparison is a degenerate run. Had the reclassification the LEAD twice halted landed while
  the Host was broken, this check would not have been available — the halt is what preserved it.
- Inheritance: `PARITY.md` records the same 20 semantic and 9 incidental **paths** appearing
  identically pre- and post-move. I did not re-run the two-Host parity fixture myself (it needs both
  production builds and a browser); the path-set inheritance claim is therefore **verified as
  recorded, not independently reproduced**.

## 4. The 8-test flip — **the finding holds; one supporting claim does not** (see MINOR-3)

I reproduced the HEAD side completely and added a control the child did not run.

- **HEAD console aggregate reproduces exactly**: `658 pass / 10 fail / 3 errors / 3082 expect() /
  668 tests across 110 files`. Every figure matches the report.
- **HEAD JUnit reproduces exactly**: **665 testcase elements, 7 carrying `<failure>`/`<error>`** —
  matching the report's "665 cases both sides" and "7 HEAD-fail", and closing its arithmetic
  (650 + 8 = 658; 15 − 8 = 7).
- **My own stability control, which the report does not contain**: I ran JUnit **twice** at HEAD,
  no change between runs, and diffed the failure sets by `classname > name`. **Identical, zero
  difference.** That is the control that actually licenses a single-run-per-endpoint comparison, and
  it passes. The 8-flip method is sound.

I did not re-run the `8437084b` baseline (the portfolio forbids a second worktree, and a
`git archive` rebuild plus full suite is disproportionate here). **The baseline-side figures are
therefore verified as recorded, not independently reproduced.** The mechanism claim is
independently plausible: all eight flipped titles are boundary-checker and corpus-isolation tests,
i.e. exactly the class that could not have been exercised before `packages/` held source.

## 5. Task 8.1 — **ruling upheld; not the same move wearing better clothes**

The LEAD asked to be second-guessed here. I tried to falsify the amendment and it survived, on
evidence external to both the LEAD and the implementer.

The discriminator between "correcting a derived restatement" and "moving a bar to fit a result" is
whether the looser reading is **independently attested in a source that predates the result**. Three
findings, each checked directly:

1. **Slice spec §3.2, lines 80-81, predates the child**: *"zero semantic rows outside the
   already-documented idempotency envelope."* The envelope is in the governing text.
2. **`design.md` Goals, line 40, predates the child's result**: *"Zero semantic parity rows outside
   the documented idempotency envelope."* The same carve-out, in the child's own design, in the
   section that states its goals.
3. **The stale §E8 has a documented, dated reason for lacking it.** `6c4a4421`'s diff shows §E8
   originally read *"Acceptance is zero semantic rows"* and recorded *"9 differences, 0 semantic,
   195 leaf values"* — accurate when written on **2026-08-04**, against a baseline that predated
   `__opencutTransaction`, which landed six days later at `14797382` and added 80 leaf values that
   paragraph was never re-run against. So the strict wording is a **fossil of a measurement taken
   before the thing being measured existed**, not a deliberate standard someone later found
   inconvenient.

That is decisive. A bar-moving move has *no* pre-existing source for the looser reading; here the
looser reading is the authoritative one in two places and the stricter one is traceable to a
specific stale measurement with a date. The amendment was recorded in place with the original
wording quoted verbatim, which is the right form.

**One caveat worth stating plainly, since it is the part that will look bad in a year:** the
amendment was still made by the author, after the result was known, to a line governing that result.
What makes it sound is not the authorization but the external corroboration. **The generalization
P2–P7 should inherit is the test, not the precedent**: an acceptance line may be amended only when
the looser reading is independently attested in a source that predates the result, and the original
wording is quoted verbatim in the artifact. Both held here. Neither is automatic.

## 6. Scope discipline and honesty — **mostly good; §3.4/§3.9 handling is honest**

- **The §3.4 / §3.9 "incidental rather than advanced" distinction is honest, not evasive.** The
  test for evasion is whether the classification *lowers* what the child must show. It does the
  opposite here: §3.9's three bullets are all *satisfied* (both Hosts green, frozen contracts not
  redefined, `apps/desktop` excluded), and the child could have claimed them as advanced. It
  declined, on the stated ground that it did not set out to satisfy them. §3.4 likewise: the rule
  was re-run and stayed green, but no synthetic-violation probe was fired at it the way tasks 7.1-7.4
  fired at the two §3.1 rules, and the report says exactly that. **Claiming less than you could is
  the opposite of evasion.** I would have flagged the reverse.
- Pre-existing failures (2 × TS2769, `check-emitted-runtime-assets` relative-import escape,
  Bucket-C `@/`-resolution duplication) are disclosed and not fixed — correct, and each carries its
  reason.
- `SOURCE_INVENTORY` deliberately not regenerated, with the generator defect (`AREAS` lacks
  `packages/*/src`, so every `git mv` misreports as a deletion) recorded and handed to P7 rather
  than a wrong inventory generated. Correct call.
- Checker count **27 at HEAD, confirmed** by `ls script/check-*.mjs`. The 26-vs-27 reconciliation is
  accurate: `check-resolution-equivalence.mjs` was added by Stage A after task 2.4's audit ran.

---

# Findings

## MAJOR-1 — the C7 vite headless proof's react-control injection is silently inert; the same alias array had its `replacement` halves updated and its `find` halves left stale

**Where:** `apps/vite-example/vite.headless.config.ts:8`, `:47`, `:50`.

```js
const webSrc = resolve(repoRoot, "apps/web/src");          // :8  — still points at the emptied tree
...
{ find: "@/editor/session/headless-proof-control",          // :47 — specifier form no longer exists
  replacement: reactControl ? injectedControl : neutralControl },
{ find: "@", replacement: webSrc },                         // :50 — no @/ specifier can reach it
```

**What happened.** Commit `5ab8b192` edited this exact alias block. Its diff updates
`neutralControl` and `injectedControl` from `webSrc` to `editorClassicSrc` — the **replacement**
halves — and leaves both **find** halves untouched.

**Why the find halves are now dead, measured:**

- `apps/vite-example/src/headless-entry.ts` imports `runHeadlessProofControl` from
  `@opencut/editor-classic/evidence`, a package specifier — not `@/editor/session/headless-proof-control`.
- `packages/editor-classic/src/evidence/index.ts:37` re-exports it as
  `export * from "../editor/session/headless-proof-control"` — a **relative** specifier.
- `git grep -l 'from "@/' -- 'packages/**'` returns **zero files**. No `@/` specifier survives
  anywhere in the package graph, so neither alias entry can ever match.

**Failure scenario.** Someone runs the C7 vite headless proof with `OPENCUT_C7_REACT_CONTROL=1`. The
alias that is supposed to swap `headless-proof-control.ts` for
`headless-proof-control-react-browser.ts` never fires, so **both the neutral and the React variant
resolve to the same module** — the neutral one, through the barrel's relative import. The build
succeeds. `check-headless-semantic-result.mjs` compares two runs that are now identical by
construction, and a react-vs-neutral discrimination that proves nothing reads as a passing proof.

**This is the child's own failure mode, one file over.** The Next half of the *same* proof was
updated correctly — `apps/web/next.config.ts:43,47` points at
`packages/editor-classic/src/editor/session/headless-proof-control{,-react}.ts`. The Vite half was
half-updated. It is also strictly worse than the Blocker in one respect: the `@source` defect was at
least catchable by the parity oracle, and the report's "the finding that must not get lost" section
says so. **This one is invisible to the parity oracle too** — nothing in P1's gate set, including
parity, touches the C7 headless proof. Task 6.5 even ran `vite build --config vite.headless.config.ts`
and recorded "44 modules transformed cleanly": a green build that had already lost the property.

**Undisclosed.** `tasks.md` mentions this file twice (barrel-leak module count at :676, a missing
`wasm()`/`topLevelAwait()` plugin pair at :682) — so it was inspected during the child, and a
*different* sibling asymmetry in it was noticed and recorded while this one was not.

**Fix:** repoint `find` to the specifier the entry chain actually emits (or drop the alias and
select the control by build-time `define`/entry swap), and delete or repoint `webSrc`.
**Confidence: high** — every step above is a direct grep or file read, not inference.

## MAJOR-2 — a storage-boundary verification probe resolves a path the move deleted

**Where:** `apps/vite-example/tests/probe/legacy-migration.pw.ts:47-50`.

```js
const MIGRATIONS_INDEX = resolve(HERE, "../../../web/src/services/storage/migrations/index.ts");
```

`apps/web/src/services/storage/migrations/index.ts` **does not exist** (verified); the file is now
`packages/editor-classic/src/services/storage/migrations/index.ts`. The probe reads that file to
parse `CURRENT_PROJECT_VERSION` out of source rather than importing it — a deliberate design so the
probe "cannot drift from the source while importing nothing." Post-move it drifts absolutely: the
read throws `ENOENT`.

**Why nothing caught it.** This is a Playwright probe, not a `bun test` case, so it is outside the
658/10/3 sweep; and it is one of exactly three programs
`check-storage-boundary.mjs` allowlists for direct browser-mechanism use, so it is a file the
boundary design treats as load-bearing. Undisclosed in the change artifacts.

**Failure scenario.** P2 or a later child runs the C5 legacy-migration probe and gets an ENOENT on a
path string, not a migration finding. Fails loudly rather than silently, which is why this is Major
and not a Blocker.

**Fix:** repoint the path at `packages/editor-classic/src/...`. **Confidence: high** (path existence
verified both ways).

## MINOR-1 — the closure ledger reports "Negative controls 15/15" where the actual figure is 14/14, and the child had already corrected it elsewhere

`evidence/implementation-report.md:28` reads `| Negative controls | 15/15 caught (5 rules) |`.
Live at HEAD: **14 negative fixtures, 14 caught**; the `NEGATIVE_FIXTURES` array in
`check-package-boundary.mjs` has 14 entries, and P1 did not add any (its checker diff is
resolution/scope only). Converse 12/12 is correct.

What makes this worth reporting rather than a typo: **`tasks.md:87` already carries the correction** —
*"re-verified (14/14 negative, 12/12 converse — a correction to 1.4's '15/15' prose, not a live
change)"*. So the child found and fixed the number in one artifact and left it standing in the
closure artifact written afterwards. That is the child's own four-times-recurring pattern a further
time, in its own report. **Confidence: high.**

## MINOR-2 — the closure report states a limitation that its own commit had already resolved

Two places in `evidence/implementation-report.md` — the Task-closure bullet and the "Limitations
retained" bullet — say `design.md` §E8 *"remains stale relative to its own Goals section; flagged,
not edited, per this child's stated brief."*

That is false at HEAD. Commit **`6c4a4421`**, titled *"…parity evidence + **restate stale E8**"*,
edits `design.md` §E8: it replaces *"Acceptance is zero semantic rows"* with *"Acceptance is zero
semantic rows outside the documented idempotency envelope"*, updates 9/0/195 to 29/20/9/275, and
adds a dated provenance note explaining the staleness. The fix is good work; the report then
disclaims it.

Direction of error is self-deprecating, which is the safe direction, but it is still a false
statement in the artifact a later reader consumes, and it would send P7 or a ship step to re-fix
something already fixed. **Confidence: high** (commit diff read directly).

## MINOR-3 — the report's HEAD run-to-run stability claim is false as stated, and its named list of persistent failures is wrong; the load-bearing comparison survives

Two separate inaccuracies in the strongest evidence section.

**(a) Stability.** The report claims: *"HEAD was also run twice (console, then JUnit; no code change
between runs). FAIL-title sets matched exactly — zero difference. … HEAD has zero run-to-run
instability."* My console run and my JUnit run at the same tree produce **different failure sets by
membership, not representation**: `C5 mounted-base dot-segment emitted-asset RED controls > rejects
literal and encoded dot-segment escapes after URL canonicalization` fails only in the JUnit run;
`editor singleton boundary` fails a *different case* in each (`the complete runtime graph has no
implicit editor owner` vs `negative control detects singleton-accessor`); and `resolveTrackPlacement`
fails overlapping-but-different subsets. These are distinct test names, so the report's explanation
(nested-`describe` classname rendering plus one embedded-newline title) does not cover them. There
is genuine run-to-run flakiness at HEAD in these timing-sensitive suites — the same flakiness the
report documents at the baseline endpoint and then declares absent at HEAD.

**(b) The named seven.** The report says the persistent failures are *"(`editor singleton boundary >
…`, six `resolveTrackPlacement > …` cases)"*. Measured from JUnit, the seven are **one C5
dot-segment case + one editor-singleton case + five `resolveTrackPlacement` cases**. The C5 case is
named nowhere in the child's artifacts.

**Why this is Minor and not Major: I ran the control the report lacks, and the conclusion holds.**
JUnit-to-JUnit at HEAD, two runs, no change between them: **identical failure sets, zero
difference.** The cross-endpoint 8-flip used JUnit on both sides, so the comparison that carries the
finding is stable and the arithmetic reproduces exactly (665 cases, 7 HEAD failures, 650+8=658,
15−8=7). The defect is that the report offers a *console-vs-JUnit* comparison as its stability
evidence — which is the one comparison that is unstable — and asserts the artifacts "cancel out"
on that basis. Substituting the JUnit-vs-JUnit control repairs it. **Confidence: high** (three full
suite runs).

## MINOR-4 — the closure ledger presents task-time census snapshots as HEAD figures

The ledger reports `962 files / 329 edges`, and the §3.1 sweep reports `329 specifiers examined;
861 files scanned`. Live at HEAD: **963 files / 329 edges**, **328 specifiers**, **862 files**. The
numbers are task-time measurements (Group 7) restated in a closure document that describes itself as
re-read "from a fresh command this session". The drift is one file and one specifier — immaterial to
every conclusion — but it is the same class as round-1's MINOR-4 in P0 (`design.md`'s stale 138
edges), and the same remedy applies: name the commit a census was taken at, or re-take it at HEAD.
**Confidence: high.**

## TRIVIAL-1 — ~25 empty directories left under `apps/web/src` by `git mv`

`actions/`, `animation/`, `background/`, `canvas/`, `clipboard/`, `commands/`, `core/`, `data/`,
`diagnostics/`, `effects/`, `export/`, `fonts/`, `fps/`, `gradients/`, `graphics/`, `guides/`,
`hooks/`, `masks/`, `media/`, `panels/`, `params/`, `preview/`, `rendering/`, `retime/`, `ripple/`
and others each contain **0 tracked and 0 on-disk files**. Git does not track directories, so `git
mv` leaves the parents behind and `git status` cannot show them. Harmless to every `git ls-files`-based
checker (the house idiom), but a reader or a filesystem-walking tool sees ~25 phantom module
directories that no longer exist. One `find … -type d -empty -delete` under `apps/web/src`.

## TRIVIAL-2 — the evidence directory holds six files, none of them the load-bearing ones

`evidence/` contains `gate-1-alias-resolution.md`, `gate-1-pre-move-baseline.md`,
`group-2-checker-scope-audit.md`, `group-2-control-rerun.md`, `group-2-type-baseline-reach.md`,
`implementation-report.md`. The primary records for the four highest-value tasks — 7.1-7.4 rule
activation, 8.1/8.3 parity, 8.6 the test flip, 8.7 the frozen-signature audit — exist only as prose
inside `tasks.md`. See the housekeeping assessment below; this is the shape the `.scratch-*`
deletions left.

---

## Process assessments

### The repeat housekeeping violation — disclosure adequate; review value lost is small but real

**The disclosure is adequate and unusually good.** It names the failure twice, states that the
second occurrence came *after* the first had been named, quotes the LEAD's own framing rather than
softening it, and refuses the comfortable conclusion ("writing a lesson down is necessary but was
not sufficient here"). A report that volunteers its own repeat failure in its own permanent artifact
is doing the thing the discipline is for.

**What was lost, concretely.** Not much, but not nothing. Every claim I most wanted to check turned
out to be checkable — I re-derived the frozen-signature audit, the rule activation, the test
aggregate and the JUnit decomposition from the live tree without needing the deleted artifacts, and
in each case the prose in `tasks.md` was accurate enough to test. What is gone is the ability to
verify the *baseline-side* numbers cheaply: the `8437084b` JUnit XML and the pre-move parity
snapshots would have let me confirm the 8-flip and the 29/20/9 inheritance in seconds instead of
marking them "verified as recorded, not independently reproduced." That is the review value lost —
two of the child's strongest claims are now attestable only by re-running an expensive rebuild.
**Recommendation for P2-P7: raw comparison artifacts on both endpoints of a before/after claim are
not scratch.** They are the only thing that makes the claim re-checkable by someone who was not
there.

### The four-instance pattern — the lesson is well captured, but its *scope* is understated

The write-up is excellent as far as it goes: four instances enumerated, the abstraction named (same
class, not same concrete case), the refinement recorded (`BOUNDARIES.md` §11 — some siblings move
together, some are deliberately anchored, and the C6 `provenance.baseCommit` case is a real,
earned example of an anchor), and the operative instruction restated in imperative form.

**But this review found instances five, six and seven, which means the lesson as written is not yet
strong enough to have caught them.** MAJOR-1 (`replacement` updated, `find` left, in the same array
literal, in the same commit), MINOR-1 (`15/15` corrected in `tasks.md`, left standing in the report
written afterwards), and MINOR-2 (§E8 fixed in one commit, declared unfixed in a later one). All
three are the same shape. Two of them are inside the child's own documentation of the pattern.

The gap is that the stated instruction — *"when an instruction or a fix names one member of a
same-purpose pair or set, treat every other member of that same class as in scope"* — is a rule
about **intent**, and intent is exactly what the actor in the moment is least able to audit. What
would have caught MAJOR-1 is mechanical: **after any path-moving commit, grep the whole tree for the
old path prefix and require a stated reason for every surviving hit.** One `git grep "web/src"` over
non-`.md`, non-`SOURCE_INVENTORY` files surfaces MAJOR-1 and MAJOR-2 in seconds — I found both that
way, in one command, before reading any of the child's reasoning. That is the form P2 can actually
execute; "remember to think about siblings" is not.

### The Blocker fix — complete for the class it names, and the instrument does support the claim

The `@source` repoint is the right layer, and both rejected alternatives (an `inset-x-0` utility, a
safelist entry) were rejected for the right reason: each fixes a symptom of a broken build rather
than the build.

**Does the vite-vs-Next utility-set diff support "nothing else was dropped"?** For the class it
covers, yes — it is the correct instrument, because the failure mode is *missing utility classes*
and a set-difference over emitted utilities is a direct measurement of exactly that, not a proxy.
1063 vs 918 with the gap attributed to one `next/font` asymmetry is a real closure of the specific
hazard. The bundle-size corroboration (35,916 → 123,113) is secondary support, and the report
correctly identifies which of the two competing figures is better corroborated rather than picking
one silently.

**What the instrument does not cover, and this is where MAJOR-1 and MAJOR-2 live:** it measures only
CSS utilities in one build. It cannot see a stale *module-resolution* path in a sibling config, or a
stale filesystem path in a test probe. The claim "nothing else was dropped by the same mechanism" is
true and appropriately narrow — the report says *by the same mechanism* — but the broader question
the LEAD asked, *was any other build-config path invalidated by the move and not noticed*, is
answered **yes, twice**, and neither is reachable by that instrument.

---

## Durable findings for P2-P7

1. **After any path-moving commit, `git grep` the old path prefix across the whole tree and require
   a stated reason for every surviving hit.** This one mechanical sweep surfaces both Majors in this
   review in a single command. The child's four-instance "sweep for siblings" lesson is correct but
   is a rule about intent; this is the executable form of it, and P1 is the proof that the intent
   form alone does not hold.
2. **The gate set has a blind spot with a known shape: anything requiring a live server, a capture
   run, or a browser is outside every mechanical check.** The C7 headless proof (MAJOR-1), the
   Playwright storage probes (MAJOR-2), `check-asset-manifest.mjs`, and the two headless checkers
   all live there. P1's own Blocker was caught only because parity happened to exercise the vite
   Host; MAJOR-1 is in the same blind spot with *no* oracle covering it. **P2 owns a second Host and
   should assume this region is unverified until it runs those programs itself.**
3. **An acceptance line may be amended only when the looser reading is independently attested in a
   source that predates the result, with the original wording quoted verbatim in the artifact.**
   Both conditions held for task 8.1 (spec §3.2 and `design.md` Goals both predate; the stale §E8
   has a dated provenance showing it predated `__opencutTransaction` by six days). Inherit the test,
   not the precedent.

---
---

# ROUND-1 RE-REVIEW — delta `af0a52ba..1e5a337c` (9 commits)

Appended 2026-08-14 by the same independent non-author reviewer. **Round 1 above is unaltered.**
Scope: the 9 fix commits only; the 21 already passed are not re-reviewed.

**Delta verdict: `clean` — 0 open Blockers, 0 open Majors.**

Both Majors, sweep bug #3, all four Minors and both Trivials are **confirmed resolved**, each
reproduced. Four new items surfaced, all Minor or Trivial. The C7 proof is now genuine — this is the
finding that mattered most and it is the one most convincingly closed.

## Method (round 2)

Live runs against the real repo; field-level diffs of all four C7 evidence files; three test runs;
one re-derivation of the pre-move parity diff from committed bytes; a post-fix repeat of the
whole-tree `apps/web/src` sweep with an existence check on every hit. rocut's working tree was not
modified — only this report file is written.

---

## Priority 1 — the C7 proof — **GENUINE. The arms differ in substance, not in a label.**

My round-1 MAJOR-1 was that the react-control injection was inert, so both arms resolved the same
module while the run read as passing. I diffed all four evidence files field by field, ignoring
timestamps, ports, digests and paths.

**Vite: 37 substantive fields differ between neutral and react.** Not a label — causal work:

| field | neutral | react |
| --- | ---: | ---: |
| `graph.moduleCount` | 16 | **33** |
| `runtimeProbe.react.mountAttempts` | 0 | **3** |
| `runtimeProbe.react.mutationRecords` | 0 | **2** |
| `runtimeResourceCounts.workers` / `.audioContexts` / `.timers` / `.animationFrames` | 0 / 0 / 0 / 0 | **2 / 2 / 2 / 1** |
| `compositorGpu.ownershipAttempts` / `.webGpuAdapterRequests` / `.wasmInstantiations` | 0 / 0 / 0 | **4 / 1 / 2** |
| `graph.negativeControl.status` | *(absent)* | **`expected-rejection`** |
| `graph.negativeControl.rule` / `.issueCount` | *(absent)* | **`forbidden.react-family` / 17** |

Seventeen extra modules, three mount attempts, two observed DOM mutations, a spawned worker, an
AudioContext, a WebGPU adapter request and four compositor-GPU ownership attempts are not
producible by relabelling a build. **(a) is answered: the injected React is doing observable work.**

**(b) The Next explanation is sound, and it is corroborated rather than asserted.** The Next react
arm does show `mountAttempts: 0`, `mutationRecords: 0`, `rootMarkersAfter: 0` — but it is not
indistinguishable from its neutral arm: **24 substantive fields differ**, including
`moduleCount` 18 → 22, `hostResourceState.workers` 0 → 1, `.audioContexts` 0 → 1,
`runtimeResourceCounts.timers` 0 → 2, `compositorGpu.ownershipAttempts` 0 → 4,
`.wasmInstantiations` 0 → 3, and `negativeControl: expected-rejection` with 1
`forbidden.react-family` issue. The zero-DOM result is also *self-describing* rather than
unexplained: the probe records the mount mode in the label itself —
`react:19.3.0-canary-…:server-no-dom` against Vite's `react:18.3.1:browser-mounted`. A server-side
route has no DOM to mutate, so sensitivity has to surface in host-resource and compositor-GPU
fields, and it does. If the Next injection were inert, all 24 of those fields would match, as they
do between the two neutral arms.

**One boundary worth writing down so nobody over-reads it later:** the Next arm proves *the injected
React module is loaded and does work*; it does **not** demonstrate DOM-mutation sensitivity, and
cannot, by construction. The Vite arm is what demonstrates that. The pair covers both properties;
neither arm covers both alone.

**(c) The negative control is genuine on both hosts.** Each react arm's graph is **rejected** —
`status: expected-rejection`, `rule: forbidden.react-family`, 17 issues (Vite) and 1 (Next). The
asymmetry tracks the bundlers: Vite folds the react-family closure into a browser graph, Next's
server route pulls one. Both non-zero, both rejected, and neither neutral arm carries a
`negativeControl` block at all.

**MAJOR-1 resolved.** The React version asymmetry (18.3.1 vs 19.3.0-canary) is itself corroborating:
each arm is resolving React from its own host's dependency graph, exactly as `BOUNDARIES.md`'s
dedupe note predicts, which a shared or faked control could not produce.

## Priority 2 — the second C7 defect — **diagnosis correct, fix correct, neutral arm not weakened**

**The diagnosis is right.** Pre-fix, `@opencut/editor-classic/evidence` was imported *statically as
values* (`runHeadlessProofControl`, `installHeadlessRuntimeProbe`) and *dynamically* from the same
entry files. Rollup folds a specifier reachable both ways into the entry chunk, and the folded chunk
emits a `modulepreload` link — a DOM mutation the runtime probe's MutationObserver correctly
recorded. So the neutral arm was failing its own zero-mutation bar on a **bundler artifact**: a false
positive on the exact control meant to prove zero React-family side effects. That is a nastier bug
than it looks, because it makes the clean arm look dirty and invites someone to relax the bar.

**The fix is the right shape.** `1770d9b0` splits the barrel into two declared subpaths —
`./evidence/headless` (value statics) and `./evidence/headless-semantic-fixture` (the dynamic
import) — so no specifier is both a static *value* import and a dynamic import.

**It does not weaken what the neutral arm asserts, and there is a decisive control for that.** The
fix removed the spurious mutation's *cause*, not the observer: `vite-neutral.json` reports
`mutationRecords: 0`, `mountAttempts: 0`, `rootMarkers 0/0` and all resource counts 0, while
`vite-react.json` reports **2 mutation records** from the same probe in the same session. Had the fix
disabled DOM-mutation detection, the react arm would read 0 too. It reads 2. **The observer is live
and the neutral zero is a real zero.**

**Unprompted bonus, worth crediting:** the same commit added `wasm()` and `topLevelAwait()` to
`vite.headless.config.ts`, closing the plugin-asymmetry gap this child had *disclosed but not fixed*
at task 6.5 — a disclosed limitation actually retired rather than carried.

See `N-3` for a residual fragility in how the fix is held in place.

## Priority 3 — MAJOR-1's fix shape — **deletion is the right call, and nothing depended on it**

`d8159157` deletes `const webSrc = resolve(repoRoot, "apps/web/src")` and its
`{ find: "@", replacement: webSrc }` alias outright, rather than repointing it, and repoints the
control alias's `find` to `../editor/session/headless-proof-control` — the specifier the entry chain
actually emits.

**Deletion is right.** A repointed catch-all would silently resolve any future stray `@/…` into
whichever tree it pointed at; deleting it makes that a hard resolution failure. That is the same
fail-loudly principle the rest of this checker family is built on.

**Nothing depended on it**, measured three ways: `git grep` for `from "@/` returns **0 files** under
`apps/vite-example/**` and **0** under `packages/**`, and `apps/vite-example/tsconfig.json` declares
no `@` path mapping. There is no consumer to strand.

**The repointed `find` resolves correctly.** Exactly two files emit that relative specifier —
`packages/editor-classic/src/evidence/headless.ts:51` and `evidence/index.ts:37` — and both sit at
the same depth, so rewriting both to the same absolute control path is correct rather than a
collision. (A relative string as an alias key is unusual and would be fragile if a module at a
*different* depth ever emitted the same text; none does today. Noted, not a finding.)

## Priority 4 — the c5 scope fix — **817 confirmed; your instruction really would have been vacuous**

**Your warning is confirmed by direct measurement.** `git ls-files "packages/*/src"` passed as a
literal pathspec returns **0 files**. Implementing the instruction literally would have produced a
guard scanning nothing — a vacuous fix for a vacuity, which is the failure mode this whole portfolio
keeps circling.

The implementation avoids it correctly: `readdirSync` over `packages/`, filtered to directories that
exist, each passed as its own literal pathspec.

**817 reproduces exactly.** Running the test's own filter chain — `git ls-files` over
`apps/web/src`, `apps/vite-example/src` and the three enumerated package src dirs, then
`/\.(ts|tsx)$/`, excluding `/__tests__/`, requiring `existsSync` — yields **817**. (The raw
unfiltered pathspec result is 947; 817 is the post-filter figure the test actually scans.)

**No false positives introduced**: the test passes, which is only possible with zero violations
found across the widened 817-file scope. `bun test ./apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts`
→ **1 pass / 0 fail**.

**Best part of this fix, and the reason it should be copied:** it added
`expect(files.length, "persistence-importer scan must not be vacuous").toBeGreaterThan(0)`. That is
P0's "refuse a pass on an empty scan" idiom applied to a test rather than a checker, and it is
exactly the guard that would have caught the literal-instruction version. See `N-4` on the "9 tests"
count.

## Priority 5 — the sweep triage — **category 4 correct; category 3 contains one real miss**

I re-ran the sweep post-fix and added an existence check the triage did not: for every
`apps/web/src/...` path still referenced in live code, does the target exist? **60 references point
at now-missing paths.** I triaged all 60 and all but one bucket is correctly classified.

**Category 4 — correct, verified mechanically.** `headless-webpack-graph-plugin.test.ts` builds its
own world: `mkdtempSync(join(tmpdir(), "opencut-c7-next-graph-"))`, then `writeFileSync` under that
temp root. The `apps/web/src/...` strings are synthetic graph-node identifiers written *into* the
fixture, never resolved against the real repo. The test passes (**5 pass / 0 fail**). The triage
claim is exactly right.

**Category 3 — correct for the documentation and vestigial cases, wrong for one.** Correctly
triaged: `legacy-migration.pw.ts:47-49` (a comment that explicitly documents the old→new move),
`apps/vite-example/tsconfig.json:22` (comment), `packages/boundary.json` entries (deliberately kept
with new "vestigial against the generic `packages/*/src` rule" notes added by `df3bf7ff` — good, that
also closes a gap I had noticed in round 1), `check-host-composition.mjs:22` (references
`browser-host-adapter.ts`, which is *intentionally* absent), and the various checker allowlist
strings. **The miss is `package.json` — see `N-1`.**

## Priority 6 — M-1..M-4 and TRIVIAL-2

- **M-1 resolved.** `implementation-report.md:28` now reads `14/14 caught (5 rules)`, matching the
  live 14 negative fixtures.
- **M-2 resolved.** The report now says §E8 *"was subsequently restated too, in commit …"* instead of
  claiming it remains stale.
- **M-3 resolved, and resolved well.** The report now names the seven persistent failures correctly
  — *"one C5 dot-segment case + one editor-singleton case + **five** `resolveTrackPlacement` cases
  (measured from JUnit; not six…)"* — and replaces the bad stability argument with the right one:
  *"console-vs-JUnit is not a valid [comparison]"*, backed by committed
  `head-stability-recheck/{console-run1,console-run2,junit-run1.xml,junit-run2.xml,junit-diff.mjs}`.
  It states plainly that the earlier draft "got backwards". That is the correct repair.
- **M-4 resolved.** Census figures now carry both readings with commit attribution:
  *"963 files / 329 edges (as of HEAD `af0a52ba`; task-time Group 7 reading was 962/329)"*, and the
  same treatment for 328/862 vs 329/861. Naming the commit a census was taken at is precisely the
  remedy round 1 recommended. (Those figures now read 964/863 at the newer tip — correctly, since
  they are attributed to a named commit rather than presented as current.)
- **TRIVIAL-1 resolved.** `find apps/web/src -type d -empty` → **0**.
- **TRIVIAL-2 resolved in substance, with one wrinkle — see `N-2`.** The artifacts are real and the
  cheap checkability I said was lost **is restored**: I re-derived the pre-move parity diff from the
  committed snapshots with the unmodified classifier and got
  **`29 difference(s): 20 semantic, 9 incidental. 275 leaf values compared.`** — task 8.1's figure,
  reproduced by me in seconds rather than by an expensive rebuild. That was the point of the ask and
  it is met.

**Regression check across all nine commits:** the boundary checker is still green at the new tip —
`acyclic-direction` 964 files / 329 edges, `public-entry-only` 964 / **328 specifiers**,
`no-internal-reexport` **863 files** and no dormant marker, `no-elftia-import` 1048,
`react-free-base` 68, exit 0. `generate-vector-manifest.mjs` runs clean (exit 0). No
`apps/web/tsconfig.json` residue in the delta.

## Priority 7 — category 6 left unfixed — **acceptable, with one condition I'd attach**

Flagging rather than fixing is the right call here, for three reasons: it is a genuinely *different*
test (a violation-scan, not the scan-scope guard `8389be4e` fixed); the child verified by whole-tree
grep that no live violations are currently hidden; and widening a RED-control's scope inside a commit
that fixed a different scope bug would blend two changes in a control test, which is the last place
you want an unattributed edit.

**The condition:** `8389be4e` gave the scan it fixed a fail-closed
`expect(files.length).toBeGreaterThan(0)`. The violation-scan test has **no equivalent guard**, so if
*its* scope silently goes vacuous — the exact failure mode that produced this whole thread — nothing
catches it. The cheap, correct action for P2 is not to widen the scope but to **add the same
non-vacuity assertion**, which converts a latent silent risk into a loud one without touching
classification. I would treat that as the accepted-known's stated remedy rather than "revisit later".

---

# New findings (round 2)

## N-1 (Minor) — `package.json` scripts point into the emptied tree; one fails, two silently lose 93% of their scope

**Where:** `package.json:19`, `:21`, `:22`.

```json
"format:web": "prettier apps/web/src/services/renderer --write",
"lint:web":   "eslint apps/web/src --ext .ts,.tsx",
"lint:web:fix": "eslint apps/web/src --ext .ts,.tsx --fix",
```

`apps/web/src/services/renderer` **does not exist** (verified); the renderer is now
`packages/editor-classic/src/services/renderer`. So `format:web` targets a deleted path and fails.

The two `lint:web` scripts are the more insidious half: `apps/web/src` still resolves, so they do not
error — they now lint **59 tracked files instead of roughly 800**. A ~93% silent coverage loss, with
no packages-side equivalent script to pick up the remainder (`grep '"lint' package.json` returns only
these three).

**Failure scenario.** A contributor runs `bun run lint:web` before pushing, sees it pass, and
concludes the editor source is lint-clean. It was never looked at. Same shape as the `@source`
Blocker: a green run over a scope that quietly stopped containing the thing it was meant to check.

**This is a sweep category-3 mis-triage** — `apps/web/src` is still live *as a path*, so the hits
landed in the "legitimate still-live" bucket, but these scripts' *intent* is no longer served by it.
That is exactly the risk you asked me to probe in that bucket. **Confidence: high** (path existence
and file counts both measured). Minor, not Major: developer tooling, not a gate or shipped code.

## N-2 (Minor) — the premove artifacts restore the *numbers* but not the *documented command*

`evidence/premove-baseline/README.md` says `parity-diff-premove.md` is the unmodified classifier
*"re-run against the two snapshots above"* and calls it *"a live re-derivation (run this session)"*.
Running exactly that on the committed filenames **crashes**:

```
TypeError: Cannot read properties of undefined (reading 'entries')
  at script/diff-parity-snapshots.mjs:292   // ledgers.vite.interactions.entries()
```

**Mechanism, traced.** The tool derives its optional interaction-ledger path with
`file.replace(/snapshot-\w+\.json$/, "ledger-<host>.json")` (`:273`). The committed names are
`snapshot-vite-premove.json` / `snapshot-next-premove.json`; `\w+` does not match the hyphen in
`vite-premove`, so the regex misses, `replace` returns the path unchanged, the tool reads **each
snapshot as its own ledger**, finds it truthy, and dereferences a `.interactions` that does not
exist.

**Proof it is only the filename.** Copying the same bytes to `snapshot-vite.json` /
`snapshot-next.json` and re-running reproduces
**`29 difference(s): 20 semantic, 9 incidental. 275 leaf values compared.`** — exactly task 8.1's
pre-move figure. So the substance is genuinely restored and the inheritance claim is verified; what
is not restored is the ability of the *next* reader to run the documented command and see it.

**Fix (choose one, all trivial):** rename the two files to the conventional
`snapshot-{vite,next}.json`; or commit the two `ledger-*.json` files beside them; or add one line to
the README giving the working invocation. **Confidence: high** (crash and success both reproduced).

## N-3 (Trivial) — the C7 fix's correctness now rests on an unpinned `import type`

After `1770d9b0`, `@opencut/editor-classic/evidence/headless-semantic-fixture` is **still** imported
both statically and dynamically. It is safe only because the static one is
`import type { HeadlessSemanticResult }`, which TypeScript erases before Rollup sees an edge.

Nothing pins that. If someone later drops the `type` keyword, or imports any *value* from that
subpath statically, the exact folding recurs — and its symptom is a spurious DOM mutation on the
neutral arm, i.e. a false positive on the cleanliness control, which is precisely the failure that
was hard to find the first time. A one-line comment at the import, or `verbatimModuleSyntax` /
`importsNotUsedAsValues` in the relevant tsconfig, would make the constraint explicit rather than
incidental. **Confidence: high** (scanned all `packages/editor-classic/src` and
`apps/vite-example/src` for static/dynamic specifier collisions; this is the only one whose safety
depends on type-erasure).

## N-4 (Trivial) — the c5 file carries 10 tests, not 9

`apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts` contains **10** `test(`
declarations; the brief says 9. All pass. Cosmetic count correction only, recorded so the number does
not propagate.

---

## Standing summary — P1 across two rounds

| round | found | closed by the next delta |
| --- | --- | --- |
| 1 (`8437084b..af0a52ba`) | 0 Blockers, 2 Majors, 4 Minors, 2 Trivials | **all 8** |
| 2 (`af0a52ba..1e5a337c`) | **0 Blockers, 0 Majors, 2 Minors, 2 Trivials** | — |

Every round-1 finding is closed and no fix regressed anything previously passing — I re-ran the
boundary checker, the vector-manifest generator, the c5 suite and the webpack-graph suite against the
new tip. Two of the fixes went beyond the finding in the right way: the `webSrc` deletion chose
fail-loudly over repoint, and `8389be4e` added a non-vacuity assertion the finding did not ask for.

**Accepted-known at ship:** N-1, N-2, N-3, N-4, plus sweep category 6 with the condition in Priority
7 above (add the non-vacuity assertion rather than widen the scope). None blocks.

**One durable addition for P2-P7**, complementing round 1's three: **an existence check belongs in
the path sweep.** Round 1's durable finding said to grep the old path prefix after a move; this round
showed that grepping alone under-delivers, because the majority bucket is "still-live path" and a
dead *target* hides inside a live *prefix*. `git grep -oE '<old-prefix>/[A-Za-z0-9_./-]+'` piped
through an `existsSync` filter turned 300 raw hits into 60 real candidates and surfaced N-1 in one
pass — the sweep's own triage, done by hand, put that one in the bucket labelled fine.
