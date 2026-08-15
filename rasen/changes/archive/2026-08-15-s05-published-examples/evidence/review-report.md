# Review report — s05-published-examples (P6, verify stage)

Reviewer: role-isolated verify worker (not an author of this change; both
implementers treated as authors). Mode: DISPATCHED, report-only — no code
edits, no fixes applied, no commits. Scope: `4f0b9c69..253bfe07`, 7 commits
(ac961390, 6c7f545a, 3f913b7a, 4d4a13da, 2a72333e, 6de3c756, 253bfe07),
78 files. Reviewer scratch: `E:\p6-review-scratch` (E: drive, outside the
repo, ancestor chain node_modules-free — verified before use, per the very
control under review).

**VERDICT: FINDINGS — 0 Blocker / 0 Major / 4 Minor / 5 Trivial.**
Nothing blocks shipping. The Minors are evidence-completeness and
evidence-precision defects plus one durable P7 item; every load-bearing claim
of the change was independently reproduced or verified against source.

## Mandated attention items — conclusions

### 1. F-P6-7, the leakage catch — VERIFIED on all four sub-points

**(a) The date-fns closure claim is true.**
`react-day-picker`'s installed manifest declares `date-fns` as a peer with
range `^2.28.0 || ^3.0.0` (workspace copy 8.10.1, `node_modules/react-day-picker/package.json`).
classic's only react-day-picker importer is
`packages/editor-classic/src/components/ui/calendar.tsx`; classic's own source
never imports date-fns directly — so date-fns is needed purely as
react-day-picker's peer, which is why the promotion rule ("a peer of a
dependency the closure needs must become the package's own dependency under
`--legacy-peer-deps`") was the correct repair. classic's manifest now carries
`"date-fns": "^3.6.0"` (packages/editor-classic/package.json:16, added in
commit 2a72333e); `bun.lock` resolves exactly `date-fns@3.6.0` (bun.lock:1293),
in-range. The base `4f0b9c69` manifest declared neither the F-P6-1 closure nor
date-fns (only culori + the react peer) — both repairs land inside this delta
(3f913b7a, 2a72333e).

**(b) CONTROL-1c semantics match the mandate.**
`script/scratch-install-harness.mjs:169-182`: the loop starts at
`dirname(root)` and iterates to the drive root, checking
`existsSync(join(dir, "node_modules"))` BEFORE the break test — the drive root
itself is checked (the clean log's "checked 3 ancestor(s)" =
`C:\Users\Sayo\.opencut-scratch-p6` → Sayo → Users → C:\). The refusal fires
inside `resolveScratchRoot()` (run-published-examples.mjs:128) BEFORE
`freshLifecycle()` (line 129) touches anything — the committed refusal log
(`evidence/logs/group5-control-1c-default-refused.log`) shows only CONTROL-1a/1b
PASS lines preceding it, and names the first leaky ancestor
(`E:\...\elftia`) with a one-line remedy in the error message
(scratch-install-harness.mjs:175). A `node_modules` inside the scratch root
itself is deliberately not flagged — correct, since that is the tree the
harness just installed.

**(c) The taint amendment is honest.**
Group-3's logs stand committed unmodified (`group3-full-run.log`,
`group3-embed-surface.log` in the diff); the amendment block sits visibly in
the implementation report at section 3.5 naming F-P6-7 and designating
`group5-full-run-clean.log` as authoritative; the failed first attempt is
preserved as the catch's own evidence
(`group5-ci-dry-run-first-attempt-failed.log`: rollup
`failed to resolve import "date-fns" from .../react-day-picker/dist/index.esm.js`,
`REAL_EXIT_CODE[example/embed-surface/build]:1`, self-logged, run at the
pre-repair commit 4d4a13da — honest sequencing). The pre/post-repair install
counts corroborate the repair inside the clean run: custom-storage 251→252,
embed-surface 348→349, install-packages 249→250, agent-transaction unchanged
at 5 — exactly the +1-per-classic-consuming-example signature the report
claims. One precision gap is filed as R3 below.

**(d) The falsification probe — no REACHABLE phantoms survive; two latent-only
peers recorded (R4).** I wrote and ran a two-level probe from a fresh pack of
the shipping tree, extracted in a node_modules-clean root
(`E:\p6-review-scratch/probe.mjs`):
- **Level 1** (every bare import specifier in classic's 796 shipped source
  files vs the declared manifest): the only undeclared names are
  `@napi-rs/canvas` (3 files, all `__tests__/` — unreachable from any declared
  entry, and dispositioned in writing at `examples/embed-surface/README.md:75`
  "measured test-only and stays undeclared") and `bun:test` (test files — the
  checker family's own allowance). Zero undeclared production-reachable
  specifiers.
- **Level 2** (every peer of every declared dep that the dep's own code
  imports, vs classic's declarations): every dep-imported peer classic's
  closure reaches is declared — `date-fns` included. Two candidates surfaced
  and were then ELIMINATED as unreachable: zustand's peers `immer` and
  `use-sync-external-store` are imported only by `zustand/esm/middleware/immer.mjs`
  and `zustand/{traditional.js,esm/traditional.mjs}` respectively; classic
  imports only `zustand`, `zustand/vanilla`, `zustand/middleware`, and
  `middleware.mjs` is a self-contained bundle with zero immer references
  (verified by grep). Latent-only — filed as R4/durable, not a delivery defect.
This confirms the implementer's statement that nothing asserts packed-manifest
dependency closure, and shows the current reachable graph is closed.

### 2. The four examples' execution evidence — VERIFIED

`evidence/logs/group5-full-run-clean.log`, line by line: CONTROL-1a/1b/1c
PASS (3-5), consumer-view PASS 3 packages / 0 failures / 0 dangling (80),
`REAL_EXIT_CODE[npm-install/*]:0` ×4 (89, 132, 183, 243), ten
`EXIT[example/...]:0` lines zero-nonzero (95, 116, 140, 152, 163, 191, 213,
227, 251, 277), wrapper `REAL_EXIT_CODE:0` (281). agent-transaction: 87 ledger
comparisons (99), 9/9 steps (98), `reopen verdict passed`, `reopened revision
6 == committed 6`, `the reopened target is a fresh store instance` (111-114).
embed-surface: build 3731 modules (197) + smoke 9/9 including
`clean/console`, `clean/pageerror`, `clean/network` (217-226). custom-storage
honest pair: production leg `classic chain: NOT LOADABLE ... observed:
wasm.__wbindgen_start is not a function` + `migration/by-replication: SKIPPED
distinctly` (143-150); mock leg `wasm mock: installed (experimental entry
...)`, `31 steps, target v31`, ports 36 cases green with migration exercised
(155-161). install-packages: three resolution assertions (259-261), five
classification assertions (262-266), `classic declares its React peer
(unsatisfied here by design)` + `node_modules/react does not exist` (273-274).
The README instability statement is present verbatim at
`examples/custom-storage/README.md:28-36`.

### 3. Census + family — VERIFIED figure-exact, independently re-derived

- Census re-run at my tree: **1135 / 1011 / 416 / 415 / 870 / 74** — identical
  to `group4-census.log`. Baseline `group1-baseline.log`: 1110/989/362/361/870/74.
  Reconciliation independently confirmed: 22 example code files by the
  checker's own filter (`.ts|.tsx|.js|.jsx|.mjs|.cjs|package.json|bun.lock`;
  `tsconfig.json`/`font-atlas.json`/`.css`/`.html` correctly excluded) + 3
  added scripts (`check-sdk-consumer-view.mjs`, `run-published-examples.mjs`,
  `scratch-install-harness.mjs`) = +25.
- Family: my own full sweep at the shipping tree reproduces **29 checkers,
  23 exit-zero / 6 nonzero** with the nonzero set byte-identical to P5's known
  six (`asset-manifest:2, emitted-runtime-assets:1, headless-graph:2,
  headless-semantic-result:2, resolution-equivalence:1, type-baseline:1`).
- Consumer declaration: `packages/boundary.json` gains
  `{ "id": "examples", "root": "examples" }` (vite-example shape, no ownership
  map); `no-elftia-import`'s clause reads "no package, Host or example" over
  1135 files.

### 4. Frozen surfaces — VERIFIED, reproduced stat-cache-immune

`git show 5aae75ec:<path> | cmp -s - <path>`: **4/4 IDENTICAL**
(transactions/opencut/index.ts, contracts engine.ts, ports index.ts,
surface/embedding/types.ts), cross-checked by blob hash — worktree = base =
HEAD `253bfe07` for all four. `git log 4f0b9c69..253bfe07 -- <the four
paths>` is empty: no commit in the delta touched any frozen path.

### 5. CI leg — VERIFIED

`.github/workflows/bun-ci.yml` parses (js-yaml: jobs `build, sdk-examples`;
5 steps; run command
`OPENCUT_SCRATCH_ROOT="$HOME/.opencut-scratch-ci" node script/run-published-examples.mjs`
— drivability purely through env seams). Scratch root under `$HOME`, never
`runner.temp` (which CONTROL-1b refuses). The job comment states the claim
(four examples + consumer view) and the three non-claims (local-only checkers
stay local, no matrix extension beyond ubuntu, no publish) and names the
local-twin log. The honest post-delivery sentence appears in BOUNDARIES §15
("the first true CI execution lands on the post-delivery push"), the
implementation report, and the delivery audit (R7 notes the sentence's
absence from the YAML comment itself). The green dry-run evidence is
committed (`group5-ci-dry-run.log`: CONTROL-1c PASS, 10 EXIT lines zero,
`REAL_EXIT_CODE:0`, `DRY_DONE:0`; subset seam `group5-subset-seam-clean.log`
green through `OPENCUT_PREPACKED_DIR`). The whole-file CRLF→LF normalization
of the workflow (base blob was CRLF-in-index) makes the raw diff a full
rewrite; `--ignore-cr-at-eol` shows the content delta is exactly the
sdk-examples job append.

### 6. Consumer-side obligations F-P6-4/5/6 — VERIFIED in code AND in the
README an adopter reads

- F-P6-4 (`@source` self-registration): `examples/embed-surface/src/styles.css:32`
  (`@source "../node_modules/@opencut/editor-classic/src"`) + README lines
  18-24 naming the silently-half-styled failure mode.
- F-P6-5 (definite height): `examples/embed-surface/src/main.tsx:122`
  (`height: "100vh", overflow: "hidden"` wrapper) + README lines 25-30.
- F-P6-6 (seed element): `main.tsx:40-58` (buildTextElement, overlay track,
  the `as CreateTextElement` narrowing) + README lines 36-41 with the
  zero-duration rationale.
- The honest pair + experimental inheritance: custom-storage README 11-36.
- All four READMEs carry consumed-surface tables with P5 classes and
  per-entry justifications; embed-surface additionally states it consumes no
  experimental entry (README:68-69).

### 7. Security sweep — CLEAN

Added lines of all 7 commits + the on-disk evidence tree swept for
credential-shaped content (`_authToken`, `AKIA…`, private-key headers,
`npm_`/`ghp_`/`sk-`/`xox`-shaped tokens, `Authorization: Bearer`, password/
secret/credential identifiers): the only hit is the base workflow's
pre-existing `FREESOUND_API_KEY: "placeholder"` (re-appearing in the diff only
because of the CRLF normalization; a literal placeholder, not a secret). npm
install output in the logs carries no registry credentials. No `signals/`
directory exists for this change (ship log confirms; independently verified).
PII is limited to `C:\Users\Sayo\...` scratch paths in the Group-5 logs —
the same absolute-path convention every prior portfolio log carries, and the
username is the repo's committer identity.

### 8. General pre-landing review — VERIFIED

- **Extraction vs P3 semantics:** `group1-p3-runner-reference.log` vs
  `group2-p3-rerun-post-extraction.log` first block: every CONTROL line,
  lifecycle line, install line and suite line byte-identical; only npm's
  install-duration line (17s vs 12s) and the wrapper's own exit echo differ
  (R8). The `--control-removal` mode re-ran green with `CONTROL-3 removal:
  PASS`. The extracted runner keeps its three CLI modes and all six env seams;
  `install()`'s default label preserves P3's `REAL_EXIT_CODE[npm-install]` line.
- **Copyability:** zero relative imports from `examples/` into `apps/` or
  `packages/`; manifests are exact-pin registry shape with no committed
  overrides and no `@opencut/*` in devDependencies; the runner's materialize
  guards (non-exact pin, committed overrides, stale pin vs packed version)
  fail closed with named causes.
- **Spec axis:** all 6 requirements / 11 scenarios / 24 atomic clauses are
  paired in `group6-delivery-audit.md` with committed evidence — except one
  clause whose pairing cites a record that does not exist (R1) and one clause
  whose literal wording is contradicted by a compliant example (R2).
- **Runner code quality:** self-logged exits throughout (PIPESTATUS-safe —
  the P5 trap this portfolio already paid for), fail-closed guards on every
  env-derived path, path-escape guard in the smoke's static server
  (smoke.mjs:53), chromium self-install fallback matching the CI job comment
  (smoke.mjs:85-97).

## Findings

### R1 — Minor — Delivery audit cites a negative-control run record that was never committed

`evidence/group6-delivery-audit.md:80-83` pairs the spec's fail-closed clause
("a dangling declared entry introduced as a control fails the gate at any
class") with "report section 2.2 ... (run record in the Group-2 log set)" —
but `grep synthetic-dangling` over `evidence/logs/` returns nothing; the
Group-2 log set contains only green runs. The violation-and-revert's FAIL
half exists as report prose only, against the F2 rule's own standard (every
clause paired with an evidence line) and against task 2.2's violation-proof
wording.
**Reviewer reproduction closes the behavior question:** a scratch-doctored
copy of the packed contracts tarball (synthetic entry declared in BOTH export
map and surface.json, so set-equality holds and only the dangling branch can
fire; the repo was never touched) run through the committed checker via
`OPENCUT_PREPACKED_DIR` fails closed at BOTH classes — `provider` and `frozen`
— with `dangling-export-entries 1`, `REAL_EXIT_CODE[consumer-view]:1`. The
branch is real; only the evidence line is missing.
**Failure scenario if unfixed:** at archive, the main-spec sync carries a
clause whose only committed evidence is narrative; a future auditor grepping
for the control finds green twins and must take the report on faith.
**Routing:** commit the FAIL-side log (or fold this report's reproduction
lines into the evidence set) before archive.

### R2 — Minor — Spec requirement 5's literal clause is contradicted by a compliant example, and syncs forward un-tightened

`specs/sdk-published-examples/spec.md:109` ("no example code reads the
surface manifest at runtime") vs requirement 1's own scenario at spec.md:21-22
("the installing example ... reads the installed artifacts' versions and
labels"). `examples/install-packages/run.ts:41` does read `surface.json` at
runtime — as data, which requirement 1 mandates. The delivery resolves the
tension with the data-vs-behavior distinction, disclosed in
`evidence/logs/group6-f2-support-verifications.log:14-16`; the example's
README phrases it as "nothing ... reads surface.json to decide runtime
behavior" (README:50-51).
**Failure scenario if unfixed:** at archive the un-tightened wording syncs
into `rasen/specs/sdk-published-examples/`; any future grep-driven audit (the
house method) finds run.ts:41 "violating" requirement 5 and files a false
defect — or worse, "fixes" it by deleting requirement 1's lesson.
**Routing:** tighten the synced wording at archive ("reads ... to drive
behavior" / "as machinery") — a one-line spec amendment, rulings attributed in
design.md per the portfolio's rule.

### R3 — Minor — The authoritative clean-run log cannot self-certify it ran the shipping revision

`evidence/logs/group5-full-run-clean.log:1` prints `running at 4d4a13da` —
the Group-4 commit. The date-fns repair and CONTROL-1c it exists to prove
were uncommitted working-tree state at run time (committed after as
2a72333e). The tree-state is strongly corroborated inside the log itself (the
`CONTROL-1c` PASS line is impossible against 4d4a13da's committed tree; the
install counts carry the +1 date-fns signature; the build is green), and the
log-before-commit pattern is the portfolio's standing convention (Groups 2-5
alike; Group 6 honestly labels itself `2a72333e+worktree`). But this
particular log is the amendment's designated authoritative run — the one
place the label gap is load-bearing.
**Failure scenario if unfixed:** a skeptical future reader (or the post-
delivery CI run disagreeing) has no committed, self-labeling artifact proving
the green full run equals the shipped tree; the claim rests on count
arithmetic read alongside a different commit's hash.
**Routing:** re-run the canonical full run at `253bfe07` (or any commit ≥
2a72333e) before archive and supersede/annotate the log, or add the explicit
tree-state note; generalizing Group 6's `+worktree` suffix to every
working-tree log closes the class.

### R4 — Minor (durable for P7) — Two latent-only peer phantoms survive classic's manifest; nothing asserts the class

My probe (mandate item 1d) found zustand's peers `immer` and
`use-sync-external-store` imported by `zustand/esm/middleware/immer.mjs` and
`zustand/traditional.{js,esm/traditional.mjs}` respectively, undeclared by
classic — but unreachable: classic imports only `zustand`, `/vanilla`,
`/middleware`, and the middleware barrel is a self-contained bundle with zero
immer references. So no current consumer is broken (consistent with the clean
run's green build), but any future classic edit adding
`zustand/middleware/immer` (or an adopter reaching `zustand/traditional`
through classic's tree) hits the exact F-P6-7 wall under
`--legacy-peer-deps`, and no gate notices — the implementer's own honest
residue ("a checker that asserts packed-manifest dependency closure" as a P7
tidy, implementation-report.md:446-448). Level-1 residuals (`@napi-rs/canvas`,
`bun:test` — test files only) are dispositioned in
`examples/embed-surface/README.md:75`.
**Routing (P7):** build the closure checker reachability-aware (probe design
available in this report: level-1 bare-specifier scan of the extracted
tarball vs the packed manifest; level-2 peers-of-deps imported by dep code,
eliminated by subpath reachability), or declare-and-document the two latent
peers.

### R5 — Trivial — Delivery-audit clause count mislabeled

`group6-delivery-audit.md:3` says "all twelve scenario clauses"; the audit
actually pairs 24 atomic clauses across 11 scenarios (requirement 6 has a
single scenario). Coverage is complete — only the count in the opening line
is wrong.

### R6 — Trivial — react-day-picker version detail unverifiable from committed evidence

implementation-report.md:411 says `react-day-picker@8.10.2`; the workspace
lock resolves 8.10.1 (`^8.10.1` in the manifest, so a fresh scratch install
plausibly picked 8.10.2). The peer range — the load-bearing fact — is
identical on 8.10.x and was verified directly. No committed log prints the
scratch-resolved version.

### R7 — Trivial — The post-delivery honesty sentence lives everywhere except the job comment

BOUNDARIES §15, the implementation report (5.2), and the delivery audit all
state "the first true CI execution lands on the post-delivery push"; the
sdk-examples job comment names the local-twin log but not the sentence
itself. Task 5.2's wording ("stated, not hidden") is met by the three
documents; adding the sentence to the YAML comment would make the job
self-describing on GitHub's UI.

### R8 — Trivial — Extraction-acceptance identity claim slightly overstated

implementation-report.md:50-53 ("every runner-emitted line identical — the
sole diff line is the evidence wrapper's own exit echo"): npm's
install-duration line also differs ("in 17s" vs "in 12s") — timing
nondeterminism echoed through the runner, not a behavior difference. The
disclosure would be exact with "except npm's install-duration line".

### R9 — Trivial — Latent materialize() guard gap for a direct opencut-wasm dependency

`script/run-published-examples.mjs:209-247` rewrites only `@opencut/*` keys
to tarball specs and injects an `opencut-wasm` override when classic is a
dependency. An example that declared unscoped `opencut-wasm` as a direct
dependency alongside classic would hit npm's direct-dep==override rule with
npm's own (less legible) error rather than the runner's fail-closed guard. No
current example does this; the runner's unknown-shape guards cover every
manifest actually shipped.

## Durable findings for P7 (from this review)

1. **The packed-manifest dependency-closure checker does not exist — build it
   reachability-aware.** Known latent set to seed it: zustand→`immer`
   (`zustand/middleware/immer` subpath), zustand→`use-sync-external-store`
   (`zustand/traditional`); level-1 test-only residuals `@napi-rs/canvas` and
   `bun:test` (already README-dispositioned). Probe design in R4.
2. **Authoritative logs should self-certify their revision.** Generalize
   Group 6's `<HEAD>+worktree` suffix to every log taken before its commit,
   and re-run the one canonical full-run log at the shipping commit (R3).
   Cheap habit; this review needed count-arithmetic to establish what a
   one-line label would have stated.
3. **Negative controls should commit their FAIL half.** The dangling
   violation-and-revert proved the branch fires but preserved only the green
   twins (R1); the same applies to any future violation-and-revert evidence.
   Pair with R2's one-line spec tightening at archive so the synced main spec
   doesn't carry a literally-violated clause.

## Method note

All runs read-only on source: census re-run, full 29-checker family sweep,
frozen byte control, probe pack/extract, and the doctored-tarball negative
control executed from `E:\p6-review-scratch` (node_modules-clean ancestor
chain, verified before use). The only repo writes are this report file.

---

# Round 1 re-review (delta 253bfe07..d4340b67)

Re-reviewer: the same role-isolated verify worker (round 1 author). Scope:
the fix delta ONLY — `4b979b67` (static fixes: R2 spec/design, R7 job
comment, R9 runner comment, R5/R6/R8 report corrections) and `d4340b67`
(evidence: R1 FAIL log, R3 authoritative re-run, gates log, round
dispositions, this report committed). Ten files, every one mapped to a
finding fix or its evidence; zero drive-bys.

**VERDICT: CLEAN — all nine round-1 findings fixed or correctly recorded;
no new findings.** Per-finding verification, each against the actual diff or
log content, not the disposition prose:

- **R1 (Minor) — FIXED.** `evidence/logs/review1-synthetic-dangling-fail.log`
  (165 lines): header documents the doctored-copy mechanism; both legs
  self-label `verifying at 4b979b67`; leg 1 (provider) FAIL at line 63, leg 2
  (frozen) FAIL at line 135, each with `dangling-export-entries 1` and
  `REAL_EXIT_CODE[consumer-view]:1`; set-equality preserved in the doctored
  package (11 declared = 11 classified in both legs — only the dangling
  branch fired); per-class census internally consistent (+1 provider / +1
  frozen); the repo-untouched proof is IN-LOG (git status at run time shows
  only the known untracked planning containers plus the round's own new
  files — no tracked file modified). The delivery audit's clause pairing now
  cites this log (`group6-delivery-audit.md:80-90`). This matches my round-1
  reproduction independently.
- **R2 (Minor) — FIXED.** Spec requirement 5 tightened in prose AND scenario
  clause to the data-vs-behavior form ("no example SHALL read the surface
  manifest as runtime machinery for its own behavior — the installing
  example's manifest read is that example's demonstrated data (requirement
  1's own lesson), not machinery"); scenario heading verbatim (diff touches
  only the AND clause); the ruling is attributed in design.md E6 as a dated
  task-time ruling naming R2. `rasen validate --strict --project rocut
  --json` re-run by this reviewer at HEAD d4340b67: `"valid": true`,
  `"issues": []`.
- **R3 (Minor) — FIXED.** `evidence/logs/review1-full-run-clean.log`
  self-labels `run-published-examples: running at 4b979b67` (line 13) — the
  static-fixes commit, with every executable round-1 change committed before
  the run (per-commit split verified: 4b979b67 carries workflow/runner/
  spec/design; d4340b67 adds only non-executed evidence). The log carries
  CONTROL-1a/1b/1c PASS (15-17), consumer-view PASS 3/0/0 (92), the date-fns
  install signature 5 / 252 / 349 / 250 (98, 132, 179, 243), ten
  `EXIT[example/...]:0` lines zero-nonzero, `REAL_EXIT_CODE[examples-run]:0`
  (292), wrapper `REAL_EXIT_CODE:0` (293). The 3.5 amendment and section 5.2
  now designate this run authoritative with group5's log explicitly relabeled
  **corroborating**; the group5 log file itself is untouched by the delta
  (verified — 0 paths), the relabel living in the report only, which is the
  correct treatment of historical evidence.
- **R4 (Minor) — RECORDED (LEAD routing: record, don't build).** The P7
  handoff section carries the zustand phantom paths verbatim
  (`zustand/esm/middleware/immer.mjs`,
  `zustand/{traditional.js,esm/traditional.mjs}`, classic's three import
  specifiers, the zero-immer middleware barrel), the two-level probe design
  with the level-1 residuals, and the consolidated durables (F-P6-3,
  F-P6-4/5/6, bun.lock refresh, the two process habits).
- **R5 (Trivial) — FIXED.** 6.3 now reads "24 atomic clauses across the
  spec delta's 11 scenarios (requirement 6 has a single scenario...)" —
  matching this reviewer's independent count exactly.
- **R6 (Trivial) — FIXED.** The F-P6-7 diagnosis drops the 8.10.2-specific
  claim, states the workspace lock resolves 8.10.1 with the peer range
  identical across 8.10.x as the load-bearing fact.
- **R7 (Trivial) — FIXED.** The sdk-examples job comment now carries "The
  first true CI execution lands on the post-delivery push — the local twin
  above is the pre-delivery evidence; stated, not hidden."
- **R8 (Trivial) — FIXED.** The 2.1 identity claim now discloses npm's
  install-duration line (`in 17s` vs `in 12s`) alongside the wrapper echo.
- **R9 (Trivial) — FIXED (noted, not guarded — the right size).** The
  materialize() wasm-override site carries the latent unscoped
  `opencut-wasm` direct-dep comment; comment-only, no behavior change.

**Round-1 close-out gates verified:** `review1-gates.log` (run at 4b979b67)
carries validate strict green, `check-sdk-surface-labels` 35 entries all four
rules PASS exit 0, and the boundary census unchanged at 1135/1011/416/415/
870/74 all rules PASS — the fixes added only `.md`/`.log` files and one
code comment, so the census arithmetic is undisturbed, as expected.

**Delta hygiene:** working tree clean of tracked modifications (only the
pre-existing untracked portfolio containers, unchanged since round 1 start);
all ten delta files CR-free at their committed blobs (ship discipline 7.1);
frozen surfaces untouched (no frozen path in either commit's file list;
spot byte-diff `packages/editor-ports/src/index.ts` vs 5aae75ec IDENTICAL);
this reviewer's round-1 report committed byte-identical (worktree blob hash
== d4340b67's committed blob hash).

No new findings. The change is review-clean through round 1 at d4340b67.

## Round-1 re-review method note

Read-only: diff inspection of both commits (combined and per-commit), log
content verification, one frozen-surface spot byte-diff, one validate-strict
re-run at HEAD, CR sweep over committed blobs. The only repo write is this
appended section.
