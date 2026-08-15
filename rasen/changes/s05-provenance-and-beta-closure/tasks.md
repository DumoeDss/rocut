## 1. Baseline

- [x] 1.1 Capture the before-half with method and measurement point inline: the current
      inventory drift figures as `SOURCE_INVENTORY.md` states them (with the generator command
      that would re-derive them), the generator's `AREAS` constant, the family census (29
      checkers, 23 exit-zero / 6 nonzero — the known set; any OTHER red is a finding), the
      frozen-surface byte-control vs `5aae75ec`, and a pack whose per-tarball file listing
      records notice presence as it stands (three editor tarballs: absent; wasm: `pkg/LICENSE`).
      Scratch roots ancestor-clean (user profile) for every pack — `CONTROL-1c` refuses dirty
      roots by design.
- [x] 1.2 Dry-run the regeneration at the pre-ship tree to size Phase B: run the inventory
      generator with the CURRENT areas (expected: the stale pre-P1 picture), then a widened-areas
      probe (a throwaway invocation, not a landed edit) to enumerate what Phase B will pick up —
      the rename restatement, the patch-row gap count, the added-file delta since `UPSTREAM.md`'s
      last update. Record the expected Phase-B deltas as the plan the dry-run proved.

## 2. Notices and pack verification

- [x] 2.1 Author `packages/editor-{ports,contracts,classic}/LICENSE` (byte-identical copy of the
      root preserved upstream MIT text — modification of that text is the existing spec's
      violation) and `NOTICE` (upstream project + URL + pin `cf5e79e9…` + fork identity + the
      one-line modifications statement). The `files` fields already list both names — no manifest
      edit needed.
- [x] 2.2 Verify in PACK OUTPUT, never the worktree: pack via `packSdkTarballs` (import, never
      re-implement), list and extract every tarball — the three editor tarballs ship LICENSE +
      NOTICE, the wasm tarball ships its license. Notice-content review is a human gate recorded
      in the round section; presence-and-shipped is the mechanical claim. Decide and record the
      wasm-NOTICE question (design E7's open item) with the pack listing as evidence either way.

## 3. The packed-manifest closure checker

- [x] 3.1 Author `script/check-packed-manifest-closure.mjs` (family's 30th) per design E3:
      level-1 bare-specifier scan of extracted shipped source vs the packed manifest (disposition
      register for the known test-file-only residuals `@napi-rs/canvas` and `bun:test`); level-2
      peer reachability over the declared deps' reachable subpath graph, with the
      documented-latent register seeded verbatim (`immer`, `use-sync-external-store` under
      zustand, with their reachability reasons). Runs from the existing tarball env seams;
      ancestor-clean scratch discipline inherited.
- [x] 3.2 Controls, FAIL halves committed: the negative control materializes a synthetic
      undeclared import AND a register-activation break (a synthetic import reaching a
      registered peer's subpath) — both FIRE, the failing logs committed beside the green twin
      (P6's R1 rule); the converse control proves dispositioned residuals and register rows stay
      silent. Census lines every run (specifiers scanned per tarball, register size, disposition
      count); empty scans refuse.
- [x] 3.3 Family integration: wire into root `package.json` scripts, re-run the family sweep
      (now 30), confirm the known nonzero set is unchanged and the new checker exits zero over
      the current tarballs. Checker-audit row recorded in `BOUNDARIES.md`.

## 4. Generator widening and reconciliation machinery

- [x] 4.1 Widen `script/generate-source-inventory.mjs`'s areas to the current tree — derived from
      the boundary map and workspace globs where possible, not a hand-list — covering
      `packages/*`, `examples/`, the script estate, `apps/vite-example` and `apps/electron-host`
      beside the surviving `rust` and `apps/web/public`. Dry-run again: the rename classification
      flows through the generator's own semantics; reconcile that moved-unmodified and
      moved-modified files classify honestly (a moved file with content change is drift, not an
      addition).
- [x] 4.2 Reconciliation machinery check (still Phase A — the final numbers are Phase B's): a
      comparison pass that pairs every modified inherited file with a `PATCHES.md` row and every
      fork-added path with a `UPSTREAM.md` entry, reporting both counts by derivation. Fix the
      gap it finds NOW (add the missing rows with their slice attributions — the patch log is the
      record) so Phase B's delta is regeneration, not row-authoring.

## 5. Lock tidy and SBOM machinery

- [ ] 5.1 Refresh `bun.lock`'s classic workspace entry with a plain `bun install` at the repo
      root — **never** `--frozen-lockfile` (measured 4-minute timeout; not the tool for a stale
      workspace map). Verify the lock's classic entry matches the manifest's dependency block
      (culori, date-fns, opencut-wasm, the two workspace deps, the react peer).
- [ ] 5.2 SBOM machinery pass at the tidied lock: run `generate-sbom.mjs` and confirm every
      recorded defect matches its declared disposition (recorded defects present, repaired
      absent). A mismatch is a repository finding, escalated with the probe output — never
      edited into silence. The SHIPPED SBOM regenerates in Phase B (design E5).

## 6. The beta record and consumer documentation

- [ ] 6.1 Author `BOUNDARIES.md`'s beta-closure section per design E6: delivery statement
      (packages + versions + the 35-entry labeled surface; conformance and four examples from
      installed tarballs with the CI leg; three Hosts), the no-`1.0` stance restated beside P5's
      policy, the wasm-init Direction finding with its failure text, mock-entry workaround and
      ownership, and the residuals with owners (lint debt = human decision; local-only checkers
      = deliberate; ubuntu-only examples job = a config change away).
- [ ] 6.2 Complete classic's README consumer obligations (P6's F-P6-3/4/5/6): the culori
      `declare module` requirement (ships no declarations), the `@source` self-registration
      without which builds are silently half-styled, the definite-height wrapper, the
      empty-scene seed trap — each stating the failure an adopter sees when it is missed.
- [ ] 6.3 Restate `UPSTREAM.md` where Phase A touched its inputs (toolchain, retained/removed
      areas if the estate changed) — its requirements are the existing spec's; the restatement
      keeps the record current rather than accruing another drift generation.

## 7. Phase B — the regeneration spine

- [ ] 7.1 Land every Phase-A group as its own commit; declare the code-complete HEAD. Confirm a
      clean tree (`git status --porcelain` empty) — Phase B's logs self-certify `HEAD: <sha>,
      tree: clean` with no `+worktree` half.
- [ ] 7.2 Run the regeneration trio at that HEAD — `generate-source-inventory.mjs`,
      `generate-sbom.mjs`, and the patch/added-file reconciliation — each log self-certifying
      its revision. Commit the generated set as ONE delta commit whose changed-file list is
      generated artifacts ONLY (`git show --name-only` is the acceptance check; a code file in
      the list restarts Phase B).
- [ ] 7.3 Stability proof and final controls: regenerate a second time with no edits in between —
      byte-stable (the existing spec's scenario); drift counts reconciled by derivation with
      method named; the frozen-surface byte-control still identical; the 30-checker family sweep
      green in the known nonzero shape; blob-level CRLF over the round's files
      (`git show HEAD:<path> | tr -dc '\r' | wc -c` = 0); `rasen validate
      s05-provenance-and-beta-closure --strict --project rocut --json` → `valid: true, issues: []`
      (named-item form).

## 8. Ship

- [ ] 8.1 The F2-class delivery audit BEFORE archive: pair every scenario clause of this change's
      spec delta with the evidence line that satisfies it (grep every cited artifact EXISTS and
      holds the phrase at the cited file:line — P6's R1/R5 hygiene); amend unmet clauses to the
      evidence's shape, headings verbatim, rulings attributed in design.md, never in spec text.
- [ ] 8.2 Explicit pathspecs; the `.rasen/` staging guard in a variable; one `feat(<change>):`
      commit per Phase-A group, `feat(<change>): regenerate provenance at <sha>` for the delta;
      **local only, no push, no publish** — the portfolio delivers once, at the parent, and B1's
      no-irreversible-step ruling holds to the last commit. Return DONE only with the final
      commit hash in hand.
- [ ] 8.3 On review-clean: `{"kind":"standDown"}` to any parked worker's signals; confirm
      `signals/.state/` is empty before the archive is planned. This is the portfolio's last
      child — the parent's delivery follows, and nothing here may park past review.
