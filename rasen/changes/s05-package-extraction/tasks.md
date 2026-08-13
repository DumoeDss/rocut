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
