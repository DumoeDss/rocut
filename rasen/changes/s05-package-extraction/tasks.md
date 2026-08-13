## 1. Gate: prove the alias replacement resolves before moving anything

- [x] 1.1 Build a throwaway two-file package under `packages/` declaring
      `"imports": { "#/*": "./src/*" }`, with one module importing the other through `#/`. Prove it
      resolves under **all four** resolvers that must agree: `bun test`, `apps/web`'s own `tsc`
      (the one `check-type-baseline.mjs` uses), Vite (`apps/vite-example`), and Next
      (`apps/web`, both webpack and Turbopack paths). Record each result.
      Done — `packages/spike-imports-probe/` built and wired into a reachable module in both hosts.
      Results: bun **FAIL**, tsc (bundler resolution) **FAIL**, Next/Turbopack **FAIL**, Next/webpack
      **FAIL**, Vite **PASS**. Full evidence, exact error text, and the mid-spike orphan-file
      correction: `evidence/gate-1-alias-resolution.md`.
- [x] 1.2 Decide the rewrite form at this gate: `#/` if 1.1 is clean, otherwise the relative-path
      rewrite described in design E2. Record the decision and its evidence; do not carry it as an
      assumption into stage 2.
      Done — 3 of 4 resolvers failed, so the `#/*` wildcard form is rejected. Stage 2 onward rewrites
      `@/x` to a computed relative path per design E2's fallback. Decision recorded in
      `evidence/gate-1-alias-resolution.md`.
- [x] 1.3 Delete the throwaway package and confirm `node script/check-package-boundary.mjs` is back
      to its pre-task output.
      Done — `packages/spike-imports-probe/` deleted, all spike wiring reverted
      (`apps/web/package.json`, `apps/web/src/app/layout.tsx`, `apps/vite-example/package.json`,
      `apps/vite-example/src/main.tsx`, `apps/web/src/spike-imports-probe-consumer.ts` removed),
      dangling `node_modules/@opencut/spike-imports-probe` symlink removed, `bun install` re-run.
      Checker output confirmed byte-identical to the documented baseline: 949 files scanned,
      341 cross-package edges, `public-entry-only` 0 specifiers examined, `no-internal-reexport`
      dormant, `no-elftia-import` 1031 files, `react-free-base` 68 files. (The cleanup `bun install`
      also registered `packages/editor-{ports,contracts,classic}` into `bun.lock` for the first
      time — those workspace packages existed via P0's manifests but were never in a committed
      lockfile; orthogonal to the gate, kept as a correct fix.)
- [x] 1.4 Capture the pre-move baseline that later tasks are measured against: the checker's full
      output (**341 cross-package edges, 949/949/1031/68 file counts, `public-entry-only`
      `0 specifiers examined`, `no-internal-reexport` dormant**), the type-baseline result, and the
      current `PARITY.md` header (**9 differences, 0 semantic, 195 leaf values**).
      Done — all three numbers confirmed exactly as documented, plus both checker controls
      (`--negative-control`: 15/15 fixtures fire; `--converse-control`: 12/12 stay silent) and the
      type baseline (3 diagnostics now vs. 13 at the pin, 0 new). Full transcript:
      `evidence/gate-1-pre-move-baseline.md`.

## 2. Teach the oracles to see `packages/` before source lands there

- [x] 2.1 Extend `ownerOfPath()` in `script/check-package-boundary.mjs` with a `packages/<dir>/src/`
      branch resolved through the **discovered** manifest names — never a hardcoded package list,
      matching the `discoverPackageDirs` precedent P0 set under BLOCKER-2.
      Done — new `PACKAGE_SOURCE_PATH_PATTERN` regex + `ownerOfPath()` branch resolves through
      `manifests.find((m) => m.dir === match[1])`, never a literal package list.
- [x] 2.2 Extend `resolveSpecifier()` to resolve `@opencut/<pkg>` and `@opencut/<pkg>/<subpath>`
      through the declared `exports` maps to a repo-relative path, and to resolve the chosen
      package-local alias form against the owning package's `src`.
      Done — new `@opencut/*` branch resolves through each manifest's declared `exports` map. The
      "package-local alias form" half is moot: gate-1 rejected `#/` in favour of relative-path
      rewrite (tasks.md 1.2), and the existing relative-path branch already resolves correctly
      against any `fromFile` root, including `packages/<dir>/src/**`, with zero code change needed.
- [x] 2.3 Extend `guardUnownedFiles()` so a `.ts`/`.tsx` file under `packages/*/src` that resolves to
      no owner is refused (`exit 2`) exactly as an unowned `apps/web/src` file is today.
      Done — `guardUnownedFiles()` now also collects `packages/*/src` `.ts`/`.tsx` files and refuses
      any that resolve to no owner via `ownerOfPath()`.
      2.1-2.3 verified together: live run + `--negative-control` (15/15) + `--converse-control`
      (12/12) all byte-identical to the 1.4 baseline (949/341/0/dormant/1031/68) — `packages/*/src`
      is currently empty, so widening the scope changed nothing observable yet, as expected.
- [x] 2.4 Audit **all 22 runnable static checkers** for `apps/web/src`-scoped scan sets. Produce a
      table listing each with either "scope follows the source" plus the edit made, or
      "deliberately Host-scoped" plus the reason. `check-next-imports.mjs` is expected to be the
      latter; do not leave any checker unlisted.
      Done — repo now has 26 `check-*.mjs` files, not 22 (a sibling change, `check-agent-evidence.mjs`,
      landed in the shared trunk after this count was written); audited all 26 rather than force-fit
      the stale count. Full table, a third classification bucket added for literal-path checkers
      whose fix is untestable before the corresponding move and is deferred to that task, and a
      cross-cutting finding (4 checkers independently reimplement `@/` resolution):
      `evidence/group-2-checker-scope-audit.md`.
- [x] 2.5 Re-scope `check-type-baseline.mjs` so the moved sources stay inside a type-checked
      program, and make the run print the number of files it type-checked. Settle the open question
      first: does `tsc` under `apps/web` still reach package sources through the workspace symlink,
      or must the program be widened explicitly? Record the measurement.
      Done — settled empirically (same discipline as gate-1): a deliberate `TS2322` planted in a
      throwaway `packages/editor-ports/src/index.ts`, imported from a reachable `apps/web/src`
      module, surfaced as a live regression with **zero** `apps/web/tsconfig.json` changes — the
      workspace symlink + declared `exports` map already puts package sources inside the program.
      No widening needed, now or for Stage B/C. Added `countTypeCheckedFiles()` (a dedicated
      `tsc --listFilesOnly` run, `node_modules` excluded from the headline count) wired into both
      the `--regenerate` and normal comparison branches. Measured: **941 repo file(s) type-checked
      now (4328 total)**, 0 new diagnostics (3 now / 13 at pin, same 7 resolved entries as 1.4).
      Full spike transcript and measurement: `evidence/group-2-type-baseline-reach.md`.
- [x] 2.6 **Control:** re-run the boundary checker and the type baseline with nothing moved. Both
      must produce output identical to task 1.4's baseline. A difference here means the scope change
      was not behaviour-preserving, and it must be resolved before any file moves.
      Done — boundary checker byte-identical to 1.4 (949/341/0/dormant/1031/68), both controls
      re-verified (14/14 negative, 12/12 converse — a correction to 1.4's "15/15" prose, not a live
      regression; see evidence). Type baseline: diagnostic counts unchanged (3/13, same 7 resolved),
      new file-count line is additive only. One real finding surfaced and contained: a stray
      `--regenerate` run (checking whether the fixture should carry a pin-side file count) produced
      32 diagnostics instead of the committed 13, root-caused to gitignored `apps/web/.next` being
      built from HEAD and linked wholesale into the reconstructed pin, whose source predates three
      routes those `.next/types` validators reference — pre-existing `reconstructPin()` fragility,
      unrelated to this group's edits. The regenerated fixture was reverted immediately
      (`git checkout -- script/fixtures/type-baseline.json`, confirmed clean) and never used for any
      recorded measurement. Full account: `evidence/group-2-control-rerun.md`.

## 3. Stage A — extract `@opencut/editor-ports` (18 files)

- [x] 3.1 `git mv` `apps/web/src/editor/ports/**` → `packages/editor-ports/src/**`, and
      `apps/web/src/editor/host/editor-host.ts` → `packages/editor-ports/src/host/index.ts`
      (the path `./host` already declares).
      Done — 18 files moved (confirmed as `R` rename entries in `git diff --staged -M`, not
      untracked add+delete pairs). `editor-host.ts` landed at `host/index.ts` as the declared entry.
- [x] 3.2 Rewrite intra-package `@/` specifiers to the form chosen at 1.2. Rewrite the ports
      package's reference to `../host/editor-host` to its new internal location, preserving the
      frozen `NavigationHost` re-export exactly as written.
      Done — 3 intra-package specifiers rewritten to relative form; `NavigationHost` re-export
      byte-identical (diffed against HEAD, zero change to that line).
- [x] 3.3 Rewrite every incoming specifier repo-wide (~157 edges): `@/editor/ports`,
      `@/editor/ports/in-memory`, `@/editor/ports/in-memory/host`, `@/editor/host/editor-host` →
      the declared `@opencut/editor-ports` entries. Discharge the two known debts here:
      `@/editor/ports/project-store` (4 uses) and `@/editor/ports/gpu-resources` (3 uses) both
      become the package root, which already exports every symbol they take.
      Done — 103 files touched (plus the 18 renamed files' own headers), 168 line replacements
      staged. The two documented debt discharges (`project-store`, `gpu-resources` → package root)
      are intentional and are now allowlisted by name in `script/check-resolution-equivalence.mjs`
      rather than silently accepted — anything else landing on the barrel still fails the check.
- [x] 3.4 Update `packages/boundary.json` ownership entries whose `path` no longer exists, keeping
      each `why` intact and adding the new location.
      Done — entries repointed to `packages/editor-ports/src/**`; `why` text unchanged.
- [x] 3.5 Full verification pass: boundary checker (edge census must not collapse), type baseline,
      `bun test` over the ports suites, and the resolution-equivalence check from task 6.1.
      Done, all four green:
      - boundary checker: 5/5 rules PASS (949 files scanned, 341 cross-package edges, 157
        `@opencut/*` specifiers, 17 entry files, 1032 total).
      - type baseline: 941 repo files type-checked (4328 incl. lib/deps) — an exact match to the
        pre-move baseline, after widening `apps/web/tsconfig.json`'s `include` with
        `../../packages/*/src/**/*.ts(x)` (see finding below). 3/13 diagnostics, zero regressions.
      - `bun test packages/editor-ports/src`: 28 pass, 0 fail, 179 `expect()` calls.
      - resolution-equivalence check (task 6.1, built early — see below): 72 specifiers examined,
        2 allowed (the task-3.3 debt discharge), 0 mismatches, 0 dangling. PASS.

      **Findings carried forward for Group 9 (P3/P7 handoff):**
      1. `apps/web/tsconfig.json`'s directory-scoped `include` glob does not reach a file with zero
         importers once that file moves outside `apps/web/`. Three orphan leaf files
         (`packages/editor-ports/src/__tests__/{conformance.test.ts,port-roles.compile-guard.ts,
         runtime-graphics-query.compile-guard.ts}`) fell out of the type-check program silently —
         `tsc` doesn't error on a file it never sees, so this only surfaced as a file-count mismatch
         (938 vs. 941), not a diagnostic. This qualifies (does not contradict) task 2.5's finding
         that transitively-reached files need no tsconfig changes: it's specifically files with NO
         importer, reached only by directory glob before the move, that need the widened include.
         Stage B and C will need the same include entries already added — no further widening
         should be needed since the glob is already package-root-relative, not per-package.
      2. Three CRLF-reintroduction near-misses this Slice, from three different tools: `git mv`
         (none — clean), a `cp` from a `/tmp`-backed backup file (100%-changed diff, fixed via
         `sed -i 's/\r$//'`), and — reconfirmed clean this time — the Edit tool's own surgical
         insertion (0 CR before and after). The standing discipline (diff against `git show HEAD:$f
         | tr -dc '\r' | wc -c` before trusting any restored/edited file) caught the `cp` case
         immediately; it would not have been visible from `git diff --stat` alone.
      3. `script/check-resolution-equivalence.mjs` (design E8, task 6.1) was built and debugged
         against Stage A rather than deferred to Group 6, per design's "runs at every stage above,
         not only here." Three real bugs were found and fixed while building it, each a distinct
         failure mode worth naming for whoever re-reads it before the Group 6 full-scale run: (a)
         confusing "genuinely dangling" with "specifier form not recognised" collapsed to a single
         silent-false-PASS state (0 real checks, 72/72 misreported as skipped); (b) a single Map
         reused for two opposite-direction lookups (new→old vs. old→new) silently fell back to
         wrong values via `?? fallback`, producing a worse-looking but *more informative* 72/72
         false-FAIL that led straight to the real bug; (c) `existsSync()` alone matches a directory,
         not just a file — the ports package's own `./host` / `../host` relative imports were
         probed against the bare `host` directory before the `/index.ts` suffix was ever tried,
         requiring `statSync(...).isFile()` on every resolution candidate. The script is unmodified
         and ready to run again at Stage B, C, and the full Group 6 rewrite.

## 4. Stage B — extract `@opencut/editor-contracts` (54 files)

- [ ] 4.1 `git mv` `apps/web/src/editor/contracts/**` → `packages/editor-contracts/src/**`,
      matching the declared entry paths (`./conformance`, `./draft`, `./draft/conformance`,
      `./engine`, `./engine/invariant`, `./engine/conformance`, `./vectors`, `./vectors/drivers`).
- [ ] 4.2 Rewrite the 16 contracts→ports edges to `@opencut/editor-ports` entries, and the intra-
      package aliases to the chosen form.
- [ ] 4.3 Relocate `contracts/vectors/__tests__/agent-opencut-projection.test.ts` to the
      `@opencut/editor-classic` tree per `boundary.json`, since its subject is the Classic
      projection. It cannot stay in the contracts package without making an upward edge.
- [ ] 4.4 Rewrite incoming specifiers repo-wide: `@/editor/contracts`, `@/editor/contracts/engine`,
      `@/editor/contracts/vectors` and `@/editor/contracts/engine/invariant` → the declared entries.
      **`engine/invariant` is a declared entry, not a rewrite to the root** — `engine/index.ts` does
      not re-export it and `surface-transaction-binding.ts` consumes `validateTransactionDocument`
      in production.
- [ ] 4.5 Full verification pass, as 3.5, plus the four contracts conformance suites.

## 5. Stage C — extract `@opencut/editor-classic` (791 files) and author the public entries

- [ ] 5.1 `git mv` the remaining package-owned tree into `packages/editor-classic/src/**`,
      **mirroring the existing directory shape** so every intra-package relative import survives
      byte-identical (design E1).
- [ ] 5.2 Move `editor/surface/surface.css` to `packages/editor-classic/src/surface/surface.css`,
      the path `./surface.css` already declares, and rewrite its importers.
- [ ] 5.3 Author the eleven new barrels at the declared entry paths — `src/surface/index.ts`,
      `src/session/`, `src/runtime/`, `src/browser/`, `src/storage/`, `src/renderer/`, `src/ui/`,
      `src/evidence/`, `src/project/`, `src/media/`, `src/fonts/` — each re-exporting from the
      mirrored internals with relative specifiers. `src/timeline/index.ts` already exists and takes
      on double duty; confirm it exports what consumers need rather than replacing it.
- [ ] 5.4 Rewrite the package's intra-package `@/` specifiers to the chosen form (the bulk of the
      2,179 occurrences), and its outgoing edges to `@opencut/editor-ports` / `-contracts` entries.
- [ ] 5.5 Relocate `editor/host/__tests__/{branding-assets,production-composition}.test.ts` and
      `services/storage/__tests__/c5-storage-red-controls.test.ts` into the `apps/web` tree per
      `boundary.json` — their subject is the Next Host composition.
- [ ] 5.6 Adjudicate the twelve shell-only ownership candidates per design E5. Recommended default:
      correct `env/web` and `changelog/utils` to `apps/web`; keep the eight `components/ui/*` atoms
      in the package behind `./ui`; decide the two dialogs on caller evidence. Record every
      correction as a `boundary.json` diff with an updated `why`, and record every rejection too.
- [ ] 5.7 Full verification pass, as 3.5.

## 6. Rewire the consumers and delete the alias

- [ ] 6.1 Implement the resolution-equivalence check (design E8): for every rewritten specifier, the
      module it resolves to after the rewrite equals the module it resolved to before, compared as
      repo-relative paths across the rename map. Run it over all 2,179 rewrites and record the
      result. This runs at every stage above, not only here.
- [ ] 6.2 Rewire `apps/web`'s 53 distinct classic targets (103 edges) and 3 ports targets (9 edges)
      onto declared entries, following design E4's mapping table.
- [ ] 6.3 Rewire `apps/vite-example`'s 43 classic targets (59 edges), 4 ports targets (8 edges) and
      1 contracts target onto declared entries.
- [ ] 6.4 Delete the `@` → `../web/src` alias from `apps/vite-example/vite.config.ts` and
      `apps/vite-example/tsconfig.json`. **This deletion is the visible form of spec §3.2's "the
      alias removal visible in the diff"** — confirm no alias remains anywhere in the example.
- [ ] 6.5 Configure `apps/web` to consume source-shipped workspace packages (`transpilePackages` or
      the Turbopack equivalent). Settle whether both the webpack and Turbopack paths need it; the
      Next Host is the parity reference, so this must be right before the parity run, not after.
- [ ] 6.6 Record the entry-mapping table (which consumer module routes through which declared entry)
      in `BOUNDARIES.md`. If any entry had to be added, record the module that forced it.

## 7. Prove the two vacuous rules now fire

- [ ] 7.1 `public-entry-only` probe: add to an `apps/vite-example` source file an import of
      `@opencut/editor-classic/src/timeline/timeline-store` — an undeclared subpath of a real
      module. Run the **live** check. Expect `FAIL [public-entry-only]`, exit `1`. Record the output.
- [ ] 7.2 Revert 7.1, re-run, and confirm exit `0` **with a non-zero `@opencut/* specifiers
      examined` count**. The non-zero count is the assertion; a pass with zero examined is the
      vacuous state this child exists to end.
- [ ] 7.3 `no-internal-reexport` probe: in the declared entry file
      `packages/editor-classic/src/surface/index.ts`, add
      `export * from "@opencut/editor-ports/in-memory/internals";`. Run the live check. Expect
      `FAIL [no-internal-reexport]`, exit `1`. Record the output.
- [ ] 7.4 Revert 7.3, re-run, and confirm the rule reports a **pass over a non-zero scan** — never
      the dormant `0 files scanned` line again. If it still prints dormant, the rule did not
      activate and this child is not done.
- [ ] 7.5 `acyclic-direction` scope proof: confirm the post-move edge census is of the same order as
      the pre-move **341**. A collapse is a scope regression even when the rule prints `PASS`.
      Record the before and after numbers side by side.
- [ ] 7.6 Run `--negative-control` and `--converse-control` and confirm both still behave, so the
      scope changes in group 2 did not weaken the controls P0 built.

## 8. Prove behaviour did not move

- [ ] 8.1 Run the parity spec on both Hosts (`PARITY_SPEC=parity` × `PARITY_HOST=vite|next`) and
      diff the snapshots. **Acceptance is zero semantic rows**; any new semantic row is an
      extraction defect, never an accepted update.
- [ ] 8.2 Run the agent spec on both Hosts (`PARITY_SPEC=agent`) and diff.
- [ ] 8.3 Regenerate `PARITY.md` and confirm the header still reads 0 semantic differences with the
      same incidental classification. Attribute any change in the leaf-value count.
- [ ] 8.4 Run `check-type-baseline.mjs`; confirm no new diagnostic and record the type-checked file
      count against task 2.5's expectation.
- [ ] 8.5 Run every runnable static checker and confirm all are green, including
      `check-distributable-boundary.mjs` with its `no-desktop-app` rule intact. The example's
      production build must still emit a module graph with all ten rules passing.
- [ ] 8.6 Run `bun test` across all suites and record the result against the pre-move baseline.
- [ ] 8.7 **Frozen-signature audit:** compare the public surfaces S03+S04 froze — the transaction
      contract barrel, the engine, the ports barrel and the Surface embedding types — before and
      after. If any differs, **stop**: that is a `failed` condition for the Slice and a finding
      returned to the contract, not a fix to make here.
- [ ] 8.8 Handle `DOMAIN_DOCUMENT_MEMBERS` additions per design E7's decision procedure. Every added
      member is committed with the member name, the file that forced it, and the `*Document` type
      that proves the identifier is the domain document rather than the DOM one. An identifier whose
      type cannot be named is a DOM leak, and the fix is renaming the binding.

## 9. Documentation and hand-forward

- [ ] 9.1 Update `BOUNDARIES.md`: replace §2's "not a published API / reaches in through a path
      alias" statement, add the entry-mapping table from 6.6, and record the checker-scope audit
      from 2.4.
- [ ] 9.2 Record for **P7** that 863 `git mv` renames restate `SOURCE_INVENTORY.{md,json}`
      wholesale — the generator derives fork additions from `git diff --name-status` against the
      upstream pin, so its output after this child bears no resemblance to its output before.
- [ ] 9.3 Record for **P3** the exact form the packages ship in (TypeScript from `./src`, no build
      step, package-local alias declared in the manifest), since that is what `npm pack` will place
      in the tarball and what must resolve in a scratch project outside the monorepo.
- [ ] 9.4 Record any ownership corrections and any export-map additions as findings, with the
      evidence that forced each.

## 10. Ship

- [ ] 10.1 Verify line endings across the whole change with `git ls-files --eol`, **per stage rather
      than once at the end** — this batch is large enough that a late CRLF discovery is expensive.
- [ ] 10.2 Stage explicit pathspecs. Assert `git diff --cached --name-only | grep -c '^\.rasen/'` is
      `0` before committing — `.rasen/` is not gitignored in this repository.
- [ ] 10.3 Verify rename detection with `git diff --cached -M --summary` so the move is attributable
      rather than recorded as 863 deletes and 863 adds.
- [ ] 10.4 Commit locally. **Ship mode is local; do not push.** The portfolio delivers once, at the
      parent, after all seven children complete.
- [ ] 10.5 The moment the review loop goes clean, write `{"kind":"standDown"}` to every parked
      worker's `<changeRoot>/signals/<role>.json` and confirm `signals/.state/` is empty **before**
      planning the archive. A live heartbeat inside the change directory makes archive ESTALE
      failures unrecoverable by retry.
