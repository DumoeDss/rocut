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
