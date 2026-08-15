# Implementation report — s05-provenance-and-beta-closure (P7)

Implementer: P7 leaf worker. Written per group as work lands. Method notes and
trap disclosures inline. Evidence logs live in `evidence/logs/`.

## Group 1 — Baseline + dry-run sizing (tasks 1.1, 1.2)

**1.1 — before-half with method inline** (`evidence/logs/group1-baseline.log`,
`group1-family-sweep.log`, `group1-frozen-byte-control.log`,
`group1-pack-baseline.log` + `group1-baseline-tarball-manifest.json`):

- HEAD `959f41d2`. Committed `SOURCE_INVENTORY.{md,json}` (last regenerated in the
  S03+S04 era) states: areas `apps/web/src:691, rust:43, apps/web/public:335`,
  totals 1069 files, drift **205 modified / 229 added / 0 other** against pin
  `cf5e79e919144200294fb9fed22a222592a0aeea`; re-derivation command stated in the
  file itself (`node script/generate-source-inventory.mjs`). Generator `AREAS`
  constant at `script/generate-source-inventory.mjs:19` — the pre-P1 set, verbatim.
- Family census: **29 checkers, 23 exit-zero / 6 nonzero**; nonzero set exactly
  `{check-asset-manifest:2, check-emitted-runtime-assets:1, check-headless-graph:2,
  check-headless-semantic-result:2, check-resolution-equivalence:1,
  check-type-baseline:1}` — the known capture-run-needing set, byte-identical to
  P6's close. Counted from the log's own 29 `EXIT[...]` lines (grep, not recall).
- Frozen-surface byte-control vs `5aae75ec`: **4/4 IDENTICAL** (method
  `git show <base>:<path> | cmp -s`, stat-cache-immune).
- Baseline pack at the scratch root (`$HOME/.opencut-scratch-p7/tarballs-baseline`,
  ancestor-clean by construction; `OPENCUT_TARBALL_OUT_DIR` under the user profile),
  via `packSdkTarballs` imported through its CLI with `--out`/`--manifest` overrides
  — determinism reproduced (4/4 packed twice, digests equal). Notice presence **from
  the pack manifest's own per-file inventories, never the worktree**:
  `@opencut/editor-ports@0.2.0` (23 files) LICENSE absent / NOTICE absent;
  `@opencut/editor-contracts@0.2.0` (61 files) absent / absent;
  `@opencut/editor-classic@0.2.0` (805 files) absent / absent;
  `opencut-wasm@0.2.10` (7 files) **LICENSE present** (wasm-pack's own
  `pkg/LICENSE`), NOTICE absent. Exactly the proposal's stated before-half.

**1.2 — dry-run sizing Phase B** (`evidence/logs/group1-dryrun.log`):

- Current-areas re-run of the generator at the pre-ship tree: **34 modified / 12
  added / 641 other (all `D`)** — the stale pre-P1 picture from the other direction
  (the moved editor files read as deletions because `packages/` sits outside the
  pathspec). The two generated files were then restored from HEAD by
  `git show HEAD:<path> > <path>` and verified by `git hash-object` equality.
- Widened-areas probe (throwaway `git diff --name-status -M cf5e79e9 --` over the
  design-E4 set; no landed edit): **M 34 / A 533 / D 37 / C 0 / R100 151 /
  R<100 453**; all 604 renames land in `packages/editor-classic`.
- Reconciliation probe (padding-aware row regex — the table pads columns with
  spaces, so a naive `` `path` |`` regex sees only 96 of 265 rows; caught by
  cross-checking against `grep -c '^| P-'`): PATCHES rows 265, **195 unique
  upstream paths**, need-row 487 (M 34 + movedModified 453), **missing 336** —
  all upstream paths under `apps/web/src`. These are Phase A task 4.2's rows.
- Added-file delta: UPSTREAM.md has area tables but **no per-file added
  inventory**; the A enumeration (533) is the derivation the 6.3 restatement
  reconciles against.

**Group 1 verdict:** the before-half is captured with method and measurement
point inline; Phase B's size is proven (rename restatement 604, patch-row gap
336, added delta 533). No code change — the group's deliverable is evidence.

## Group 2 — Notices and pack verification (tasks 2.1, 2.2)

**2.1 — the files.** `packages/editor-{ports,contracts,classic}/LICENSE` created
by `git show HEAD:LICENSE > <target>` — byte-identity to the preserved upstream
MIT text (`8117f9bb…`, the sha256 UPSTREAM.md's licence-integrity section
records) proven by digest, all three identical to root and pin. `NOTICE` in each
package: upstream project + URL + pin `cf5e79e9…` + fork identity
(`DumoeDss/rocut`) + the one-line statement that modifications in the shipped
tree are recorded in the fork's provenance set (PATCHES/SOURCE_INVENTORY/UPSTREAM
at the repository root). The three NOTICE files differ only in the package-name
first line. LF-verified at write time (`tr -dc '\r' | wc -c` = 0). No manifest
edit — the `files` fields already listed both names (P5's README precedent).

**2.2 — verified in PACK OUTPUT** (`evidence/logs/group2-pack-notices.log` +
`group2-pack-notices-manifest.json`; packed via `packSdkTarballs` through its
CLI with `--out` under the ancestor-clean scratch root): all three editor
tarballs list and ship LICENSE + NOTICE (ports 23→25 files, contracts 61→63,
classic 805→807 — exactly +2 each), and each packed LICENSE's sha256 in the
manifest's own per-file inventory equals the root text's digest —
byte-identity proven from the artifact, never the worktree. Belt-and-braces
`tar -tf` listing per tarball confirms the same. The wasm tarball ships its
LICENSE (byte-identical to root — wasm-pack's copy carries the same text) and
no NOTICE: **the design-E2 open question is decided as the recorded flat-artifact
shape** — `rust/wasm/pkg/` is gitignored build output (`.gitignore:39`), so a
pkg NOTICE would be an untracked file inside a regenerated directory; adding one
means a build-tooling change, recorded here as the one-copy-step-if-review-wants-it
outcome the design names. Notice-content review is the human gate; the mechanical
claim proven here is presence-and-shipped.

## Group 3 — The packed-manifest closure checker (tasks 3.1, 3.2, 3.3)

**3.1 — the checker.** `script/check-packed-manifest-closure.mjs`, the family's
30th, mirroring `check-sdk-consumer-view.mjs`'s structure (same `runTool`
shell idiom copied byte-for-byte, same env seams `OPENCUT_PREPACKED_DIR` /
`OPENCUT_TARBALL_OUT_DIR` / `OPENCUT_SCRATCH_ROOT`, extraction under a
dot-dir beside the tarballs wiped each run, `REAL_EXIT_CODE` self-logging).
Design E3, line for line:

- **Level 1** scans every scannable shipped file of every tarball (including
  the wasm artifact — its glue genuinely traverses 2 relative imports) —
  bare specifiers must be declared (dep/peer/optional, root-name matching so
  `zustand/vanilla` and `@opencut/editor-ports/host` count as their declared
  roots), a Node builtin, or dispositioned. The two dispositions (`bun:test`,
  `@napi-rs/canvas`) license test files ONLY — the same specifier in runtime
  code still fails.
- **Level 2** walks each declared dependency's peer set (minus names the
  package itself declares, minus peers no runtime file of the dep imports —
  that drops `@types/react`), resolves the subpaths the package's REACHABLE
  graph imports through the dep's `exports` map (import condition, `./*`
  wildcard substitution), takes the transitive closure of every landed dep
  file, and asks which subjects that closure needs. The two-level answer is
  compared with the documented-latent register — seeded verbatim with
  `zustand|use-sync-external-store` and `zustand|immer` and their P6
  reachability reasons — over four failure modes: REGISTER ACTIVATION (names
  the row and quotes its reason), unregistered latent, peer-needing-promotion
  (F-P6-7), stale row. Register judgement aggregates ACROSS packages: a row
  belongs to whichever package declares the dep, so ports/contracts/wasm
  (which do not declare zustand) have no say over zustand's rows.
- Census lines every run per tarball (files scanned, import occurrences,
  unique bare, declared count, entry roots, reachable, level-2 subjects,
  latent/activated) plus dispositions honoured and register size; empty scans
  refuse (zero scannable files, or zero import specifiers).

**Bring-up findings, all fixed in place** (the record keeps them because each
is a trap the next author would re-hit): `homedir` lives in `node:os` not
`node:fs`; a `main`→`runClosure` argument key mismatch; `.map(resolve)`
passes the map triple into `path.resolve` (`ERR_INVALID_ARG_TYPE`); English
prose in JSDoc reads as an import under a naive `\bfrom\s*["']…` regex —
`trigger: "visibility prop transitions from 'hidden' to 'visible'"` (a FROZEN
file) and `Distinguishing "…" from "the runtime holds nothing"` both fired —
so the `from` clauses are now line-anchored on `import`/`export`/`}`;
subpath imports (`zustand/vanilla`) initially failed against exact-name
declaration matching, and zustand's traditional twin imports
`use-sync-external-store/shim/with-selector.js` — the full subpath — so
peer/importer keys normalize to the package root; and the control-world
builder hit the documented GNU-tar `host:path` hazard cross-drive
(scratch on `C:`, repo on `E:` — `entry.tarballPath` is repo-relative, and
joining it back against the repo produced a broken path tar read as a remote
host), fixed by addressing the pack dir by basename.

**3.2 — controls, FAIL halves committed** (`group3-closure-green.log`,
`group3-closure-negative.log`, `group3-closure-converse.log`):

- **Green run** over freshly packed tarballs: **0 failures over 4 packages**
  — ports 19 files/46 imports; contracts 55/240; classic 796/3502 with 49
  unique bare, 32 declared, 18 entry roots, 683 reachable, **level-2 subjects
  2, latent 2, activated 0** (both register rows latent — the seeded premise
  re-derived, not trusted), dispositions `bun:test`×88 + `@napi-rs/canvas`×3;
  wasm 3/2 with `main`-rooted reachability 2. Exit 0.
- **Negative control**: doctored classic (in-scratch only) plants
  `@synthetic/undeclared-closure-probe` AND `zustand/traditional` into
  `src/index.ts` (the `.` entry — reachable by construction), repacked with
  real `npm pack`, scanned over `OPENCUT_PREPACKED_DIR`. **Both fired**:
  the level-1 FAIL names the file and specifier; the REGISTER ACTIVATION
  FAIL names row `zustand|use-sync-external-store`, the package, the
  F-P6-7 remedy, and quotes the registered reason. Census shows latent 1 /
  activated 1. Scratch root CONTROL-1a/1b/1c-checked (outside repo, outside
  Temp, ancestors node_modules-free to the drive root); `git status
  --porcelain` printed in-log proving the repo untouched; exit 1 = the FAIL
  half, committed beside the green twin.
- **Converse control**: doctored classic plants `@napi-rs/canvas` into a NEW
  test file — the disposition count moves 3→4 and **nothing fires**; both
  register rows stay silent (latent 2, activated 0); 0 failures, 0 refusals,
  exit 0.

**3.3 — family integration.** Wired as `check:packed-closure` in the root
`package.json` (LF-preserving node edit; `git ls-files --eol` verified).
Family sweep re-run as the 30-checker census
(`group3-family-sweep.log`; method: every `script/check-*.mjs` run bare in
name order, `EXIT[name]:code` per checker — Group 1's method unchanged):
**30 checkers, 24 exit-zero / 6 nonzero, the known set byte-identical**
(`asset-manifest:2, emitted-runtime-assets:1, headless-graph:2,
headless-semantic-result:2, resolution-equivalence:1, type-baseline:1`), the
new checker green among the exit-zero. Checker-audit row recorded as
`BOUNDARIES.md` §16's opening subsection. ESLint on the new file: clean.

**Group 3 verdict:** the checker exists, is green over the current tarballs,
its negative control proves both failure modes fire (FAIL half committed),
its converse control proves the dispositions and register stay silent, the
family census moved 29→30 with the known nonzero set unchanged, and the
wiring + audit row are in place.


## Group 4 — Generator widening and reconciliation machinery (tasks 4.1, 4.2)

**4.1 — areas derived, drift classified honestly.** The generator's pre-P1
`AREAS` hand-list is gone: `deriveAreas()` expands the root manifest's
`packages/*` workspace glob, maps `boundary.json` consumers (ownership map
contributes the mapped tree plus the app's `public`; a `src`-rooted consumer
contributes its whole app; any other its root), and hand-names only the two
survivors the design itself names (`script`, `rust`) — the design-E4 set,
reproduced by derivation. Dry-run at the widened areas: pin-side totals
unchanged (1071 files — the fork added no files inside pin-side areas beyond
the 2 script files), drift **34 M / 453 moved-modified / 151 moved-unmodified
/ 503 added / 0 deleted** once the third rename class landed:

- `computeDrift` now recovers the extraction's heavy-rewrite tail as
  **`movedRewritten`** (37 files): a pin path git reported deleted pairs with
  the UNIQUE added path carrying its `apps/web/src/`-stripped suffix — drift
  carrying a PATCHES row, never a silent deletion. Two of the 37 were
  ambiguous at first pass because the c5-storage-boundary fixtures replicate
  the upstream layout verbatim (`script/fixtures/**` tails collide with the
  packages destinations); fixtures are copies, never extraction destinations,
  so they are excluded from pairing candidates and stay fork-added. Leftover
  unpaired paths would stay `deleted`; the derivation refuses to guess.
- The md/JSON/console renderings all carry the new class; the stale claim that
  deletions are "judgement recorded in UPSTREAM.md's removed-areas section"
  is gone (the 37 are moves, and nothing is deleted at all).
- `SOURCE_INVENTORY.{md,json}` were regenerated to verify the rendering, then
  restored from HEAD by `git show HEAD:<path> > <path>` with `git hash-object`
  equality — Phase B owns the regenerated commit, not this group.

One trap fixed in passing, and worth its record: the generator's pin ref was
`process.argv[2]`, so an IMPORTER's flag (`--apply`) leaked into `git diff`
as a ref. The pin is now an exported `PIN` constant and `computeDrift`
defaults to it; the CLI-only override ignores leading-dash args.

**4.2 — reconciliation machinery, gap found and fixed NOW.**
`script/reconcile-provenance.mjs` pairs every drift-classed inherited file
(M + movedModified + movedRewritten, keyed by upstream path) with a PATCHES
row via the padding-aware row regex — parser cross-checked against the naive
`^| P-` line count each run, a shortfall refuses — and every fork-added path
with a UPSTREAM.md listing (reported; a FAIL only under `--require-added`,
which task 6.3's inventory satisfies and Phase B's gates turn on). Orphan rows
(key paths outside the derivation) are censused: all 9 are repo-root/app-config
paths (bun-ci.yml, .gitignore, package.json, bun.lock, Cargo.toml,
eslint.config.mjs, README.md, apps/web/{package.json,next.config.ts}) —
outside the inventoried areas by design.

First run against the 265-row ledger: **need-row 524, covered 186, missing
338** (Group 1's 336 + 2: 35 of the 37 movedRewritten froms were already
rowed). The gap is fixed in this group, by derivation, not archaeology:
`evidence/group4-author-rows.mjs` (dry-run by default, `--apply` appends)
generated rows P-277..P-614 — every field derived (drift class and R-score
from the generator, destination from the rename/pairing record, last-touch
from a single `git log` pass, and the forcing clause is S05 P1's extraction
clause per BOUNDARIES.md §7 "Specifier rewrites P1 owes"). The last-touch
histogram matters for honesty: 776 of 802 extracted files were last touched
by the extraction commit itself, so the drift is overwhelmingly the
extraction's own import-specifier rewrites — rows say exactly that; only 3 of
the 338 carry post-extraction attributions (35950753 ×2, f239d81b ×1; the
unmapped-commit case refuses rather than fabricating). After-state
(`group4-reconcile-after.log`): **603 rows / 533 unique paths, need-row 524,
covered 524, MISSING 0, exit 0**; `--require-added` verified to fail with the
496-unlisted census (task 6.3's deliverable). ESLint clean on all three
touched scripts. `SOURCE_INVENTORY` files left at HEAD bytes.

**Group 4 verdict:** the areas and the three-class rename taxonomy are
derived, the reconciliation machinery exists and gates, and the patch-row gap
it found (338 rows) is closed in Phase A — Phase B's delta is regeneration.

## Group 5 — Lock tidy and SBOM machinery (tasks 5.1, 5.2)

**5.1 — the tidy.** Before-state measured first: the lock's
`packages/editor-classic` entry was the stale pre-P5 map — version `0.1.0`,
four dependencies (`editor-contracts`/`editor-ports` workspace, `culori`
4.0.2, `opencut-wasm` file:), one peer (`react ^18.3.1`) — against the
manifest's 0.2.0 / 30 dependencies / 2 peers. The refresh ran as a plain
`bun install` at the repo root (never `--frozen-lockfile`), and the
environment fight is part of the record: the inherited `HTTP_PROXY`/
`HTTPS_PROXY` (127.0.0.1:7890) hung bun twice at `Resolving dependencies`
(attempt 1: 20 min; attempt 2: 35 min; both with CPU flat at 0.6 s over a
12 s sample, memory flat at 76 MB, four ESTABLISHED proxy connections static
— a bun-vs-proxy stall, not a slow registry: the same proxy answered curl in
4 s, and the direct path measured 10.7 s/metadata and working). Attempt 3
unset the proxy variables for the child only — the command itself stayed
plain `bun install` — and completed in **6.25 s** ("Resolved, downloaded and
extracted [26]; Saved lockfile; 3 packages installed"; log
`group5-bun-install.log`, hung twins preserved as `-attempt1-stalled.log` /
`-attempt2-hung.log`).

After-state verified mechanically (`group5-install-verify` in the transcript;
JSONC-tolerant parse of `bun.lock` vs the manifest): version equal (0.2.0),
**dependencies equal 30-to-30**, peers equal (react + react-dom ^18.3.1);
the task's named set all present — `culori = 4.0.2`, `date-fns = ^3.6.0`,
`opencut-wasm = file:../../rust/wasm/pkg`, both workspace deps `workspace:*`,
react peer `^18.3.1`. The lock diff is exactly the tidy: three workspace
version syncs 0.1.0→0.2.0 (classic/contracts/ports), the classic dependency
block expansion, one `sprintf-js` nested-dedup flattening — nothing else.

**5.2 — SBOM machinery pass at the tidied lock** (`group5-sbom.log`):
`node script/generate-sbom.mjs` → **1375 npm packages, 80 wasm crates,
exit 0, all five defect probes matching their declared dispositions** —
D-1/D-2/D-3/D-4 `recorded` all observed present; D-5 `repaired` observed
absent. No mismatch, nothing escalated, nothing edited. The regenerated
`SBOM.md` was then restored from HEAD (`git show` + `git hash-object`
equality; the stat-cache M it initially showed was healed by an index
refresh staging the identical blob — content diff empty) — **the shipped
SBOM regenerates in Phase B** (design E5), exactly as `SOURCE_INVENTORY`
does.

**Group 5 verdict:** the lock's classic entry now equals the manifest's
dependency block by mechanical comparison, and the SBOM machinery passes at
the tidied lock with every recorded defect present and the repaired one
absent. One environmental finding worth its bytes: bun 1.2.2 through an
inherited local proxy can hang at resolution with zero CPU — the fix is
unsetting the proxy env for the install child, not a flag change.

## Group 6 — Beta record and consumer documentation (tasks 6.1, 6.2, 6.3)

**6.1 — the beta-closure record** (`BOUNDARIES.md` §16's closing subsection,
design E6 line for line): the delivery statement (three `@opencut/*` packages at
`0.2.0` behind a **35-entry labeled surface** — ports 6 + contracts 10 + classic
19, counted from the shipped `surface.json` files, not recalled; the conformance
suites and the four examples executable from installed tarballs by
`run-published-examples.mjs` with the `sdk-examples` CI leg wired, its first
true execution post-delivery per §15's own statement; the three Hosts — Next,
Vite, Electron); the **no-`1.0` stance restated beside P5's policy** (§14): no
GA or production-readiness claim exists in any published material, the
per-package compatibility policy is the only stability claim, and the beta name
is precisely that statement; the **wasm-init Direction finding recorded as
carried** — the probe text verbatim (`wasm.__wbindgen_start is not a function`,
bun-version-independent 1.2.2/1.2.18, identical in-repo and from tarballs), the
transitive binding named (`v27-to-v28.ts` and `services/storage/service.ts`
import from `src/wasm`), the workaround named (install the **experimental**
`./evidence/wasm-test-mock` entry first — custom-storage's honest pair), and the
ownership explicit (Direction level, not the package; the package README states
it as a `0.x` constraint); and the **residuals with owners**: the 255-error
lint debt stays a human decision, the local-only family sweep is deliberate,
the ubuntu-only examples job is a config change away from a matrix.

**6.2 — classic README consumer obligations** (F-P6-3/4/5/6, new "Consumer
obligations (from-tarball adoption)" section): the culori `declare module`
requirement (culori publishes no declarations; the from-tarball typecheck fails
on the first import until the consumer declares the module), the `@source`
self-registration (the failure is silent and specific — theme colours apply,
`.size-full`/`.overflow-hidden`/`.flex-1`/`.min-h-0` never generate, a
coloured-but-inert editor), the definite-height wrapper (`min-height: 100%`
establishes no definite height; the Surface resolves to content height and the
timeline renders clipped invisible), and the empty-scene seed trap
(`buildDefaultScene` is zero-duration, the seek controller clamps into it, the
playhead provably cannot move — seed one element before asserting). Each
obligation names the failure an adopter sees, per the task's own wording.

**6.3 — UPSTREAM.md restated where Phase A touched its inputs.** Three dated
restatement blocks, each preserving the historical text above it as history:
the **Extraction method** (S01 aliased and rejected extraction; S05 P1 then
performed exactly that extraction — and the ambiguity S01 feared is now
answered by the provenance set: the rename taxonomy plus rows P-277..P-614,
not by avoidance); the **Retained areas** (the old `apps/web/src/**` table now
maps to `packages/editor-classic/src/**`, with the mapping derived in
`SOURCE_INVENTORY.json`, never recalled); the **Toolchain** (the lock-refresh
note: the tidy ran under bun 1.2.2, so the recorded 1.2.18-pin discrepancy
stands unchanged). Beside them, the **added-file inventory** the design's E4
reconciliation requires: `--write-added-inventory` derived the 504 fork-added
paths by area and the list is embedded as UPSTREAM.md's closing section — after
which `reconcile-provenance.mjs --require-added` exits 0 (every added path
listed, every drift-classed inherited file rowed).

**One line-ending catch, caught by the standing check:** the Write-tool temps
carried CRLF into UPSTREAM.md's insertions (`git ls-files --eol` showed
`w/mixed`); 518 lines normalized to LF, after which all three touched files
read `i/lf w/lf` and every diff is pure additions (BOUNDARIES +50, UPSTREAM
+580, README +31 — `group6-docs.log`).

**Group 6 verdict:** the portfolio's closing record states the delivery, the
stance, the carried finding and the residuals with owners; the README tells an
adopter the four failures they will otherwise meet; UPSTREAM.md no longer
accrues a drift generation — its stale sections are restated beside their
history and the added-file inventory is embedded, closing E4's second half.

## Group 7 — Phase B: the regeneration spine (tasks 7.1, 7.2, 7.3)

**7.1 — code-complete HEAD declared** (`group7-code-complete.log`): the six
Phase-A groups landed as their own commits (e2f82d3b / 98ab8997 / 52fd84b0 /
490beaef / caa720c3 / 1431840a), the tracked tree is clean
(`--untracked-files=no` empty — no `+worktree` half), and the log prints the
full porcelain beside it: the only entries are the untracked planning scope
(the lead's artifacts for this change and the sibling change's directory),
which are the lead's call to commit, never the implementer's.

**7.2 — the regeneration trio, one generated-only delta.** At HEAD `1431840a`
with a clean tracked tree: `generate-source-inventory.mjs` (1071 pin-side
files; drift **34 M / 453 moved-modified / 37 moved-rewritten / 151
moved-unmodified / 504 added / 0 deleted** — derived, method named in the log),
`generate-sbom.mjs` (1375 npm + 80 crates at the tidied lock; D-1..D-4
recorded+present, D-5 repaired+absent), and the reconciliation with
`--require-added` (need-row 524 covered 524; every fork-added path listed in
UPSTREAM.md; exit 0). Each log self-certifies `HEAD: <sha>, tree: clean
(tracked)`. Committed as **`04c42f40` "feat(s05-provenance): regenerate
provenance at 1431840a"** — `git show --name-only` acceptance reads exactly
`SBOM.md, SOURCE_INVENTORY.json, SOURCE_INVENTORY.md`, generated artifacts
only, no code file in the list.

**7.3 — stability and final controls:**

- **Second-run byte-stability** (`group7-stability.log`): all three generators
  re-run at `04c42f40` with no edits between; sha256 pre==post 3/3 and the
  tracked porcelain after the second run is empty — byte-stable.
- **Frozen-surface byte-control** vs `5aae75ec`: **4/4 IDENTICAL**
  (`git show <base>:<path> | cmp -s`, stat-cache-immune).
- **30-checker family sweep** (`group7-family-sweep.log`): **30 EXIT lines,
  24 exit-zero / 6 nonzero, the known nonzero set byte-identical**
  (asset-manifest:2, emitted-runtime-assets:1, headless-graph:2,
  headless-semantic-result:2, resolution-equivalence:1, type-baseline:1);
  the family's 30th (`check-packed-manifest-closure`) green among the zero.
- **Blob-level CRLF**: `git show HEAD:<path> | tr -dc '\r' | wc -c` = 0 for
  all nine files the round committed (the three generated artifacts, the four
  documentation files, PATCHES.md, bun.lock, tasks.md).
- **`rasen validate s05-provenance-and-beta-closure --strict --project rocut
  --json`** (`group7-validate.log`): named-item form
  `id=s05-provenance-and-beta-closure, valid=true, issues=[]`.

**Group 7 verdict:** the spine held — one delta commit whose changed-file list
is generated artifacts only, proven byte-stable on the second run, with every
control (frozen surfaces, family sweep, CRLF, strict validate) green in its
known shape.

## Group 8 — Ship: delivery audit, final commit, standDown (tasks 8.1, 8.2, 8.3)

### 8.1 — the F2-class delivery audit

Every scenario clause of `specs/sdk-provenance-beta-closure/spec.md` paired with
the evidence line that satisfies it, each citation grep-verified at the cited
file (P6's R1/R5 hygiene). Canonical run:
`evidence/logs/group8-delivery-audit.log` — **45 PASS, 0 FAIL,
REAL_EXIT_CODE:0** over 6 requirements / 12 scenarios / 45 clause checks.
Attempt 1 (4 FAIL, all audit-script artifacts, no delivery gap: a miscounted
11-vs-10 areas expectation, a bare-specifier `require` in the manifest probe,
two anchors spanning hard markdown line-wraps) is preserved at
`group8-delivery-audit-attempt1.log` with its diagnosis beside it.

One unmet clause found and amended — the audit doing its job. R6.S1.c2 ("the
beta record states that registry-specific behaviour was never exercised and is
claimed nowhere") had no sentence in the §16 record. Amended by appending five
lines to the beta-closure record's "Delivered." paragraph (BOUNDARIES.md, pure
addition, headings verbatim, spec text untouched):

> Nothing was published to any registry and nothing was signed: every
> verification above ran against locally packed tarballs, so registry-specific
> behaviour (publishing, resolution from a registry, provenance attestations)
> was never exercised and is claimed nowhere (design B1, held to the last
> commit).

Clause-to-evidence highlights (the full mapping is the audit log itself):

- **R1** delta generated-files-only: `git show --name-only 04c42f40` = exactly
  SBOM.md, SOURCE_INVENTORY.{md,json}; self-cert
  `group7-regen-source-inventory.log:1`; byte-stability
  `group7-stability.log:43`; drift counts with method named
  (`script/generate-source-inventory.mjs:147`).
- **R2** areas: 10 derived areas (`group7-regen-reconcile.log:2`), 10
  area-table rows in SOURCE_INVENTORY.md, all 10 directories exist live; the
  0-file rows are correct semantics — the inventory hashes the PIN, where
  packages/*, the electron host, the vite example and examples did not exist
  yet; need-row 524 / covered 524 / MISSING 0
  (`group7-regen-reconcile.log:5`); a no-row file FAILs loudly
  (`script/reconcile-provenance.mjs:130`).
- **R3** notices: all four tarballs ship LICENSE (sha256 `8117f9bb…`,
  byte-identical to the repo's preserved upstream MIT — live re-hash of the
  root LICENSE plus all four package LICENSEs), the three editor packages ship
  NOTICE beside it (live parse of `group2-pack-notices-manifest.json`); the
  SBOM reflects the tidied lock (`group5-bun-install.log:16`) with D-1..D-5
  all green (`group7-regen-sbom.log:3-7`).
- **R4** closure: undeclared runtime import FAILs naming file and specifier
  (`group3-closure-negative.log:16`); register activation FAILs naming the
  register row (`:32`); the converse stays silent
  (`group3-closure-converse.log:32`); the documented-latent register with its
  reachability reason lives at `script/check-packed-manifest-closure.mjs:107,112`;
  census lines every run (`group3-closure-green.log:21`); the failing logs are
  committed beside the green run.
- **R5** beta record: delivery and stance (`BOUNDARIES.md:1358-1381`), the
  wasm-init Direction finding with failure text, workaround and ownership
  (`:1392-1397`), residuals each with its owner (`:1404-1408`), README
  obligations each naming the failure an adopter sees
  (`packages/editor-classic/README.md:61-87`).
- **R6** no publish, no frozen edits: zero credential/registry-operation
  patterns in the change's full diff (`959f41d2..HEAD`) and zero added
  publish-command lines; the amended never-exercised sentence at
  `BOUNDARIES.md:1378`; frozen control 4/4 IDENTICAL
  (`group7-stability.log:45`, baseline `group1-frozen-byte-control.log:4`);
  the frozen-surface exclusion ruling at `design.md:51`.

### 8.2 — explicit pathspecs, staging guard, local only

One Group 8 commit: the BOUNDARIES.md amendment, the three audit artifacts
(audit log + attempt-1 log + diagnosis), this report section and the tasks.md
ticks — staged by explicit pathspec, `.rasen/` staging guard verified 0, hooks
on. Local only: the branch has never been pushed (no
`origin/feat/s05-community-beta`); B1's no-irreversible-step ruling holds to
the last commit. The final commit hash is this commit itself, reported in the
implementer's DONE message and reproducible as `git log -1`.

### 8.3 — standDown

Satisfied vacuously, sibling precedent (`s05-second-host`'s ship log, task
10.4): no worker was ever parked for this change —
`<changeRoot>/signals/` does not exist, `signals/.state/` does not exist, and
no signal file or signals directory exists under the change root or `.rasen/`
(verified at ship time immediately before the commit). There is no live
heartbeat that could make a later archive ESTALE. The checkbox is ticked with
this justification recorded here. This is the portfolio's last child; nothing
here parks past review.
