# Review report — s05-conformance-for-third-parties (P3, verify stage)

Reviewer: `reviewer-s05-p3` (dispatched, report-only; not the author). Date: 2026-08-15.
Delta reviewed: base `8248a115` .. HEAD `00263505` — 10 commits, 66 files, +15938/−3.
Repo: rocut @ `feat/s05-community-beta`. `rasen validate --strict --project rocut --json` → `valid: true, errors: []`.

**VERDICT: FINDINGS — 0 Blocker / 1 Major / 3 Minor / 0 Trivial.**
Every load-bearing claim of the change was independently reproduced by the reviewer and held.
The findings are evidence hygiene and spec-fidelity items, none of which invalidate the
executed proofs; F1's regen and F2's spec amendment should land before archive.

## Scope check

CLEAN. Delivered = the proposal's Impact section plus exactly the LEAD-ruled Group-9 additions
(classic manifest truth, `./storage/migrations`, fourth tarball, react-free control). No
out-of-scope files: `git diff --name-only 8248a115..HEAD -- apps/` is empty; the five frozen
suite modules and four frozen surfaces are untouched (reproduced below); `.rasen/` appears in
zero commits. The two unchecked task boxes (7.5 post-archive rider grep, 8.4 standDown) are
correctly unchecked per their own text; 8.4's precondition holds (no `signals/` directory
exists under the change root).

## What this reviewer reproduced (not just read)

- **The full scratch sequence, all three modes** (pack 4 tarballs → npm install
  `--legacy-peer-deps` → controls → run): full run green (ports 36 / transaction 21 / engine
  38 / draft 22 / vectors 29, `REAL_EXIT_CODE[suites]:0`), variant failing exactly the 4
  attributable cases with `CONTROL-variant-exactness: PASS`, removal control collapsing the
  adapter runner at its first `@opencut/editor-ports/conformance` import — byte-for-byte the
  committed `group9-scratch-all-modes.log` shape, including all four CONTROL-2 lines and the
  react-absent line in every leg.
- **The in-repo adapter leg at HEAD**: `wasm.__wbindgen_start is not a function. (In
  'wasm.__wbindgen_start()', 'wasm.__wbindgen_start' is undefined)` with the NEW
  `./storage/migrations` wording, five suites green, exit 0.
- **The migration-walker test**: 2 pass / 0 fail against the real 31-step chain via
  `@opencut/editor-classic/evidence/wasm-test-mock` (migrated 30→31, progress 1/1; second call
  `not-needed`; declining transform failed closed `invalid version`).
- **The pack module with determinism**: all four tarballs packed twice, digests reproduced;
  the npm shasums from this reviewer's run at HEAD (ports `07ddd5e3…`, contracts `436aa45d…`,
  classic `449f3d61…`, wasm `a59e1ee3…`) are identical to the committed
  `tarball-manifest.json`.
- **All three host gates**: `apps/electron-host` typecheck EXIT 0, `apps/vite-example`
  typecheck EXIT 0, `check-type-baseline` exit 1 with the same two S01 rows, scope **942**
  repo files.
- **The boundary checker + both controls**: PASS over 1107 repo files / 989 graph files /
  361 specifiers / 362 edges; negative control — every rule proven able to fail; converse —
  no misfire.
- **Frozen surfaces**: `git show 8248a115:<path> | cmp` → IDENTICAL for all four S03+S04
  surfaces; `git diff --stat 8248a115..HEAD` over the five suite modules → empty.
- **The variant single-diff**: `diff -r` of the two fixture trees → exactly one file, one
  hunk, in `save()` — reproduces `group6-variant-single-diff.txt` byte-for-byte.
- **The spec rider**: per-requirement LCS diff of all six MODIFIED blocks against
  `git show 8248a115:rasen/specs/transaction-automation-api/spec.md` (see item 4).

## Findings

### F1 [Minor, evidence integrity] — `group9-adapter-in-repo.log` was captured one code-revision before the code it is committed beside

`evidence/logs/group9-adapter-in-repo.log:4` reads `classic chain: NOT LOADABLE —
@opencut/editor-classic/storage failed to import`. That string is produced only by the
pre-`00263505` `run.ts` (`git show 62bd9d1c:script/fixtures/third-party-adapter/run.ts:65`),
which imported the react-carrying `./storage` barrel. The committed `run.ts:65` prints
`…editor-classic/storage/migrations failed to load or initialize`, and the scratch log
(`group9-scratch-all-modes.log:30`) shows the new wording — so the in-repo leg of Group 9 was
evidenced with the old import path, then committed in the same commit that switched it.
Failure scenario: a future reader auditing "identical in-repo and from tarballs" for the ruled
`./storage/migrations` entry finds an in-repo log that never exercised that entry; in a
portfolio whose own spec warns §3.5 is "most easily faked by writing documentation instead of
running it", a stale log reads as current evidence.
The claim itself is TRUE — this reviewer re-ran the committed code in-repo and got the
identical decisive wasm line with all five suites green — but the committed log doesn't prove
it. Same one-revision staleness class: `script/fixtures/third-party-adapter/README.md:44`
("`@opencut/editor-classic/storage` could not resolve"), the walker test's header
(`__tests__/migration-walker.test.ts:4`), and `run-scratch-conformance.mjs:314-377`'s
smoke-consumer fallback comments ("template … does not yet exist (Group 5)" — it does).
Fix: regenerate the in-repo log from HEAD and refresh the three stale strings; ~5 minutes.

### F2 [Major, spec fidelity] — the ADDED spec scenario "with migration exercised" is not satisfied by the from-tarballs evidence and was not amended to the ruled honest-pair shape

`specs/sdk-third-party-conformance/spec.md:134` — requirement "A worked third-party adapter
passes every applicable suite from installed tarballs", scenario "The adapter passes from the
scratch project": "**THEN** the ports conformance suite passes on the portable profile with
migration exercised". Delivered state: in every scratch leg the chain is not loadable
(`group9-scratch-all-modes.log:32` — `suites/ports: passed=true cases=36 (migration absent:
classic unresolved)`; `run.ts:108` sets `exerciseMigration: chain !== null` = false), so
migration is exercised only in-repo via the mock entry (walker test). The LEAD's P3-apply
ruling accepts exactly this honest-pair end state for the implementation — but the spec delta
still carries the pre-ruling wording, and `rasen archive` will sync it verbatim into
`rasen/specs/sdk-third-party-conformance/spec.md`, enshrining a THEN clause the repo cannot
meet from tarballs (P6's custom-storage example will hit the same wall the LEAD's own note
predicts). Fix: amend the one clause before archive — e.g. "…with migration exercised where
the published chain initializes; where it cannot (the recorded wasm-init class), the run
records and skips the migration leg distinctly and the walker is validated against the real
chain" — or record an explicit LEAD waiver of the clause. The implementation report's own
disclosure (§9.6, Open items) is honest; only the spec text lags it.

### F3 [Minor, spec fidelity] — "adapter location all env-configurable" is not implemented

`specs/sdk-third-party-conformance/spec.md:40-42` requires the harness to be CI-ready with
"root, tarball output and adapter location all env-configurable". The runner exposes
`OPENCUT_SCRATCH_ROOT`, `OPENCUT_BUN`, `OPENCUT_PREPACKED_DIR`
(`script/run-scratch-conformance.mjs:26-29`) — root yes; tarball *input* yes, tarball *output*
no (packing always targets `<repo>/dist-sdk-tarballs/`; only the module API / CLI `--out`
override it); adapter location no — `ADAPTER_TEMPLATE` is hardcoded at line 52.
`BOUNDARIES.md` §13's own record says "three env seams", which is the accurate count.
Failure scenario: P6's CI leg wants to point the harness at its own example fixture without
forking the runner and cannot. Fix: either add the missing env seam(s) (one-liners) or soften
the spec's list to the three real seams.

### F4 [Minor, report arithmetic] — checker-sweep count is wrong: 21 zero-exit, not 23

`evidence/implementation-report.md:299-300` claims "27 checkers swept … 23 zero / 6 nonzero".
`evidence/logs/group7-all-checkers.log` contains exactly 27 `EXIT[…]` lines: **21** exit 0 and
6 nonzero (23+6=29≠27 — impossible on its face). The disposition set itself is correct (the
six nonzero are exactly P2's six, same exit codes, causes re-verified below); only the green
count is inflated. Fix the two numbers; census arithmetic is evidence discipline in this
portfolio (P0's archive already carried a "do not carry a wrong count forward" correction).

## Mandated attention items — conclusions

1. **LEAD gate-ruling execution (Group 9): VERIFIED, faithfully executed.**
   - classic manifest (`packages/editor-classic/package.json` @ `62bd9d1c`): `culori: "4.0.2"`
     exact pin in dependencies — the lockfile's actual resolution (single `culori@4.0.2`
     entry, deduped with apps/web's `^4.0.2`); `react: "^18.3.1"` in **peerDependencies**
     only; `opencut-wasm: "file:../../rust/wasm/pkg"` resolving to the same physical
     directory the root declares (lockfile adds one resolution entry, no duplicate, still a
     single `react@18.3.1` in the tree — no new react copy).
   - Fourth tarball: `SDK_PACKAGES` includes `rust/wasm/pkg` (opencut-wasm@0.2.10, 7 files,
     per-file SHA-256 inventory in the committed manifest); scratch `overrides` map
     `opencut-wasm` → `file:tarballs/opencut-wasm-0.2.10.tgz`; CONTROL-2 asserts all four
     installed copies; no registry publish anywhere (no publish command exists in either
     script); npm's "added 5 packages" = 4 tarballs + culori from the registry, which the
     ruling explicitly blesses.
   - `./storage/migrations` attributed entry: exports the whole chain surface; forcing module
     ("the third-party adapter's react-free migration conformance") named in the barrel
     header, BOUNDARIES §13's entry table, and the ruling record.
   - React-free proof: `--legacy-peer-deps` + fail-closed `CONTROL-react-free`
     (`node_modules/react` must not exist) + the migration leg importing the entry live from
     the installed tarballs — react-absent PASS in all three legs; resolution proceeds past
     module loading into wasm initialization (i.e. nothing needed react).
   - Host re-gates: reproduced — electron 0 / vite 0 / type-baseline exit 1 with the SAME two
     S01 rows byte-identical at the same file:line (compared across P2's archived log, P3
     group 7, P3 group 9, and this reviewer's re-run), scope 941→942 (+1 = the migrations
     barrel), zero new diagnostics.
   - **The boundary.json deviation is TRUE in code, not an excuse**: the checker derives
     declared entries from the discovered package manifests at load time
     (`packageSpecifierPattern(manifests)` / `manifestEntrySets` over `discoverPackageDirs`,
     `script/check-package-boundary.mjs:401-425, 875-899`); `boundary.json` carries no entry
     list (keys: `$comment/layers/consumers/shellPaths/ownership`), so the new exports entry
     self-registers. `public-entry-only` green over it; both controls re-run green by this
     reviewer.
2. **Fork honesty: VERIFIED.** The decisive `wasm.__wbindgen_start is not a function` line is
   in `group9-scratch-all-modes.log` (lines 31 and 72). "Identical in-repo and from tarballs"
   is true — reproduced in-repo at HEAD by this reviewer (see F1 for the stale committed
   in-repo log). The walker's validation against the real 31-step chain via classic's
   published `./evidence/wasm-test-mock` entry is real (test re-run green, same mechanism
   classic's own storage tests use). The disclosure is plain: the runner prints the skip
   distinctly, never claims a successful from-tarballs migration, and the report carries the
   wasm-init class as LEAD-owned Direction-level. No overclaim found beyond F2's spec-text lag.
3. **Core §3.5 proofs: VERIFIED.** Five suites green in-repo AND from tarballs at
   36/21/38/22/29 — re-ran both legs myself; the logs' `REAL_EXIT_CODE` lines are genuine.
   No-linking controls 1a/1b (outside repo, outside Temp) and 2 (lstat real-directory +
   lockfile `file:`/`link:false` over four packages) are fail-closed in code and print in
   every run. The removal control is **adapter-shaped and real, not weakened**: it re-runs the
   full adapter runner, whose first runtime import is the deleted package, and gates the
   failure through a resolution-failure regex — strictly stronger than the bare probe it
   replaced. The variant fails EXACTLY the 4 attributable cases (2 ports + 2 engine) under an
   executable count==4 exactness gate that fails closed in both directions (pass→fail, missing
   name, extra case), with the identical failure set in-repo and from tarballs.
4. **Spec delta + rider: VERIFIED, with F2/F3.** Six MODIFIED blocks. The five path-refresh
   blocks are each exactly a one-line-in/one-line-out path-text change (LCS diff,
   requirement-by-requirement against `git show 8248a115:rasen/specs/…`) — **zero semantic
   drift**; scenario headings verbatim in all six blocks (heading-level compare: removed=[]
   everywhere; the corpus block adds exactly one new scenario, "The corpus loads from an
   installed package", matching the declared substantive change). The new capability's six
   requirements are testable as written (executable scenarios against the harness, checkers,
   logs, guards). `rasen validate --strict` valid.
5. **Frozen surfaces + suites: VERIFIED by reproduction.** All four S03+S04 surfaces
   byte-identical to the base blobs; the five suite modules diff-empty over the change.
6. **Checker dispositions: VERIFIED, with F4.** The six nonzero exits are exit-code-identical
   to P2's dispositions (`asset-manifest` 2 — no preview server at 127.0.0.1:4173;
   `emitted-runtime-assets` 1 — `relative-next-static-escape` in `worker.dd71b7fd.ts`, whose
   on-disk mtime 2026-08-14 12:23 predates base and whose path this change never touches
   (`apps/` diff empty); `resolution-equivalence` 1 — fail-closed "nothing was verified" with
   no staged rewrites; headless pair 2 each — usage-gated). type-baseline's two S01 rows are
   byte-identical across P2/group7/group9/this re-run; scope 935→941→942 fully attributed
   (+6 group-2/3 files, +1 migrations barrel), zero new diagnostics.
7. **Security sweep: CLEAN.** Full-delta grep over all 10 commits' blobs and the on-disk
   evidence/logs for credential-shaped content (api keys, tokens, npm_/gh_/AKIA/private-key/
   bearer shapes) and env dumps: zero hits. No `signals/` directory exists (no parked
   workers). No publish path exists in the harness. Nothing leaves the machine except npm's
   registry fetch of the pinned public `culori` — normal consumer behaviour under B1.
8. **General pre-landing review: no findings beyond F1–F4.** Pack determinism is a real
   pack-twice sha256 comparison, fail-closed in the CLI, and reproduces (this reviewer's run
   yields byte-identical shasums to the committed manifest). The scratch runner's isolation
   is fail-closed (marker + foreign-root refusal + location assertions + fresh-per-run wipe).
   Both drift guards are fail-closed in both directions with violation-and-revert legs and
   non-vacuity assertions (`sources.length > 100` survives the `__tests__` exemption). The
   adapter's opacity claim is genuine: the NUL-marker codec is collision-free (escaped literal
   NUL keys), structuredClone-subset, and throws typed failures on functions/symbols/class
   instances/unknown markers — never silently coerces. The variant's single-hunk defect
   reproduces byte-for-byte. No enum/completeness, race, or side-effect issues found in the
   new code.

## Durable findings (for the LEAD / later children)

1. **Regenerate evidence logs when the last code revision changes what they print.** A log
   committed in the same commit as the code change that invalidates it (F1) reads as current
   but isn't. Cheap guard: before committing a log, grep it for a string only the new code
   prints (`storage/migrations failed to load` here) — absence means the log is stale.
2. **Spec deltas authored at propose time must be re-audited at delivery against what actually
   executed.** Archive syncs delta text verbatim into main specs, so an unmet THEN clause
   (F2) outlives the honest disclosure that lives only in the implementation report. A
   pre-archive pass pairing each ADDED/MODIFIED scenario with its evidence log line closes
   this class.
3. **Report arithmetic over logs must be derived by counting the log's own lines.** "23 zero /
   6 nonzero" of 27 (F4) was arithmetically impossible on its face; `grep -c 'EXIT\[.*\]:0'`
   is one command. Census numbers are the regression tests — carry the discipline to the
   prose counts too.

## Round 1 re-review (fix batch `688e0685`, 2026-08-15)

Delta reviewed: `00263505..688e0685` — one commit, 10 tracked files, +128/−47, against findings
F1–F4 only. Every fix verified by reproduction, not by reading the fixer's claims.

**VERDICT: CLEAN — all four findings resolved; nothing new introduced.**

- **F2 [Major] RESOLVED.** `specs/sdk-third-party-conformance/spec.md` — the scenario's THEN
  clause now states the two-mode pair exactly as the evidence shows it (in-repo: walker
  validated against the real 31-step chain via the published `./evidence/wasm-test-mock` entry,
  wasm-init finding recorded distinctly; from tarballs: suite passes with the migration leg
  absent, the skip recorded and named in the run's own output). Scenario heading
  ("The adapter passes from the scratch project") verbatim; WHEN and both AND clauses
  byte-unchanged; no ruling attribution embedded in the spec — the dated addendum lives in
  `design.md:195-211` (E7, 2026-08-15) and names the LEAD ruling and fork branch (b), plus the
  F3 seam addition. `rasen validate --strict --project rocut --json` re-run: `valid: true,
  errors: []`.
- **F1 [Minor] RESOLVED, and the regen is genuine.** The committed
  `evidence/logs/group9-adapter-in-repo.log` now contains the new-code-only string
  (`@opencut/editor-classic/storage/migrations failed to load or initialize`) — 1 occurrence —
  and 0 occurrences of the old `editor-classic/storage failed` wording; same decisive
  `wasm.__wbindgen_start` line; five suites green. This reviewer regenerated the log at HEAD
  with the same runtime (system bun 1.2.2): **byte-identical** on all 12 substantive lines (the
  only delta is the fixer's wrapper self-logging `REAL_EXIT_CODE:0` as a 13th line — a capture
  shape, not a content difference). Stale doc strings refreshed and verified: fixture README
  (exit-rule sentence now names `./storage/migrations`; package list now names
  `@opencut/editor-classic`), both walker-test headers, both `run.ts` headers, and the
  SMOKE_CONSUMER / no-template fallback comments (no more pre-Group-5 sequencing language).
  Walker re-run at HEAD: 2 pass / 0 fail, exit 0. Variant tree re-synced: `diff -r` still
  shows exactly one file, one hunk (`src/alien-store.ts` save()) — the single-diff invariant
  holds at `688e0685`.
- **F3 [Minor] RESOLVED.** Six env seams now real in `script/run-scratch-conformance.mjs`:
  `OPENCUT_SCRATCH_ROOT`, `OPENCUT_BUN`, `OPENCUT_PREPACKED_DIR` (pre-existing) plus
  `OPENCUT_TARBALL_OUT_DIR`, `OPENCUT_ADAPTER_TEMPLATE`, `OPENCUT_VARIANT_TEMPLATE` — each
  threaded to its use site (pack outDir, materialization sources), all six documented in the
  runner header; BOUNDARIES §13 updated with the round-1 attribution ("three at close-out, six
  after review round 1's F3 fix"). `node --check` clean. **Render-equality reproduced**: a
  default-env full scratch run at `688e0685` prints
  `adapter: committed template materialized into scratch (script/fixtures/third-party-adapter)`
  — byte-identical to committed `group9-scratch-all-modes.log:26` (same `templateLabel` logic
  covers the variant/removal legs' lines 67/127), and the run stayed green (react-free PASS,
  ports 36 passed, `REAL_EXIT_CODE[suites]:0`) — the committed scratch evidence is not
  perturbed by the fix.
- **F4 [Minor] RESOLVED.** `implementation-report.md` §7.1 now reads "21 zero / 6 nonzero";
  re-derived independently from `group7-all-checkers.log`'s own lines: 27 `EXIT[…]` entries,
  21 ending `:0`, 6 nonzero. Matches. §7.4's seam count also corrected.

**Drive-by sweep of `688e0685`:** clean. The 10-file tracked set is exactly the F1/F3/F4
surface (BOUNDARIES, implementation-report, the group9 in-repo log, both fixtures'
README/walker/run.ts, the runner) — no `bun.lock`, no package manifests, no `packages/`
sources, no other evidence logs touched. Zero surviving stale barrel references in the
fixtures (`editor-classic/storage` without `/migrations`: no hits). The
`transaction-automation-api` delta spec is untouched by the fix round (still exactly 6
requirement blocks; the installed-consumption scenario heading intact at line 151). The
spec/design deltas remain untracked by convention (`git status` shows only `.openspec.yaml`,
`design.md`, `proposal.md`, `specs/`, and this report as untracked). Nothing in the batch
invalidates any committed scratch evidence — re-verified end-to-end by the default-env scratch
run above.

**Standing conclusion unchanged:** 0 Blocker / 0 Major / 0 Minor outstanding for this change
(round-1 findings F1–F4 all resolved). Ship-ready from this reviewer's side.
