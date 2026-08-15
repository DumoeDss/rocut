# Ship Log: s05-versioning-and-experimental-labeling

**Date:** 2026-08-15
**Mode:** local
**Branch:** feat/s05-community-beta
**Commit:** 6f99336dce4f319f027e4aeeb265b0b04340c5ca (pre-ship-log HEAD; this ship adds one further commit carrying this file, the reviewer's round-1 re-review append, and the ship-gate log — `tasks.md` needed no ship-time tick: every box was already `[x]`, including 7.4)
**Tree:** 081cf5fd6bb7ea2fe83c5e2d5bab0b7d967558c4 (pre-ship-log HEAD tree)
**Status:** Committed (delivery deferred to portfolio level)

## Delivery mode and why

`local`. This is child P5 of the 7-child decomposed portfolio for Slice
`05-community-beta-second-host` (workstream `opencut-agent-editor-sdk`). Per
the portfolio's decomposition contract, children accumulate commits on the
shared branch `feat/s05-community-beta` and the portfolio delivers once, as
a single PR, after every child completes. Pushing or opening a PR from this
child individually would fragment that delivery, so this ship commits
locally only. No `git push`, no `gh pr create`, no `rasen archive` was run.

## Scope shipped

9 commits since base `5aae75ec` (`git rev-list --count 5aae75ec..HEAD` = 9,
re-verified at ship time — the delegation's "10" over-counted by one; the
table below is the enumeration), 57 files changed, +8395/−33
(`git diff 5aae75ec..HEAD --shortstat`). Delivers the change described in
`rasen/changes/s05-versioning-and-experimental-labeling/{proposal.md,design.md,tasks.md}`
and its delta spec (`specs/sdk-versioning-and-labeling/spec.md` NEW — UNSYNCED
by design; spec sync belongs to the archive stage). `tasks.md`: **100%
complete** — every box `[x]`; box 7.4 (standDown) was already ticked by the
implementer with the vacuous justification recorded in the implementation
report Group 7 (leaf worker, no parked workers; the change directory has no
`signals/` directory at all — re-verified absent at ship time, so there is no
`signals/.state/` to confirm empty and no standDown to send; same convention
as P2's 10.4 and P3's 8.4).

### Per-group summary with commits

| Commit | Group / content |
|---|---|
| `5387926d` | Group 1 — baseline at base `5aae75ec`: 36-entry export-map inventory (6/11/19), checker census (989/362/361/870/74, 1107 repo files), frozen byte-control over the four S03+S04 surfaces (stat-cache-immune `git show`-blob + `cmp`); policy draft reviewed against spec §3.6 before any file landed. |
| `ba6c7ae4` | Group 2 — policy ships: three per-package READMEs (the manifests' `files` entries name READMEs that now exist), all three manifests bumped `0.1.0 → 0.2.0` as the policy's first application, early pack gate (README + `0.x` version proven from the pack path; pack determinism control reproduced). |
| `f239d81b` | Group 3 — three `surface.json` manifests (36 classifications with reasons; adjudications: `./storage/conformance` provider, `./evidence` ×4 experimental; classic root measured override-FREE — closure traced, zero frozen symbols) + 19 `@opencutSurface` markers as first doc-comment lines; zero frozen files touched (byte-control re-run immediately after the batch). |
| `ab23ccc4` | Group 4 — `script/check-sdk-surface-labels.mjs` joins the family (`check:surface-labels` beside `check:packages`): completeness both directions, class vocabulary, marker agreement, override validity, empty-scan refusal (exit 2), census lines; negative + converse controls; task 3.3's real-source misclassification plant fired (`EXIT[planted]:1`) and reverted with blob-hash verification; family sweep 28 checkers 22/6; census movement 1107→1109 attributed. |
| `3cb78fbc` | Group 5 — consumer view from tarballs (`evidence/consumer-view-from-tarballs.mjs`, imports P3's `packSdkTarballs`): versions `0.x`, README policy, surface.json set-equality, markers in EXTRACTED source — all from the packed artifact, never the workspace; manifest truth (dependency blocks byte-identical; only `version` + `files` changed). **First run caught the dangling `./vectors/drivers` entry** — escalated, both tools hardened to carry it visibly pending adjudication. |
| `e7243283` | Group 6 — semantic no-`1.0` sweep (5 terms, 891-file universe, 70 candidates read and dispositioned, fail-closed both ways, `0.1.0`-substring trap handled); `packages/README.md` restated at the current tree (P0-era emptiness text false since P1); BOUNDARIES §14 labeling section + §9 audit row. |
| `df408d03` | Group 7 — F2 delivery audit (6 requirements / 15 scenarios, headings verbatim, no clause required amendment) + final controls (frozen ×4 IDENTICAL, family 22/6, both empty-scan refusals via the new `OPENCUT_LABELS_ROOT` seam, validate strict green). |
| `0fa1e6db` | Group 8 — LEAD-ruling execution on the escalated finding: `./vectors/drivers` removed from the exports map + surface.json row (census 36→35, frozen 17→16); checker fourth rule `target-existence` fails closed at any class; consumer-view dangling branch fails closed at any class; controls re-proven (negative 8/8, converse silent, frozen ×4 fifth-not-yet, boundary unchanged); docs updated. |
| `6f99336d` | Group 9 — review round 1 fixes R1–R6: contracts README figures 11→10 / frozen 10→9 + removal parenthetical (R1, proven in the packed artifact), session-state mirror row removed (R2), non-string conditional targets fail closed (R3), marker agreement exactness not membership (R4), monotone-rule exception in place (R5), delivery-audit citation corrected (R6); negative control extended to 10 worlds; durable `vectors/drivers` repo-sweep guard with all hits dispositioned. Round-1 re-review: CLEAN. |

## Pre-Flight Results

- Verification: `evidence/review-report.md` present — one review round plus
  re-review. Round 1 (dispatched leaf reviewer, rasen-review report-only,
  author ≠ reviewer; delta `5aae75ec..0fa1e6db`, 8 commits): **0 Blocker /
  1 Major / 4 Minor / 1 Trivial**, every mandated control independently
  reproduced. Findings: R1 [Major] the shipped contracts README still
  documented the removed `./vectors/drivers` entry (consumer-visible);
  R2 [Minor] the session-state checker's `PACKAGE_EXPORTS` mirror still
  mapped it; R3 [Minor] checker rules silently bypassed non-string
  (conditional) export targets; R4 [Minor] marker agreement was membership,
  not exactness; R5 [Minor] `packages/README.md`'s monotone rule lacked the
  dangling-correction nuance it narrated elsewhere; R6 [Trivial] a
  delivery-audit citation overshot the cited file. All six fixed in
  `6f99336d`. The round-1 re-review (delta `0fa1e6db..6f99336d`) re-executed
  every gate itself — including re-packing and extracting the contracts
  tarball to prove the R1 fix ships in the packed artifact, and reproducing
  the repo-wide `vectors/drivers` guard with its own 59-hit grep reconciled
  against the log's 40 — verdict **CLEAN — all six findings verified fixed;
  no new findings; ship gate PASS**. The re-review append is committed by
  this ship, unmodified (P2/P3 precedent).
- Reviewer's mandated conclusions of record: frozen surfaces untouched
  (VERIFIED CLEAN), taxonomy honesty (VERIFIED HONEST — no misclassification
  found among the 35 rows), checker family integrity (VERIFIED), the no-1.0
  sweep (VERIFIED HONEST), version bump consistency (VERIFIED CLEAN),
  security sweep (CLEAN).
- Tasks: 100% complete (see Scope shipped — no open boxes, no ship-time
  ticks).

## Oracle verdicts (evidence-cited)

- **Labels census** — 35 export entries = **frozen 16 / provider 13 /
  experimental 6** across ports 6 / contracts 10 / classic 19,
  `dangling-export-entries: 0`, four rules PASS (completeness,
  marker-agreement, override-validity, target-existence). Re-run fresh by
  this ship's gate (`evidence/logs/ship-gates.log`, `EXIT[labels]:0`),
  matching the group-8 ruling log and the reviewer's independent re-run.
- **10-world negative control** — every planted violation FIRED under its
  rule, 10/10 (`EXIT[negative]:0`): the spec's named pair first — world 1
  the unlabeled experimental export (row without marker) FAILS under
  marker-agreement, world 2 the unclassified export entry named by the
  failure — plus unknown vocabulary, dangling override, marker on a frozen
  file, undeclared row, absent target at both classes, the non-string
  conditional target (R3's world 9), and the stale marker beside the current
  one (R4's world 10). Converse control silent over correctly labeled rows,
  frozen rows without markers, a resolving override, and prose that merely
  mentions a class name — with zero dangling (`EXIT[converse]:0`).
- **Boundary census** — all five rules PASS, figures unchanged from base
  attribution: 989 package-graph files / 362 cross-package edges / 361
  `@opencut/*` specifiers / 870 no-internal-reexport / 74 react-free-base,
  repo files 1110 (`EXIT[boundary]:0`, this ship's gate; the 1107→1110
  movement fully attributed in the implementation report: the new checker +
  consumer-view module + the zero-entries fixture's `package.json`, all
  outside every package graph).
- **Consumer view from tarballs** — pack via P3's `packSdkTarballs`, every
  read through the extract directory, never the workspace: all three
  manifest versions `0.2.0` (`0.x`), README carries the policy,
  surface.json set-equal with the packed export maps (6 / 10 / 19),
  `./vectors/drivers` absent, 0 failures, markers present in extracted
  source for all non-frozen entries (`group8-completion-ruling.log`,
  `group9-review-round1.log`, `REAL_EXIT_CODE[consumer-view]:0`). The R1 fix
  is proven **in the packed artifact**: the reviewer extracted
  `package/README.md` from `opencut-editor-contracts-0.2.0.tgz` and read
  "10 export entries" / "**frozen (9)**" there.
- **Frozen surfaces** — the four S03+S04 frozen surfaces byte-identical to
  base `5aae75ec` by the stat-cache-immune `git show`-blob + `cmp` method,
  **proven five times** across the change (Group 1, post-marker batch,
  Group 7, Group 8, Group 9); the fifth re-proof at the review-fixed tree.
- **No-1.0 sweep** — 70 candidates every one read and dispositioned
  (keyed `path:line` in the committed tool, fail-closed on an
  undispositioned candidate OR a stale disposition); zero surviving
  `1.0`/GA/production-readiness claims; mechanical noise classified by
  context (111 SVG-path coordinates, 10 longer decimals, 3 version-string
  substrings incl. the task's own `0.1.0` trap). Re-run green at Group 8
  and Group 9 after the doc edits (re-anchored keys forced by the tool's
  own stale-disposition gate — the discipline worked).
- **Checker family** — 28 checkers, **22 exit-zero / 6 nonzero**, the
  nonzero set IDENTICAL to P3's known pre-existing / capture-run-needing
  set (`asset-manifest:2, emitted-runtime-assets:1, headless-graph:2,
  headless-semantic-result:2, resolution-equivalence:1, type-baseline:1`).
- **Validate** — `rasen validate s05-versioning-and-experimental-labeling
  --strict --project rocut --json` → `"valid": true, "issues": []`
  (`EXIT[validate]:0`, this ship's gate).

## The LEAD ruling, the version policy, and the taxonomy

- **LEAD ruling 2026-08-15 on `./vectors/drivers` (executed as `0fa1e6db`).**
  The entry was declared by P0's boundary-freeze commit `5e3fc7cb` but its
  target was never authored in any commit; zero importers existed, so
  removal breaks nobody (a consumer got module-not-found either way, and
  removal makes the manifest honest). The four frozen S03+S04 surfaces are
  code signatures — the exports map is S05-authored manifest surface, so
  correcting it is not a frozen-surface change. Authoring the index now
  would invent surface with no forcing consumer (monotone-growth cuts
  against inventing barrels). **Attribution of record:** P0 declared
  `./vectors/drivers` in `5e3fc7cb`; target never authored; zero importers;
  removed by P5 under LEAD ruling 2026-08-15; **re-add only with a named
  forcing module.** The checker's new fourth rule `target-existence` now
  fails closed at any class (a declared entry whose target is absent — or
  unrepresentable, per R3's non-string extension — is a violation), and the
  consumer-view verifier mirrors it from the packed tarball.
- **The `0.1.0 → 0.2.0` policy application** (design E4's decision, applied
  at `ba6c7ae4`): the minor records P0→P5 entry additions; the hold-`0.1.0`
  alternative was available and not ruled, so the artifacts' own decision
  governed. Verified harmless: in-repo consumers resolve `workspace:*` (no
  literal version resolved anywhere), and P3's harness maps tarball
  filenames structurally (`-\d+\.\d+\.\d+[^.]*\.tgz` stripped before the
  name lookup), so the harness needed no edit.
- **Labeling taxonomy census:** 35 entries = **frozen 16 / provider 13 /
  experimental 6** (post-ruling; 36 = 17/13/6 before). Adjudications worth a
  reader's attention: classic's `./storage/conformance` is provider (Classic's
  own published test rig), `./evidence` ×4 experimental (unstable by intent),
  `./conformance/requirements` experimental in ports + contracts (P3's
  legibility layer), classic's root `.` measured override-free. Reviewer's
  mandated conclusion: taxonomy VERIFIED HONEST — no misclassification found.
- **No spec amendment.** The F2 delivery audit paired all 15 scenarios of the
  delta spec with satisfying evidence lines and amended nothing — every
  clause is met as written; the task-time rulings (version `0.2.0`, root
  override-free, the dangling-entry scope ruling) are attributed in
  `design.md`'s "Task-time rulings" subsection, never in the spec text.

## Accepted-known at ship

- **Stale `0.1.0`-named tarballs sit in `dist-sdk-tarballs/`** — gitignored
  pack-output scratch from earlier pack runs; nothing consumes them by
  literal name (P3's harness strips the version before lookup; the
  consumer-view verifier packs fresh). The reviewer's benign observation;
  not staged (the directory is gitignored).

## Test Gate

- Required scope: the delivered delta since the last green evidence is
  evidence/markdown only — no code changed after `6f99336d`, the tree the
  reviewer's CLEAN re-review battery ran against. Proportionate fresh
  re-verification at the ship state, run by this ship: the labels checker
  (live + both controls), the boundary checker, and strict validation of the
  named change item — the checkers whose subject matter this change owns or
  touches. The remaining oracles (consumer view, frozen byte-control,
  no-stability sweep, full family) were re-executed by the reviewer at this
  same tree (round-1 re-review) and are cited above.
- Commands (log committed as `evidence/logs/ship-gates.log`, each leg
  self-logging its `EXIT[...]` line — background exit codes are untrusted on
  this machine, the log's own lines are the verdict):
  - `node script/check-sdk-surface-labels.mjs` → **EXIT[labels]:0** — 3
    packages / 35 entries, census 16/13/6, dangling 0, four rules PASS.
  - `node script/check-sdk-surface-labels.mjs --negative-control` →
    **EXIT[negative]:0** — 10/10 worlds FIRED.
  - `node script/check-sdk-surface-labels.mjs --converse-control` →
    **EXIT[converse]:0** — silence + zero dangling.
  - `node script/check-package-boundary.mjs` → **EXIT[boundary]:0** — five
    rules PASS, 989/362/361/870/74, repo files 1110.
  - `rasen validate s05-versioning-and-experimental-labeling --strict
    --project rocut --json` → **EXIT[validate]:0**, `valid: true`,
    `issues: []`.
- Diff sanity scan (this ship): 0 added TODO/FIXME/XXX/HACK markers and 0
  secret-pattern lines in `git diff 5aae75ec..HEAD` (57 files, +8395/−33;
  the reviewer's round-1 security sweep independently CLEAN).
- Tree: `081cf5fd6bb7ea2fe83c5e2d5bab0b7d967558c4` (pre-ship-log HEAD tree;
  the ship commit adds only evidence markdown, no code).

## Notes for the portfolio delivery (parent = 05-community-beta-second-host)

- Nothing was pushed: the branch has never been pushed. At ship time
  `git rev-list --left-right --count origin/main...HEAD` = `0 86`
  (0 behind, 86 ahead — the earlier portfolio children's commits plus this
  child's 9); the ship commit makes it 87.
- The `specs/` delta is UNSYNCED by design — `sdk-versioning-and-labeling`
  (NEW) belongs to the archive-stage spec sync, not ship.
- `proposal.md`, `design.md`, `specs/`, and `.openspec.yaml` remain
  untracked by convention while the change is active (same as P2/P3) — the
  archive transaction commits them with the change.
- Review round 1's re-review append to `evidence/review-report.md` is
  committed by this ship step, unmodified (P2/P3 precedent).
