## 1. Baseline: what exists before anything is labeled

- [x] 1.1 Capture the baseline with method and measurement point inline (P2's reviewer rule): the
      export-map inventory (36 classifiable entries — 6 ports / 11 contracts / 19 classic,
      `./package.json` excluded; re-count at the current commit via the manifests read directly),
      the current full checker census (`check-package-boundary.mjs` + the family sweep's per-rule
      counts), and the byte-control over the four S03+S04 frozen surfaces
      (`git show <base>:<path> | cmp`, the P2/P3 method). This is the before-half of every
      comparison in this change.
- [x] 1.2 Author the compatibility policy text (design E4): `0.MINOR.PATCH`; frozen additive-only;
      provider may change in a minor; experimental may change or be removed in a minor; no
      stability claim beyond the policy; the Classic migration surface's known wasm-init
      constraint stated as current-surface truth. Review the draft against spec §3.6's evidence
      clauses before any file lands.

## 2. Policy ships: READMEs and the version decision

- [x] 2.1 Create `packages/editor-ports/README.md`, `packages/editor-contracts/README.md` and
      `packages/editor-classic/README.md`, each carrying the shared policy statement plus the
      package's role and its class summary. This makes the manifests' existing `files` entries
      real — today all three name READMEs that do not exist, so tarballs ship no policy at all.
- [x] 2.2 Apply the version decision (design E4): bump all three `0.1.0 → 0.2.0` as the policy's
      first application (the minor recording P0→P5 entry additions), OR record the
      hold-`0.1.0` alternative if review has ruled by then. Verify `workspace:*` in-repo
      resolution is unaffected (no consumer resolves the literal) and that P3's harness name map
      keys package names, not versions (so tarball filename changes flow through).
- [x] 2.3 Verify the version/policy half from the pack path early: reuse `packSdkTarballs`
      (import from `script/pack-sdk-tarballs.mjs`; never re-implement), pack, and confirm the
      tarball inventory lists `README.md` and shows the `0.x` version — a cheap gate before the
      labeling work lands on top.

## 3. The surface manifests and in-source markers

- [ ] 3.1 Author the three `surface.json` manifests — every export entry of every package
      classified `frozen | provider | experimental` with a one-line reason, plus symbol-level
      overrides only where an entry genuinely mixes classes (classic's root `.` is the known
      case). The classification table IS this change's reviewable core: the four frozen surfaces
      are `frozen`; the Classic UI/media/session/storage barrels are `provider`; the
      evidence/test-infrastructure entries (`./evidence/*`, `./storage/conformance`,
      `./conformance/requirements`) are adjudicated with reasons — `experimental` where unstable
      by intent, `provider` where they are Classic's own machinery. Add `surface.json` to each
      manifest's `files`.
- [ ] 3.2 Add `@opencutSurface <class> — <reason>` markers as the first doc-comment line of every
      `provider`- and `experimental`-classified entry's source file. **No frozen-classified file
      is edited** — verify with the byte-control from 1.1 immediately after the marker batch,
      not at ship time. CRLF-check every touched file (`tr -dc '\r' < f | wc -c` = 0).
- [ ] 3.3 Control: a deliberately misclassified row (marker says provider, manifest says
      experimental) is planted, the checker from Group 4 must fire on it, then reverted — the
      marker/manifest agreement rule proven on real source, the P1 E6 violation-and-revert
      pattern.

## 4. The checker joins the family

- [ ] 4.1 Author `script/check-sdk-surface-labels.mjs` per design E3: completeness in both
      directions (every export entry classified; no row naming an undeclared entry),
      class-vocabulary enforcement, marker agreement for non-frozen rows, symbol-override
      validity resolved against real exports, empty-scan refusal, and census lines
      (per-package entry counts, per-class counts) in the house idiom. Wire it into root
      `package.json`'s scripts beside `check:packages`.
- [ ] 4.2 `--negative-control`: an unlabeled experimental export (synthetic entry + manifest row
      without a source marker) and an unclassified export entry (map row absent from the
      manifest) must each fire with a named violation. `--converse-control`: correctly labeled
      rows, `frozen` rows without markers (the designed state), and prose merely mentioning a
      class name must all stay silent. Both controls exit non-zero on any miss.
- [ ] 4.3 Family sweep: run every runnable static checker, all green, with per-checker
      `EXIT[<name>]:<code>` lines; the new checker's census reconciles with 1.1's inventory
      (36 entries at the time of writing — the current count wins if entries moved); the
      boundary checker is untouched and green over its own census (`boundary.json` needs no
      edit — entries derive from export maps at load time; record the row in BOUNDARIES.md).

## 5. The consumer view, proven from tarballs

- [ ] 5.1 Pack via the P3 module and verify from the packed inventory + extract, not the
      workspace: every tarball's version is `0.x`; each ships `README.md` containing the policy;
      each ships `surface.json` classifying exactly its export-map entries (count reconciliation
      against 4.1's census); at least one non-frozen entry's `@opencutSurface` marker is present
      in the extracted source. Self-log `REAL_EXIT_CODE`.
- [ ] 5.2 Manifest truth (P3's rule): assert the packages' dependency blocks are unchanged
      except version fields — labeling adds no runtime-closure import. If implementation added
      any, declare it in the same commit and run the scratch harness
      (`run-scratch-conformance.mjs`) before claiming this group done; record the run.

## 6. The no-stability sweep and documentation

- [ ] 6.1 Semantic no-`1.0` sweep: enumerate candidates (`1.0`, `stable`, `production-ready`,
      `semver`, `GA`) over everything tarballs ship plus `packages/README.md`, `BOUNDARIES.md`
      and the DECISIONS docs under `src/`; give every hit a recorded disposition — `0.1.0`
      contains `1.0` as a substring, and counting without reading is the failure mode this task
      exists to avoid.
- [ ] 6.2 Restate `packages/README.md` at the current tree: its "packages/*/src is empty / every
      module still lives under apps/web/src" text has been false since P1. Refresh with current
      figures (method + measurement point inline), and point to the per-package policy READMEs
      as the consumer-facing statement.
- [ ] 6.3 `BOUNDARIES.md`: labeling section (taxonomy, mechanism, the frozen-files-untouched
      rule, the checker and its controls), the classification summary table, the checker-audit
      row for the new script, and the non-coverage statement (LICENSE/NOTICE/SBOM = P7;
      wasm-init fix = Direction-level; release automation and CI = out of scope, P6 decides CI).

## 7. Delivery audit and ship

- [ ] 7.1 The F2-class delivery audit (P3's rule): pair every scenario clause of this change's
      spec delta with the evidence line that satisfies it; amend any clause the delivery does not
      meet BEFORE archive, scenario headings verbatim, rulings attributed in design.md — never
      in the spec text.
- [ ] 7.2 Final controls re-run: the frozen-surface byte-control from 1.1 still identical; the
      full checker family green; `rasen validate s05-versioning-and-experimental-labeling
      --strict --project rocut --json` → `valid: true, issues: []` (the item name is required —
      bare `--strict` prints "Nothing to validate").
- [ ] 7.3 Line endings per stage; explicit pathspecs with the `.rasen/` staging guard
      (`grep -c` exits 1 on zero — capture in a variable); one `feat(<change>):` commit per
      group; **local only, no push** — the portfolio delivers once at the parent.
- [ ] 7.4 On review-clean: `{"kind":"standDown"}` to any parked worker's signals, confirm
      `signals/.state/` is empty before the archive is planned.
