> Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c0`, branch
> `feat/s02-wasm-self-built-canonical`, branched from `main@49f8a88a`.
> Planning artifacts live in the main checkout (`rasen/` is gitignored in `rocut`) and are never
> committed. Commits contain code only.
>
> **Standing constraints.** `script/fixtures/type-baseline.json` must not be edited by this change.
> The type-baseline ceiling is **3**; a count above 3 or a `FAIL` is a stop condition escalated to
> the LEAD, never a re-baseline. Both Hosts stay green. `CARGO_TARGET_DIR` points at a path on `C:`
> for every `cargo` / `wasm-pack` invocation. This child runs concurrently with
> `s02-port-contract-freeze`, which writes only `apps/web/src/editor/host/editor-host.ts` and new
> modules under `apps/web/src/editor/` — **if this change finds it must write any file under
> `apps/web/src/`, stop and report rather than proceeding.**

## 0. Baseline, on the unmodified tree, before any edit

- [x] 0.1 Create the worktree from `main@49f8a88a` and confirm `git rev-parse HEAD` and
      `git rev-parse HEAD^{tree}` match `49f8a88a` / `97097f0a`. Record both.
- [x] 0.2 Export `CARGO_TARGET_DIR` to a path on `C:` for this session and record the path. Confirm
      free space on `E:` before and after each heavy step; the cohort launched with 10.5 GB free.
- [x] 0.3 `bun install` at the repository root, unmodified. Record package count and whether
      `bun.lock` was rewritten (`git diff --stat bun.lock`).
- [x] 0.4 Run `node script/check-type-baseline.mjs` on the **unmodified** baseline. Record the
      output verbatim. Expected: *"3 diagnostic(s) now, 13 at the pin cf5e79e9 … PASS"*. **A
      different result is a stop condition — escalate to the LEAD, do not proceed.**
- [x] 0.5 Build both Hosts on the unmodified baseline (`bun run build:web`; `vite build` in
      `apps/vite-example`) and run the parity fixture: `bun run test:parity` in `apps/vite-example`.
      Record pass/fail per step and archive the snapshots as the comparison baseline for task 6.
      **A baseline parity failure is a stop condition surfaced to the LEAD, not something to work
      around** — it is the regression oracle for every child in this Slice.
- [x] 0.6 Record the resolved published artifact for later comparison: hash the five files in
      `node_modules/opencut-wasm/` and keep a copy of the directory outside the worktree. This is
      the only guaranteed-clean copy of published `0.2.10`; do not rely on being able to re-fetch it.

## 1. Rust toolchain and the first correspondence measurement

- [x] 1.1 Confirm the toolchain: `cargo`/`rustc` ≥ 1.85 (the crate is edition 2024), the
      `wasm32-unknown-unknown` target, `wasm-pack`, and `wasm-bindgen-cli` at **0.2.116** exactly —
      it must match the `wasm-bindgen = "0.2.116"` pin in `rust/wasm/Cargo.toml`. Record every
      observed version.
- [x] 1.2 Build: `wasm-pack build rust/wasm --target bundler --out-dir pkg`, with `CARGO_TARGET_DIR`
      on `C:`. Expect ~4 minutes of **completely silent** workspace-wide Cargo resolution before
      anything prints — the Cargo workspace includes `apps/desktop`'s `gpui` graph, which is
      resolved but never compiled. **The silence is not a hang.** Record wall time and the full
      warning list, including the `License key is set in Cargo.toml but no LICENSE file(s) were
      found` warning that defect D-5 records.
- [x] 1.3 **Measurement A** — compare `rust/wasm/pkg` against the published copy kept in 0.6, file
      by file: `opencut_wasm.d.ts`, `package.json`, `opencut_wasm.js` (expect byte-identical),
      `opencut_wasm_bg.js` (expect differences confined to wasm-bindgen closure-trampoline hashes and
      shim indices, with the **sorted lists of 638 exported symbols identical**), and
      `opencut_wasm_bg.wasm` (expect a size and hash difference; explicitly **not** the criterion).
      Record the result. **Any difference touching an `export` is a stop condition.**

## 2. Make the self-built artifact the resolved one

- [x] 2.1 Change `"opencut-wasm"` in the root `package.json` from the registry range to the local
      build output (`file:./rust/wasm/pkg`), and make the matching change in `apps/web/package.json`
      with the correct relative path.
- [x] 2.2 Delete `node_modules/opencut-wasm` and re-run `bun install`. Record whether bun **symlinks
      or copies** the `file:` dependency, and whether `apps/web`'s resolution follows the root's or
      installs its own copy. This answers design open questions 2 and 3 — record the answer, do not
      assume it.
- [x] 2.3 Verify the resolved artifact by content hash: every file at the resolved
      `node_modules/opencut-wasm` matches `rust/wasm/pkg`. If bun copied rather than symlinked, note
      that a wasm rebuild now requires a re-install and carry that into the developer path in
      task 5.
- [x] 2.4 Record any `bun.lock` churn beyond the two dependency entries. If the older installed bun
      (1.2.2, against the `packageManager` pin 1.2.18 — a discrepancy `UPSTREAM.md` already records)
      rewrites unrelated parts of the lockfile, attribute that churn explicitly in `PATCHES.md` the
      way P-015 attributed the `configVersion` removal. Do not commit unattributed lockfile churn.
- [x] 2.5 Build both Hosts **without touching either build config**, testing design decision D-B's
      hypothesis that no module-resolution change is needed. Only if a build fails, make the minimal
      resolution change in `apps/vite-example/vite.config.ts` and/or `apps/web/next.config.ts`, and
      record the exact failure that forced it. A speculative config edit is scope creep.
- [x] 2.6 Run `node script/check-type-baseline.mjs`. `tsc` now reads the self-built
      `opencut_wasm.d.ts`; S01 proved it byte-identical to the published one, so expect **no
      movement**. Count above 3 or `FAIL` → stop and escalate.

## 3. Close the licence debt

- [x] 3.1 Add `rust/wasm/LICENSE`, byte-identical to the repository root `LICENSE` (sha256
      `8117f9bb64534f7530fc6139b014fd1c1465f7981f93d1871789150fa3f59d3d`), with the
      `Copyright 2025-2026 OpenCut` notice unmodified.
- [x] 3.2 Rebuild the wasm and confirm the `License key is set in Cargo.toml but no LICENSE file(s)
      were found` warning is gone.
- [x] 3.3 **Measurement B** — re-run the task 1.3 comparison. Determine whether `wasm-pack` copies
      the licence into the package **and** whether it adds it to the generated `package.json`'s
      `files` array. Record which happened. If the manifest is no longer byte-identical to published
      `0.2.10`, that is an **acceptable, attributed** divergence — record the exact delta and its
      cause. An unrecorded delta is a failure.
- [x] 3.4 Re-verify the resolved artifact (2.3) after the rebuild, so the consumed copy carries the
      licence too.

## 4. Make the claim mechanical

- [x] 4.1 Write `script/check-wasm-source.mjs` asserting, at the resolved `node_modules/opencut-wasm`
      in each Host's resolution: per-file content equality with `rust/wasm/pkg`; that
      `rust/wasm/pkg`'s emitted `.wasm` is newer than every input under `rust/wasm/src`,
      `rust/crates/*/src`, `rust/wasm/Cargo.toml` and `Cargo.lock`; and that `rust/wasm/LICENSE`
      matches the root `LICENSE`. Exit non-zero with the rebuild command named in the message.
- [x] 4.2 Add the **negative control**: run the check against a fixture directory holding the
      published package's files (from 0.6) and assert it reports failure. Record the control's
      output. A check that cannot fail is not evidence, and this one is load-bearing for every later
      child in the Slice.
- [x] 4.3 Run the check green in both Hosts' resolution and record the output.

## 5. Provenance records

- [x] 5.1 Update `script/generate-sbom.mjs`: give each entry in `UPSTREAM_DEFECTS` an explicit
      disposition (`recorded` → probe must return true; `repaired` → probe must return false, with a
      patch id and evidence pointer), and change the exit condition from "every defect present" to
      "every defect matches its declared disposition", so a **re**-introduction fails as loudly as an
      undocumented repair does. Set D-5 to `repaired`; leave D-1 … D-4 at `recorded` and untouched.
- [x] 5.2 Regenerate `SBOM.md` (`node script/generate-sbom.mjs`) and confirm it exits 0 and prints
      the per-defect disposition line for all five. Update §4's heading and preamble so the section
      reads as "disposition per defect" rather than a blanket "recorded, **not** repaired".
      `core.autocrlf=true` can make a regenerated file present as dirty with an empty diff — expect
      it, do not chase it.
- [x] 5.3 Update `UPSTREAM.md`: state that the canonical artifact is now built from `rust/`; state
      what S01 decided and why, and what changed (upstream is archived, so the published package can
      never carry the exports C0b adds) — **reversal with a reason, not a silent overwrite**; move
      the Rust / `wasm32-unknown-unknown` / `wasm-pack` toolchain rows from "only needed for the
      optional wasm rebuild" to required prerequisites; and record measurements A and B with every
      difference attributed.
- [x] 5.4 Update the D-5 row in `UPSTREAM.md`'s known-upstream-defects table from recorded to
      repaired, naming the patch id and the evidence — the record must not describe a defect as
      unrepaired when it has been repaired.
- [x] 5.5 Append `PATCHES.md` entries for every modified inherited file (`package.json`,
      `apps/web/package.json`, `bun.lock`, `script/generate-sbom.mjs`, and either build config if
      2.5 forced a change), each with the forcing clause and the verification. `rust/wasm/LICENSE`
      and `script/check-wasm-source.mjs` are **new files, not patches** — do not add rows for them.

      > **Corrected during implementation — this task's file list was wrong in two directions.**
      > `script/generate-sbom.mjs` is **fork-added, not inherited** (`git ls-tree cf5e79e9` finds no
      > such path), so per `PATCHES.md`'s own header rule it gets **no** row; adding one would have
      > logged a nonexistent upstream modification. Neither build config was touched, because 2.5's
      > hypothesis held. Conversely the task list **missed two inherited files** this change does
      > modify: root `README.md` and `rust/wasm/README.md`. Rows written: **P-021** `package.json`,
      > **P-022** `apps/web/package.json`, **P-023** `bun.lock`, **P-024** `README.md`,
      > **P-025** `rust/wasm/README.md` — which is exactly the set
      > `git diff --name-only cf5e79e9` reports as inherited-and-modified by this change.
- [x] 5.6 Update the developer path documentation with the required ordering — `script/setup-rust` →
      `bun run build:wasm` (with `CARGO_TARGET_DIR` on `C:`) → `bun install` → Host build — and with
      the re-install requirement if 2.2 found bun copies rather than symlinks.
- [x] 5.7 Regenerate `SOURCE_INVENTORY.md` **after** the commit that changes the compared set, if the
      generator's scope covers any file this change touched, and commit the regenerated content —
      `upstream-provenance` requires a derived inventory to be generated against the committed state.
      If its scope does not cover them, record that it does not, rather than skipping silently.

## 6. Evidence and gates

- [x] 6.1 Build both Hosts for production and run `bun run test:parity` in `apps/vite-example`.
      Compare against the task 0.5 snapshots with `script/diff-parity-snapshots.mjs`. **Expected:
      unchanged.** Any movement is a defect of this change — an artifact source swap with an
      identical exported API cannot legitimately move editing behaviour. Report; do not re-baseline.
- [x] 6.2 Re-run every existing check script and record each result:
      `check-type-baseline.mjs` (≤ 3, `PASS`), `check-asset-manifest.mjs`,
      `check-storage-boundary.mjs`, `check-next-imports.mjs`, `check-distributable-boundary.mjs`,
      `check-reference-boundary.mjs`, plus the new `check-wasm-source.mjs` and its negative control.
- [x] 6.3 Confirm the CI ordering still holds: `.github/workflows/bun-ci.yml` builds the wasm before
      `bun install` on all three runners. If the workflow needs no edit, say so explicitly with the
      reason — a step that is now load-bearing rather than vestigial is worth recording even when its
      text is unchanged.
- [x] 6.4 **Write-set audit.** `git diff --name-only main@49f8a88a` and assert **no path under
      `apps/web/src/`**. The C0 ∥ C1 concurrency edge rests on this. Assert
      `script/fixtures/type-baseline.json` is unmodified.

## 7. Spec-falsification sweep — manual, and no tool catches it

- [x] 7.1 Grep **all eight** capability specs under `rasen/specs/` for assertions this change's diff
      makes false — `browser-persistence-boundary`, `developer-reproducibility`,
      `editing-parity-fixture`, `host-service-boundary`, `inherited-defect-repair`,
      `next-free-distributable-boundary`, `runtime-asset-delivery`, `upstream-provenance`. **Eight,
      not seven**: `inherited-defect-repair` was added by Track 1's archive and post-dates the Slice
      Plan's count. Include numbered `SHALL` clauses inside requirement **prose**, not only scenario
      bullets — that is where this failure mode hides.
- [x] 7.2 Confirm the two already-identified falsifications are declared MODIFIED and that the delta
      copies each requirement block in full with a byte-exact header:
      `upstream-provenance` → *"The wasm rebuild correspondence result is recorded"* (its
      *"the published npm package remains the recorded parity source"* clause becomes false) and
      *"Repairing a donor code defect does not repair a recorded metadata defect"* (its *"every
      recorded metadata defect is still detected as present"* scenario becomes false when D-5 is
      repaired); `developer-reproducibility` → *"A documented path takes a clean checkout to a
      running production build"* (*"for the optional wasm rebuild"* becomes false).
- [x] 7.3 Confirm these are **not** falsified, and record why, so the sweep is auditable rather than
      assertive: `upstream-provenance`'s scenario enumerating the four pre-known metadata defects
      (D-1 … D-4 are untouched; D-5 is not in that list); `next-free-distributable-boundary`'s
      *"Declared-but-unused root manifest entries do not affect the boundary result"* (the three
      entries it names are unchanged); `runtime-asset-delivery`'s *"WASM and worker modules load from
      the production build"* (still true, and re-evidenced by 6.1).
- [x] 7.4 Record the sweep's method and its negative results in the change, not just its hits.
