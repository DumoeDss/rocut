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
