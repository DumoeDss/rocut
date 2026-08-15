## Context

The provenance estate as P6 leaves it, measured:

- **The pin**: `cf5e79e919144200294fb9fed22a222592a0aeea` (OpenCut Classic, MIT,
  `Copyright 2025-2026 OpenCut`), recorded in `UPSTREAM.md`, `SOURCE_INVENTORY.json`'s `ref`, and
  `PATCHES.md`'s header. `script/generate-source-inventory.mjs` hashes **pinned upstream blobs**
  (stable fingerprint) and reports working-tree drift separately; its `AREAS` constant is the
  pre-P1 `["apps/web/src", "rust", "apps/web/public"]` while the code now lives in `packages/`,
  `examples/`, two newer apps and an enlarged script estate.
- **The staleness**: `SOURCE_INVENTORY.md` still reports "205 inherited file(s) modified" against
  pre-P1 paths; S03+S04 shipped with ~95 entries of drift and every child since has added surface
  the inventory has never seen. P1's 863 renames will restate the derived sets wholesale — that
  is expected and is exactly why the regen is the spine, not a chore.
- **The SBOM**: `script/generate-sbom.mjs` reads `bun.lock` + `Cargo.lock`, emits `SBOM.md`, and
  **asserts known upstream metadata defects against their declared dispositions** (recorded vs
  repaired, one-sided assertion eliminated in S02). `bun.lock`'s classic workspace entry is stale
  (predates P6's dependency repair); refreshing it feeds the SBOM.
- **The notices gap**: all three package manifests list `LICENSE` and `NOTICE` in `files`; the
  files do not exist (P5 made `README.md` real and left these as P7's). `rust/wasm/pkg/` already
  contains a `LICENSE` (wasm-pack's copy; the pkg manifest declares MIT) — the fourth tarball
  ships its license by construction, to be verified in pack output.
- **The closure-checker seed set** (P6's round-1 probe, verbatim): zustand's peers `immer`
  (imported only by `zustand/esm/middleware/immer.mjs`) and `use-sync-external-store` (only by
  `zustand/{traditional.js,esm/traditional.mjs}`) are undeclared by classic but **latent-only**
  — classic imports `zustand`, `zustand/vanilla`, `zustand/middleware`, and the middleware barrel
  is self-contained. Level-1 residuals `@napi-rs/canvas` and `bun:test` are test-file-only.
- **The family**: 29 checkers, 23 exit-zero / 6 nonzero (the known set); census figures derive
  from each checker's printed filter; `CONTROL-1c` refuses ancestor-unclean scratch roots (the
  green-by-leakage class); runs that pack/extract/install set `OPENCUT_SCRATCH_ROOT` under the
  user profile; long runs go background with bounded polling, discriminated on the log's own
  completion marker; CRLF is verified at **blob** level after commits; FAIL halves of
  violation-and-revert controls are committed beside their green twins.

## Goals / Non-Goals

**Goals:**

- The provenance set regenerated and **accurate at the ship commit**, with accuracy evidenced by
  the generator's named inputs, a generated-files-only delta commit, and a second-run stability
  proof.
- Legal closure a consumer actually receives: notices verified inside all four packed tarballs.
- The packed-manifest closure checker, reachability-aware, joining the family with its seed
  verdicts and controls.
- The beta record and the consumer-obligation documentation — the portfolio's honest closing
  statement.

**Non-Goals:**

- Publishing anything (B1's no-irreversible-step ruling to the last); fixing the wasm-init defect
  (Direction-level, documented not repaired); touching the four frozen surfaces, the export maps,
  `surface.json`, or the 29 existing checkers' rules; SBOM format migration; the lint debt and
  CI-promotion residuals.

## Decisions

### E1 — The sequencing spine: Phase A structural, Phase B regenerative, delta-commit-proven

**Phase A** (ordinary groups): notices, checker, generator widening, lock tidy, documentation.
**Phase B** (the closing group): with all code committed, run the regeneration at that HEAD —
`node script/generate-source-inventory.mjs`, the `PATCHES.md`/`UPSTREAM.md` reconciliation, and
`node script/generate-sbom.mjs` — and commit the generated set **as its own commit whose diff
touches only generated files**. That diff shape IS the accuracy evidence: the content derives
from a named, code-complete revision, and nothing executable moved after it. A second
regeneration with no edits in between must be byte-stable (the existing
`upstream-provenance` scenario, executed). Every Phase-B log self-certifies
`HEAD: <sha>, tree: clean` — the generalized self-certifying label with the `+worktree` half
gone precisely because Phase B runs clean.

*Why not regen inside every group:* each regen would be stale by its own landing commit — the
S03+S04 8.7 lesson and the reason P7 is last. *Why a delta commit rather than amending:* history
shows the regen's inputs (the pre-regen HEAD) must stay addressable for the record; an amend
erases the input the record names.

### E2 — Notices: create the missing files, verify in pack output, all four tarballs

Three packages gain `LICENSE` (the upstream MIT text, byte-identical to the root `LICENSE` —
preservation is the existing requirement) and `NOTICE` (upstream project + URL + pin
`cf5e79e9…` + this fork's identity + a one-line statement that the packages contain fork
modifications recorded in the shipped `PATCHES`-referencing inventory). The `files` fields
already list both names — P5's README precedent, repeated. Verification: pack via the existing
`packSdkTarballs`, then **inspect the artifacts** (`tar -tf` plus extraction) — every tarball
lists `LICENSE` and `NOTICE` (the wasm tarball: `LICENSE` via its `pkg/` copy; if its `NOTICE`
equivalent is absent, that is recorded as the flat artifact's shape — it has no exports map or
surface manifest either, and the consumer-view checker already logs it as a flat artifact).
Notice *content* review is a human gate; presence-and-shipped is the mechanical one.

### E3 — The closure checker: reachability-aware, seeded, register-backed

`script/check-packed-manifest-closure.mjs` (the family's 30th), driven over packed tarballs via
the existing seams (`OPENCUT_PREPACKED_DIR` / `OPENCUT_TARBALL_OUT_DIR`):

- **Level 1** — bare-specifier scan of the extracted tarball's shipped source vs the packed
  manifest's declared deps + peers. Hits are violations unless dispositioned (the known
  test-file-only residuals `@napi-rs/canvas`, `bun:test` carry written dispositions; a new
  undeclared runtime import fails — manifest truth, mechanically).
- **Level 2** — for each *declared* dependency's peer dependencies, determine whether any file
  **reachable from the package's shipped entries** imports the subpath that needs the peer;
  unreachable-only peers land in the **documented-latent register** with their reachability
  reason. Seeded verbatim: `immer` and `use-sync-external-store` under zustand, latent-only
  today. A register entry whose peer becomes reachable — by any future edit — fails the checker
  with a message naming the register row. This makes P6's finding a standing gate instead of a
  snapshot.
- Controls: negative (a synthetic undeclared import and a synthetic register-reachability break
  both FIRE, FAIL log committed beside the green twin), converse (dispositioned residuals and
  register rows stay silent), census lines (specifiers scanned per tarball, register size,
  disposition count), empty-scan refusal. Runs from the same ancestor-clean scratch discipline
  as every pack-touching gate (`CONTROL-1c`).

### E4 — The regeneration's scope: widen the areas, classify the renames, reconcile the rows

The generator's `AREAS` widen to the current tree (`packages/*`, `examples/`, the script estate,
`apps/vite-example`, `apps/electron-host`, beside the surviving `rust` and `apps/web/public`) —
**derived from the boundary map and workspace globs where possible, not a third hand-list**.
P1's renames flow through `git diff --name-status` against the pin; how moved-but-modified and
moved-unmodified files classify is the generator's existing semantics — P7's obligation is that
the output **reconciles**: drift counts derived (not recalled), every modified inherited file
carries a `PATCHES.md` row, every fork-added file appears in `UPSTREAM.md`'s added inventory, and
the second-run stability proof passes. A modified file with no patch row is a finding to fix by
adding the row (the patch log is the record, not an accusation), attributed by count as S03+S04's
8.7 did.

### E5 — The lock tidy and the SBOM behind it

Refresh `bun.lock`'s classic workspace entry with a plain `bun install` at the repo root
(**never** `--frozen-lockfile` — measured 4-minute timeout; the flag is not the tool for a stale
workspace map). Verify the lock's classic entry matches the manifest's dependency block, then
regenerate `SBOM.md` **after** the tidy (the SBOM reads the lock) — in Phase B, so the shipped
SBOM describes the shipped lock. The SBOM's disposition assertions must come out exactly as
declared (recorded defects present, repaired defects absent) — a mismatch is a real finding
about the repository, not a generator nuisance.

### E6 — The beta record and the consumer obligations

`BOUNDARIES.md` gains the portfolio's closing section: the delivered state (three `0.2.0`
packages behind a 35-entry labeled surface; conformance and four examples executable from
installed tarballs with a CI leg; three Hosts), the no-`1.0` stance restated beside P5's policy,
the **wasm-init Direction finding recorded as carried** (its probe text, its owner, its
mock-entry workaround), and the residuals with owners (lint debt = human decision; local-only
checkers = deliberate; ubuntu-only examples job = config change away). Classic's README gains
the four consumer obligations P6 named (culori declarations, `@source` self-registration,
definite-height wrapper, empty-scene seed trap) — documentation the beta's adopters need on day
one.

### E7 — Sequence

1. **Baseline:** current inventory drift figures (method inline), family census (29 / 23-6),
   frozen byte-control, pack a set and inventory notice presence as the before-half.
2. **Notices + pack verification** (E2). 3. **The closure checker** (E3). 4. **Generator
   widening + reconciliation dry-run** at the pre-ship tree (E4) — dry-run findings fixed in
   Phase A. 5. **Lock tidy + SBOM machinery** (E5). 6. **Beta record + consumer docs** (E6).
7. **Phase B — the spine** (E1): code-complete commit, regen trio, self-certifying logs,
   generated-files-only delta commit, second-run stability, final controls (frozen byte-control,
   30-checker sweep, blob-level CRLF over the round's files, named-item strict validate).
8. Ship local; standDown on review-clean.

## Risks / Trade-offs

- **[The regen's delta commit accidentally includes a code edit.]** → The delta-only diff shape
  is the acceptance criterion: `git show --name-only <delta>` lists only generated artifacts; a
  code file in the list restarts Phase B.
- **[The closure checker's reachability analysis is wrong in the permissive direction.]** →
  The register is the alarm, not a waiver: becoming-reachable fails loudly; the seeded pair's
  reachability reasons are re-derived each run, not trusted from the register.
- **[The regen restates ~863 renames and drowns review.]** → Attribution by count with the
  generation method named (S03+S04's 8.7 shape); the summary table's totals reconcile by
  derivation; the reviewer reads the reconciliation, not 863 lines.
- **[The lock tidy shifts resolutions the SBOM asserts over.]** → SBOM regenerates after the
  tidy in Phase B; a disposition mismatch is escalated as a repository finding, never edited
  into silence.
- **[Notice content is legally wrong.]** → Content is reviewed as a human gate; the mechanical
  claim (shipped, complete, upstream-preserving) is what this change proves. The root MIT text
  is copied byte-identical — modification of it is the existing spec's explicit violation.
- **[A long regen or pack loop stalls silently.]** → Background with bounded polling turns;
  completion discriminated on the log's own marker + mtime, never on silence (P6's 43-quiet-
  minutes lesson).

## Migration Plan

Phase A is additive or generated-tooling; Phase B is generated-artifacts-only. Rollback of Phase A
is `git revert`; Phase B's delta reverts to the previous generated state, which the code tree no
longer matches — the honest rollback for Phase B is a fresh regen. Ship mode **local (commit
only)** — the portfolio delivers once, at the parent, after this child. No push, no publish, no
irreversible step anywhere (B1 to the last).

## Open Questions

- **The NOTICE files' exact wording** — drafted in Phase A, reviewed as content; the pin and fork
  identity are fixed inputs, the phrasing is a review gate.
- **Whether `examples/` belongs in the inventory's areas or only in `UPSTREAM.md`'s added-file
  inventory** — examples are fork additions, not inherited content; the generator's classification
  of never-upstream paths settles it mechanically (additions list), and the dry-run shows which.
- **Whether the wasm tarball should carry a NOTICE** — it has no exports map or surface manifest
  (the flat-artifact shape P6 recorded); deciding adds one copy step if review wants it, and the
  pack-output verification names the outcome either way.
