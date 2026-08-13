## 1. Ownership declaration

- [x] 1.1 Create `packages/boundary.json` with the three-package layer order
      (`@opencut/editor-ports` → `@opencut/editor-contracts` → `@opencut/editor-classic`), the
      consumer list (`apps/web`, `apps/vite-example`), and a `shellPaths` list naming the six
      Host-shell roots no package may claim.
- [x] 1.2 Write the directory-level ownership entries, each with a required `why`. Assign
      `editor/ports/**` and `editor/host/editor-host.ts` to layer 0; `editor/contracts/**` to
      layer 1; the remainder of `apps/web/src` to layer 2; and the Next shell
      (`app/`, `site/`, `blog/`, `db/`, `auth/`, `components/landing/`, `components/header.tsx`,
      `components/footer.tsx`, `components/gitHub-contribute-section.tsx`, `changelog/components/`,
      `editor/host/next-editor-host.ts`, `editor/host/c4-next-runtime-probe.tsx`) to `apps/web`.
- [x] 1.3 Add the two file-level overrides design D4 identified: split `apps/web/src/feedback/`
      (`index.ts` + `queries.ts` → `apps/web`; `types.ts` + `components/**` →
      `@opencut/editor-classic`), and reassign the four test files whose subject is not their
      directory (`contracts/vectors/__tests__/agent-opencut-projection.test.ts` →
      `@opencut/editor-classic`; `editor/host/__tests__/branding-assets.test.ts`,
      `editor/host/__tests__/production-composition.test.ts`,
      `services/storage/__tests__/c5-storage-red-controls.test.ts` → `apps/web`).
- [x] 1.4 Confirm `apps/desktop` appears nowhere in the declaration.

## 2. Package manifests and export maps

- [x] 2.1 Create `packages/editor-ports/package.json`: name `@opencut/editor-ports`, version
      `0.1.0`, `"private": true`, no dependencies, `files` = `dist`, `src`, `README.md`, `LICENSE`,
      `NOTICE`, and the `exports` entries `.`, `./host`, `./in-memory`, `./in-memory/host`,
      `./conformance`, `./package.json`.
- [x] 2.2 Create `packages/editor-contracts/package.json`: version `0.1.0`, `"private": true`, a
      single dependency on `@opencut/editor-ports`, the same `files` shape, and the `exports`
      entries `.`, `./conformance`, `./draft`, `./draft/conformance`, `./engine`,
      `./engine/invariant`, `./engine/conformance`, `./vectors`, `./vectors/drivers`,
      `./package.json`.
- [x] 2.3 Create `packages/editor-classic/package.json`: version `0.1.0`, `"private": true`,
      dependencies on both packages above, the same `files` shape, and the `exports` entries `.`,
      `./surface`, `./surface.css`, `./session`, `./runtime`, `./browser`, `./storage`, `./project`,
      `./timeline`, `./renderer`, `./media`, `./fonts`, `./ui`, `./evidence`, `./package.json`.
      Leave React out of the manifest for now and record design D-open-2 (peer versus direct
      dependency) as P1's call.
- [x] 2.4 Write `packages/README.md`: what each package is, the layer order and why ports sit below
      contracts, the monotone-growth meaning of the `0.x` entry freeze, and a pointer to
      `boundary.json` as the ownership source of truth.
- [x] 2.5 Verify `npm pack --dry-run` succeeds for all three manifests despite `"private": true`,
      and record the output in the change's evidence directory. This is the assumption B1's
      pack-and-install harness rests on; do not carry it as a belief.

## 3. The boundary checker

- [x] 3.1 Create `script/check-package-boundary.mjs` following the house idiom: shebang, a header
      comment stating what it proves and why it is asserted this way, `REPO_ROOT` from
      `fileURLToPath`, file discovery via
      `git ls-files -z --cached --others --exclude-standard`, a `RULES` array of
      `{ id, description, why, ... }`, a pure `scan()` used by both the live run and the controls,
      per-rule `PASS`/`FAIL` lines, a per-violation report with the rule's `why`, and `clean` on
      success.
- [x] 3.2 Implement ownership resolution: parse `boundary.json`, longest-prefix match with
      file-level overrides, and a **self-guard that exits `2`** if any ownership entry claims a
      declared shell path or if any tracked source file under `apps/web/src` resolves to no owner.
- [x] 3.3 Implement `acyclic-direction`: resolve every `import` / `export … from` / `require()` /
      dynamic `import()` specifier (alias `@/` → `apps/web/src/`, plus relative resolution), map
      both ends through ownership, and fail any edge to an equal-or-higher layer. Exclude
      consumer↔consumer edges, which `check-host-composition.mjs` already owns.
- [x] 3.4 Implement `no-elftia-import` per design D7: match specifiers `elftia`, `elftia/*`,
      `@elftia/*` and `^elftia-plugin-`; dependency names in every `package.json` and package
      identifiers in `bun.lock`; the protocol literals `plugin://` and `elftia://`; and the runtime
      identifiers `window.elftia`, `globalThis.elftia`, `window.native`, `window.api`,
      `CapabilityBroker`, `ArtifactRuntime`, `ArtifactRef`. **Match specifiers, dependency names and
      identifiers only — never raw file text.** State in the header that there is no
      `adapter-elftia` exception and why.
- [x] 3.5 Implement `react-free-base`: no file owned by layer 0 or layer 1 imports `react`,
      `react-dom`, a DOM global, or a module owned by layer 2. Use identifier-level matching for the
      DOM globals — `editor/contracts/draft` and `editor/contracts/engine` name a local variable
      `document`, so a `document.` text scan produces false hits in the very package this rule
      exists to protect.
- [x] 3.6 Implement `public-entry-only` and `no-internal-reexport` over files under `packages/`,
      resolving declared subpaths from each manifest's `exports`. Report `0 files scanned` for both
      while `packages/` holds no source, and make that census line explicit output rather than a
      silent `PASS`.
- [x] 3.7 Implement the fail-closed census: each of the three live rules refuses to report a pass on
      an empty scan set and exits `2`.
- [x] 3.8 Implement `--negative-control`: synthesise one violation per rule against `scan()` and
      assert each fires. Implement `--converse-control`: synthesise a legal downward edge, a
      declared-entry import, an Elftia mention in prose, and a React import inside layer 2, and
      assert each stays silent. Exit non-zero if any control misbehaves.
- [x] 3.9 Add `"check:packages": "node script/check-package-boundary.mjs"` to the root
      `package.json` scripts, beside the existing `check:wasm`.

## 4. Verification

- [x] 4.1 Run `node script/check-package-boundary.mjs` and record its output. Expected: every live
      rule `PASS`, the cross-package edge census reported, `public-entry-only` and
      `no-internal-reexport` reporting `0 files scanned`, exit `0`.
- [x] 4.2 Run `--negative-control` and `--converse-control` and record both outputs.
- [x] 4.3 Prove the negative control is not self-referential: temporarily add a real inverted import
      (a layer-1 file importing a layer-2 module), confirm the live run fails with the offending
      path, then revert and confirm it passes again. Record both runs.
- [x] 4.4 Re-run the existing static checkers that need no build and confirm all remain green;
      confirm `check-distributable-boundary.mjs` still carries `no-desktop-app` unmodified.
- [x] 4.5 Run `git ls-files --eol $(git diff --name-only)` over every touched file and confirm LF.
      Editing tooling on this machine flips files to CRLF.

## 5. Documentation and hand-forward

- [x] 5.1 Add a package-boundary section to `BOUNDARIES.md`: the three packages and their layer
      order, the measured evidence that settled the count (the 8/0 contracts↔ports asymmetry and
      the five bidirectional seams above it), the `editor-host.ts` ownership decision and the cycle
      it resolves, and how the checker matches Elftia identifiers rather than text.
- [x] 5.2 In that same section, write the non-coverage statement with owners: the
      "delete `adapter-elftia` and both Hosts still work" removal test belongs to Elftia-side
      integration CI in the E5/S07 era; installed-tarball resolution is P3's; no behavioural or
      parity claim is made here.
- [x] 5.3 Record the specifier rewrites P1 owes, as an explicit closed list:
      `@/editor/ports/project-store` (4 uses), `@/editor/ports/gpu-resources` (3 uses) — both
      resolvable to the package root, which already exports the symbols they take — and the four
      test-file relocations from task 1.3.
- [x] 5.4 Record the Direction-level finding: Target State §4's `provider-opencut-classic` /
      `react-editor` sibling split is not reachable by extraction alone, with the edge counts that
      show it, and the recommendation that it be raised against Roadmap M9/S09 rather than absorbed
      into S05.

## 6. Ship

- [x] 6.1 Stage explicit pathspecs only. Assert
      `git diff --cached --name-only | grep -c '^\.rasen/'` is `0` before committing — `.rasen/` is
      not gitignored in this repository.
- [x] 6.2 Commit locally. **Ship mode is local (commit only); do not push.** The portfolio delivers
      once, at the parent, after all seven children complete.
