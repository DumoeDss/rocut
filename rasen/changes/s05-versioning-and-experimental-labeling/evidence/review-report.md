# Review report — s05-versioning-and-experimental-labeling (P5, verify stage)

Reviewer: dispatched leaf reviewer (rasen-review, DISPATCHED report-only mode). Author ≠ reviewer.
Delta under review: `5aae75ec..0fa1e6db` (8 commits), branch `feat/s05-community-beta`.
Every claim below was re-executed by the reviewer at HEAD `0fa1e6db` unless marked otherwise;
scratch logs live outside the repo (`E:\AI\review-scratch-p5\`).

**Verdict: FINDINGS — 0 Blocker, 1 Major, 4 Minor, 1 Trivial.**
The change is substantively sound and every mandated control reproduces; the findings are
incompleteness of one LEAD-ruling execution (shipped doc + a checker mirror), two latent
checker gaps, and two documentation-accuracy nits.

## Scope check

CLEAN. Delivered = proposed: three `surface.json` (35 rows post-ruling), 19 `@opencutSurface`
markers in non-frozen entry files, three per-package policy READMEs, `0.1.0 → 0.2.0`,
`script/check-sdk-surface-labels.mjs` (4 rules, 3 modes, fixtures), the from-tarballs
consumer-view verifier, the semantic no-stability sweep, `packages/README.md` restatement,
BOUNDARIES §14 + §9 audit row, one root-`package.json` script line (verified: the diff is
exactly `+ "check:surface-labels"`). The two deltas from the proposal's letter — census 36 → 35
and the checker's fourth rule — both flow from the LEAD ruling of 2026-08-15, attributed in
design.md's task-time rulings, BOUNDARIES §14, and the delivery-audit addendum. No
out-of-scope files touched.

## Mandated conclusions

### 1. The LEAD ruling's execution (0fa1e6db) — verified in substance, incomplete in sweep

All re-verified independently:

- `./vectors/drivers` is gone from BOTH `packages/editor-contracts/package.json` exports and
  `packages/editor-contracts/surface.json` (read both files at HEAD; `grep -rn vectors/drivers
  packages/` finds only the stale README hit of finding R1 and legitimate narration in
  `packages/README.md`).
- The checker's fourth rule **really fails**: `script/check-sdk-surface-labels.mjs:272-279` —
  `text === null` pushes a `target-existence` violation into the same `violations` array that
  `runCheck()` exits 1 on (line 414-417). Not print-and-pass. Confirmed empirically: negative
  control world 8 (frozen row, absent target) FIRED under `target-existence`; world 7
  (non-frozen absent target) FIRED; my live run at HEAD prints `PASS target-existence` /
  `dangling-export-entries: 0`.
- Consumer view from tarballs, re-run by me at `0fa1e6db`: contracts **10 declared = 10
  classified, set-equal**, `./vectors/drivers` absent, **0 failures**, `dangling-export-entries
  0`, `REAL_EXIT_CODE[consumer-view]:0`. Ports 6=6, classic 19=19, all versions `0.2.0` read
  from the EXTRACTED manifests, policy anchor in all three extracted READMEs, all 19 non-frozen
  markers verified in extracted source, 17 frozen files marker-free.
- Attribution of record present and consistent in BOUNDARIES.md §14 (lines 1137-1161, ruling
  quoted, census movement 36→35 / frozen 17→16), design.md task-time rulings (last bullet),
  implementation-report Group 8, and the delivery-audit addendum.

**Ruling soundness — I judge the ruling itself sound.** Its factual premises all check out
against the record:

- *Never authored*: `git log --all --oneline -- packages/editor-contracts/src/vectors/drivers/index.ts`
  is empty; the directory holds only `durable.ts` / `in-memory.ts`.
- *Zero importers*: at base `5aae75ec` the only source references are RELATIVE imports of
  `durable`/`in-memory` (`requirements-index.test.ts:32-33`) — nothing imports the entry by
  specifier `@opencut/editor-contracts/vectors/drivers`, so removal breaks nobody and a
  consumer's experience is module-not-found either way.
- *Not a frozen-surface change*: the four frozen surfaces are code files (re-proven
  byte-identical, see item 2); the exports map is manifest surface authored by P0's `5e3fc7cb`
  within S05. Nothing in the record contradicts the ruling.

But the execution missed two files that name the entry — R1 (Major) and R2 (Minor) below.

### 2. Frozen surfaces untouched — VERIFIED CLEAN

- Stat-cache-immune control reproduced by me (`git show 5aae75ec:<path> > tmp; cmp -s`): all
  four surfaces IDENTICAL — `editor-classic/src/editor/transactions/opencut/index.ts`,
  `editor-contracts/src/engine/engine.ts`, `editor-ports/src/index.ts`,
  `editor-classic/src/editor/surface/embedding/types.ts`. Also IDENTICAL against P3's own base
  `8248a115`.
- `git log --oneline 5aae75ec..0fa1e6db -- <the four frozen paths>` is empty — no commit in
  the delta touched any frozen path.
- Checker-side: frozen rows carry no markers (live `PASS marker-agreement`; 17 frozen files
  verified marker-free from the extracted tarballs; negative-control world 5 proves a misplaced
  marker on a frozen file fires).

### 3. Taxonomy honesty — VERIFIED HONEST (no misclassification found)

I sampled well beyond the mandated 5, across all three classes and all three packages:

- classic root `.` as `provider` **with no overrides** — the load-bearing claim: I traced the
  barrel myself (`src/index.ts` re-exports `./core`, `./utils/{ui,date,id,string}`, `./wasm`,
  `./background/color`, `./canvas/sizes`, `./fps/defaults`, `./feedback/types`); `core/index.ts`
  exports only `class EditorCore` (the frozen transaction barrel at line 23 is an internal
  IMPORT, not a re-export), and none of the ten closure modules re-export from
  `editor/surface` or `transactions/opencut`. Zero frozen symbols flow through the root — the
  "no overrides needed" ruling is correct, not merely plausible.
- classic `./surface` + `./surface.css` frozen — the S03+S04 embedding contract; one of the
  four byte-controlled files sits here. Correct.
- classic `./storage/conformance` provider-not-experimental — the task's pre-adjudicated arm,
  reason records the adjudication. Defensible (Classic's own published test rig).
- classic `./evidence/wasm-test-mock` experimental — with the dependency tension (a provider
  migration chain currently requires an experimental entry to initialize) EXPLICITLY recorded
  in both the surface.json reason and the README's Known-constraint section. Honest, not
  hidden; the tension is the wasm-init Direction finding's to resolve.
- contracts `./conformance/requirements` and ports `./conformance/requirements` experimental —
  P3's legibility layer over frozen suites. Correct.
- ports `./in-memory` + `./in-memory/host` frozen — S02 reference surface whose signatures are
  the contract's. Defensible, reason states it.
- contracts `./vectors/corpus` frozen — exact-bytes contract test data. Correct.
- Nothing frozen smells provider-specific, and nothing provider smells frozen, in my sample.

### 4. Checker family integrity — VERIFIED

All re-run by me at HEAD:

- Labels checker: live EXIT 0, census **35 = 16+13+6** (6/10/19 per package), four rules PASS,
  `dangling-export-entries: 0`.
- Negative control **8/8 FIRED**, including the spec's named evidence (world 1: unlabeled
  experimental export → `marker-agreement`; world 2: unclassified entry → `completeness`) and
  world 8 (frozen absent target → `target-existence`). EXIT 0 (no misses).
- Converse control silent, zero dangling. EXIT 0.
- Empty-scan refusals: `OPENCUT_LABELS_ROOT` at the committed fixtures → "no packages
  discovered … refusing" EXIT 2 and "zero export entries scanned … refusing" EXIT 2. (Note: my
  first attempt used a wrong relative path and got a raw ENOENT stack trace — exit 1, not the
  curated exit-2 refusal. A nonexistent `OPENCUT_LABELS_ROOT` crashes at
  `discoverPackageDirs`'s `readdirSync` rather than refusing gracefully. Fail-closed in outcome
  (nonzero either way) — noted as R6-adjacent polish, not a finding.)
- Boundary census unchanged and the **inference is sound, not assumed**: every boundary rule
  counts import-graph facts (files, cross-package edges, `@opencut/*` specifiers,
  re-export-chain files), and the removed entry had zero specifier importers at base (verified
  by `git grep` at `5aae75ec`) and a target that never existed (so no file count, edge, or
  chain ever depended on it). My live run reproduces 989 / 362 / 361 / 870 / 74, all PASS.
- Family sweep: I ran all 28 checkers at HEAD — **22 exit-0 / 6 nonzero**, nonzero set exactly
  `{asset-manifest:2, emitted-runtime-assets:1, headless-graph:2, headless-semantic-result:2,
  resolution-equivalence:1, type-baseline:1}` — identical to the committed group4/group7 logs
  and to P3's known disposition set (asset-manifest wants a preview server; headless pair want
  CLI args; resolution-equivalence wants a staged diff; type-baseline's two TS2769 MediaTime
  pins reproduce).
- The real-source misclassification control (task 3.3) is genuine: planted, FAILed
  `marker-agreement` naming `./timeline`, reverted via `git show HEAD:…` with blob-hash
  verification (`f30e33d3…`); I confirmed classic's `surface.json` at HEAD is still blob
  `f30e33d3` and was touched by exactly one commit (`f239d81b`) — the plant never landed.

### 5. The no-1.0 sweep — VERIFIED HONEST

Re-run by me: EXIT 0, 891 files, `REAL: 70`, all 70 dispositioned (70 `ok` lines), noise
classified (111 svg-path, 10 decimal-substring, 3 version-string-substring — the `0.1.0` /
`0.2.0` / `0.2.10` trap handled). Fail-closed both ways in the tool (undispositioned OR stale
disposition exits 1). Five dispositions spot-checked against the actual lines, all honest:

- `packages/editor-ports/README.md:23` — the negation sentence ("No `1.0`, GA or
  production-readiness claim") — a denial, correctly not a claim.
- `packages/editor-classic/src/services/video-cache/service.ts:231` —
  `if (frame.timestamp > targetTime + 1.0) break;` — a one-second threshold literal.
- `packages/editor-classic/src/stickers/providers/countries-data.ts:575` — `"code": "GA"` —
  Gabon's ISO 3166 code in sticker data.
- `packages/editor-classic/src/masks/__tests__/snap.test.ts:331` — `snaps to height=0.2*5=1.0`
  arithmetic comment.
- `BOUNDARIES.md:1175` — §14's own narration of the term list — self-referential mention.

No undispositioned candidate survives. I also probed variants the five-term list could miss
("general availability" spelled out, hyphenless "production ready") — zero occurrences in the
shipped universe, so the fixed term list is adequate at this tree. The one residual `0.1.0` in
shipped material (`packages/editor-classic/src/changelog/entries/0.1.0.md`) is the upstream
product changelog's own historical entry (a different version series, dates 2026-02-23),
dispositioned as version-string noise — correct, not a stray SDK version.

### 6. Version bump consistency — VERIFIED CLEAN

All three manifests `0.2.0`; `files` gained `surface.json`; dependency blocks byte-identical to
base (re-verified by me: changed top-level keys are exactly `version` + `files` — plus
`exports` for contracts, which is the ruling's entry removal, declared); all three READMEs
carry `0.2.0` in their measurement lines; consumer view proves `0.x` from the packed
manifests. No stray `0.1.0` in shipped SDK material. `opencut-wasm@0.2.10` correctly left at
its own version.

### 7. Security sweep — CLEAN

- The full delta diff (54 files, +7757/−30) greps clean for credential-shaped patterns
  (password / secret / api-key / AKIA / PRIVATE KEY / ghp_ / sk- / xox / _authToken /
  Authorization / Bearer / .npmrc).
- The on-disk evidence tree (logs, fixtures, tools) likewise — the only "token" hits are the
  sweep tool's own lexical terminology.
- No `signals/` directory exists in the change dir (implementation-report 7.4's claim
  verified).
- No new dependency, no network egress, no eval/exec in the new tooling; the sweep is a
  read-only Python scanner, the checker is read-only FS scanning.

## Findings

Canonical severities (Blocker / Major / Minor / Trivial). All are report-only — no fixes
applied by this reviewer (dispatched mode).

### R1 — Major — Shipped contracts README still documents the removed `./vectors/drivers` entry

`packages/editor-contracts/README.md:30` states "**11 export entries** (measurement: this
manifest's `exports` map read at `0.2.0` …)" and lines 33-37 state "**frozen (10)** — … the
vectors runner with its corpus and drivers (`./vectors`, `./vectors/corpus`,
**`./vectors/drivers`**), …". The shipped manifest at the same version declares **10** entries
(frozen **9**). The README was authored at `ba6c7ae4` (pre-ruling) and never touched again —
the group-8 completion pass updated `package.json`, `surface.json`, the checker, the
consumer-view verifier, BOUNDARIES §14, `packages/README.md`, design.md, the implementation
report and the delivery audit, but not the per-package README this change itself created,
which `packages/README.md:48-50` names "the **consumer-facing policy statement**".

Concrete failure: a consumer installs the `0.2.0` tarball, reads the README beside the
manifest, imports `@opencut/editor-contracts/vectors/drivers` because the README's frozen list
names it → module-not-found; or reconciles the README's "11 / frozen 10" against the
manifest's 10 / 9 and distrusts both. No spec clause is violated (the policy-scenario clauses
only require the policy statement, which is present and accurate) — this is incompleteness of
the ruling's execution in the very artifact class the change exists to make truthful. No
checker can catch it: the labels checker reads export maps and surface.json, and the
no-stability sweep verifies term claims, not figure accuracy.

Fix: update the two figures (11→10, frozen 10→9) and drop `./vectors/drivers` from the frozen
list (one sentence edit); optionally note the removal beside the packages/README.md narration.

### R2 — Minor — Session-state checker's PACKAGE_EXPORTS mirror still maps the removed entry

`script/check-session-state-boundary.mjs:658` — `["./vectors/drivers",
"vectors/drivers/index.ts"]` remains in the hand-maintained `PACKAGE_EXPORTS` mirror after the
entry's removal from the manifest. Today it is unreachable (zero specifier importers, so
`resolvePackageSpecifier` is never queried for it) and the checker stays green — but it is
stale coupling data contradicting the manifest the same ruling corrected, and the map's own
comment ("This mirrors each package's `package.json#exports` map, so it only resolves subpaths
the package actually publishes") is now false for that row. If anything ever imports the
specifier, resolution returns a path to a file that does not exist. (Context: the mirror was
already partial before this change — it omits `./conformance/requirements`,
`./vectors/corpus`, and classic's `./evidence/*` — so full-mirroring was never its invariant;
the delta-specific defect is retaining a row for an entry the ruling removed.)

Fix: delete the row (one line), or add a comment that the mirror lists only
reachability-relevant entries.

### R3 — Minor — Checker rules 2/3/4 silently bypass non-string export targets

`script/check-sdk-surface-labels.mjs:263` — `if (typeof target !== "string") continue;`. A
conditional-exports object (the common npm `{"types": …, "import": …}` shape) would skip
marker-agreement, override-validity AND target-existence entirely, while the census still
counts the entry as classified. Rule 4's census line claims "every declared entry's target file
exists on disk" — enforced only for string targets. No live impact (all three manifests use
string targets; the house style guards it), but this is precisely the vacuous-absence class
the implementer flagged in the report: unreadable/absent fails closed, but an
unrepresentable-as-string target passes vacuously. Fix: fail closed (or at least census-flag)
non-string targets.

### R4 — Minor — Marker agreement is membership, not exactness, on non-frozen files

`script/check-sdk-surface-labels.mjs:289` — the rule is `!markerClasses.includes(row.class)`:
a non-frozen entry file carrying BOTH a stale and a current marker (e.g. a reclassification
whose old marker survived a merge) passes with a wrong label shipped in the source. Frozen
rows are strict (any marker fires); non-frozen rows should be too — require exactly one
marker, exactly the row's class. Low likelihood, but the rule's stated contract ("a
reclassification that updates the manifest without the marker, or vice versa, fails") is
weaker than implemented.

### R5 — Minor — packages/README.md states the monotone rule without the dangling-correction nuance it also narrates

`packages/README.md:39` — "a declared entry may **not** be removed, renamed, or repointed"
sits ~28 lines above lines 67-72, which narrate the LEAD ruling removing `./vectors/drivers`.
The nuance (a never-authored target's removal is a manifest correction, not a surface removal)
is in BOUNDARIES §14, and the file's Source-of-truth section defers to the manifest — but the
repo-level README now contains both the un-nuanced absolute and the exception with no
cross-reference. One clause ("…removed — except a declared-but-never-authored target, which is
a manifest correction; see BOUNDARIES §14") closes it.

### R6 — Trivial — Delivery-audit citation overshoots the cited file

`evidence/delivery-audit.md:38-39` cites the classic README's wasm-constraint sentence at
"lines 56–62"; the file is 59 lines and the quoted sentence sits at 58-59 (heading at 50, the
`wasm.__wbindgen_start` failure mode at 56). Quote is verbatim and the clause is met; only
the range drifts.

## Standards / Spec axes

**Standards: PASS with findings.** No SQL/concurrency/LLM surface (docs + static tooling).
Enum completeness: the three-class vocabulary is enforced by the checker and identical across
all five statements of it (3 READMEs, surface.json set, BOUNDARIES §14, design E1). Checker
code quality findings: R3, R4 (and the ENOENT-vs-exit-2 polish noted under item 4). Magic
string coupling: R2.

**Spec: PASS.** Every clause of the 6 requirements / 15 scenarios verified against evidence I
re-executed: version `0.x` + policy statement from packed tarballs (my run); wasm-init
constraint stated as current-surface truth (classic README §Known constraint); manifest
complete both directions + classification-at-birth + override validity (checker + controls);
markers in extracted source; frozen byte-identical + marker-free; marker/manifest agreement
(planted-on-real-source control); unlabeled-experimental FAILS + converse silent + census
non-vacuous (empty-scan exit 2 ×2); sweep dispositions 70/70 semantic; packages/README.md
current-tree restatement with method + measurement point; consumer view from tarballs
(re-run); manifest truth (dep blocks identical, re-verified). The delivery audit's pairings
are accurate; no clause required amendment.

## Coverage (control-path audit of the new checker/verifier)

The checker's rule × mode matrix is exercised by its own committed controls, which I re-ran:

- completeness (no-row / unknown-class / zombie-row) — negative worlds 2/3/6 FIRED.
- marker-agreement (unlabeled experimental / marker-on-frozen / flipped class on real source) —
  worlds 1/5 FIRED + group3 plant FIRED and reverted with blob-hash proof.
- override-validity (dangling / resolving) — world 4 FIRED; converse resolving override silent.
- target-existence (non-frozen / frozen absent) — worlds 7/8 FIRED.
- empty-scan (no-packages / zero-entries) — exit 2 ×2.
- Gaps = R3 (non-string targets unexercised — no fixture world covers them) and R4 (no
  multi-marker world). The consumer-view verifier's four clauses are all green in my re-run.

## Verification-of-claims ledger (claims re-executed vs trusted)

Re-executed by me at HEAD: labels checker 3 modes + 2 empty-scan fixtures; boundary checker;
full 28-checker family sweep; consumer view from tarballs (pack + extract); no-stability
sweep; frozen byte-control ×4 (vs `5aae75ec` and `8248a115`); manifest-truth dep-block diff;
never-authored / zero-importer premises; classic root-barrel closure trace; 5 sweep
dispositions; blob-hash continuity of classic surface.json; version/`0.1.0` greps; security
greps. Trusted from committed logs (consistent with my re-runs where they overlap): group-time
logs' historical censuses (36-era), group2 early-pack inventory counts, group8 log legs
(labels/converse/negative/boundary/consumer-view all matched my re-runs line-for-line).

## Durable findings

1. **A cross-cutting correction must sweep every file that names the corrected thing** — the
   ruling's execution updated eight artifacts but missed the shipped per-package README and a
   checker's mirror map; a repo-wide grep of the removed identifier at the completion pass
   would have caught both. Figure-accuracy of shipped docs is not covered by any existing
   checker (labels reads maps/manifests; the stability sweep reads term claims).
2. **Fail-closed checkers should treat unrepresentable targets like unreadable ones** — the
   vacuous-absence class survives for non-string export targets (R3); exactness beats
   membership for marker agreement (R4).
3. **The from-tarballs consumer-view oracle is the only gate that catches
   packed-artifact-level defects** (it caught the dangling entry no workspace gate could see);
   its example is worth generalizing when P6/P7 wire CI.

## Review round 1 dispositions (implementer, 2026-08-15)

All six findings fixed in one batch; evidence at `evidence/logs/group9-review-round1.log`;
narrative in `evidence/implementation-report.md` §Group 9.

| finding | severity | disposition |
| --- | --- | --- |
| R1 | Major | FIXED — contracts README figures 11→10 / frozen 10→9, entry dropped from the frozen list, removal note added; figure proof at README lines 30/33; the durable guard adopted: repo-wide `git grep vectors/drivers` (excluding archived children) at the fixed tree = 40 hits, all dispositioned in the log (ruling narration / committed evidence / checker provenance / still-existing driver-file references); zero hits present the entry as live. |
| R2 | Minor | FIXED — `PACKAGE_EXPORTS` mirror row removed; invariant stated in the map's comment; checker re-run green (10/10 factories, 10/10 registry keys, 53 modules). |
| R3 | Minor | FIXED — non-string conditional targets fail closed under `target-existence` (unrepresentable = unreadable); negative-control world 9 fires it; no live instance (all manifests string-targeted), the world pins the guard. |
| R4 | Minor | FIXED — marker agreement is exactness (exactly one marker, exactly the row's class); negative-control world 10 (stale beside current marker) fires under `marker-agreement`; live run green. |
| R5 | Minor | FIXED — packages/README.md's monotone rule carries the dangling-correction exception in place, cross-referencing BOUNDARIES §14. |
| R6 | Trivial | FIXED — citation now "the quoted sentence at lines 58–59 of the 59-line file, failure mode at line 56". |

Round-1 gates at the fixed tree: labels live/negative (10/10 FIRED)/converse all EXIT 0 with
census 35 = 16+13+6 and `dangling-export-entries: 0`; session-state-boundary EXIT 0;
boundary five rules PASS; consumer view from tarballs EXIT 0 (set-equal 6/10/19, 0 failures);
frozen byte-control vs `5aae75ec` IDENTICAL ×4; no-stability sweep EXIT 0 (70 dispositioned);
`rasen validate --strict` valid:true.
