# Ship Log: s05-conformance-for-third-parties

**Date:** 2026-08-15
**Mode:** local
**Branch:** feat/s05-community-beta
**Commit:** 688e0685b7a55f4d76c55442782bb310aa6f343e (pre-ship-log HEAD; this ship adds one further commit carrying this file, the reviewer's round-1 re-review append, the ship-gate logs, and the 8.4 tick)
**Tree:** 07f5c87cda1453c43107346d9513458432cf6b5c (pre-ship-log HEAD tree)
**Status:** Committed (delivery deferred to portfolio level)

## Delivery mode and why

`local`. This is child P3 of the 7-child decomposed portfolio for Slice
`05-community-beta-second-host` (workstream `opencut-agent-editor-sdk`). Per
the portfolio's decomposition contract, children accumulate commits on the
shared branch `feat/s05-community-beta` and the portfolio delivers once, as
a single PR, after every child completes. Pushing or opening a PR from this
child individually would fragment that delivery, so this ship commits
locally only. No `git push`, no `gh pr create`, no `rasen archive` was run.

## Scope shipped

11 commits since base `8248a115` (`git rev-list --count 8248a115..HEAD` = 11,
re-verified at ship time), 66 files changed, +16019/−3
(`git diff 8248a115..HEAD --shortstat`). Delivers the change described in
`rasen/changes/s05-conformance-for-third-parties/{proposal.md,design.md,tasks.md}`
and its two delta specs (`specs/sdk-third-party-conformance/spec.md` NEW,
`specs/transaction-automation-api/spec.md` MODIFIED — both UNSYNCED by design;
spec sync belongs to the archive stage). `tasks.md`: 36/37 `[x]` after this
ship ticks 8.4 — the single open box is 7.5, open by design (see below).

### Per-group summary with commits

| Commit | Group / content |
|---|---|
| `7e2f429d` | Gate 1 — `npm pack` of the three packages, scratch resolution spike (npm `overrides` + bun), mechanism decision E3 (no post-pack manifest rewriting; the tarball under test is the artifact `npm pack` produced). Evidence: `evidence/gate-1-tarball-resolution.md`. |
| `ca41ceb0` | Group 2 — `./vectors/corpus` entry (`readPublishedCorpusText()` + `PUBLISHED_CONTRACT_SURFACE`), fail-closed drift guards with violation-and-revert legs (5 pass / 0 fail); census 1078→1080 repo files, both controls green. |
| `ee0f4200` | Group 3 — requirement indices at `./conformance/requirements` (ports suite; transaction/draft/engine/vectors suites) + `formatConformanceFailures`, index drift guard fail-closed over every reported case name; census 1084/988/361/362. |
| `09e7d458` | Group 4 — `script/pack-sdk-tarballs.mjs` (committed `tarball-manifest.json`, per-file SHA-256 inventory) + `script/run-scratch-conformance.mjs` (fresh-per-run scratch, E:-drive default, env-overridable) with no-linking controls 1a/1b/2 wired into every run and control-3 removal mode; both suites+drift guards green. |
| `bc1a0c4e` | Group 5 — worked third-party adapter (`script/fixtures/third-party-adapter/`): alien store (JSON-string records in a Map), own ids/assets/diagnostics, all five suites green in-repo AND from installed tarballs; migration walker validated against the real 31-step chain; findings recorded, not patched. |
| `e7ca7fdb` | Group 6 — mutation matrix: `variant-nonconforming` sibling (single hunk in `src/alien-store.ts` `save()`), fails exactly the 4 attributable cases by name through the formatter, executable count==4 exactness gate fail-closed in both directions. |
| `75bafcc1` | Group 7 close-out — checker-scope audit (all 27 `script/check-*.mjs`, no silence), frozen-surface control (4/4 S03+S04 surfaces byte-identical to `8248a115` via `git show`-blob + `cmp`), census 1106/988/361/362 attributed, BOUNDARIES §13 harness record. |
| `ff242e67` | Group 8 — ship discipline: EOL audit (59 files, all `i/lf w/lf` or `w/lf`, zero CRLF), staging guards (`RASEN_STAGED:0` at every commit), local-only commits. |
| `62bd9d1c` | Group 9 (LEAD ruling 1/2) — classic manifest truth: `culori@4.0.2` exact dependency, `react@^18.3.1` peer-only, `opencut-wasm` in-repo `file:` spec; react-free `./storage/migrations` attributed entry (whole chain surface, closure audited file-by-file, no react specifier). |
| `00263505` | Group 9 (LEAD ruling 2/2) — fourth tarball (`rust/wasm/pkg`, opencut-wasm@0.2.10) + scratch override mapping; react-free proof (`--legacy-peer-deps` + `CONTROL-react-free` in all three modes); all-modes scratch run; fork branch (b) honest pair; census re-derived 1107/989/361/362. |
| `688e0685` | Review round 1 fixes F1–F4 — spec two-mode clause (F2), in-repo log regenerated at HEAD + stale strings refreshed (F1), six env seams (F3), checker count 21/6 corrected (F4). Round-1 re-review: CLEAN. |

## Pre-Flight Results

- Verification: `evidence/review-report.md` present — one review round plus
  re-review. Round 1 (reviewer `reviewer-s05-p3`, delta `8248a115..00263505`):
  **0 Blocker / 1 Major / 3 Minor**, every load-bearing claim independently
  reproduced (scratch sequence all three modes, in-repo leg, walker, pack
  determinism, all three host gates, boundary checker + both controls,
  frozen surfaces, variant single-diff, spec-rider LCS diff). Findings:
  F2 [Major] the ADDED spec scenario's THEN clause promised from-tarballs
  migration unconditionally, lagging the executed ruling's honest-pair fork;
  F1 [Minor] `group9-adapter-in-repo.log` captured one code-revision stale;
  F3 [Minor] spec's "all env-configurable" not implemented (three seams, not
  six); F4 [Minor] checker-sweep count said 23 zero, arithmetically
  impossible. All four fixed in `688e0685`. The round-1 re-review verified
  every fix **by reproduction** (regenerated the log byte-identical, re-ran
  the default-env scratch run green, re-derived the counts from the log's
  own lines): **verdict CLEAN — all four resolved, nothing new introduced;
  ship-ready.** The re-review append is committed by this ship, unmodified.
- Tasks: 36/37 complete. Two boxes need their ship-time disposition
  recorded (both are deliberate, neither is an omission):

### Box 7.5 — deliberately OPEN at ship (post-archive-by-design)

7.5 verifies the P1-move path-refresh rider AFTER archive:
`grep -c 'apps/web/src/editor/contracts' rasen/specs/transaction-automation-api/spec.md`
must return `0`. At ship time the main spec still carries the stale path
because this change's delta (which refreshes it) is unsynced by design —
spec sync is the archive transaction's job. The verification therefore
cannot execute until after the archive syncs the delta; it is sequenced
post-archive by design, not skipped, and not vacuous (it has a real
predicate to check and a real failure mode: a non-zero count means a stale
reference survived the delta). The ARCHIVER executes it and ticks the box.

### Box 8.4 — vacuously satisfied, ticked by this ship

8.4 (standDown signals) is satisfied vacuously: no worker was ever parked —
`<changeRoot>/signals/` does not exist and `signals/.state/` does not exist
(re-verified at ship time), so there is no live heartbeat that could make a
later archive ESTALE and no `{"kind":"standDown"}` to write. The checkbox is
ticked by this ship with this justification recorded here (same convention
as P2's 10.4).

## Oracle verdicts (evidence-cited)

- **Five conformance suites, both legs** — in-repo AND from installed
  tarballs: ports 36 / transaction 21 / engine 38 / draft 22 / vectors 29,
  `REAL_EXIT_CODE[suites]:0` (`evidence/logs/group5-adapter-in-repo.log`,
  `group5-adapter-scratch.log`, `group9-scratch-all-modes.log`). The
  in-repo/scratch pair is the completeness proof for the new entries.
- **Variant exactness** — the nonconforming variant fails EXACTLY the 4
  attributable cases (2 ports + 2 engine) by name through the formatter,
  under an executable count==4 gate that fails closed in both directions;
  identical failure set in-repo and from tarballs; single-diff invariant
  (one file, one hunk, `src/alien-store.ts` `save()`) reproduced
  byte-for-byte (`group6-variant-*.log`, `group6-variant-single-diff.txt`).
- **No-linking controls** — 1a scratch root outside the repo tree, 1b
  outside any Temp path, 2 `lstatSync` real-directory copies over all FOUR
  installed packages + lockfile `file:` resolutions: assertion pass lines
  in every run's log, not only once. Control 3 is **adapter-shaped**: it
  deletes the installed `@opencut/editor-ports` copy and re-runs the full
  adapter runner (whose first runtime import is the deleted package),
  gating the failure through a resolution-failure regex — the runner
  collapses at its first import, proving no reach-through into the
  monorepo (`group4-control-3-removal.log`,
  `group5-control-3-adapter-removal.log`).
- **React-free proof from tarballs** — `--legacy-peer-deps` install +
  fail-closed `CONTROL-react-free` (react absent from the tree) + the
  migration leg importing `./storage/migrations` LIVE from the installed
  tarballs: PASS in all three modes; resolution proceeds past module
  loading into wasm initialization (`group9-scratch-all-modes.log`).
- **Migration walker vs the real chain** — validated against the real
  31-step chain via classic's published `./evidence/wasm-test-mock` entry:
  migrated 30→31, second call `not-needed`, declining transform fails
  closed (`group5-migration-walker-real-chain.log`, re-run green at HEAD in
  the re-review).
- **Pack determinism** — all four tarballs packed twice, digests reproduce;
  the committed `tarball-manifest.json` shasums independently reproduced by
  the reviewer at HEAD (`group9-pack-manifest.log`).
- **Frozen surfaces** — all four S03+S04 surfaces byte-identical to base
  `8248a115` (stat-cache-immune `git show`-blob + `cmp` method); the five
  conformance suite modules diff-empty over the change
  (`evidence/frozen-signature-README.md`; reproduced by the reviewer).
- **Boundary census** — 1107 repo files / 989 package-graph files / 361
  `@opencut/*` specifiers / 362 edges (+1 over Group 7 = the migrations
  barrel, fully attributed); both checker controls green. Re-run fresh by
  this ship's gate: identical figures.
- **Checker sweep** — 27 checkers, **21 zero / 6 nonzero** (the F4-corrected
  count, re-derived from the log's own lines), the six nonzero all
  dispositioned and exit-code-identical to P2's six: `asset-manifest` 2
  (no preview server at 127.0.0.1:4173), `emitted-runtime-assets` 1
  (pre-base Next build artifact this change never touches),
  `resolution-equivalence` 1 (fail-closed "nothing verified", no staged
  rewrites), `headless-graph` 2 + `headless-semantic-result` 2
  (usage-gated), `type-baseline` 1 (the two byte-stable S01 rows at the
  same file:line across P2/group7/group9/re-review; scope 935→941→942
  fully attributed, zero new diagnostics) (`group7-all-checkers.log`,
  `group9-host-gates.log`).
- **Host re-gates** — electron-host typecheck 0, vite-example typecheck 0,
  apps/web scoped program unchanged (`group9-host-gates.log`).

## LEAD ruling executed, the fork, and the spec amendment

- **The LEAD gate ruling** (arrived after DONE was sent; recorded verbatim
  in `gate-1-tarball-resolution.md` "## LEAD ruling") was executed as Group
  9, commits `62bd9d1c` + `00263505`: classic manifest truth (`culori@4.0.2`
  exact-pinned dependency — the lockfile's actual resolution; `react@^18.3.1`
  peer-only, satisfied by every Host's existing 18.3.1, no new react copy;
  `opencut-wasm` as the in-repo `file:` spec with resolution semantics
  unchanged), the react-free attributed `./storage/migrations` entry, and
  the fourth tarball (`rust/wasm/pkg`) with the scratch override mapping —
  no registry publish anywhere. Verified by the reviewer as faithfully
  executed, including the `boundary.json` self-registration of the new
  entry (the checker derives declared entries from the packages' own
  exports maps).
- **Fork branch (b) landed.** With resolution honest (culori installed,
  opencut-wasm a real installed copy, react absent), the full scratch
  migration run still dies at initialization with the identical decisive
  line in-repo and from tarballs — per the ruling's own fork rule this is
  P1's disclosed pre-existing crash-masked wasm error, a runtime failure
  class, not a P3 defect and not fixable by packaging. The honest-pair
  shape stands as the end state.
- **Review-round-1 F2 spec amendment.** The scenario's THEN clause now
  states the two-mode pair exactly as the evidence shows it (in-repo:
  walker validated against the real 31-step chain via the published
  `./evidence/wasm-test-mock` entry, wasm-init finding recorded distinctly;
  from tarballs: suite passes with the migration leg absent, the skip
  recorded and named in the run's own output). Scenario heading and
  WHEN/AND clauses byte-unchanged; the LEAD-ruling attribution lives in
  `design.md` E7's dated addendum, not the spec. The amendment is attested
  by the predating LEAD ruling — the two-mode clause is the shape the
  ruling itself ruled in; archive may sync it verbatim.

## Accepted-known at ship

- **The wasm-init class** — `wasm.__wbindgen_start is not a function`:
  classic's migration chain cannot initialize outside the mock entry.
  Identical in-repo and from installed tarballs; P1's pre-existing
  crash-masked error, evidenced as the honest two-mode pair (the production
  runner records the finding and skips the migration leg distinctly — all
  five suites still green, `REAL_EXIT_CODE[suites]:0`; the walker is
  validated against the real chain in-repo). Recorded as a Direction-level
  finding carried by the LEAD (portfolio planning-context); **constrains
  P6** — its custom-storage example will hit the same wall the LEAD's own
  note predicts. Nothing else is open at ship.

## Test Gate

- Required scope: the delivered delta since the last green evidence is
  zero code changes — the reviewer's re-review battery ran at exactly this
  tree (`688e0685` = pre-ship HEAD; only untracked planning/evidence
  markdown differs at ship time). The verify-stage oracles (both adapter
  legs, variant exactness, removal control, walker, pack determinism,
  host gates, boundary checker + controls, frozen surfaces) are cited
  above and were re-run by the reviewer at this tree. Proportionate fresh
  re-verification at the ship state, run by this ship:
- Commands (logs committed as `evidence/logs/ship-gate-boundary-checker.log`
  and `evidence/logs/ship-gate-typecheck.log`, each self-logging
  `REAL_EXIT_CODE` — background exit codes are untrusted on this machine,
  the logs' own lines are the verdict):
  - `node script/check-package-boundary.mjs` → **EXIT[boundary]:0,
    REAL_EXIT_CODE:0** — scanned 1107 repo files, 989 graph files, 361
    specifiers, 362 edges (all five rules PASS; figures match the Group-9
    census exactly).
  - `bun run --cwd apps/electron-host typecheck` (`tsc --noEmit -p
    tsconfig.json`) → **EXIT[electron-typecheck]:0**
  - `bun run --cwd apps/vite-example typecheck` → **EXIT[vite-typecheck]:0**;
    combined **REAL_EXIT_CODE:0**
- Diff sanity scan (this ship): 0 added TODO/FIXME/XXX/HACK markers and 0
  secret-pattern lines in `git diff 8248a115..HEAD` (the reviewer's round-1
  security sweep over all blobs and evidence logs independently CLEAN).
- Tree: `07f5c87cda1453c43107346d9513458432cf6b5c` (pre-ship-log HEAD tree;
  the ship commit adds only evidence/planning markdown, no code).

## Notes for the portfolio delivery (parent = 05-community-beta-second-host)

- Nothing was pushed: `origin/feat/s05-community-beta` does not exist (the
  branch has never been pushed; its configured upstream `origin/main` is
  behind-only). At ship time `git rev-list --left-right --count
  origin/main...HEAD` = `0 75` (0 behind, 75 ahead — the earlier portfolio
  children's commits plus this child's 11); the ship commit makes it 76.
- The `specs/` delta is UNSYNCED by design — `sdk-third-party-conformance`
  (NEW) and `transaction-automation-api` (MODIFIED, the six-block rider:
  five path-refresh blocks with zero semantic drift + the corpus block)
  belong to the archive-stage spec sync, not ship. Box 7.5's grep verifies
  the rider immediately after that sync (see above).
- `proposal.md`, `design.md`, `specs/`, and `.openspec.yaml` remain
  untracked by convention while the change is active (same as P2) — the
  archive transaction commits them with the change.
- Review round 1's re-review append to `evidence/review-report.md` is
  committed by this ship step, unmodified (P2's precedent).

## Archive
**Date:** 2026-08-15T04:58:59.208Z
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut\rasen\changes\archive\2026-08-15-s05-conformance-for-third-parties
**Transaction:** 3c2e993d-a312-47be-a559-2cd03b88ba1a
