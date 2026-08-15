# Ship Log: s05-published-examples

**Date:** 2026-08-15
**Mode:** local
**Branch:** feat/s05-community-beta
**Commit:** d4340b670ac0f7d8109614125171c657dd7c32ff (pre-ship-log HEAD; this ship adds one further commit carrying this file, the reviewer's round-1 re-review append, and the fresh ship-gate log — `tasks.md` needed no ship-time tick: all 21 boxes were already `[x]`, including 7.1–7.3)
**Tree:** ed5ed9b8a2968d6200b78760cde4b7eb1ab11993 (pre-ship-log HEAD tree)
**Status:** Committed (delivery deferred to portfolio level)

## Delivery mode and why

`local`. This is child P6 of the 7-child decomposed portfolio for Slice
`05-community-beta-second-host` (workstream `opencut-agent-editor-sdk`). Per
the portfolio's decomposition contract, children accumulate commits on the
shared branch `feat/s05-community-beta` and the portfolio delivers once —
PR + merge, settled by the user 2026-08-15 — after every child completes;
that delivery is the PARENT's act, not this child's. Pushing or opening a
PR from this child individually would fragment the delivery, so this ship
commits locally only. No `git push`, no `gh pr create`, no `rasen archive`
was run.

## Scope shipped

9 commits since base `4f0b9c69` (`git rev-list --count 4f0b9c69..HEAD` = 9),
82 files changed, +22449/−402 (`git diff 4f0b9c69..HEAD --shortstat`).
Delivers the change described in
`rasen/changes/s05-published-examples/{proposal.md,design.md,tasks.md}` and
its delta spec (`specs/sdk-published-examples/spec.md` NEW — UNSYNCED by
design; spec sync belongs to the archive stage). `tasks.md`: **21/21
complete** — every box `[x]`; no ship-time vacuous tick was needed (7.1–7.3
were ticked by the implementer at Group 7 with the controls recorded in
`evidence/logs/group7-ship.log`: committed-content CR sweep 77 files /
0 hits, `.rasen/` staging guard 0, `signals/` absent — re-verified absent
at ship time, so there is no `signals/.state/` to confirm empty and no
standDown to send).

### Per-group summary with commits

| Commit | Group / content |
|---|---|
| `ac961390` | Group 1 — baseline at base `4f0b9c69`: census 1110/989/362/361/870/74, checker family 28 = 22 exit-zero / 6 nonzero (P5's known set), frozen byte-control over the four S03+S04 surfaces 4/4 IDENTICAL, P3 runner reference log captured pre-extraction. |
| `6c7f545a` | Group 2 — harness extraction (P3's scratch-lifecycle / no-linking controls into importable `script/scratch-install-harness.mjs`; rerun byte-identical to the reference except npm's install-duration line — R8's disclosure), the consumer view promoted to a standing gate (`script/check-sdk-consumer-view.mjs`), and the committed runner `script/run-published-examples.mjs` with its runner-mode negative controls (placeholder / subset-seam / unknown-name-guard). |
| `3f913b7a` | Group 3 — the four examples green through the runner from a scratch root. **Runs later TAINTED by F-P6-7** (green-by-leakage; see the F-P6-7 section) — logs stand committed unmodified, amended not overwritten. |
| `4d4a13da` | Group 4 — `examples` declared as a boundary consumer in `packages/boundary.json` (vite-example shape, no ownership map); census reconciled 1110→1135 (+22 example code files by the checker's own filter + 3 added scripts = +25, all outside every package graph). |
| `2a72333e` | Group 5 — the F-P6-7 repair and its proof: classic's manifest completed (the F-P6-1 dependency closure + `"date-fns": "^3.6.0"` by the peer-promotion rule), CONTROL-1c (refuse any scratch root with a `node_modules`-bearing ancestor), the clean canonical full run (`group5-full-run-clean.log`), the CI leg (`sdk-examples` job + green env-shaped dry-run + subset seam), the preserved failed first attempt. |
| `6de3c756` | Group 6 — `BOUNDARIES.md` §15 (examples section: four shapes, workspace-stance rule, harness reuse seam, honest-pair decision, CI leg statement, non-coverage statement), the F2 delivery audit (6 requirements / 11 scenarios / 24 atomic clauses, headings verbatim), close-out controls. |
| `253bfe07` | Group 7 — ship controls at the seven-group tree: one-commit-per-group verified, committed-content CR sweep (77 files, 0 cr-containing), `.rasen/` staging guard 0, signals state empty by absence. |
| `4b979b67` | Review round 1 fixes (static): R2 spec requirement 5 tightened to the data-vs-behavior form + design.md E6 ruling attribution; R4 P7 handoff section (zustand phantom paths, two-level probe design, consolidated durables); R5 clause-count correction; R6 react-day-peer version claim corrected to the load-bearing peer-range fact; R7 the post-delivery honesty sentence added to the job comment; R8 install-duration disclosure; R9 latent `opencut-wasm` guard comment at the materialize() override site. Every executable round-1 change is in this commit. |
| `d4340b67` | Review round 1 evidence (non-executed): R1's synthetic-dangling FAIL log (both classes, repo untouched), R3's authoritative self-certifying re-run (`review1-full-run-clean.log`, running at 4b979b67), the round-1 close-out gates log, round dispositions, the re-review report committed. |

## Pre-Flight Results

- Verification: `evidence/review-report.md` present — one review round plus
  re-review. Round 1 (dispatched leaf reviewer, role-isolated, report-only;
  delta `4f0b9c69..253bfe07`, 7 commits, 78 files; scratch
  `E:\p6-review-scratch`, ancestor chain node_modules-free): **0 Blocker /
  0 Major / 4 Minor / 5 Trivial — nothing blocks shipping.** Findings: R1
  [Minor] the delivery audit paired the fail-closed dangling clause with a
  run record that was never committed (the reviewer's own doctored-tarball
  reproduction closed the behavior question); R2 [Minor] spec requirement
  5's literal clause contradicted by a compliant example (install-packages
  reads `surface.json` as data — requirement 1's own lesson); R3 [Minor]
  the authoritative clean-run log labeled a pre-repair commit; R4 [Minor,
  durable for P7] two latent-only zustand peer phantoms with no closure
  checker; R5–R9 [Trivial] clause-count label, an unverifiable
  react-day-picker version detail, the post-delivery honesty sentence
  missing from the job comment, an overstated extraction-identity claim, a
  latent materialize() guard gap. The round-1 re-review (same role-isolated
  reviewer; delta `253bfe07..d4340b67`, ten files, every one mapped to a
  finding fix or its evidence, zero drive-bys) re-verified each finding
  against the actual diff or log content: **VERDICT CLEAN — all nine
  round-1 findings fixed or correctly recorded; no new findings**; the
  close-out gates re-run green at 4b979b67. The re-review append is
  committed by this ship, unmodified (P2/P3/P5 precedent).
- Reviewer's mandated conclusions of record: the F-P6-7 leakage catch
  VERIFIED on all four sub-points (date-fns closure true; CONTROL-1c
  semantics correct; the taint amendment honest; no reachable phantoms
  survive the falsification probe); the four examples' execution evidence
  VERIFIED line by line; census + family VERIFIED figure-exact,
  independently re-derived; frozen surfaces VERIFIED reproduced
  stat-cache-immune; the CI leg VERIFIED (YAML parses, env-seam-driven,
  honest non-claims); consumer-side obligations F-P6-4/5/6 VERIFIED in code
  AND in the README an adopter reads; security sweep CLEAN; general
  pre-landing review VERIFIED (extraction semantics, copyability, spec
  axis, runner code quality).
- Tasks: 21/21 complete (see Scope shipped — no open boxes, no ship-time
  ticks).

## Oracle verdicts (evidence-cited)

- **The F-P6-7 leakage catch (this change's defining repair).** The
  predecessor's Group-3 green runs were green-by-leakage: the scratch root
  resolved under an ancestor chain carrying `node_modules`, so
  react-day-picker's peer `date-fns` (range `^2.28.0 || ^3.0.0`, workspace
  copy 8.10.1) resolved from the leaked tree and the examples' packed
  closure was never proven from the manifests. The catch surfaced honestly:
  the first CI-shaped dry run (`group5-ci-dry-run-first-attempt-failed.log`,
  run at the pre-repair commit `4d4a13da`) FAILED — rollup `failed to
  resolve import "date-fns" from .../react-day-picker/dist/index.esm.js`,
  `REAL_EXIT_CODE[example/embed-surface/build]:1`, self-logged. The repair:
  classic's manifest completed with the F-P6-1 closure and
  `"date-fns": "^3.6.0"` under the peer-promotion rule (a peer of a
  dependency the closure needs must become the package's own dependency
  under `--legacy-peer-deps`); `bun.lock` resolves exactly `date-fns@3.6.0`,
  in-range. CONTROL-1c (`script/scratch-install-harness.mjs:169-182`) makes
  the leak class unreachable in tooling: the loop starts at
  `dirname(root)` and iterates to the drive root — the drive root itself
  checked — refusing any scratch root with a `node_modules`-bearing
  ancestor BEFORE anything is installed; the committed refusal log
  (`group5-control-1c-default-refused.log`) shows the default refusing on
  this machine, naming `E:\...\elftia` as the first leaky ancestor with a
  one-line remedy. **The taint was amended, not overwritten:** the Group-3
  logs stand committed unmodified, the implementation report's §3.5
  amendment block names F-P6-7 and designates the clean run authoritative,
  and the failed first attempt is preserved as the catch's own evidence.
  The clean run corroborates the repair by install-count arithmetic:
  custom-storage 251→252, embed-surface 348→349, install-packages 249→250,
  agent-transaction unchanged at 5 — exactly the +1-per-classic-consuming-
  example signature.
- **The canonical R3 re-run.** `evidence/logs/review1-full-run-clean.log`
  self-labels `run-published-examples: running at 4b979b67` — the
  static-fixes commit carrying every executable round-1 change — so the
  authoritative run needs no count-arithmetic to prove it ran the shipping
  revision. It carries CONTROL-1a/1b/1c PASS, consumer-view PASS 3 packages
  / 0 failures / 0 dangling, the date-fns install signature (5 / 252 / 349 /
  250), ten `EXIT[example/...]:0` lines zero-nonzero,
  `REAL_EXIT_CODE[examples-run]:0`, wrapper `REAL_EXIT_CODE:0`. Group 5's
  log is explicitly relabeled **corroborating** (the relabel lives in the
  reports; the historical log file itself is untouched by the fix delta —
  the correct treatment of historical evidence).
- **The four examples' clean-root execution** (verified line by line by the
  reviewer against the canonical log):
  - `agent-transaction` — 87 ledger comparisons, 9/9 steps,
    `reopen verdict passed`, `reopened revision 6 == committed 6`, the
    reopened target proven a fresh store instance.
  - `embed-surface` — Vite build 3731 modules; browser smoke 9/9 including
    `clean/console`, `clean/pageerror`, `clean/network`.
  - `custom-storage` — the honest pair: the production leg records
    `classic chain: NOT LOADABLE` (observed:
    `wasm.__wbindgen_start is not a function`) and
    `migration/by-replication: SKIPPED distinctly`; the mock leg installs
    the wasm mock through the published experimental entry, runs 31 steps
    to target v31, ports 36 cases green with migration exercised; the README
    states the experimental-inheritance instability verbatim.
  - `install-packages` — three resolution assertions, five classification
    assertions (versions and labels read from the installed artifacts as
    data — requirement 1's own lesson, R2's tightened wording), classic's
    React peer unsatisfied by design (`node_modules/react does not exist`).
- **Census, family, frozen.** Boundary census 1110/989/362/361/870/74 →
  **1135/1011/416/415/870/74**, the +25 fully attributed (22 example code
  files by the checker's own filter + 3 added scripts); the reviewer
  re-derived the figures independently at the shipping tree. Checker family
  28 → **29, 23 exit-zero / 6 nonzero**, the nonzero set byte-identical to
  P5's known six (`asset-manifest:2, emitted-runtime-assets:1,
  headless-graph:2, headless-semantic-result:2, resolution-equivalence:1,
  type-baseline:1`). Frozen surfaces **4/4 IDENTICAL** to `5aae75ec` by the
  stat-cache-immune `git show`-blob + `cmp` method, cross-checked by blob
  hash; `git log 4f0b9c69..253bfe07 -- <the four paths>` is empty.
- **The CI leg.** `.github/workflows/bun-ci.yml` gains the `sdk-examples`
  job (ubuntu-latest, five steps), driven purely through the runner's env
  seams (`OPENCUT_SCRATCH_ROOT` under `$HOME` — never `runner.temp`, which
  CONTROL-1b refuses; `OPENCUT_BUN`). The green local dry run
  (`group5-ci-dry-run.log`: CONTROL-1c PASS, ten EXIT lines zero,
  `REAL_EXIT_CODE:0`) and the subset seam
  (`group5-subset-seam-clean.log` through `OPENCUT_PREPACKED_DIR`) are the
  pre-delivery evidence. **The first true CI execution lands on the
  post-delivery push — stated, not hidden**: in the job comment itself
  (R7's fix), BOUNDARIES §15, the implementation report §5.2, and the
  delivery audit. The job's non-claims are equally explicit: local-only
  static checkers stay local, no OS-matrix extension, no publish.
- **Consumer-side obligations F-P6-4/5/6** — verified in code AND in the
  README an adopter reads: `@source` self-registration
  (`examples/embed-surface/src/styles.css:32` + README's
  silently-half-styled failure mode), the definite-height wrapper
  (`main.tsx:122`), the empty-scene seed element (`main.tsx:40-58` with the
  zero-duration rationale); all four READMEs carry consumed-surface tables
  with P5 classes and per-entry justifications.

## Accepted-known at ship

- **Two latent-only zustand peer phantoms** — `immer` (imported only by
  `zustand/esm/middleware/immer.mjs`) and `use-sync-external-store`
  (`zustand/{traditional.js,esm/traditional.mjs}`), undeclared by classic
  but unreachable: classic imports only `zustand`, `zustand/vanilla`,
  `zustand/middleware`, and the middleware barrel is a self-contained
  bundle with zero immer references (the reviewer's two-level
  falsification probe). No current consumer is broken; any future classic
  edit reaching those subpaths hits the F-P6-7 wall under
  `--legacy-peer-deps` and no gate notices. Recorded as review R4, routed
  to P7 as the seed for a reachability-aware packed-manifest
  dependency-closure checker (probe design in the review report). Level-1
  test-only residuals (`@napi-rs/canvas`, `bun:test`) are dispositioned in
  `examples/embed-surface/README.md:75`.
- **The workspace `bun.lock`'s classic entry is stale** — it predates the
  F-P6-1 repair (records four deps); no gate consumes the lock's workspace
  map, CI installs non-frozen, and the resolved set (`date-fns@3.6.0`) is
  unchanged. Refreshing the lock is a P7 tidy (implementation report §5.2
  residue).

## Test Gate

- Required scope: proportionate to the ship state. The delivered delta
  since the last green evidence is evidence/markdown only — `d4340b67`
  added only non-executed evidence (the re-review verified zero executable
  paths in it), and this ship adds only evidence markdown. The checkers
  this change owns or touches — the labels checker (live + both controls),
  the boundary checker (the census this change moved 1110→1135) — plus
  strict validation of the named change item were re-run fresh by this
  ship. **The 12-minute examples suite was NOT re-run**: the canonical
  `review1-full-run-clean.log` self-certifying at `4b979b67` IS the
  execution evidence at this content — no executable byte differs between
  that tree and the shipped tree — and the suite's next true execution is
  the post-delivery CI push the job comment itself announces. The remaining
  oracles (frozen byte-control, full family sweep, consumer view from
  tarballs) were re-executed by the reviewer at this same tree (round-1
  re-review) and are cited above.
- Commands (log committed as `evidence/logs/ship-gates.log`, each leg
  self-logging its `EXIT[...]` line — background exit codes are untrusted
  on this machine, the log's own lines are the verdict; run at `d4340b67`
  + the uncommitted evidence-only worktree):
  - `rasen validate s05-published-examples --strict --project rocut --json`
    → **EXIT[validate]:0**, `"valid": true`, `"issues": []`.
  - `node script/check-sdk-surface-labels.mjs` → **EXIT[labels]:0** — 3
    packages / 35 entries, census 16/13/6, dangling 0, four rules PASS.
  - `node script/check-sdk-surface-labels.mjs --negative-control` →
    **EXIT[negative]:0** — all ten planted worlds FIRED (the spec's named
    unlabeled-experimental pair first).
  - `node script/check-sdk-surface-labels.mjs --converse-control` →
    **EXIT[converse]:0** — silence over correctly labeled rows, frozen rows
    without markers, a resolving override, class-name prose; zero dangling.
  - `node script/check-package-boundary.mjs` → **EXIT[boundary]:0** — five
    rules PASS, 1135/1011/416/415/870/74, figures identical to the
    reviewer's independent re-derivation.
- Diff sanity scan (this ship): 0 added TODO/FIXME/XXX/HACK markers in
  `git diff 4f0b9c69..HEAD` (82 files, +22449/−402); the secret-pattern
  scan's single hit is the reviewer's own sweep prose listing the pattern
  names (`review-report.md`), and the base workflow's pre-existing
  `FREESOUND_API_KEY: "placeholder"` reappears in the diff only through the
  CRLF normalization the reviewer already dispositioned (a literal
  placeholder, not a secret); the reviewer's round-1 security sweep was
  independently CLEAN.
- Tree: `ed5ed9b8a2968d6200b78760cde4b7eb1ab11993` (pre-ship-log HEAD
  tree; the ship commit adds only evidence markdown, no code — the
  executable content the canonical run proved is unchanged).

## Notes for the portfolio delivery (parent = 05-community-beta-second-host)

- Nothing was pushed: the branch has never been pushed. At ship time
  `git rev-list --left-right --count origin/main...HEAD` = `0 97`
  (0 behind, 97 ahead — the earlier portfolio children's commits plus this
  child's 9); the ship commit makes it 98.
- The `specs/` delta is UNSYNCED by design — `sdk-published-examples` (NEW)
  belongs to the archive-stage spec sync, not ship. R2's tightened wording
  is already in the delta spec, so the synced main spec will not carry a
  literally-violated clause.
- `proposal.md`, `design.md`, `specs/`, and `.openspec.yaml` remain
  untracked by convention while the change is active (same as P2/P3/P5) —
  the archive transaction commits them with the change.
- Review round 1's re-review append to `evidence/review-report.md` is
  committed by this ship step, unmodified (P2/P3/P5 precedent).

## Archive
**Date:** 2026-08-15T15:02:31.139Z
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut\rasen\changes\archive\2026-08-15-s05-published-examples
**Transaction:** 69a6fd4b-7df6-4fa4-b685-342b4d1f3cd1
