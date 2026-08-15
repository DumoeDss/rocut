# Review report — s05-provenance-and-beta-closure (P7, verify stage)

Reviewer: `reviewer-s05-p7` (dispatched, report-only; not the author).
Delta reviewed: `959f41d2..c4334827` (10 commits) on `feat/s05-community-beta`.
Date: 2026-08-16. Scratch: `E:\rocut-p7-review-scratch` (outside the repo, E:
drive, node_modules-free ancestors — CONTROL-1c discipline; reproduction logs
copied to `evidence/review-scratch/`).

**Verdict: CLEAN** — 0 Blocker / 0 Major / 0 Minor / 2 Trivial.

Every mandated attention item was verified by independent reproduction, not by
reading the implementer's claims. Details below; the log of each reproduction
is in `evidence/review-scratch/`.

---

## Mandated item 1 — Phase-B spine: VERIFIED

- **Delta-commit shape**: `git show --name-only 04c42f40` lists exactly
  `SBOM.md`, `SOURCE_INVENTORY.json`, `SOURCE_INVENTORY.md` (all `M`, no other
  file) — generated-artifacts-only, the acceptance check holds.
- **Self-certifying logs name the right HEADs**:
  `group7-regen-source-inventory.log:1`,
  `group7-regen-sbom.log:1`, `group7-regen-reconcile.log:1` all read
  `HEAD: 1431840a…, tree: clean (tracked)`; `group7-stability.log:2` reads
  `HEAD: 04c42f40… (the delta commit) … no edits between runs`; final evidence
  (`group8-validate-final.log`) at the ship commit.
- **Second-run byte-stability REPRODUCED, and stronger**: I re-ran the full
  trio (`generate-source-inventory.mjs`, `generate-sbom.mjs`,
  `reconcile-provenance.mjs --require-added`) at the SHIP commit `c4334827`
  (three commits after the delta, tracked tree clean). All three regenerated
  files hash **exactly** the committed blob hashes:
  `95cc0b8c…` (SOURCE_INVENTORY.md), `cd3b1895…` (.json), `42df748a…`
  (SBOM.md) — the same values the committed stability log records — and every
  printed figure matches (1071 files / rollup `92caf3b6…`; drift
  34/453/37/151/504/0; SBOM 1375+80; reconcile 524/524/0, exit 0). Tracked
  tree restored clean afterwards (`git show HEAD:<p> > <p>`, porcelain empty).
  This proves the set is accurate at the delivery HEAD, not only at regen HEAD.
- **Input pin and diff base stated and consistent**: the pin
  `cf5e79e919144200294fb9fed22a222592a0aeea` is the generator's exported `PIN`
  (`script/generate-source-inventory.mjs:20`), the `SOURCE_INVENTORY.json`
  `ref` field, `PATCHES.md:4`, and `UPSTREAM.md:9`; `computeDrift` diffs
  against the same pin. No divergence anywhere.

## Mandated item 2 — Notices in PACK OUTPUT: VERIFIED (independently re-packed)

I packed all four tarballs myself via the repo's own `packSdkTarballs` seam
into scratch and inspected the artifacts (never the worktree):

- All four tarballs ship `LICENSE`; the three editor tarballs ship `NOTICE`
  beside it; the wasm tarball ships no NOTICE — the recorded flat-artifact
  decision (spec requires only the license for wasm).
- **LICENSE sha256 `8117f9bb64534f7530fc6139b014fd1c1465f7981f93d1871789150fa3f59d3d`
  is consistent across root worktree + 3 editor package LICENSEs + wasm
  `pkg/LICENSE` + all four extracted packs** — the mandated 9-way consistency.
- File counts: ports 25 / contracts 63 / classic 807 (each +2 = LICENSE+NOTICE
  over the baseline 23/61/805), wasm 7 — exactly the claimed deltas; the
  committed baseline manifest (`group1-baseline-tarball-manifest.json`)
  independently confirms the before-half (all four LICENSE/NOTICE **absent**
  at baseline except wasm's LICENSE present at `8117f9bb…`).
- Packed NOTICE content read from the artifact: names the upstream project +
  URL + the full pin + the fork (`DumoeDss/rocut`) + the provenance-set
  pointer; the package-name first line differs per package as claimed.

## Mandated item 3 — The closure checker (family #30): VERIFIED

All four runs reproduced (logs in `evidence/review-scratch/`):

- **Green**: 0 failures over 4 packages; classic census 796 files / 3502
  imports / 49 unique bare / 32 declared / 18 entry roots / 683 reachable /
  level-2 subjects 2 / **latent 2 / activated 0**; dispositions
  `bun:test`×88 + `@napi-rs/canvas`×3 — byte-identical to the committed green
  log. Exit 0.
- **Negative control re-run**: exit 1; BOTH legs fired — the level-1 FAIL
  names `src/index.ts` + `@synthetic/undeclared-closure-probe`, the REGISTER
  ACTIVATION FAIL names row `zustand|use-sync-external-store`, the package,
  the F-P6-7 remedy, and quotes the registered reason; census latent 1 /
  activated 1; in-log `git status --porcelain` proof the repo was untouched.
- **Converse control re-run**: exit 0; the dispositioned `@napi-rs/canvas` in
  a NEW test file moved the disposition count 3→4 and nothing fired; both
  register rows stayed silent.
- **MY OWN activation plant (independent of the committed control)**: I
  doctored a scratch copy of the real classic tarball with
  `import "zustand/middleware/immer"` — a DIFFERENT row than the committed
  control's plant — repacked with real `npm pack`, and ran the checker's own
  exported `runClosure`. It fired exactly
  `REGISTER ACTIVATION: row zustand|immer` (naming the row, quoting its
  registered reason), failures=1, exit 1. The register's reachability is
  **re-derived per run** (both directions: activation and staleness — verified
  in code at `check-packed-manifest-closure.mjs:499-516` and empirically
  here), not a static string match.
- **Family census re-run (all 30 checkers, bare, name order)**: 30 EXIT lines,
  **24 exit-zero / 6 nonzero**, nonzero set byte-identical to the known set
  (`asset-manifest:2, emitted-runtime-assets:1, headless-graph:2,
  headless-semantic-result:2, resolution-equivalence:1, type-baseline:1`); the
  new checker green among the zero. Census 29→30 with the known set unchanged,
  reproduced.
- Empty-scan refusal verified in code (`:299-303` zero scannable files,
  `:309-314` zero import specifiers → REFUSE + exit 2). Scanner line-anchoring
  probed for permissive gaps: the one theoretical blind form (multi-line
  import with mid-line closing brace) does not occur in any shipped source
  (both `} from` grep hits are a string literal and a commented-out import).

## Mandated item 4 — Reconcile + PATCHES honesty: VERIFIED

- **The math, re-derived by my own run**: need-row 524 = 34 modified + 453
  movedModified + 37 movedRewritten; covered 524, MISSING 0, exit 0 under
  `--require-added`; 603 rows / 533 unique paths; the 9 orphan rows are
  exactly the repo-root/app-config paths outside inventoried areas
  (bun-ci.yml, .gitignore, package.json, bun.lock, Cargo.toml,
  eslint.config.mjs, README.md, apps/web/{package.json,next.config.ts}),
  0 over restated files.
- **`--require-added` exit 0**: every fork-added path listed in UPSTREAM.md —
  per-area unlisted counts all 0; the 504 total = 33+57+1+9+34+166+63+25+2+114.
- **Attribution honesty — 6 of the 338 authored rows spot-checked (P-277,
  P-281, P-347, P-412, P-585, P-614)**, each verified against TWO independent
  derivations: (a) `git diff --name-status -M cf5e79e9` shows the rename with
  exactly the row's R-score and destination (R072/R096/R091/R096/R082/R095 —
  6/6 match); (b) `git log -1 -- <destination>` yields exactly the row's
  last-touch claim (`c234042e` for the three "no later edits" rows;
  `35950753` ×2; `f239d81b` ×1 — 6/6 match). The three later-edit commits'
  subjects match their row wording. The authored range and the 3-row
  post-extraction histogram are exactly as reported.
- **10-area derivation / 0-file semantics verified against the generator's
  code**: `deriveAreas()` expands the root manifest's `packages/*` glob, maps
  `boundary.json` consumers, and hand-names only `script` + `rust`
  (`generate-source-inventory.mjs:38-66`); `listTree` hashes the PIN per area
  via `git ls-tree -r <ref> -- <area>` (`:76-87`), so fork-created areas
  legitimately show 0 files with the empty digest `e3b0c442…` (= sha256 of
  empty input) — PIN-side fingerprint semantics, correct. All 10 area
  directories exist live (the `existsSync` filter at `:64` drops dead ones),
  satisfying "no area names a location that no longer exists". The audit's
  original 11-vs-10 expectation was the audit script's miscount, corrected
  with the diagnosis recorded.

## Mandated item 5 — SBOM: VERIFIED

1375 npm + 80 wasm reproduced by my regeneration at the ship commit; all five
defect dispositions checked against reality independently of the generator:
D-1 root `package.json` self-dependency `"opencut": "."` — **present**; D-2
`next ^16.1.3` + `better-auth ^1.4.15` in root deps — **present**; D-3
`rust/wasm/Cargo.toml:6` `repository = "https://github.com/opencut/opencut"` —
**nonexistent repo** (live fetch: GitHub serves its generic landing page /
route disambiguation, no such repository; the real upstream is
OpenCut-app/opencut-classic); D-4 pkg `sideEffects` includes `./snippets/*`
which the shipped `files` set does not contain — **present**; D-5 "declared
MIT while shipping no LICENSE" — **absent/repaired** (pkg/LICENSE exists at
`8117f9bb…`). All five match their declared dispositions.

## Mandated item 6 — Frozen surfaces: VERIFIED

Reproduced the 4/4 byte-control myself with the stat-cache-immune method
(`git show 5aae75ec:<path> | cmp -s - <path>`): all four IDENTICAL
(`packages/editor-classic/src/editor/transactions/opencut/index.ts`,
`packages/editor-ports/src/index.ts`, `packages/editor-contracts/src/index.ts`,
`packages/editor-classic/src/editor/surface/embedding/types.ts`). None of the
10 commits touches any frozen path (`git log --name-only` over the delta with
the four pathspecs is empty).

## Mandated item 7 — The proxy-env deviation: VERIFIED, refutation attempt failed to refute

- Both hung twins are committed as evidence:
  `group5-bun-install-attempt1-stalled.log` (raw 20-min stall at "Resolving
  dependencies", exit after kill) and `-attempt2-hung.log` (35-min hang,
  diagnosis prose inline); the successful third attempt
  (`group5-bun-install.log`) documents the unset inline and completes in 6.25 s
  with the post-install mechanical lock-vs-manifest verification.
- **Cheap refutation attempt**: the inherited proxy
  `http://127.0.0.1:7890` answers curl TODAY in 2.07 s (HTTP 200 from
  registry.npmjs.org) — consistent with, and supporting, the committed claim
  that the proxy itself was alive while bun hung through it (a
  bun-vs-proxy stall, not a dead proxy). I did not re-run bun through the
  proxy: it would rewrite the lock/node_modules (tree-dirtying) and a
  present-day success would not refute a past stall anyway.
- **No other env-fiddling**: a pattern scan (`env -u`, `unset`, `setx`,
  `$env:`, `export VAR=`) over all evidence logs and the author-rows script
  finds zero occurrences — the only manipulation is the documented proxy unset
  for the install child, and the command itself stayed plain `bun install`.

## Mandated item 8 — Beta-closure record: VERIFIED

`BOUNDARIES.md` §16 (1308-1409) carries, line-verified: the delivery statement
(35-entry labeled surface counted from shipped `surface.json`; conformance +
four examples from installed tarballs with the CI leg; three Hosts) at
1358-1373; the amended **registry-never-exercised clause** verbatim at
1375-1378 (the audit's R6.S1.c2 catch, amended per the audit); the no-`1.0`
stance restated at 1380-1385; the **wasm-init finding carried, not fixed** —
failure text `wasm.__wbindgen_start is not a function`, bun-version
independence, the two transitive importers named, the experimental
mock-entry workaround, Direction-level ownership — at 1387-1400; residuals
each with its decision owner at 1402-1409. The classic README's "Consumer
obligations (from-tarball adoption)" section (`README.md:61-90`) names all
four obligations, each stating the specific failure an adopter sees
(first-culori-import typecheck failure; coloured-but-inert editor;
hundred-pixel strip with clipped timeline; playhead that cannot move).

## Mandated item 9 — Security + no-publish sweep: VERIFIED CLEAN

- Credential-shaped content scan over the entire delta (`git diff
  959f41d2..c4334827`, added lines) for api-key/secret/password/token/AKIA/
  ghp_/gho_/github_pat_/sk-/npm_/PEM headers/Bearer: zero hits beyond the
  audit log's own prose describing the scan. The untracked planning scope and
  `.rasen/` scanned too: prose only ("non-secret placeholder env" guidance in
  an older change's ephemera).
- Registry-operation scan (`npm|bun|yarn|pnpm|cargo publish`, `dist-tag`,
  `whoami`, signing/attestation/provenance-apply, `publishConfig`): zero
  operational hits — only prose stating publishing never happened.
- No `signals/` directory exists under the change root or `.rasen/` (the
  standDown-vacuous claim's premise holds).
- `origin` carries no s05/community-beta branch — never pushed; delivery is
  local-only as ruled.

## Mandated item 10 — General pre-landing: VERIFIED

- **Delivery audit**: `group8-delivery-audit.log` — 0 FAIL,
  `REAL_EXIT_CODE:0`; every PASS line names a distinct clause with a citation
  I spot-verified at the cited file:line (R4's three control citations, R5's
  four BOUNDARIES/README anchors, R6's clause lines all hold). Attempt 1
  (4 FAIL) is preserved beside a diagnosis whose explanations I independently
  confirmed (the areas ARE 10; the anchors now match single-line substrings).
  See finding **T-1** below on the tally.
- **`rasen validate s05-provenance-and-beta-closure --strict --project rocut
  --json`** run by me at the ship commit: `valid: true, issues: []`.
- **Porcelain interpretation**: `group7-code-complete.log` records the full
  porcelain verbatim at `1431840a` — the only entries are the untracked
  planning scope (this change's and the sibling's artifacts), tracked-clean
  asserted by `--untracked-files=no` empty. Corroborated: my byte-identical
  regeneration from today's clean tree could not have reproduced the committed
  bytes had any inventoried-area file been dirty at regen time. Nothing
  TRACKED was left dirty at any evidence point.

---

## Standards axis

ESLint clean on all three touched scripts (re-run). Blob-level CRLF = 0 on all
nine files the round committed (re-run). Root `package.json` wiring follows the
family idiom (`check:packed-closure`). No frozen-surface edits, no workflow
edits, no manifest `files` edits (P5's precedent used as designed). File-size
and style conform to the script estate's existing shape.

**Standards: 0 findings.**

## Spec axis

All six ADDED requirements' scenarios verified with independent reproduction
(R1 delta-shape/self-cert/stability — reproduced; R2 areas/rows — reproduced;
R3 pack-output notices + SBOM-vs-lock — re-packed and re-derived; R4 closure
behaviors incl. both controls and a novel activation plant — reproduced; R5
beta record + README obligations — read and anchored; R6 no-publish/frozen —
scanned and byte-compared). No requirement missing or partial; no behaviour
beyond the proposal's stated Impact (scope check CLEAN; `.github/workflows`
untouched; the wasm no-NOTICE outcome is the design's recorded open-question
resolution, and the spec claims only the license for wasm).

**Spec: 0 findings.**

---

## Findings

### T-1 — Trivial — delivery-audit tally understates its own PASS-line count by one

`evidence/logs/group8-delivery-audit.log:134` reads `audit: 45 PASS, 0 FAIL`,
but the log contains **46** distinct `^PASS` clause lines (all substantiated;
I verified the citations). Attempt 1 shows the same off-by-one (41 `^PASS`
lines vs `audit: 40 PASS, 4 FAIL` at `group8-delivery-audit-attempt1.log:103`),
so the audit script's counter — not committed, see T-2 — drops one. The
implementation report and the ship message propagate "45/45". Direction of the
error is conservative (more passes exist than claimed; zero FAILs either way),
so it gates nothing — but this portfolio's theme is counting honesty, and the
record's headline number should match its own lines.

### T-2 — Trivial — the Group-8 audit script itself is not committed

Group 4's one-off is committed as `evidence/group4-author-rows.mjs`, but the
script that produced the delivery audit exists only in the implementer's
transcript; the committed evidence is the log. The log's LIVE sections embed
the commands' outputs (so the checks are inspectable), but a future re-audit
must be re-derived from the log rather than re-run. A reproducibility gap in
evidence hygiene, not in delivery — and the direct enabler of T-1's
uncorrected counter.

### Observations (no severity — recorded for the next author)

- The closure checker's line-anchored import regex has one theoretical blind
  form (a multi-line import whose closing `}` sits mid-line). It does not
  occur in any shipped source (probed); the anchoring is the deliberate fix
  for the prose-in-JSDoc false positives the implementation report records.
- The checker's level-2 dependency-side graph reads the repo's `node_modules`
  (documented in-file as the one workspace input); a future lockfile change
  that shifts a dep's subpath shape could re-classify register rows — which is
  exactly the fail-loud direction the register exists for.

## Reproduction index (evidence/review-scratch/)

`v1-regen.log` (trio at ship commit, 3/3 byte-identical), `v2-pack2.log`
(pack-output notices + 9-way LICENSE hash), `v3-green.log`, `v3-negative.log`,
`v3-converse.log`, `v3-myplant2.log` (independent immer-row activation),
`v3-family-sweep.log` (30/24/6), plus `README.txt` (scratch provenance).

**VERDICT: CLEAN — ship.** 0 Blocker / 0 Major / 0 Minor / 2 Trivial.
