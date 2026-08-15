# Ship Log: s05-provenance-and-beta-closure

**Date:** 2026-08-16
**Mode:** local
**Branch:** feat/s05-community-beta
**Commit:** c4334827574e484215706e8253c4429b6f07490b (pre-ship-log HEAD; this ship adds one further commit carrying this file, the reviewer's CLEAN report — committed unmodified, zero rounds — and the fresh ship-gate log; `tasks.md` needed no ship-time tick: all 20 boxes were already `[x]`, including 8.1–8.3)
**Tree:** b2795b82aacea97e8e9cbe9def2a6335d50c5c17 (pre-ship-log HEAD tree)
**Status:** Committed (delivery deferred to portfolio level)

## Delivery mode and why

`local`. This is child **P7 of seven — the FINAL child** of the decomposed
portfolio for Slice `05-community-beta-second-host` (workstream
`opencut-agent-editor-sdk`). Per the portfolio's decomposition contract,
children accumulate commits on the shared branch `feat/s05-community-beta`
and the portfolio delivers once — PR + merge, settled by the user 2026-08-15 —
after every child completes; that delivery is the PARENT's act, not this
child's. Pushing or opening a PR from this child individually would fragment
the delivery, so this ship commits locally only. No `git push`, no
`gh pr create`, no `rasen archive` was run. B1's no-irreversible-step ruling
holds to the last commit.

## Scope shipped

10 commits since base `959f41d2` (`git rev-list --count 959f41d2..HEAD` = 10),
51 files changed, +19116/−948 (`git diff 959f41d2..c4334827 --shortstat`).
Delivers the change described in
`rasen/changes/s05-provenance-and-beta-closure/{proposal.md,design.md,tasks.md}`
and its delta spec (`specs/sdk-provenance-beta-closure/spec.md` NEW — UNSYNCED
by design; spec sync belongs to the archive stage). `tasks.md`: **20/20
complete** — every box `[x]`; no ship-time tick was needed.

### The two-phase shape

Phase A landed the structural work group by group (Groups 1–6 + 8); Phase B
is the regeneration spine: at the code-complete HEAD `1431840a` (tracked tree
clean, porcelain recorded verbatim in `group7-code-complete.log`) the trio
`generate-source-inventory.mjs` / `generate-sbom.mjs` /
`reconcile-provenance.mjs --require-added` ran once, and the regenerated set
landed as **ONE delta commit `04c42f40` whose changed-file list is generated
artifacts ONLY** — `git show --name-only 04c42f40` lists exactly `SBOM.md`,
`SOURCE_INVENTORY.json`, `SOURCE_INVENTORY.md` (all `M`, nothing else; the
acceptance check). Every regen log self-certifies its revision
(`HEAD: 1431840a…, tree: clean (tracked)` at
`group7-{regen-source-inventory,regen-sbom,regen-reconcile}.log:1`), and the
stability log proves the second run byte-stable with no edits in between
(`group7-stability.log:2`, self-labeled at `04c42f40` the delta commit).

### Per-group summary with commits (oldest → newest)

| Commit | Group / content |
|---|---|
| `e2f82d3b` | Group 1 — baseline before-half at base `959f41d2`: inventory drift figures as `SOURCE_INVENTORY.md` states them (with the re-deriving generator command), the generator's `AREAS` constant, family census 29 = 23 exit-zero / 6 nonzero (the known set; any OTHER red is a finding), frozen-surface byte-control vs `5aae75ec`, pack manifest recording notice absence (three editor tarballs absent; wasm `pkg/LICENSE` present). Phase-B dry-run sizing: the stale pre-P1 picture, then a widened-areas throwaway probe enumerating the rename restatement, patch-row gap count, and added-file delta Phase B would pick up. |
| `98ab8997` | Group 2 — `packages/editor-{ports,contracts,classic}/LICENSE` (byte-identical preserved upstream MIT; modifying that text is the existing spec's violation) + `NOTICE` (upstream project + URL + pin `cf5e79e9…` + fork identity + one-line modifications statement); `files` fields already listed both — no manifest edit. Verified in PACK OUTPUT, never the worktree. |
| `52fd84b0` | Group 3 — `script/check-packed-manifest-closure.mjs`, the static family's **30th**: level-1 bare-specifier closure against the packed manifest (disposition register licensing `@napi-rs/canvas` / `bun:test` in test files ONLY), level-2 peer reachability with the documented-latent register (`immer`, `use-sync-external-store` under `zustand`) **re-derived every run, never trusted** — activation, staleness, and needed-peer directions all FAIL loud. Controls with FAIL halves committed (synthetic undeclared import + register activation both fire; converse proves dispositioned residuals and register rows stay silent); census lines every run; empty scans refuse. Wired as root `check:packed-closure`; family sweep re-run 29→30 with the known nonzero set unchanged; checker-audit row in `BOUNDARIES.md`. |
| `490beaef` | Group 4 — generator areas widened to the current tree (derived from the root manifest's `packages/*` glob + `boundary.json` consumers, hand-naming only `script` + `rust`; 10 live areas, dead ones dropped): the rename classification flows through the generator's own semantics — a moved file with content change is drift, not an addition. Reconciliation machinery pairing modified inherited files with `PATCHES.md` rows and fork-added paths with `UPSTREAM.md` entries; the gap it found fixed NOW — **338 derivation-backed PATCHES rows** with slice attributions — so Phase B's delta is regeneration, not row-authoring. The one-off committed as `evidence/group4-author-rows.mjs`. |
| `caa720c3` | Group 5 — `bun.lock` classic entry tidied to manifest truth via plain `bun install` (**never** `--frozen-lockfile`; measured 4-minute timeout — see the proxy-env deviation below for the two hung attempts committed as evidence); post-install mechanical lock-vs-manifest verification. SBOM machinery pass at the tidied lock: every recorded defect matches its declared disposition. |
| `1431840a` | Group 6 — `BOUNDARIES.md` §16 beta-closure record: delivery statement (packages + versions + the 35-entry labeled surface counted from shipped `surface.json`; conformance + four examples from installed tarballs with the CI leg; three Hosts), the no-`1.0` stance restated beside P5's policy, the wasm-init Direction finding carried with failure text / mock-entry workaround / ownership, residuals each with its decision owner. Classic README "Consumer obligations (from-tarball adoption)" (`README.md:61-90`): culori `declare module`, `@source` self-registration, definite-height wrapper, empty-scene seed — each stating the failure an adopter sees. `UPSTREAM.md` restated where Phase A touched its inputs + the added-file inventory. **This is the code-complete HEAD Phase B regenerated at.** |
| `04c42f40` | **The Phase-B delta commit** — `regenerate provenance at 1431840a`: exactly the three generated artifacts, `M` only, nothing else (see the two-phase shape above). |
| `1714bb45` | Group 7 — Phase B evidence: the code-complete declaration (full porcelain verbatim at `1431840a`; tracked-clean asserted `--untracked-files=no` empty), the self-certifying regen logs, the second-run byte-stability proof, final controls (blob-level CRLF 0 over the round's files, validate --strict). |
| `159a7056` | Group 8 — the F2-class delivery audit BEFORE archive: every scenario clause of the delta spec paired with the evidence line that satisfies it — **45/45, 0 FAIL** (`group8-delivery-audit.log`, every PASS line naming a distinct clause with a citation; attempt 1 with 4 FAIL preserved beside a diagnosis); the registry-never-exercised clause amended per the audit's R6.S1.c2 catch; standDown vacuous — no `signals/` exists under the change root or `.rasen/`. |
| `c4334827` | Group 8 evidence — `rasen validate s05-provenance-and-beta-closure --strict --project rocut --json` green at the ship commit (`group8-validate-final.log`). |

## Pre-Flight Results

- Verification: `evidence/review-report.md` present — dispatched leaf reviewer
  (`reviewer-s05-p7`, role-isolated, report-only; delta `959f41d2..c4334827`,
  10 commits; scratch `E:\rocut-p7-review-scratch`, outside the repo,
  node_modules-free ancestors — CONTROL-1c discipline; reproduction logs
  copied to `evidence/review-scratch/`). **Verdict: CLEAN at verify, zero
  rounds — 0 Blocker / 0 Major / 0 Minor / 2 Trivial.** Every mandated
  attention item was verified by independent reproduction, not by reading the
  implementer's claims. The report is committed by this ship, unmodified
  (P2/P3/P5/P6 precedent).
- Tasks: 20/20 complete (see Scope shipped — no open boxes, no ship-time
  ticks).

## Oracle verdicts (evidence-cited)

- **The Phase-B spine, proven at the delivery HEAD — the reviewer's stronger
  proof.** Beyond the committed second-run stability log, the reviewer re-ran
  the full trio at the SHIP commit. Quoted verbatim from
  `evidence/review-report.md` (Mandated item 1):
  > Second-run byte-stability REPRODUCED, and stronger: I re-ran the full
  > trio (`generate-source-inventory.mjs`, `generate-sbom.mjs`,
  > `reconcile-provenance.mjs --require-added`) at the SHIP commit
  > `c4334827` (three commits after the delta, tracked tree clean). All three
  > regenerated files hash **exactly** the committed blob hashes:
  > `95cc0b8c…` (SOURCE_INVENTORY.md), `cd3b1895…` (.json), `42df748a…`
  > (SBOM.md) — the same values the committed stability log records — and
  > every printed figure matches (1071 files / rollup `92caf3b6…`; drift
  > 34/453/37/151/504/0; SBOM 1375+80; reconcile 524/524/0, exit 0). […]
  > This proves the set is accurate at the delivery HEAD, not only at regen
  > HEAD.

  The input pin `cf5e79e919144200294fb9fed22a222592a0aeea` is consistent
  across the generator's exported `PIN`
  (`script/generate-source-inventory.mjs:20`), `SOURCE_INVENTORY.json`'s
  `ref`, `PATCHES.md:4`, and `UPSTREAM.md:9`; `computeDrift` diffs against
  the same pin.
- **Notices proven in PACK OUTPUT** (the reviewer independently re-packed all
  four tarballs via the repo's own `packSdkTarballs` seam and inspected the
  artifacts, never the worktree): all four tarballs ship `LICENSE`, the three
  editor tarballs ship `NOTICE` beside it, the wasm tarball ships no NOTICE —
  the recorded **flat-artifact decision** (the spec requires only the license
  for wasm). LICENSE sha256
  `8117f9bb64534f7530fc6139b014fd1c1465f7981f93d1871789150fa3f59d3d` is
  consistent across root worktree + 3 editor package LICENSEs + wasm
  `pkg/LICENSE` + all four extracted packs — the mandated **9-way
  consistency**. File counts 25 / 63 / 807 / 7 — exactly +2 (LICENSE+NOTICE)
  over the committed baseline manifest's 23 / 61 / 805, which independently
  records the before-half (all four LICENSE/NOTICE absent at baseline except
  wasm's LICENSE, already at `8117f9bb…`). Packed NOTICE content read from
  the artifact: upstream project + URL + the full pin + the fork
  (`DumoeDss/rocut`) + the provenance-set pointer.
- **The closure checker (family #30) — the register's independent-plant
  proof.** All four committed runs reproduced by the reviewer (logs in
  `evidence/review-scratch/`): green 0 failures over 4 packages with census
  byte-identical to the committed green log (classic 796 files / 3502
  imports / 49 unique bare / 32 declared / 18 entry roots / 683 reachable /
  level-2 subjects 2 / latent 2 / activated 0; dispositions `bun:test`×88 +
  `@napi-rs/canvas`×3); the negative control exit 1 with BOTH legs firing
  (level-1 naming the synthetic undeclared import; REGISTER ACTIVATION naming
  row `zustand|use-sync-external-store`, the package, the F-P6-7 remedy, and
  quoting the registered reason) plus in-log porcelain proof the repo was
  untouched; the converse control moving the disposition count 3→4 with both
  register rows silent. Beyond the committed controls, the reviewer planted
  an activation on a **DIFFERENT row** — a doctored scratch copy of the real
  classic tarball with `import "zustand/middleware/immer"`, repacked with
  real `npm pack`, run through the checker's own exported `runClosure`: it
  fired exactly `REGISTER ACTIVATION: row zustand|immer`, naming the row and
  quoting its registered reason, failures=1, exit 1. The register's
  reachability is re-derived per run (both directions — activation and
  staleness — verified in code at `check-packed-manifest-closure.mjs:499-516`
  and empirically), not a static string match. Family census re-run by the
  reviewer: 30 EXIT lines, **24 exit-zero / 6 nonzero**, the nonzero set
  byte-identical to the known six (`asset-manifest:2, emitted-runtime-assets:1,
  headless-graph:2, headless-semantic-result:2, resolution-equivalence:1,
  type-baseline:1`). Empty-scan refusal verified in code; the one theoretical
  scanner blind form (multi-line import with mid-line closing brace) occurs
  in no shipped source.
- **Reconcile + PATCHES honesty: 524/524/0.** Re-derived by the reviewer's
  own run: need-row 524 = 34 modified + 453 movedModified + 37
  movedRewritten; covered 524, MISSING 0, exit 0 under `--require-added`;
  603 rows / 533 unique paths; the 9 orphan rows are exactly the
  repo-root/app-config paths outside inventoried areas, 0 over restated
  files; every fork-added path listed in `UPSTREAM.md` (per-area unlisted
  counts all 0; the 504 total = 33+57+1+9+34+166+63+25+2+114).
  Attribution honesty — 6 of the 338 authored rows spot-checked
  (P-277, P-281, P-347, P-412, P-585, P-614), each against TWO independent
  derivations: `git diff --name-status -M cf5e79e9` rename scores/destinations
  6/6 match, and `git log -1 -- <destination>` last-touch commits 6/6 match
  with subjects matching the row wording. The 10-area derivation verified
  against the generator's code (`deriveAreas()` at
  `generate-source-inventory.mjs:38-66`); fork-created areas legitimately show
  0 files at the PIN with the sha256-of-empty digest — PIN-side fingerprint
  semantics, correct; all 10 area directories exist live.
- **SBOM: 1375 npm + 80 wasm**, reproduced by the reviewer's regeneration at
  the ship commit; all five defect dispositions checked against reality
  independently of the generator: **D-1** root `package.json`
  self-dependency `"opencut": "."` — present; **D-2** `next ^16.1.3` +
  `better-auth ^1.4.15` in root deps — present; **D-3**
  `rust/wasm/Cargo.toml:6` `repository = "https://github.com/opencut/opencut"`
  — nonexistent repo (live fetch; the real upstream is
  `OpenCut-app/opencut-classic`); **D-4** pkg `sideEffects` including
  `./snippets/*` absent from the shipped `files` set — present; **D-5**
  "declared MIT while shipping no LICENSE" — absent/repaired (`pkg/LICENSE`
  exists at `8117f9bb…`). All five match their declared dispositions.
- **Frozen surfaces: 4/4 IDENTICAL** to `5aae75ec`, reproduced by the
  reviewer with the stat-cache-immune method
  (`git show 5aae75ec:<path> | cmp -s - <path>`) over
  `packages/editor-classic/src/editor/transactions/opencut/index.ts`,
  `packages/editor-ports/src/index.ts`,
  `packages/editor-contracts/src/index.ts`,
  `packages/editor-classic/src/editor/surface/embedding/types.ts`; none of
  the 10 commits touches any frozen path.
- **The proxy-env deviation, with its committed hung twins.** The inherited
  proxy `http://127.0.0.1:7890` stalled `bun install` twice — attempt 1 a raw
  20-minute stall at "Resolving dependencies", killed
  (`group5-bun-install-attempt1-stalled.log`); attempt 2 a 35-minute hang
  with diagnosis prose inline (`group5-bun-install-attempt2-hung.log`). The
  successful third attempt documents the unset inline and completes in
  6.25 s with the post-install mechanical lock-vs-manifest verification
  (`group5-bun-install.log`); the command itself stayed plain `bun install`.
  The reviewer's refutation attempt FAILED to refute: the proxy answers curl
  today in 2.07 s (HTTP 200 from registry.npmjs.org) — consistent with a
  bun-vs-proxy stall, not a dead proxy; re-running bun through the proxy was
  deliberately not done (it would rewrite the lock/node_modules and a
  present-day success cannot refute a past stall anyway). A pattern scan
  (`env -u`, `unset`, `setx`, `$env:`, `export VAR=`) over all evidence logs
  and the author-rows script finds zero other occurrences — the documented
  proxy unset for the install child is the only manipulation.
- **The beta record's residuals-with-owners** (`BOUNDARIES.md` §16,
  line-verified by the reviewer): delivery statement at 1358-1373 (35-entry
  labeled surface counted from shipped `surface.json`; conformance + four
  examples from installed tarballs with the CI leg; three Hosts); the
  amended registry-never-exercised clause verbatim at 1375-1378 (the audit's
  R6.S1.c2 catch); the no-`1.0` stance at 1380-1385; the **wasm-init finding
  carried, not fixed** at 1387-1400 — failure text
  `wasm.__wbindgen_start is not a function`, bun-version independence, the
  two transitive importers named, the experimental mock-entry workaround,
  Direction-level ownership; residuals each with its decision owner at
  1402-1409 (**lint debt = human decision; local-only checkers = deliberate;
  ubuntu-only examples job = a config change away**). The classic README's
  four consumer obligations each state the specific failure an adopter sees.
- **Security + no-publish sweep: CLEAN.** Credential-shaped scan over the
  entire delta's added lines: zero hits beyond the audit log's own prose.
  Registry-operation scan (`npm|bun|yarn|pnpm|cargo publish`, `dist-tag`,
  `whoami`, signing/attestation, `publishConfig`): zero operational hits.
  `origin` carries no s05/community-beta branch — never pushed.
- **The F2 delivery audit: 45/45, 0 FAIL** (`group8-delivery-audit.log`,
  `REAL_EXIT_CODE:0`), every PASS line naming a distinct clause with a
  citation the reviewer spot-verified at the cited file:line; attempt 1
  (4 FAIL) preserved beside a diagnosis whose explanations the reviewer
  independently confirmed. See accepted-known T-1 for the tally's off-by-one.

## Accepted-known at ship

- **T-1 (Trivial) — the delivery-audit tally understates its own PASS-line
  count by one.** `group8-delivery-audit.log:134` reads `audit: 45 PASS,
  0 FAIL` but the log contains 46 distinct `^PASS` clause lines (all
  substantiated; the reviewer verified the citations); attempt 1 shows the
  same off-by-one (41 vs 40). Direction of the error is conservative — more
  passes exist than claimed, zero FAILs either way — so it gates nothing.
  Accepted-known at ship; the portfolio's counting-honesty theme is served
  by recording the discrepancy here rather than editing a committed log.
- **T-2 (Trivial) — the Group-8 audit script itself is not committed.** Group
  4's one-off is committed (`evidence/group4-author-rows.mjs`), but the
  script that produced the delivery audit exists only in the implementer's
  transcript; the committed evidence is the log. The log's LIVE sections
  embed the commands' outputs, so the checks remain inspectable — a future
  re-audit is re-derived from the log rather than re-run. A reproducibility
  gap in evidence hygiene, not in delivery; accepted-known at ship (and the
  direct enabler of T-1's uncorrected counter).

## Test Gate

- Required scope: proportionate to the ship state. The delivered delta since
  the last green evidence is evidence/markdown only — `c4334827` added only
  the validate log, and this ship adds only evidence markdown (ship log,
  review report, gate log; no executable byte). The checkers this change
  owns or touches — the closure checker (family #30, this change's own
  deliverable), the boundary checker (the census this change's new scripts
  moved) — plus strict validation of the named change item were re-run fresh
  by this ship. **The regen trio was NOT re-run by the ship**: the reviewer
  re-proved the full trio at the delivery HEAD `c4334827` — 3/3
  byte-identical to the committed blobs (quoted verbatim above) — and this
  ship's tree is content-identical to that tree for every inventoried file
  (the ship commit adds evidence markdown only, outside every inventoried
  area). The frozen byte-control, the 30-family sweep, and the pack-output
  notices were likewise re-executed by the reviewer at this same tree and
  are cited above.
- Commands (log committed as `evidence/logs/ship-gates.log`, each leg
  self-logging its `REAL_EXIT_CODE` line — background exit codes are
  untrusted on this machine, the log's own lines are the verdict; run at
  `c4334827` with tracked-clean asserted in-log):
  - `rasen validate s05-provenance-and-beta-closure --strict --project
    rocut --json` → **REAL_EXIT_CODE[validate]:0**, `"valid": true`,
    `"issues": []` (named-item form).
  - `node script/check-package-boundary.mjs` →
    **REAL_EXIT_CODE[boundary]:0** — five rules PASS
    (acyclic-direction / public-entry-only / no-internal-reexport /
    no-elftia-import / react-free-base), census 1138/1011/416/415/870/74
    (the +3 total over P6's 1135 is this change's added script estate; the
    per-rule figures 1011/416/415/870/74 are unchanged).
  - `OPENCUT_SCRATCH_ROOT=… node script/check-packed-manifest-closure.mjs`
    (live green-path run, fresh pack of all four tarballs, scratch under the
    user-profile dot-dir, CONTROL-1c discipline) →
    **REAL_EXIT_CODE[closure]:0** — 0 failures over 4 packages, census
    byte-identical to the committed green log (classic 796/3502/49/32/18/
    683/2 latent 2 activated 0; dispositions `bun:test`×88 +
    `@napi-rs/canvas`×3; register 2 rows, re-derived this run).
  - Wrapper `REAL_EXIT_CODE[overall]:0`.
- Diff sanity scan (this ship): 0 added TODO/FIXME/XXX/HACK markers in
  `git diff 959f41d2..c4334827` added lines (51 files, +19116/−948); the
  reviewer's credential-shaped and registry-operation sweeps over the same
  delta were independently CLEAN.
- Tree: `b2795b82aacea97e8e9cbe9def2a6335d50c5c17` (pre-ship-log HEAD tree;
  the ship commit adds only evidence markdown, no code — the executable
  content the reviewer's reproduction proved is unchanged).

## Notes for the portfolio delivery (parent = 05-community-beta-second-host)

- Nothing was pushed: the branch has never been pushed. At ship time
  `git rev-list --left-right --count origin/main...HEAD` = `0 109`
  (0 behind, 109 ahead — the earlier portfolio children's commits plus this
  child's 10); the ship commit makes it 110.
- The `specs/` delta is UNSYNCED by design — `sdk-provenance-beta-closure`
  (NEW) belongs to the archive-stage spec sync, not ship.
- `proposal.md`, `design.md`, `specs/`, `.openspec.yaml`, and the reviewer's
  `evidence/review-scratch/` reproduction logs remain untracked by
  convention while the change is active (same as P2/P3/P5/P6 — the tracked
  set for ship is {ship-log, review-report, gate logs, tasks ticks}); the
  archive transaction commits them with the change.
- `tasks.md` 8.3's standDown was vacuous as declared: no `signals/`
  directory exists under the change root or `.rasen/` (re-verified absent
  at ship time), so no worker is parked and nothing must be stood down
  before the parent's delivery.
- **This is the portfolio's LAST child.** With P7 shipped, all seven
  children are complete and the parent's delivery (PR + merge against
  `main`, then archive per the on-merge timing) is unblocked.

## Archive
**Date:** 2026-08-15T19:34:52.374Z
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut\rasen\changes\archive\2026-08-15-s05-provenance-and-beta-closure
**Transaction:** 3936ce41-a7f1-4dd7-abec-a1036fd2c6b9
