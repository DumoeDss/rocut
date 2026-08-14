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
