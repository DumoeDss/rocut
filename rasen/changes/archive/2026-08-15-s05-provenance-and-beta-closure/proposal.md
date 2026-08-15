## Why

Spec §3.8's warning is history, not hypothesis: S03+S04 shipped with an inventory that had
accumulated **~95 entries of drift**, and this Slice *publishes to strangers*. Since then, P1
moved 863 files into `packages/`, P2 added an app, P3–P6 added the harness estate, examples and
a CI job — and the provenance set has not been regenerated once: `SOURCE_INVENTORY.md`'s drift
report still counts "205 inherited file(s) modified" against pre-P1 areas (`apps/web/src`, `rust`,
`apps/web/public`) that no longer describe where the code lives, the generator's area list
predates the extraction, and the packages' `files` fields promise `LICENSE`/`NOTICE` files that
**do not exist** (P5 made the README real and left these two as P7's named open question — it is
P7's now). P7 is the last child *by necessity*: an inventory generated before the final commit
describes a tree that no longer exists, so its regeneration sequencing is this change's spine.

## What Changes

- **The two-phase sequencing spine.** Phase A (pre-ship) lands everything structural: the notice
  files, the new checker, the generator's area widening, the lock tidy, the documentation. Phase B
  (post-code-commit) runs the final regeneration — `SOURCE_INVENTORY.{md,json}`, the
  `PATCHES.md`/`UPSTREAM.md` reconciliation, and `SBOM.md` — at the code-complete commit, commits
  the generated set as a **generated-files-only delta commit**, and proves stability by
  regenerating a second time with no edits in between (the existing spec's own scenario). Every
  authoritative log self-certifies its revision (`<HEAD>`, no `+worktree` — the tree is clean at
  that point). This is S03+S04's deferred-8.7 precedent made the plan's spine instead of a
  late discovery.
- **Notices inside the packed tarballs, verified in pack output.** MIT `LICENSE` and a `NOTICE`
  (naming the upstream project, the pin `cf5e79e9…`, and the fork) created in all three packages,
  making the manifests' existing `files` entries real; the **fourth tarball** (`opencut-wasm`
  from `rust/wasm/pkg`) already carries `pkg/LICENSE` (wasm-pack's own copy, MIT — verified, then
  re-verified in its pack output). Legal closure is proven by extracting or listing the packed
  artifacts — never by reading the working tree — because the `files` field decides what a
  consumer gets.
- **The packed-manifest dependency-closure checker**, built reachability-aware per P6's probe
  design and joining the family as its 30th: **level 1** scans bare specifiers of the extracted
  tarball against the packed manifest (known residuals `@napi-rs/canvas` and `bun:test` are
  test-file-only, dispositioned); **level 2** eliminates peers-of-declared-deps that only
  unreachable subpaths import — seeded verbatim with zustand's `immer` and
  `use-sync-external-store`, which are latent-only today and recorded in a **documented-latent
  register with their reachability reasons**, so a future edit that reaches them trips the
  checker instead of an adopter. Negative and converse controls per the family idiom, FAIL halves
  committed, census lines, empty-scan refusal.
- **The inventory regenerated over the current tree**: the generator's area list widened past its
  pre-P1 set to cover `packages/*`, `examples/`, the script estate and both newer apps; P1's
  renames classified by the generator's own semantics with counts reconciled by derivation;
  `UPSTREAM.md`'s added-file inventory and `PATCHES.md`'s row completeness cross-checked so a
  modified inherited file with no patch row is a finding, not a silent pass.
- **The beta-closure record** in `BOUNDARIES.md`: what the S05 portfolio delivers (narrow-published
  `0.2.0` packages, the 35-entry labeled surface, conformance from installed tarballs, three
  Hosts, four CI-executed examples), the no-`1.0` stance restated, the **wasm-init Direction
  finding documented as carried, not fixed** (next Slice owns it), and the named residuals with
  owners (the 255-error lint debt stays a human decision; the local-only checkers; the
  ubuntu-only examples job).
- **P6's documentation debts paid**: classic's README names its consumer obligations (the culori
  `declare module` requirement, the `@source` self-registration against silently half-styled
  builds, the definite-height wrapper, the empty-scene seed trap), and `bun.lock`'s stale classic
  workspace entry is refreshed — **without** `--frozen-lockfile`, which times out (measured); the
  SBOM reads the lock, so it regenerates after the tidy.

## Capabilities

### New Capabilities

- `sdk-provenance-beta-closure`: the two-phase regeneration and its accuracy evidence; notices
  and SBOM verified inside pack output for all four tarballs; the reachability-aware
  packed-manifest closure checker with its latent-peer register; the beta-closure record and the
  consumer-obligation documentation; the stated non-coverage.

### Modified Capabilities

*(none — the existing `upstream-provenance` requirements are path-neutral where P7 executes them
("any committed document whose content is derived from a comparison against the upstream pin")
and describe repo-root artifacts where they stand; P7 executes and extends in place rather than
amending normative text.)*

## Impact

**Added**

- `packages/editor-{ports,contracts,classic}/LICENSE` + `NOTICE`; the documented-latent register
  and disposition records inside the new checker; the beta-closure section; the
  consumer-obligation sections in classic's README.

**Modified**

- `SOURCE_INVENTORY.{md,json}`, `PATCHES.md`, `UPSTREAM.md`, `SBOM.md` — the regenerated set,
  committed as the Phase-B delta; `script/generate-source-inventory.mjs` (area widening);
  `bun.lock` (workspace-entry refresh); `BOUNDARIES.md` (beta-closure record);
  `.github/workflows` untouched.

**Untouched, deliberately**

- The four frozen S03+S04 surfaces (byte control stands — P5's rule: frozen classification is
  manifest-only and no provenance sweep edits a frozen file; any pressure is escalation); the
  packages' export maps and `surface.json` (no entry changes); the 29 existing checkers' rules;
  `rust/wasm/pkg` (its LICENSE already ships via wasm-pack's own placement).

**Not covered by this change, stated so silence is not read as coverage**

- **No publish and no irreversible step** — B1's ruling carries to the end; nothing here touches
  a registry, signs an artifact, or rotates a credential.
- The wasm-init runtime defect — Direction-level, documented in the beta record, repaired
  nowhere in this portfolio.
- SBOM format migration (CycloneDX/SPDX) — the committed generator's shape is the established
  format; completeness and currency are the claims, not a new schema.
- The 255-error lint debt and any checker's promotion to CI — named residuals with their owners,
  unchanged by this child.
