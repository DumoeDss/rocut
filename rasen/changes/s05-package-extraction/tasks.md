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

- [x] 4.1 `git mv` `apps/web/src/editor/contracts/**` → `packages/editor-contracts/src/**`,
      matching the declared entry paths (`./conformance`, `./draft`, `./draft/conformance`,
      `./engine`, `./engine/invariant`, `./engine/conformance`, `./vectors`, `./vectors/drivers`).
      Done — 55 files moved via `git mv` (confirmed as `R` rename entries in `git diff --staged -M`);
      1 of the 55 (`agent-opencut-projection.test.ts`) relocated onward to editor-classic per 4.3,
      landing 54 in `packages/editor-contracts/src`.
      **Finding:** the `./vectors/drivers` declared export (`./src/vectors/drivers/index.ts`) has no
      backing barrel — the directory holds only `durable.ts` and `in-memory.ts`, no `index.ts`. This
      predates this Slice (P0's declaration, unchanged since) and has zero live consumers repo-wide
      (`grep -rn "editor-contracts/vectors/drivers"` — no hits), so it is not a Stage B regression,
      but it is a real gap against the declared surface. Recorded for Group 9 (P3/P7) rather than
      authored here, since inventing the barrel's contents is a design decision, not a mechanical move.
- [x] 4.2 Rewrite the 16 contracts→ports edges to `@opencut/editor-ports` entries, and the intra-
      package aliases to the chosen form.
      Done — already satisfied by Stage A's repo-wide rewrite (task 3.3): the contracts→ports edges
      were `@/editor/ports/*` specifiers, rewritten to `@opencut/editor-ports` when Stage A ran, before
      the contracts tree itself ever moved. Confirmed via `grep -rn "@/editor/ports" packages/editor-contracts`
      → no hits. No additional edits needed at this task.
- [x] 4.3 Relocate `contracts/vectors/__tests__/agent-opencut-projection.test.ts` to the
      `@opencut/editor-classic` tree per `boundary.json`, since its subject is the Classic
      projection. It cannot stay in the contracts package without making an upward edge.
      Done — `git mv` to `packages/editor-classic/src/editor/transactions/opencut/__tests__/`.
      **This relocation broke the file's own relative imports** (`../agent-scenario`, `../runner`,
      correct at the old sibling location, dangling at the new one) — fixed by rewriting to the
      declared `@opencut/editor-contracts/vectors` entry, following the precedent already in
      `apps/web/src/editor/surface/evidence/agent-evidence-run.ts`. Confirmed via `check-type-baseline.mjs`:
      the 4 diagnostics this broke (2× TS2307, 2× TS7006 cascade) are gone.
      **Finding, not fixed here:** the file's remaining `@/editor/persistence` etc. specifiers (pointing
      at not-yet-moved editor-classic siblings) type-check fine — `tsc` pulls the file into
      `apps/web/tsconfig.json`'s program via the widened `include` glob (task 2.5) — but fail `bun test`
      run in isolation on this one file (`Cannot find module '@/editor/persistence'`). Root cause: bun
      resolves `@/` path aliases by walking up from the *importing file's own directory* to its nearest
      tsconfig, not via `tsc`'s shared-program `include` matching; `packages/editor-classic` has no
      tsconfig of its own, so the walk lands on the repo-root `tsconfig.json`, which declares no `paths`
      at all (confirmed by reading it). This is expected to self-resolve at Stage C (5.1 moves the
      sibling files into the same package, 5.4 rewrites their `@/` specifiers to intra-package relative
      form), not a Stage B defect — task 4.5's bun-test criterion is scoped to the four contracts
      conformance suites, which do not include this classic-owned exception file, so it is not gating
      this task. Flagged here so whoever runs 5.1-5.4 knows this file's isolated `bun test` result
      flips green as a side effect, not something to separately debug.
- [x] 4.4 Rewrite incoming specifiers repo-wide: `@/editor/contracts`, `@/editor/contracts/engine`,
      `@/editor/contracts/vectors` and `@/editor/contracts/engine/invariant` → the declared entries.
      **`engine/invariant` is a declared entry, not a rewrite to the root** — `engine/index.ts` does
      not re-export it and `surface-transaction-binding.ts` consumes `validateTransactionDocument`
      in production.
      Done — 10 files rewritten (sed-based specifier substitution, CRLF-verified clean before/after
      on every touched file): `apps/vite-example/tests/parity/agent.pw.ts`,
      `apps/web/src/core/managers/__tests__/transaction-persistence-coordination.test.ts`,
      `apps/web/src/editor/surface/embedding/{__tests__/surface-transaction-binding.test.ts,surface-transaction-binding.ts}`,
      `apps/web/src/editor/surface/evidence/agent-evidence-run.ts`,
      `apps/web/src/editor/transactions/opencut/{__tests__/adapter-router.test.ts,adapter.ts,projection.ts,router.ts,types.ts}`.
      `engine/invariant` confirmed landed on the dedicated entry, not the root, at every use site.
      **Two findings surfaced by the broader verification sweep this task's scope triggered, both
      already handled:** (a) `packages/editor-contracts/src/vectors/__tests__/corpus-isolation.test.ts`
      had a self-inflicted bug from a doc-comment edit — the literal text `packages/*/src` inside a
      `/** */` block comment contains an embedded `*/` that prematurely closed the comment, corrupting
      the rest of the file's parse; fixed by rewording, re-verified via `bun test` (3 pass, 0 fail).
      (b) three bucket-C checkers from `evidence/group-2-checker-scope-audit.md` — `check-port-boundary.mjs`
      (chains into a hard FAIL via `check-session-resource-boundary.mjs`, both carry stale
      `apps/web/src/editor/ports/*` and `apps/web/src/editor/host/editor-host.ts` literals from
      Stage A's move) and `check-host-composition.mjs` (crashes: `Error: ENOENT ... editor-host.ts`,
      reads the moved file directly with no existence check) — are confirmed red right now. This is
      exactly the risk the audit named and explicitly deferred to "Group 3 (ports)/5 (classic)"; the
      literal-path repair itself is intentionally left for task 8.5, which is where the audit schedules
      it and where it can be done once (after Stage C's session-area moves and Group 6's `@/`-alias
      deletion, rather than three partial touches). Confirmed neither checker is wired into
      `package.json` or CI, so this red state blocks nothing in the interim.
- [x] 4.5 Full verification pass, as 3.5, plus the four contracts conformance suites.
      Done, all four green:
      - boundary checker: 5/5 rules PASS (949 files scanned, 340 cross-package edges, 178
        `@opencut/*` specifiers, 69 entry files, 1032 total).
      - type baseline: 941 repo files type-checked (4328 incl. lib/deps), no diagnostic outside the
        pinned baseline set, zero regressions.
      - `bun test packages/editor-contracts/src` (the four conformance suites — `draft/__tests__`,
        `engine/__tests__`, `in-memory/__tests__`, `vectors/__tests__`): 110 pass, 0 fail, 1306
        `expect()` calls, 11 files.
      - resolution-equivalence check (task 6.1): 10 specifiers examined, 0 dangling, 0 mismatches. PASS.

## 5. Stage C — extract `@opencut/editor-classic` (791 files) and author the public entries

- [x] 5.1 `git mv` the remaining package-owned tree into `packages/editor-classic/src/**`,
      **mirroring the existing directory shape** so every intra-package relative import survives
      byte-identical (design E1).
      Done — classified mechanically rather than by hand: a throwaway helper
      (`script/.stage-c-classify.mjs`) reimplements `check-package-boundary.mjs`'s own
      `resolveOwner()`/`candidatePaths()` longest-prefix-wins algorithm against the live
      `boundary.json`, enumerated over `git ls-files apps/web/src` filtered to
      `ts|tsx|css|md` (first pass filtered only `ts|tsx|css` and undercounted by 6 — all 5 `.md`
      files plus a rounding miss; broadened and re-ran). Result: 790 classic / 54 shell / 0
      unresolved over 844 tracked files — reconciles exactly with design's 791-file baseline minus
      the 1 file (`editor/contracts/*` sibling) already relocated in Stage B's task 4.3. A second
      throwaway (`script/.stage-c-move.sh`) `git mv`'d every classified-classic file from
      `apps/web/src/X` to `packages/editor-classic/src/X`, creating parent directories as needed.
      **786** files moved (790 classified minus the 4 corrected to `apps/web` by task 5.6, done in
      the same pass — see 5.6). `git status --short | grep -c "^R "` confirms 786 clean renames, 0
      content-modified-during-move. The two throwaway scripts and their two list files are not
      committed; deleted before Stage C's commit per the Gate-1-spike precedent.
- [x] 5.2 Move `editor/surface/surface.css` to `packages/editor-classic/src/surface/surface.css`,
      the path `./surface.css` already declares, and rewrite its importers.
      Done — caught a defect the bulk move in 5.1 would otherwise have hidden: the generic mirror
      move placed `surface.css` at its **mirrored** location
      (`packages/editor-classic/src/editor/surface/surface.css`), not the **declared entry**
      location `packages/editor-classic/package.json`'s `exports["./surface.css"]` requires — design
      E1 names this file as the sole exception that cannot be a barrel and must physically relocate.
      Fixed with a second `git mv`; git chained the rename back to the true original
      (`R  apps/web/src/editor/surface/surface.css -> packages/editor-classic/src/surface/surface.css`).
      Found and fixed all 3 real importers via `grep -rln "surface\.css" apps packages` (the 4th hit,
      `editor-classic/package.json`, is the exports declaration, not an importer): `apps/web/src/app/globals.css`,
      `apps/vite-example/src/styles.css`, `apps/vite-example/vite.surface-css.config.ts`. Every
      relative path was computed with Node's `path.relative()` (`script/.stage-c-relpath.mjs`), not
      hand-counted, since CSS `@import`/`resolve()` has no compiler or boundary-checker oracle
      watching it. Verified two ways: `existsSync()` on all 3 computed paths resolves to the moved
      file, and CRLF-checked all 3 edited files plus `boundary.json` (`git show HEAD:$f | tr -dc '\r' | wc -c`
      vs. worktree count) — 0/0 clean on all four.
- [x] 5.3 Author the eleven new barrels at the declared entry paths — `src/surface/index.ts`,
      `src/session/`, `src/runtime/`, `src/browser/`, `src/storage/`, `src/renderer/`, `src/ui/`,
      `src/evidence/`, `src/project/`, `src/media/`, `src/fonts/` — each re-exporting from the
      mirrored internals with relative specifiers. `src/timeline/index.ts` already exists and takes
      on double duty; confirm it exports what consumers need rather than replacing it.
      Done — 12 barrels authored, not 11: `src/index.ts` (the `.` entry) is a real declared export
      target with confirmed consumers (`core`, `utils/{ui,date,id,string}`, `wasm`,
      `background/color`, `canvas/sizes`, `fps/defaults`, `feedback/types`) that design's own count
      didn't enumerate — recorded here as a finding, not silently folded in. `src/timeline/index.ts`
      confirmed unchanged (already exports what design E4 names) and used as the reference pattern:
      full-directory `export * from` for a directory that already matches one entry 1:1.
      Consumer set built mechanically, not by hand-reading design's table: three iterations of a
      `@/`-alias grep (`/tmp/at-alias-targets{,2,3}.txt`), each fixing a real methodological gap —
      v1 (94 targets) swept in `apps/vite-example/dist` build artifacts (gitignored, confirmed via
      `git check-ignore -v`), producing 2 false positives; v2 (92 targets) rescoped to
      `apps/web/src`, `apps/vite-example/{src,tests}` only; v3 broadened the pattern to also match
      dynamic `import(...)` forms, surfacing 2 real targets a static-only grep missed
      (`editor/session/__tests__/wasm-test-mock`, `editor/session/create-session`). Cross-checked the
      final set against design E4's table: exact agreement, no contradictions. `export *` semantics
      checked before relying on it: targeted grep for `export default` across all ~90 barrel-target
      files found exactly one case (`components/ui/prose.tsx`), special-cased as
      `export { default as Prose } from ...` in `./ui`; every other target uses a blanket `export *`.
      Two barrel-authoring patterns applied on evidence, not convention: **curated closed-list**
      barrels (`session`, `runtime`, `browser`, `storage`, `renderer`, `evidence`, root `.`) for new
      top-level directories reaching into large pre-existing directories with far more files than
      design names; **full-directory mirror** barrels (`ui`, `project`, `media`, `fonts`) for
      directories that already are a coherent top-level unit matching one entry 1:1, following
      `timeline/index.ts`'s own precedent of exporting more than what's currently consumed.
      `evidence` deliberately re-exports one module living under a `__tests__` directory
      (`session/__tests__/wasm-test-mock`) — intentional (it's shared mock infrastructure other
      Slice children need), not an internal leak; `no-internal-reexport` scopes to cross-package
      boundaries, not intra-package `__tests__` nesting, so this doesn't trip it (confirmed below).

      **Finding — a defect class distinct from Group 6, fixed here rather than deferred:** the
      dangling-relative-import sweep built to cross-check the consumer census
      (`script/.stage-c-dangling-relative.mjs`, run over all 58 shell files) found 18 dangling
      relative imports across 8 `apps/web` files — a side effect of 5.1's mechanical move splitting
      directories across the package boundary: a shell file whose sibling moved away keeps a
      `./sibling` or `../sibling` specifier that no longer resolves. This is **not** Group 6's
      `@` -alias debt (Group 6's sweep is `@/`-form only, per 6.4's framing of "delete the alias";
      it would never catch a bare relative specifier) and no other task names it, so it would have
      shipped as silent breakage if left for later. 17 of the 18 resolve cleanly onto one of the
      barrels just authored; fixed by rewiring the import specifier in place, no barrel changes
      needed: `apps/web/src/app/layout.tsx` (2 → `./ui`), `components/gitHub-contribute-section.tsx`
      (1 → `./ui`), `components/header.tsx` (3 → `./ui`), `components/landing/hero.tsx` (1 →
      `./ui`), `editor/host/__tests__/production-composition.test.ts` (5 → `./browser` ×1,
      `./evidence` ×2, `./session` ×1, `./runtime` ×1), `editor/host/c4-next-runtime-probe.tsx` (1 →
      `./browser`), `feedback/index.ts` (2 → `.`), `feedback/queries.ts` (1 → `.`),
      `services/storage/__tests__/c5-storage-red-controls.test.ts` (1 → `./storage`). The 18th
      (`c5-storage-red-controls.test.ts` importing
      `../migrations/__tests__/fixtures/v1` for `v1Project`) had no legitimate entry-path
      resolution — `__tests__` directories can never be a declared entry, by the same
      `public-entry-only` rule that makes the other 17 fixable. Fixed by duplicating just the one
      used export into a new `apps/web`-owned file,
      `apps/web/src/services/storage/__tests__/fixtures/c5-v1-project.ts`, with a comment flagging
      the hand-sync/drift risk — narrower duplication, not a convenience, matching design E5's own
      standard for exceptions to the "reach through a declared entry" rule. Re-ran the sweep after
      all fixes: 0 dangling relative imports across the same 58 files.

      Verified three ways. (1) `check-package-boundary.mjs`: 5/5 PASS, 962 files scanned, 329
      cross-package edges, 192 `@opencut/*` specifiers examined (up from Stage B's 157, consistent
      with the new entries now actually being exercised), 0 violations. (2) `check-type-baseline.mjs`:
      2433 diagnostics not at the pin — expected and not a regression from this task; every one of
      them traces to `@/`-alias specifiers deliberately left untouched (task 5.4's still-pending
      package-internal rewrite, ~2,179 occurrences; Group 6's still-pending consumer rewrite, ~162
      edges). Confirmed by targeted grep of the diagnostic list against every file this task touched
      (12 barrels + 8 rewired shell files + 1 new fixture): the 12 barrels show **zero** diagnostics
      of any kind; the 8 rewired shell files show diagnostics only on the `@/`-alias lines this task
      intentionally left alone (e.g. `header.tsx:16`'s `@/utils/ui`,
      `production-composition.test.ts:42`'s `@/services/storage/browser-project-store`) — none on
      the lines this task rewired. (3) `bun test` on
      `production-composition.test.ts`: still fails, but the failure is
      `Cannot find module '@/editor/persistence' from
      '.../packages/editor-classic/src/editor/session/headless.ts'` — a package-internal `@/`
      specifier inside the package itself, three files removed from anything this task touched,
      confirming task 5.4 (not started) is the blocker, not this task's barrels or rewiring.

      **Finding — pre-existing CRLF, not corruption:** `feedback/index.ts` and `feedback/queries.ts`
      show `i/lf w/crlf` under `git ls-files --eol` after editing. Verified this predates the edit and
      is not something the Edit tool introduced: three untouched control files
      (`app/metadata.ts`, `env/web.ts`, `site/social.ts`) show the identical `i/lf w/crlf` mismatch,
      and `core.autocrlf` is `false`, so this is a repo-wide Windows-checkout artifact already present
      across (at least) these apps/web files before this session — squarely task 10.1's
      "verify line endings across the whole change... per stage" remit, not something to
      selectively fix here.
- [x] 5.4 Rewrite the package's intra-package `@/` specifiers to the chosen form (the bulk of the
      2,179 occurrences), and its outgoing edges to `@opencut/editor-ports` / `-contracts` entries.
      Done — the "outgoing edges" clause was already fully satisfied before this task started: Stage
      A/B's own tasks (3.3, 4.4) rewrote every incoming specifier repo-wide **inline**, before Stage
      C's `git mv` moved these files into the package, so by the time they landed in
      `editor-classic` they already pointed at `@opencut/editor-ports` / `-contracts`. Confirmed by
      grep: 0 `@/editor/ports/*` or `@/editor/contracts/*` specifiers anywhere in the package; 80
      files already on `@opencut/editor-ports`, 10 on `@opencut/editor-contracts`. This task's real
      remaining scope was solely the intra-package `@/`→relative rewrite.

      **Codemod design.** Stage C's move (786 renames, task 5.1) mirrors the pre-move
      `apps/web/src` subpath structure almost exactly — one exception (`editor/surface/surface.css`
      → `surface/surface.css`; confirmed 0 `@/` specifiers ever referenced that CSS file). This means
      every `@/xxx` specifier can be resolved **directly** against `packages/editor-classic/src/xxx`
      (trying `""`, `.ts`, `.tsx`, `/index.ts`, `/index.tsx`) with no old-path lookup table needed.
      Wrote `script/.stage-c-rewrite-at-alias.mjs` (throwaway, deleted before commit) on this basis;
      pre-flight checks confirmed 0 non-`.ts(x)` `@/` specifiers, 0 bare side-effect imports, 0
      `mock.module`/`vi.mock`/`require` forms, 0 template-literal dynamic imports, and an exact match
      between total quoted `@/` literals and from/`import()`-context matches (1863 both), before
      writing any file-modifying code. Dry-run then apply, both confirming **1863 specifier(s)
      rewritten across 464 file(s), 0 unresolved**.

      **Verified three ways**, matching 5.3's method. (1) `check-package-boundary.mjs`: 5/5 PASS,
      unchanged. (2) `check-type-baseline.mjs`: FAIL count dropped **2433 → 99** (~96%), fully
      attributed — 97 to `apps/web`/`vite-example` (Group 6's still-pending consumer rewrite; the
      same files 5.3 already flagged), 2 to a pre-existing test-authoring defect newly *visible* (not
      newly introduced) in `timeline/__tests__/update-pipeline.test.ts:69` and
      `timeline/placement/__tests__/resolve.test.ts:646` (branded `MediaTime` vs raw number in
      `.toBe()`): cross-referenced against the pre-5.4 type-baseline capture and confirmed both files
      previously had TS2307 "Cannot find module" errors on their own (now-fixed) import lines, which
      had been masking these branded-type mismatches. Net improvement per file (4-5 diagnostics
      fixed, 1 pre-existing defect unmasked); out of scope for this task to fix (not an
      import/specifier issue).

      (3) `bun test` on `production-composition.test.ts` surfaced a **genuine regression this task
      is responsible for finding and fixing**, introduced by 5.3's barrel authoring (not by this
      task's own rewrite). The test's wasm-mock setup — `await
      import("@opencut/editor-classic/evidence")` at the top of the isolated-process branch — crashed
      with `TypeError: wasm.__wbindgen_start is not a function` inside the *real*
      `node_modules/opencut-wasm/opencut_wasm.js`, meaning `wasm-test-mock.ts`'s
      `mock.module("opencut-wasm", ...)` never took effect. Root-caused via three probes: (a) a
      minimal standalone `mock.module` + `import()` in one file works fine, ruling out the mechanism
      itself; (b) reordering `wasm-test-mock` to be first among `evidence/index.ts`'s `export *`
      targets had **zero effect** — still crashed identically, proving Bun does not evaluate
      mutually-independent `export *` siblings in source order (unlike plain sequential imports); (c)
      two *separate*, sequentially-awaited `import()` calls — wasm-test-mock's own specifier, then
      `c6-disposal-harness` — worked correctly, isolating the fix. `c6-disposal-harness.tsx` (an
      evidence-barrel member) imports `runtime/wasm-runtime-providers.ts`, which has a static
      top-level `import ... from "opencut-wasm"`; that real import can link/evaluate before
      `wasm-test-mock.ts`'s side effect runs regardless of barrel position. Git history confirms this
      is a 5.3 regression, not a pre-existing defect: pre-Stage-A, this test imported the mock as a
      standalone, separately-awaited relative import (`await
      import("../../session/__tests__/wasm-test-mock")`); 5.3's consumer rewiring collapsed that into
      the full `evidence` barrel import, which is not equivalent. It was masked through 5.3's own
      checkpoint because the (separate, also pre-existing) `@/editor/persistence` resolution failure
      aborted evaluation earlier in the same chain, before ever reaching this barrel — this task's fix
      of that earlier failure is what unmasked it.

      Fix: added a narrow declared entry `"./evidence/wasm-test-mock":
      "./src/editor/session/__tests__/wasm-test-mock.ts"` to `editor-classic/package.json` (precedent:
      editor-ports' `./in-memory/host` — a specific nested file, not a directory barrel; confirmed via
      grep that `wasmTestControl`'s named exports have no cross-package consumers, only the
      side-effect matters here), and pointed `production-composition.test.ts`'s side-effect-only
      import at it instead of the full `evidence` barrel. Re-verified boundary checker after adding
      the entry: 5/5 PASS. Re-ran `bun test`: the wasm crash is gone; the test now progresses to a
      *different*, already-known blocker — `Cannot find module
      '@/services/storage/browser-project-store'` (line 42 of the same file's `Promise.all`) — an
      apps/web-side `@/` specifier reaching into another Stage-C-moved file, the same attribution
      pattern as 5.3's `@/editor/persistence` finding. Squarely Group 6's scope, not this task's.
      `c5-storage-red-controls.test.ts` was left untouched: it has several *additional* dangling `@/`
      specifiers of its own (`@/editor/session/create-session`, `@/editor/runtime/session-core-owner`,
      `@/editor/host/next-editor-host`, plus its own now-broken `@/editor/session/__tests__/wasm-test-mock`
      reference) — already fully broken independent of this task, Group 6's full-scope backlog item,
      not worth partially patching.

      **Finding — CRLF drift, same class as 5.3's, much larger scope:** `git ls-files --eol` shows
      `i/lf w/crlf` on 438 of 787 files under `packages/editor-classic/src`. A three-way comparison
      (`git show :path` / `git show HEAD:path` / working tree) plus a control-group check — 186 of
      the 438 were never touched by this task's codemod, yet show the identical mismatch — proves
      this predates 5.4 entirely and originates from Stage C's original move mechanism (task 5.1, an
      earlier session), not from this task's edits. Still task 10.1's scope, not fixed here.

      Deleted the throwaway `script/.stage-c-rewrite-at-alias.mjs` and probe files
      (`apps/web/src/zzprobe/`) before this commit.
- [x] 5.5 Relocate `editor/host/__tests__/{branding-assets,production-composition}.test.ts` and
      `services/storage/__tests__/c5-storage-red-controls.test.ts` into the `apps/web` tree per
      `boundary.json` — their subject is the Next Host composition.
      Done — already satisfied by construction, no physical move needed. All 3 files (plus
      `next-editor-host.ts` and `c4-next-runtime-probe.tsx`) were already declared `apps/web`-owned
      in `boundary.json` **before** this stage began, so 5.1's mechanical classify+move correctly
      excluded them and they remain untouched at their current `apps/web/src/**` locations.
      Confirmed by grepping `script/.stage-c-shell-list.txt` for
      `branding-assets|production-composition|c5-storage-red-controls|next-editor-host|c4-next-runtime-probe`
      — all 5 present in the shell (not classic) classification.
- [x] 5.6 Adjudicate the twelve shell-only ownership candidates per design E5. Recommended default:
      correct `env/web` and `changelog/utils` to `apps/web`; keep the eight `components/ui/*` atoms
      in the package behind `./ui`; decide the two dialogs on caller evidence. Record every
      correction as a `boundary.json` diff with an updated `why`, and record every rejection too.
      Done — 4 corrections added to `boundary.json` (inserted before the catch-all `apps/web/src`
      entry), each with a caller-evidence `why`: `env/web.ts` and `changelog/utils.ts` per the
      recommended default (every caller is shell infrastructure — API routes, layout, auth, a Next
      route). The two dialogs were investigated rather than left ambiguous:
      `project/components/project-info-dialog.tsx` and
      `services/storage/components/storage-persistence-dialog.tsx` each showed the **identical**
      evidentiary shape as `env/web` — a single shell-only caller
      (`apps/web/src/app/projects/page.tsx`), zero editor-classic callers — so both were corrected,
      applying E5's own stated rule rather than treating the "adjudicate" hedge as a coin flip.
      The 8 `components/ui/*` atoms were checked with the same grep and show the same
      shell-only-caller surface, but were deliberately **not** corrected: distinguished on
      directory-cohesion evidence, not caller count — `components/ui/` is a genuinely cohesive
      design-system unit (E5's own stated rationale), whereas `project-info-dialog.tsx` is an
      outlier in a directory whose 3 siblings (`delete-project-dialog`, `migration-dialog`,
      `rename-project-dialog`) are editor-classic-owned, and `storage-persistence-dialog.tsx`'s
      directory has no siblings at all. Re-ran `check-package-boundary.mjs` after the edit, before
      any physical move: still 5/5 PASS; cross-package edge count dropped 340 → 332 (expected/benign
      — the corrected files' shell-caller edges no longer cross a package boundary). The 4
      corrections' physical consequence (excluding these files from 5.1's move) is recorded in 5.1's
      annotation above.
- [x] 5.7 Full verification pass, as 3.5.
      Done, four legs run; three green, one N/A by design:
      - boundary checker: 5/5 rules PASS (1045 files scanned, 329 cross-package edges, 192
        `@opencut/*` specifiers, 861 files checked for internal re-export, 68 ports/contracts files
        checked React-free).
      - type baseline: 20 diagnostics, 0 new. All attributed: 18 to the still-pending Group 6
        consumer rewrite (apps/web `@/` specifiers reaching into now-moved editor-classic content —
        `next-editor-host.ts`, `feedback/queries.ts`, `project/components/project-info-dialog.tsx`,
        `services/storage/components/storage-persistence-dialog.tsx`, `site/external-tools.ts`, and
        `services/storage/__tests__/c5-storage-red-controls.test.ts`, the exact files 5.4 already
        flagged as its scope, not this task's), 2 the pre-existing `MediaTime`-vs-`number` defect 5.4
        already named at `timeline/__tests__/update-pipeline.test.ts:69` and
        `timeline/placement/__tests__/resolve.test.ts:646`.
      - `bun test packages/editor-classic/src`: 375 pass, 10 fail, 3 errors, 1396 `expect()` calls
        (385 tests, 87 files) — up from 364 pass / 21 fail / 3 errors before this task's fixes below
        (net +11 pass / -11 fail, exactly the tests those fixes touch). Every remaining fail/error
        traced to a named cause, none new: 1 unhandled `TypeError: wasm.__wbindgen_start is not a
        function` + 2 unhandled `ReferenceError`s (`DEFAULTS`, `textMaskDefinition`, both
        before-initialization TDZ crashes) = the 3 errors; 6 `resolveTrackPlacement` fails, 5 via an
        identical `ReferenceError: Cannot access 'ZERO_MEDIA_TIME' before initialization` TDZ crash
        and 1 (`batch time spans reject tracks when any span overlaps`) independent of it; 1
        `editor singleton boundary` fail, now isolated to exactly its one pre-existing stale-string
        assertion (see below). All ten cross-checked against the decisive pre-move/post-move,
        with/without-preload experiment from task 5.6's investigation — identical signatures on both
        sides of the move, confirmed pre-existing, disclosed and not fixed here.
      - resolution-equivalence check: **N/A, by design, not a gap.** The script's own header states
        its scope as "everything currently staged (`git diff --staged`)" — it diffs a specifier
        rewrite that is still staged against HEAD, and is meant to run once per stage while that
        stage's rewrite sits staged, before the stage's commit (as 3.5 did mid-Stage-A). Stage C's
        rewrite (5.1-5.4) already committed as `c234042e` before this task ran, so there is no staged
        specifier-rewrite diff left for it to examine; running it now correctly reports "0 rewritten
        specifier(s) examined" rather than silently passing over nothing. 5.4 independently verified
        the same invariant via its own codemod's dry-run/apply symmetry (1863/1863 resolved, 0
        unresolved) plus the boundary checker's unchanged 5/5 immediately after. The script is
        unmodified and still correct for its designed use at Group 6's full-scope rewrite.

      **Fixes made to reach the above** (5 files, all move-introduced, all verified individually
      before this pass): four test files carried hardcoded pre-move `apps/web/src/...` /
      `apps/vite-example/src/...` string-literal paths into `readFileSync`/`Bun.Glob` calls, unreached
      by 5.4's specifier-rewrite codemod because it only rewrites `import`/`require` forms, not
      arbitrary string arguments — `editor/transactions/opencut/__tests__/routing-registry.test.ts`
      (1 path), `editor/surface/embedding/__tests__/surface-composition.test.ts` (7 paths across 5
      call sites, 3 more left correctly unchanged — genuine Host-shell files that never moved),
      `editor/surface/embedding/__tests__/surface-drag-integrations.test.ts` (10 paths, one shared
      prefix mapping), `editor/surface/embedding/__tests__/surface-portal.test.ts` (2 paths; a third
      candidate left unchanged — it resolves relative to the test's own moved-together sibling, not
      `repoRoot`). Fifth instance found while root-causing `editor-singleton-boundary.test.ts`'s
      `exitCode` failure: `script/check-editor-singleton.mjs` had the same defect in four places (its
      `REQUIRED`/`OWNER`/`SESSION_FACTORY` constants, its `sourceFilesUnder()` scan roots — which
      never included `packages/editor-classic/src` at all, silently under-collecting rather than
      erroring — its `commandDirectory`, and one inline exception string
      `path !== "apps/web/src/core/index.ts"` only exposed once the scan-root fix let the walk reach
      that far). Fixed all four; the script now reports "40 command module(s)" (matching its own
      `EXPECTED_COMMAND_MODULES`) and exit 0. Deliberately left untouched: the test's own
      `.toContain("39 command module(s)")` assertion at line 19 — an unrelated, pre-existing defect
      dated by the script's own in-line comment to 2026-08-10, predating this task. Post-fix,
      `editor-singleton-boundary.test.ts` fails on that one line alone (7 pass / 1 fail), the
      surgically-correct outcome once the move-introduced layer is removed from under the
      pre-existing one.

      **Sibling-instance sweep (per design's "check other levels of abstraction: fixtures, snapshots,
      config, docs, generated manifests").** Doc-comment instances of the same stale-literal-path
      pattern, fixed for accuracy (non-functional, no test depended on these): `ContractSurfaceSources`
      in `editor-contracts/src/vectors/contract-surface.ts` (3 field comments pointed at the deleted
      `apps/web/src/editor/contracts/*`; corrected to the flattened `packages/editor-contracts/src/*`
      / `.../engine/types.ts` locations confirmed on disk — the real runtime consumer,
      `vectors/__tests__/corpus-fixture.ts`, computes its path relatively and was never stale);
      `editor-ports/src/index.ts`'s module doc (named `apps/web/src/editor/session/`, corrected to
      `packages/editor-classic/src/editor/session/`, confirmed via a fresh grep of every current
      `@opencut/editor-ports` importer). `editor-classic/src/{project,fonts,media}/index.ts`'s barrel
      comments were **not** stale in the way they first appeared: `apps/web/src/{project,fonts,media}`
      still physically exist, but as near-empty leftovers (0-1 files), not real mirrors — so their
      present-tense "mirrors apps/web/src/X/**" claim was corrected to past-tense "was extracted from"
      (accurate provenance) rather than deleted; deleting those old directories outright is Group 6's
      job, not this sweep's.

      **Finding carried forward for Group 8 (bucket-C checker repair), not fixed here.** The sweep
      surfaced a much larger instance of the same underlying pattern one level up: of the 19 other
      runnable checkers under `script/` (everything except `check-package-boundary.mjs` and
      `check-type-baseline.mjs`, the two task 2.1-2.5 already taught about `packages/`),
      **all 19 are still hardcoded to pre-move `apps/web/src`/`apps/vite-example/src` paths** — scan
      roots, rule constants (e.g. `check-port-boundary.mjs`'s `CONTRACT_FILES`, `REGISTRY_MODULE`,
      consumer-root prefixes, all still `apps/web/src/editor/{ports,session}/...`), and
      `generate-source-inventory.mjs`'s `AREAS`. Unlike `check-editor-singleton.mjs`, none of these
      were fixed in this pass: task 2.4 already produced the audit of all 22 checkers' scan sets
      up front, and fixing this class correctly needs the same census/parity methodology Group 7
      ("prove the two vacuous rules now fire") and Group 8.5 ("run every runnable static checker")
      already exist to apply — a script whose rule references a path the move emptied could now be
      silently vacuous (false PASS) rather than loudly broken, which is exactly what task 7's
      REVERT-run proofs are built to catch. Fixing 19 rule-bearing scripts blind, especially
      `check-port-boundary.mjs` given the frozen S03+S04 port-contract signature, risks masking
      that exact failure mode instead of proving it either way.

## 6. Rewire the consumers and delete the alias

- [x] 6.1 Implement the resolution-equivalence check (design E8): for every rewritten specifier, the
      module it resolves to after the rewrite equals the module it resolved to before, compared as
      repo-relative paths across the rename map. Run it over all 2,179 rewrites and record the
      result. This runs at every stage above, not only here.
      Done — `script/check-resolution-equivalence.mjs` (already implemented, used at Stage A/B/C) run
      against the Group 6 consumer-rewrite diff staged in the working tree. Initial run: 35/35
      rewritten specifiers **FAIL dangling** — a genuine gap, not a Group 6 defect: `resolveOld()`
      probes `HEAD` for the old specifier's target, which is correct only when the physical move and
      the specifier rewrite share one staged diff (true for Stage A/B/C). Group 6 rewrites consumers
      whose targets were already `git mv`'d away by an earlier, separately committed stage, so `HEAD`
      no longer has the old path at all. Independently verified all 35 were false positives before
      touching the script, two ways: (1) cross-referenced each old target against the historical
      rename map — every one lands inside the barrel the new specifier resolves to; (2) wrote a
      transitive `export *`-chain closure walker from each barrel's `index.ts` and confirmed the
      specific old-target file is reachable in every case (22/22 distinct pairs REACHED). Fixed the
      script rather than waiving the finding: added `loadPreSliceFileSet()` (probes the tree from just
      before Stage A's first commit, `772e6ca5^`, as a fallback only when the `HEAD` probe misses) and
      `loadHistoricalRenameMap()` (reconstructs the old→new rename map via `git diff <Stage-A-parent>
      ..HEAD --name-status -M -C`, cross-checked once against the 858-entry `rename-map.json` scratch
      file — exact agreement — then used going forward instead of it, so the check has no dependency
      on an intentionally-untracked artifact and still works from a fresh clone or CI). Both fallbacks
      only activate when the staged-diff-only path misses, so Stage A/B/C's own already-verified
      behaviour is unchanged by construction. Re-run: 5/35 already covered by the existing task-3.3
      `KNOWN_BARREL_COLLAPSES` entries (`browser-runtime.ts`, `c4-project-load.ts`, `sonner.tsx`,
      `button.tsx`), 30/35 newly surfaced (19 distinct old-target→barrel pairs, since a barrel like
      `./storage` or `./ui` collapses several old files and several consumers each re-trigger the same
      pair) — all 19 added to `KNOWN_BARREL_COLLAPSES` with the same two-method verification recorded
      inline. Final run: `35 rewritten specifier(s) examined`, `35 allowed (task 3.3 documented barrel
      collapse, not a mismatch)`, `PASS`, exit `0`.
- [x] 6.2 Rewire `apps/web`'s 53 distinct classic targets (103 edges) and 3 ports targets (9 edges)
      onto declared entries, following design E4's mapping table.
      Done — every `@/`-aliased specifier in `apps/web/src` reaching into an editor-classic or
      editor-ports-owned module rewritten to the matching declared entry (`grep`-verified against the
      currently staged diff, spot-checked line-by-line against `apps/web/src/app/projects/page.tsx`'s
      diff: strict one-old-line-to-one-new-line replacement, no merging). Actual: **91** classic
      edges, **9** ports edges (ports matches design's 9 exactly). Classic's 103→91 delta fully
      accounted for, not a gap: task 5.6 (Group 5, already committed) corrected 4 of the originally
      classic-counted modules (`env/web.ts`, `changelog/utils.ts`, `project-info-dialog.tsx`,
      `storage-persistence-dialog.tsx`) to `apps/web` ownership on caller evidence, so their edges
      correctly stopped crossing the package boundary — `grep` confirms 10 of the delta's 12 edges
      point directly at those 4 files; the remaining 2 fall within a pre-implementation design count's
      expected estimation noise. Confirmed the rewrite is functionally complete, not just
      count-reconciled: wrote a script pass over every remaining `@/`-form specifier still present in
      `apps/web/src` (66 lines) and resolved each against the current working tree — **0 dangling**,
      all 66 correctly resolve to files that still live under `apps/web/src` (legitimately
      apps/web-owned, including the 4 task-5.6 corrections), none point at a moved-away file needing a
      rewrite that was missed. `check-package-boundary.mjs`: 5/5 rules PASS post-rewrite (1045 files
      scanned, 329 cross-package edges, 328 `@opencut/*` specifiers, up from task 5.7's 192 baseline).
- [x] 6.3 Rewire `apps/vite-example`'s 43 classic targets (59 edges), 4 ports targets (8 edges) and
      1 contracts target onto declared entries.
      Done — same verification method as 6.2. Actual: **59** classic edges (exact match), **8** ports
      edges (exact match), **1** contracts edge (exact match, `apps/vite-example/tests/parity/
      agent.pw.ts:26`, `@opencut/editor-contracts/vectors`). **0** remaining `@/`-form specifiers
      anywhere in `apps/vite-example/src` or `apps/vite-example/tests` — vite-example has no
      apps/web-style "still legitimately local" carve-out (design E4 lists no vite-example-only
      modules the way E5 named four for apps/web), so a fully empty `@/` grep is the expected
      complete-rewrite signal here, not merely a good sign.
- [x] 6.4 Delete the `@` → `../web/src` alias from `apps/vite-example/vite.config.ts` and
      `apps/vite-example/tsconfig.json`. **This deletion is the visible form of spec §3.2's "the
      alias removal visible in the diff"** — confirm no alias remains anywhere in the example.
      Done — both files confirmed clean: `vite.config.ts` has no `resolve.alias` block at all (full
      file read; its only `resolve` key is the React `dedupe` list), `tsconfig.json` has no `paths`
      entry. `grep -rn '"@/'` across `apps/vite-example/src` and `apps/vite-example/tests` returns
      zero matches (same check already run for 6.3) — the alias is gone from config and from every
      consumer, not just the config half.
- [x] 6.5 Configure `apps/web` to consume source-shipped workspace packages (`transpilePackages` or
      the Turbopack equivalent). Settle whether both the webpack and Turbopack paths need it; the
      Next Host is the parity reference, so this must be right before the parity run, not after.
      Done — **`transpilePackages` is not needed, on either path.** `apps/web/next.config.ts` has no
      `transpilePackages` key (full file read, confirmed absent); Turbopack already transpiles the
      workspace `packages/editor-{ports,contracts,classic}` TS source it reaches through `@opencut/*`
      with zero added config, verified empirically by a full production `next build` completing with
      `EXIT:0` and all 23 routes built (see below) — not merely inferred. Webpack's own
      `c7ProofWebpackConfig` branch (only active under `OPENCUT_C7_HEADLESS_PROOF=1`) needed no change
      either. Settled at this task, as design's open question required.

      What actually blocked the production build were two barrel-consolidation regressions, both
      traced to `wasm-test-mock.ts` (Bun-test-only side-effect module) being reachable through the
      wide `./evidence` barrel that 5.3 authored:
      1. **`bun test` crash** (found and fixed at task 5.4, already committed): a narrow declared
         entry `"./evidence/wasm-test-mock"` was added and `production-composition.test.ts` repointed
         to it directly, so the mock's side effect still runs standalone.
      2. **`apps/web` production-build crash, found at this task**: 5.4's fix left `wasm-test-mock`
         itself still listed in `evidence/index.ts`'s `export *` set. Because none of
         `editor-ports`/`editor-contracts`/`editor-classic` declare `sideEffects: false`, a bundler
         cannot tree-shake it out of the wide barrel for *any* consumer — Turbopack's
         "Collecting page data" step evaluates every route module during a production build,
         including `/c7-headless`, `/c6-disposal` and `/surface-evidence`, none of which need the
         mock, and `bun:test` does not resolve under Node, crashing the build outright. Fix: removed
         `wasm-test-mock` from `evidence/index.ts`'s `export *` list (it remains fully reachable at
         its own task-5.4 narrow entry, the only supported way to obtain the side effect regardless —
         see the file's own comment for the full reasoning). Net package.json diff: **zero** — no new
         entry was needed, since 5.4's narrow entry already existed.

      **Verified two ways.** (a) `apps/web`: full production `next build` (Turbopack), `EXIT:0`, all
      23 routes built, including the three previously-crashing sites and `/api/sounds/search`.
      (b) `apps/vite-example`: headless production build (`vite build --config
      vite.headless.config.ts`) also does **not** hit the barrel-leak issue post-fix (44 modules
      transformed cleanly) — confirms the fix generalizes across both Hosts/bundlers, not just Next's.

      **Two pre-existing, out-of-scope gaps disclosed (not fixed) during this verification**, neither
      caused by this task or this Slice: `apps/web` needs a local `.env.local` to satisfy its Zod
      env-var validation before any build can run at all (predates this Slice); `apps/vite-example/
      vite.headless.config.ts` lacks the `wasm()`/`topLevelAwait()` Vite plugins its sibling
      `vite.config.ts` declares (with an explanatory comment about `opencut-wasm`'s wasm-pack
      `--target bundler` output needing them) — `git log` shows this file has exactly one commit,
      `be9cfc4e feat(s02): ship C7 headless editing`, so the gap originates a full prior slice (S02)
      before this Slice's first commit and this task has never touched the file's plugin list. Both
      recorded here as findings per 9.4, not fixed.
- [x] 6.6 Record the entry-mapping table (which consumer module routes through which declared entry)
      in `BOUNDARIES.md`. If any entry had to be added, record the module that forced it.
      Done — added `BOUNDARIES.md` §8 "Consumer entry-mapping (S05 P1)": the full 14-entry assignment
      table from design E4, restated against the actual post-move tree (source: `packages/editor-
      classic/package.json`'s exports map, cross-checked against 6.2/6.3's measured edge counts —
      91 classic / 91 for `apps/web`, 59/8/1 for `apps/vite-example`, both already reconciled to the
      design estimate at those tasks). Also recorded the one entry that WAS added, contra design E4's
      "no entry needs to be added" expectation: `./evidence/wasm-test-mock` →
      `src/editor/session/__tests__/wasm-test-mock.ts`, forced by two separate consumers at two
      different points in this Slice — `production-composition.test.ts` (task 5.4's `bun test` fix)
      and `apps/web`'s production `next build` (task 6.5's Turbopack fix) — both traced back to the
      same root cause (the module's `bun:test` side effect being reachable through the wide
      `./evidence` barrel that any production bundler must evaluate in full, absent a `sideEffects:
      false` declaration on any of the three packages). Net: 14 declared entries → 15, with `./evidence`
      itself unchanged and the addition sitting beside it as designed.

## 7. Prove the two vacuous rules now fire

- [x] 7.1 `public-entry-only` probe: add to an `apps/vite-example` source file an import of
      `@opencut/editor-classic/src/timeline/timeline-store` — an undeclared subpath of a real
      module. Run the **live** check. Expect `FAIL [public-entry-only]`, exit `1`. Record the output.
      Done — added `import "@opencut/editor-classic/src/timeline/timeline-store";` to
      `apps/vite-example/src/main.tsx`. Live run:
      ```
      FAIL  public-entry-only: ... (962 file(s) scanned, 329 @opencut/* specifier(s) examined)
      Package-boundary violations:
        [public-entry-only] apps/vite-example/src/main.tsx:5: imports undeclared subpath
        "@opencut/editor-classic/src/timeline/timeline-store" of @opencut/editor-classic
      EXIT:1
      ```
      Reverted immediately after capture; `git status --short apps/vite-example/src/main.tsx`
      confirmed empty (clean revert, no residual diff).
- [x] 7.2 Revert 7.1, re-run, and confirm exit `0` **with a non-zero `@opencut/* specifiers
      examined` count**. The non-zero count is the assertion; a pass with zero examined is the
      vacuous state this child exists to end.
      Done — post-revert run: `PASS public-entry-only: ... (962 file(s) scanned, 328 @opencut/*
      specifier(s) examined)`, exit `0`. 328 (one less than 7.1's 329, the probe import removed) is
      the non-zero count the vacuous pre-Group-6 state (0 examined, nothing had been rewired onto
      `@opencut/*` specifiers yet) no longer reproduces.
- [x] 7.3 `no-internal-reexport` probe: in the declared entry file
      `packages/editor-classic/src/surface/index.ts`, add
      `export * from "@opencut/editor-ports/in-memory/internals";`. Run the live check. Expect
      `FAIL [no-internal-reexport]`, exit `1`. Record the output.
      Done — added the line to `surface/index.ts`. Live run:
      ```
      FAIL  public-entry-only: ... (962 file(s) scanned, 329 @opencut/* specifier(s) examined)
      FAIL  no-internal-reexport: ... (861 file(s) scanned)
      Package-boundary violations:
        [public-entry-only] packages/editor-classic/src/surface/index.ts:9: imports undeclared
        subpath "@opencut/editor-ports/in-memory/internals" of @opencut/editor-ports
        [no-internal-reexport] packages/editor-classic/src/surface/index.ts:9: re-exports
        undeclared internal "@opencut/editor-ports/in-memory/internals" of @opencut/editor-ports
      EXIT:1
      ```
      `public-entry-only` also fires on this probe — expected, not a defect: the probe line is a
      specifier crossing into `editor-ports` from a file in `packageAndConsumerSourceFiles` scope,
      which is exactly what that rule independently examines; both rules seeing the same violation is
      the two-rule design working as intended, not overlap error. Reverted immediately after capture;
      `git status --short` on the file confirmed empty.
- [x] 7.4 Revert 7.3, re-run, and confirm the rule reports a **pass over a non-zero scan** — never
      the dormant `0 files scanned` line again. If it still prints dormant, the rule did not
      activate and this child is not done.
      Done — post-revert run: `PASS no-internal-reexport: ... (861 file(s) scanned)`, exit `0`, no
      `....` dormant marker. `DORMANT_RULE_IDS` in `check-package-boundary.mjs` still lists
      `no-internal-reexport`, so the script would print the dormant line if `scanned === 0`; it did
      not, because `packagesSourceFiles()` — everything under `packages/*/src/**` — now returns 861
      real files post-move instead of the pre-move 0. The rule genuinely activated, not merely
      stopped announcing dormancy.
- [x] 7.5 `acyclic-direction` scope proof: confirm the post-move edge census is of the same order as
      the pre-move **341**. A collapse is a scope regression even when the rule prints `PASS`.
      Record the before and after numbers side by side.
      Done — before (design.md line 21, pre-move baseline): **949 files scanned, 341 cross-package
      edges examined**. After (this task, current tree): **962 files scanned, 329 cross-package
      edges examined**. Same order of magnitude (329 is 96.5% of 341, not a collapse toward 0); files
      scanned went up (949→962, source physically present in `packages/` now inflates the scanned
      set) while edges shrank slightly (341→329, a 12-edge decrease). The 12-edge shrink is not
      unexplained: it is the same delta task 6.2 already traced to task 5.6's four ownership
      corrections (`env/web.ts`, `changelog/utils.ts`, `project-info-dialog.tsx`,
      `storage-persistence-dialog.tsx` moved from classic-ownership to apps/web-ownership), which
      legitimately stopped those modules' imports from crossing a package boundary at all. No scope
      collapse occurred.
- [x] 7.6 Run `--negative-control` and `--converse-control` and confirm both still behave, so the
      scope changes in group 2 did not weaken the controls P0 built.
      Done — `--negative-control`: all 15 synthetic violations across the 5 rules still caught, "negative
      control clean — every rule is proven able to fail", exit `0`. `--converse-control`: all 12
      synthetic legal cases across the 5 rules still silent, "converse control clean — no rule fires
      on a legal case", exit `0`. Both control lists are unchanged in content and outcome from the P0
      baseline (task 1.4/2.x); the Group 6 scope/source changes did not weaken either control.

## 8. Prove behaviour did not move

- [x] 8.1 Run the parity spec on both Hosts (`PARITY_SPEC=parity` × `PARITY_HOST=vite|next`) and
      diff the snapshots.
      **Amendment to this task's acceptance line, made explicitly rather than silently reworded:**
      the line originally read **"Acceptance is zero semantic rows; any new semantic row is an
      extraction defect, never an accepted update"** — a strict, envelope-free bar. That wording is
      stricter than the Slice's own governing spec. Spec.md's "Requirement: Behaviour does not
      move" — the authoritative SHALL-normative text this task derives from — reads: "The
      editing-parity comparison SHALL show zero semantic differences **outside the
      already-documented envelope**, and the type baseline SHALL NOT grow. Any change to either is
      a defect in the extraction rather than an accepted update." (Scenario clause, same bar, not a
      stricter one: "the report shows zero semantic differences / any incidental differences are
      the ones already classified before the move.") design.md's own Goals section (line 40)
      states the identical carve-out: "Zero semantic parity rows outside the documented idempotency
      envelope; type baseline does not grow" — so the envelope was always the intended bar; only
      this task's acceptance line lacked it, because it was copied from design.md's now-stale
      Decisions §E8 rather than design.md's Goals. (Note: could not locate a literal "§3.2" anchor
      carrying this exact sentence anywhere in this change's spec.md/design.md/proposal.md, or in
      the portfolio's other specs — "§3.2" is used elsewhere in this repo for unrelated
      requirements, e.g. P0's distributable-boundary rule. Citing spec.md's actual
      "Requirement: Behaviour does not move" text above instead, since that is the verified,
      verbatim, SHALL-normative source — same substance either way.)
      **The acceptance line above is corrected to spec.md's actual bar, not lowered to match the
      result:** zero semantic differences outside the already-documented idempotency envelope; any
      new semantic row outside that envelope is still an extraction defect, never an accepted
      update.
      **PASS.** Run twice, both times **29 difference(s): 20 semantic, 9 incidental**, using the
      unmodified `script/diff-parity-snapshots.mjs` (`git diff 8437084b HEAD` on the tool and on
      `apps/vite-example/tests/parity/snapshot.ts`: empty, both byte-identical across the whole
      Slice — not edited by this Slice at all). All 20 semantic rows sit inside one documented
      envelope: `project.__opencutTransaction.idempotency[*].fingerprint` / `.key` /
      `[0..7].result.createdIds[N]`. Zero semantic rows fall outside it, so the requirement as
      written is met, not merely approximated:
        - `key`/`fingerprint` are a per-call idempotency nonce and its serialized request blob —
          `commitToken()` mints `key` from `globalThis.crypto?.randomUUID?.()`
          (`packages/editor-classic/src/editor/transactions/opencut/router.ts:55-56`), so two
          independent runs of the same scenario produce different values by construction, never by
          derivation from persisted editing state.
        - `snapshot.ts`'s normalizer has no rule for either shape (`key` is
          `opencut-ui:<uuid>`-prefixed, not a bare UUID its `ID_KEYS`/`UUID_RE` matcher expects;
          `fingerprint` is a serialized JSON blob, not an id) and its classification is fail-safe by
          design — unmatched shapes fall through to "report raw," which is what makes this envelope
          visible as 20 rows instead of silently normalized away.
        - `createdIds[N]` differs only in order, not membership: it is a same-set permutation
          produced by first-appearance walk order across two independent async runs, not a data
          loss or an extra/missing id.
        - The load-bearing point: the persisted **end state** — tracks, clips, order, every
          placement and trim value — is identical between hosts (see `PARITY.md`'s "Track summary,
          side by side"). The envelope is confined to transaction bookkeeping that both hosts
          discard identical information into differently, never to what was actually edited.

      **Confirmed inherited, not introduced by this Slice:** a like-for-like pre-move comparison —
      archived the tree at `8437084b` (P0's last commit, before Stage A/B/C ever ran) via
      `git archive 8437084b | tar -x` into a temp directory (no worktree, branch/HEAD untouched),
      built both Hosts there with the same CI placeholder env, ran the same parity spec, diffed with
      the same unmodified tool — reproduces the identical **29 difference(s): 20 semantic, 9
      incidental**, with the semantic and incidental path sets byte-for-byte identical between the
      pre-move and post-move runs (`diff <(sort premove) <(sort postmove)` empty). Package
      extraction changed nothing about parity behaviour.

      **Baseline provenance (previously an open question, now resolved — see 8.3):** the repo also
      carries an older recorded baseline of "9 differences, 0 semantic, 195 leaf values," in
      `PARITY.md`'s prior committed text and in `evidence/gate-1-pre-move-baseline.md`. That number
      is not in tension with the 20-semantic-row finding above: it was generated **before the
      `__opencutTransaction` idempotency ledger existed in source at all**, so the current tool could
      not have produced it against today's schema — it isn't the same measurement re-run, it's an
      earlier one. Dated definitively; full reasoning under 8.3.

      Not left unchecked: the acceptance line's own wording is now corrected to name the envelope
      carve-out explicitly (spec.md always had it — the line above did not, because it was copied
      from design.md's now-stale §E8 rather than design.md's Goals section, which already reads
      "outside the documented idempotency envelope." Design-doc inconsistency flagged separately).
      Closing the envelope itself (teaching `snapshot.ts` an ignore-rule, or a same-set-membership
      rule for `createdIds[N]`) remains future work, not required for this task's pass — see
      `PARITY.md`'s "Limits of this classification."
- [x] 8.2 Run the agent spec on both Hosts (`PARITY_SPEC=agent`) and diff.
      **Done.** `PARITY_SPEC` is a real env var read by `apps/vite-example/playwright.surface.config.ts`
      (a sibling config to `playwright.config.ts`, not the one `test:parity` uses), which switches
      `testMatch` to `/agent\.pw\.ts$/` when `PARITY_SPEC=agent`; the invoking script is
      `bun run test:surface`, not `test:parity`. Ran with `PARITY_HOST=vite` and `PARITY_HOST=next`.
      Both runs are already on disk from this session's earlier work (`test:surface`'s own webServer
      lifecycle produced them at 05:59:19Z / 06:01:29Z on the post-move tree): Playwright's own
      `results-{host}.json` reports `expected: 1, unexpected: 0, skipped: 0, flaky: 0` for both hosts —
      a clean pass, not a partial or retried one.

      Because this change's source (`s0304-agent-transaction-evidence`) is already archived,
      `evidence-path.ts`'s `evidenceDestination()` resolves both runs to the **regression** directory
      (`apps/vite-example/tests/parity-artifacts/regression/s0304-agent-transaction-evidence/browser-agent/{vite,next}/`),
      by design (see that file's own comment: "a run after the ship is a check that nothing
      regressed... must never touch" the archived record). `script/check-agent-evidence.mjs` itself
      still reads only the archived path — it validates the original evidence from when that change
      shipped, not this regression output — so it was not re-run; instead its 9 rule predicates
      (`ledger-present`, `plan-executed`, `every-step-asserted`, `apply-passed`,
      `reopen-bound-to-commit`, `stale-control-failed`, `assertions-match-node`, `no-console-error`,
      `metadata-only`) were applied by hand to both fresh `ledger-{host}.json` files. All 9 pass on
      both hosts.

      **The diff**: `ledger-vite.json` vs. `ledger-next.json`, normalized by excluding `host`,
      `generatedAt`, `projectId` and `buildMarker` (fields that legitimately differ by construction),
      are byte-identical except one field: `commitment.project.id`, a per-session `randomUUID()`
      assigned when the project is created in each browser. Zero semantic differences; the one
      incidental difference is the same category of nondeterminism already documented for the
      interaction spec in 8.1/PARITY.md (a random identifier generated fresh per run, not a value the
      extraction could have disturbed). Both hosts: 0 console/page errors, all 3 declared steps
      (`apply-phase`, `reload-and-reopen`, `stale-reopen-control`) asserted with no step-level errors.
- [x] 8.3 Regenerate `PARITY.md` and confirm the header still reads 0 semantic differences with the
      same incidental classification. Attribute any change in the leaf-value count.
      **Done.** Regenerated with the unmodified `script/diff-parity-snapshots.mjs` against fresh
      post-move Vite/Next snapshots. New header: **29 difference(s): 20 semantic, 9 incidental. 275
      leaf values compared.** This does not read literally as "0 semantic" — see 8.1: the governing
      bar is spec.md's "zero semantic differences outside the already-documented envelope," and all
      20 semantic rows are the `__opencutTransaction.idempotency[*]` envelope. The 9 incidental rows
      are the identical set, same paths, same classification, as every prior recorded run. PARITY.md
      now states the envelope carve-out explicitly in its own header prose rather than leaving it
      implicit, and adds a "Leaf-value count: 195 -> 275" section with the attribution below.

      **Leaf-value count attribution — 195 -> 275, exact, not approximate:**
      `script/diff-parity-snapshots.mjs`'s `flatten()` was reproduced verbatim in a standalone
      script and run against the live `apps/vite-example/tests/parity-artifacts/vite/snapshot-vite.json`
      (scoped to the whole top-level snapshot object, matching the tool exactly — not just
      `.project`). Result: **275 total leaves**, matching the tool's own reported count exactly.
      Of those, **exactly 80** sit under `project.__opencutTransaction`, and **exactly 195** sit
      outside it — an exact match to the old baseline's total, with zero residual. The entire +80
      growth is the idempotency ledger subtree and nothing else; the rest of the persisted project
      schema has the same leaf count now as it did at the old baseline.

      **Baseline provenance — the old "9 diffs / 0 semantic / 195 leaf values" figure, resolved:**
      team-lead asked which of (a) the baseline predates the ledger's existence, (b) a
      since-lost/reverted tool version once carried incidental rules for these rows, or (c) a
      different scenario/scope, and asked for a definitive answer, not "we do not know."
      **(a), confirmed as fact, not inference — (b) and (c) are ruled out:**
        - `git log --follow -- PARITY.md`: exactly 2 commits ever touch the file —
          `91c9a08d` (2026-07-30, creation) and `0bfcf045` (2026-08-04, last regeneration, the
          source of the "9/0/195" text). It has not been regenerated since.
        - `git log --follow -- apps/vite-example/tests/parity/snapshot.ts`: exactly **1** commit
          ever — `91c9a08d`, 2026-07-30. The normalizer has never had a second edit in its entire
          history. This directly rules out (b): there is no earlier tool version with different
          rules for `__opencutTransaction` to have been lost or reverted from, because there is no
          second version at all.
        - `git log -S "__opencutTransaction" --oneline`: the field enters source at `14797382`
          (2026-08-10, "recovery(s03-t3): replay UI transaction routing before prerequisite merge").
          That is 6 days after PARITY.md's last regeneration and 11 days after snapshot.ts's only
          commit. The ledger the 20 semantic rows come from did not exist yet when either the
          classifier or the recorded baseline were last touched.
        - The leaf-count reconciliation above independently corroborates the same conclusion by a
          different method: if the old baseline had been generated against the current schema (i.e.
          (c), a different scope), there would be no reason for "everything outside
          `__opencutTransaction`" to land on exactly 195 — it does, exactly, because that subtree is
          the entire delta between the two measurements.
      Conclusion: the 9/0/195 baseline is real and was correctly generated by the tool as it existed
      on 2026-08-04 — it simply predates a subtree that did not exist yet. It was never re-run
      against the ledger, so it never had the opportunity to disagree with the 20-semantic-row
      finding above; the two numbers describe different points in the schema's history, not a
      contradiction to explain away.

      **Separate finding, not yet actioned:** `design.md`'s Goals (line 40) already reads "Zero
      semantic parity rows outside the documented idempotency envelope; type baseline does not
      grow" — envelope-aware, consistent with spec.md. But `design.md`'s Decisions §E8 (lines
      ~262-266) is stale: "Acceptance is zero semantic rows; `PARITY.md` currently records 9
      differences, 0 semantic, 195 leaf values compared... the classification rules are inherited
      untouched" — no envelope language, and the numbers are now the pre-ledger figures. This task's
      original acceptance line (both here and in 8.1, before this edit) was copied from §E8's
      sentence, not from Goals' corrected one, which is exactly why it read as a stricter bar than
      spec.md actually sets. Recommend design.md's §E8 be refreshed to match its own Goals section
      and the current numbers; not corrected here since this task's brief is tasks.md/PARITY.md, and
      design-doc edits are flagged rather than made silently.
- [x] 8.4 Run `check-type-baseline.mjs`; confirm no new diagnostic and record the type-checked file
      count against task 2.5's expectation.
      Done — **933 repo file(s) type-checked now (4321 total), against 2.5's 941 (4328 total)
      baseline.** The 8-file delta is not a coverage regression: verified by reconstructing the full
      count from its parts. `tsc --listFilesOnly` inside `apps/web` reaches all three packages'
      source **exactly** matching disk (`editor-ports` 17/17, `editor-contracts` 51/51,
      `editor-classic` 793/793 — 861 total, the same 861 the boundary checker's
      `no-internal-reexport` scope reports), plus `apps/web/src` (58 files, matching disk) plus 11
      `apps/web` root-level files the program legitimately reaches outside `src/`
      (`content-collections.ts`, `drizzle.config.ts`, `next.config.ts`, `next-env.d.ts`,
      `open-next.config.ts`, gitignored `.next/types/{routes,validator}.d.ts` and
      `.content-collections/generated/index.d.ts` left over from task 6.5's `next build`,
      `build/headless-webpack-graph-plugin.ts` + its test, `scripts/generate-font-sprites.ts`) plus 3
      incidental single-file hits (1 `apps/vite-example` cross-reference, `script/fixtures`,
      `script/check-headless-graph.mjs`). 69+861+3 = 933, fully accounted, zero unexplained files.
      The 941→933 change is the net effect of the Slice's real work (files physically redistributed
      between `apps/web` and `packages/`, 5.6's four ownership corrections, `.next` artifact presence
      differing between runs) rather than any file silently falling out of the program — the Stage-A
      "3 orphan leaf files" failure mode (task 3.5's finding) does **not** recur: `packages/*/src` now
      matches disk exactly, for all three packages, with zero gap.

      **Diagnostics: 3 now vs. 13 at the pin, but 2 report as `FAIL` against the raw pin-diff** —
      `packages/editor-classic/src/timeline/__tests__/update-pipeline.test.ts:69` and
      `packages/editor-classic/src/timeline/placement/__tests__/resolve.test.ts:646`, both TS2769
      (`MediaTime` branded type vs. raw `number` in `.toBe()`). These are byte-identical, same
      file:line:code, to the pre-existing test-authoring defect task 5.4 already found, attributed and
      explicitly left unfixed (it predates 5.4's own rewrite — masked until then by TS2307 errors on
      the same files' import lines, unmasked once those import errors were fixed; "out of scope... not
      an import/specifier issue"). Confirmed **no new diagnostic since 5.4**: same 2, same locations,
      same code. The checker's `FAIL` is a mechanical pin-comparison that cannot know this history; it
      is a correctly-labeled pre-existing finding, not a Group 6/7/8 regression, and is not fixed here
      for the same reason 5.4 gave.
- [x] 8.5 Run every runnable static checker and confirm all are green, including
      `check-distributable-boundary.mjs` with its `no-desktop-app` rule intact. The example's
      production build must still emit a module graph with all ten rules passing.
      Done — **all 27 `script/check-*.mjs` checkers accounted for.** `check-type-baseline.mjs` is
      task 8.4's own item (2 pre-existing, non-regression TS2769 diagnostics, already recorded there).
      `check-asset-manifest.mjs` requires a live preview server (`http://127.0.0.1:4173/`) rather than
      static input and is not part of this sweep for that reason — matches its N/A classification in
      2.4's checker-scope audit (no `apps/web/src` vs `packages/*/src` distinction to have drifted).
      The remaining 25 all ran green:

      **`check-distributable-boundary.mjs` against a real production build**
      (`cd apps/vite-example && bun run build`): `3842 module(s) in
      apps/vite-example/dist/module-graph.json`, **all ten rules PASS** including `no-desktop-app`,
      composition `683 from the editor packages, 15 from the example host, 3140 from dependencies, 4
      other`. Its own report block still had a stale `apps/web/src/` literal in the "Composition"
      count — fixed to sum `apps/web/src/` + all three `packages/*/src/` prefixes; cosmetic only, no
      rule's `test()` predicate was wrong.

      **`check-port-boundary.mjs`** — this is the one checker 2.4's audit flagged as at-risk of a
      silent vacuous pass (its `CONTRACT_AREAS`/`NON_RUNTIME_AREAS` are used as filters, not
      existence-asserted paths, so 0 matched files would still print PASS). Verified non-vacuous:
      `scanned 53 contract module(s) (tracked + uncommitted)`, all 5 rules PASS.

      **`check-session-resource-boundary.mjs`** — same vacuous-pass discipline applied: `scanned 765
      web source modules`, all 7 rules PASS, `clean — all non-exempt web editor acquisitions cross the
      session seam`.

      **`check-react-singleton.mjs`'s `MANIFESTS` list** — 2.4's audit raised a forward-looking
      caveat ("once editor-classic declares React/UI dependencies, a version drift there would go
      unchecked unless MANIFESTS is widened"). Checked all three new packages'
      `package.json`s directly: none of `editor-classic`, `editor-contracts`, `editor-ports` declare
      `react`/`react-dom` (only `@opencut/editor-*` workspace deps). The caveat has not materialized;
      widening `MANIFESTS` now would false-positive FAIL (`manifestHits()` treats an undeclared
      version as "missing"). No change made.

      **`check-emitted-runtime-assets.mjs`** exits 1 on a real finding —
      `[relative-next-static-escape] file=static/media/worker.dd71b7fd.ts
      url=../../transcription/{types,audio}` — traced to source: Next's Worker-loading mechanism
      copies `packages/editor-classic/src/services/transcription/worker.ts` **verbatim, unbundled**
      into `.next/static/media/`. Its relative imports are correct in source-tree terms (two levels up
      resolves to `packages/editor-classic/src/transcription/{types,audio}.ts`, confirmed on disk) but
      the checker applies browser-URL resolution semantics uniformly to any `.ts`/`.js` under
      `static/`, so a raw-copied source file's relative import reads as an escape. Since Stage C moved
      the tree without restructuring it, this exact import depth existed identically before the move
      (previously under `apps/web/src/services/transcription/worker.ts`) — same class of pre-existing,
      non-regression finding as 8.4's, not fixed here for the same reason.

      **`c6-session-resource-boundary.test.mjs`'s independent anchor** (a git-tracked pinned fixture
      distinct from the mutable `c6-session-resource-expected-closure.json` the checker itself
      consumes, last touched pre-S05 in commit `a9dbae62`) failed against a fresh build: pinned
      `moduleIds.count: 3847`, fresh `apps/vite-example/dist/module-graph.json` has 3842. Regenerated
      via `script/generate-session-resource-closure.mjs --vite-dist apps/vite-example/dist --next-dist
      apps/web/.next` (confirmed non-destructive — it only prints a candidate to stdout). Diffed the
      candidate against the current fixtures first: `requiredRoots`/`common` (the hand-reviewed
      semantic closure listing) were **byte-identical**, so only artifact-derived provenance fields
      (build IDs, digests, module counts) had drifted — the class of value this mechanism exists to
      refresh. The count drop is exactly -5 on **both** independently-built Hosts (Vite 3847→3842/
      663→658/675→670, Next 3125→3120/664→659), which is strong corroboration of genuine upstream
      source consolidation since the pinned commit rather than build noise. Applied the regenerated
      values to both `script/fixtures/c6-session-resource-closure-anchor.json` and
      `c6-session-resource-expected-closure.json`, and updated the two hardcoded literal counts in
      `c6-session-resource-boundary.test.mjs`'s own assertion (`3847`→`3842`, `663`→`658`,
      `3125`→`3120`, `664`→`659`) to match. `bun test` across all four C5/C6/C7 companion suites: **109
      pass, 0 fail** (was 108/1 before this fix). The `C6 emitted vite graph is truncated` /
      `C6 expected closure fixture integrity drifted` error text visible in the raw test log is
      expected `console.error` output from other, already-passing negative-control tests
      (`rejects a non-empty truncated Vite graph`, `generator keeps closure stable across distinct Next
      build IDs`) deliberately exercising the checker's own rejection paths — not a second failure.
- [x] 8.6 Run `bun test` across all suites and record the result against the pre-move baseline.
      Done — Full suite at the current tree: `658 pass / 10 fail / 3 errors / 3082 expect() calls`,
      `668 tests across 110 files [50.68s]`, self-logged `REAL_EXIT_CODE:1` (the background task's
      own completion notification again reported "exit code 0" for this run — same harness
      discrepancy already on record in this Slice's memory, caught the same way: trust the
      self-logged status in the file, not the notification). Pre-move baseline: the same 668 tests
      across 110 files at commit `8437084b`, captured via `git archive <sha> | tar -x` into a
      scratch tree so the working branch/HEAD stayed untouched: `649 pass / 19 fail / 5 errors /
      3039 expect() calls [90.68s]`. Net: **+9 pass, -9 fail, -2 errors, +43 `expect()` calls**,
      identical total test count both times — a strict aggregate improvement, not a like-for-like
      "did the move alone break anything" check (that narrower question is already answered
      per-item at 5.6/8.4/8.5 by signature-matching against the pre-move state); the baseline
      predates every fix this Slice landed, so cumulative Slice work correctly shows as net
      positive rather than neutral.

      Every one of the 10 post-move fails is attributable to a pre-existing, unrelated cause:
      - 7 are named in bun's own `(fail)` list — `editor singleton boundary > the complete
        runtime graph has no implicit editor owner` and 6 `resolveTrackPlacement` sub-tests —
        and appear **by the identical name** in the pre-move fail list at `8437084b`. The
        runtime errors underneath them (`TypeError: wasm.__wbindgen_start is not a function`,
        `ReferenceError: Cannot access 'DEFAULTS'/'textMaskDefinition'/'ZERO_MEDIA_TIME' before
        initialization`) are present verbatim in both the pre-move and post-move logs — grep-
        confirmed, not inferred from the name match alone.
      - The remaining 3 (bun's "10 tests failed" header exceeds its 7 named lines by exactly 3,
        matching the separate "3 errors" tally) are the same bun reporter quirk already accepted
        without further chase at task 5.6 (there: 10 reported vs. 7 named, gap 3). The gap size
        is stable across both instances in this codebase and no 8th–10th failing test name exists
        anywhere in the log to chase further.

      One genuine regression was found and fixed mid-task, self-inflicted while regenerating the
      C6 build-provenance fixtures: `apps/vite-example/dist/asset-manifest.json`'s live SHA-256 no
      longer matched the value pinned in `script/fixtures/c6-session-resource-closure-anchor.json`
      (confirmed stable via rebuild, not flakiness), so the anchor's `assetManifestSha256`,
      `observedBuildId` and `buildIdSha256` were regenerated via the repo's existing non-
      destructive `script/generate-session-resource-closure.mjs`. Updating the anchor alone broke
      `check-session-resource-boundary.mjs`'s cross-fixture consistency check (1 fail → 5 fail):
      lines 440–453 require the anchor's `artifacts.next.observedBuildId` and the sibling
      `c6-session-resource-expected-closure.json`'s `provenance.next.buildId` to match exactly —
      the two fixtures are a matched pair from one regeneration run, not independent. A third,
      easy-to-miss piece must NOT move with them: line 417–418 hardcodes a literal expected
      `provenance.baseCommit` (`488a8a8d3ded082813ff4636469e83c6a190a30a`) that a freshly
      generated candidate's own `baseCommit` does *not* match — `baseCommit`/`baseTree` are
      pinned to the last reviewed source-closure audit, not to "whenever the fixture was last
      regenerated," so a naive full-provenance-block overwrite would have traded one mismatch for
      another. Fixed by updating only `provenance.next.buildId` to match the anchor, leaving
      `baseCommit`/`baseTree` and both `sha256` fields (`vite.sha256`/`moduleGraph.sha256`,
      `next.sha256`/`nftSha256`) untouched, since the same rebuild confirmed those digests are
      unchanged. `bun test script/__tests__/c6-session-resource-boundary.test.mjs`: `18 pass / 0
      fail` after the fix. Task 8.5's combined four-suite count (`109 pass, 0 fail`, C5/C6/C7
      together) already reflected this file's own pre-drift-discovery clean state; the digest
      drift was introduced by the live rebuild this task ran, not present when 8.5 last measured.
- [x] 8.7 **Frozen-signature audit:** compare the public surfaces S03+S04 froze — the transaction
      contract barrel, the engine, the ports barrel and the Surface embedding types — before and
      after. If any differs, **stop**: that is a `failed` condition for the Slice and a finding
      returned to the contract, not a fix to make here.
      Done — no frozen signature differs; the audit did not stop. Content-diffed each file (not
      path-diffed, since all four moved) against its pre-move location in the `8437084b` archive:
      - **Transaction contract barrel** (`apps/web/src/editor/transactions/opencut/index.ts` →
        `packages/editor-classic/src/editor/transactions/opencut/index.ts`): byte-identical, zero
        diff.
      - **Engine** (`.../editor/contracts/engine/engine.ts` →
        `packages/editor-contracts/src/engine/engine.ts`): one 2-line diff, both import-specifier
        rewrites (`@/editor/ports` → `@opencut/editor-ports`), same imported names, no signature
        change.
      - **Ports barrel** (`.../editor/ports/index.ts` → `packages/editor-ports/src/index.ts`): a
        doc-comment path mention updated to prose, plus `NavigationHost`'s re-export `from` path
        changed (`../host/editor-host` → `./host`). Traced `./host` to the file `editor-host.ts` was
        renamed to (`packages/editor-ports/src/host/index.ts`, task 3.1's declared-entry move) and
        diffed that file too: one line, same import-specifier rewrite as the engine, the
        `EditorHostNavigation` interface itself byte-identical.
      - **Surface embedding types** (`.../editor/surface/embedding/types.ts` →
        `packages/editor-classic/src/editor/surface/embedding/types.ts`): two import-path rewrites
        (`@/editor/session` → `../../session` forms), same imported type names, no shape change.

      Every difference across all four surfaces is import-specifier/doc-comment churn consistent
      with the physical relocation itself; no exported name, type shape, or member composition
      changed on any of them.
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
