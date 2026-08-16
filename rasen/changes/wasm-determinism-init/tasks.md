# Tasks — `wasm-determinism-init`

Base: `661d7ac8` (`main`, PR #2 merge). Branch `fix/wasm-determinism`.
Evidence: `rasen/changes/wasm-determinism-init/evidence/`.

## 1. Measure before designing

- [x] 1.1 Reproduce `check-wasm-api-surface` at HEAD on the local toolchain (rustc 1.88.0,
      wasm-pack 0.13.1). Result: **exactly 2 errors** (`LICENSE`, `README.md`), everything else
      green — so the CI redness is not one phenomenon.
- [x] 1.2 Pull the merge run's failing log (`gh run view 31915394334 --log-failed`). Result: **5
      errors** on ubuntu; the CI-only three are `package.json`,
      `opencut_wasm_bg.wasm.d.ts`, `wasm-exports`. Same log shows
      `Installing wasm-pack v0.15.0` from `version: latest`.
- [x] 1.3 Prove the two shared errors are stale recordings, not platform binding:
      `sha256(crlf(LICENSE))` and `sha256(crlf(rust/wasm/README.md))` equal the two recorded
      values exactly; `git ls-files --eol` shows `i/lf w/lf` for both today.
- [x] 1.4 Reproduce wasm-init and isolate the runtime, not the artifact: node 24 imports
      `opencut-wasm` fine (38 exports, `TICKS_PER_SECOND()=120000`); bun 1.2.18 resolves the
      `.wasm` import to `{__esModule, default: "<path string>"}`.
- [x] 1.5 Prototype the explicit-instantiation entry against the built artifact; identical results
      under bun and node.
- [x] 1.6 Record the binary's `producers` section (`rustc 1.88.0 …`, `walrus 0.26.1`,
      `wasm-bindgen 0.2.116`) and the three rustc symbol-hash trampoline exports, which are the
      named cause of the `wasm-exports` delta.

## 2. Repair wasm-init

- [x] 2.1 `script/build-wasm.mjs` — `emitSyncEntry()`: emit `opencut_wasm_sync.js` with the
      re-export block **sliced from `opencut_wasm.js`**, and patch the generated manifest with
      `exports` (`types`/`bun`/`node`/`require`/`default` + `./*` passthrough), `files` and
      `sideEffects`.
- [x] 2.2 `script/check-wasm-api-surface.mjs` — pin the new file, add `entry-parity` (identical
      re-export block, and the entry actually calls `__wbg_set_wasm`/`__wbindgen_start`) and
      `entry-conditions` (serialised condition object, order included, plus the `./*` passthrough).
- [x] 2.3 Four new negative controls (`sync-entry-export-drift`, `sync-entry-uninitialized`,
      `condition-swap`, `condition-dropped`). Control count **14 → 18**, all firing.
- [x] 2.4 `script/check-wasm-init.mjs` + two fixtures — the runtime gate: both runtimes,
      cross-runtime agreement, the real mock-free migration chain, and a negative control that is
      the pre-fix world rather than a synthetic mutation.
- [x] 2.5 Wire it: root `check:wasm`, `GATED` in `check-wasm-source.mjs`, and a CI step after the
      api-surface step.

## 3. Determinism

- [x] 3.1 `rust-toolchain.toml` — rustc `1.88.0`, `wasm32-unknown-unknown`, minimal profile.
- [x] 3.2 `script/wasm-toolchain.mjs` — reads the channel from the toolchain file, carries
      `WASM_PACK_VERSION`, asserts both with a fix-command message.
- [x] 3.3 `script/build-wasm.mjs` asserts the pins **before** wasm-pack runs
      (`OPENCUT_WASM_ALLOW_UNPINNED=1` escape hatch, labelled as a local experiment).
- [x] 3.4 CI: `rustup toolchain install` (the command that applies the toolchain file) and
      `jetli/wasm-pack-action` pinned to `v0.13.1` in **both** jobs.
- [x] 3.5 `check-wasm-source.mjs` asserts the pin wiring: the workflow's literal action version,
      the presence of `rustup toolchain install`, and that `build-wasm.mjs` still calls
      `assertToolchain()`.
- [x] 3.6 Re-record the two stale hashes and the post-processed `package.json`; rename
      `unchangedHashes` → `pinnedHashes` (one member is deliberately no longer the C0 byte-state)
      and write the derivation into the contract file.
- [x] 3.7 `script/check-wasm-reproducible.mjs` + `check:wasm:reproducible`. Fresh
      `CARGO_TARGET_DIR` by default, so it is a full recompile at a different absolute path.

## 4. Verification

- [x] 4.1 `bun run check:wasm` — all four gates green (log: `check-wasm-chain-final.log`).
- [x] 4.2 `node script/check-wasm-api-surface.mjs --negative-control` — 18/18 fire.
- [x] 4.3 `bun run check:wasm:reproducible` — 10/10 files byte-identical across a fresh-target
      full recompile.
- [x] 4.4 **Mutation verification**: revert `rust/wasm/pkg` to the pre-fix shape (delete the sync
      entry, strip the `exports` map) and re-run. `check-wasm-init` refuses (exit 2),
      `check-wasm-api-surface` fails `generated-files` (exit 1), the mock-free chain probe fails
      with the original `__wbindgen_start` error. Restored by `build:wasm` + `bun install`; the
      reverted `package.json` hashed back to the **original recorded** `6eab1bdb…`, proving the
      post-processing is exactly the three-key delta and nothing else.
- [x] 4.5 `bun test` on both sides of the mutation: **identical** — 724 pass / 6 fail / 3375
      expect() / 730 tests / 118 files, same six failure names. (The suite mocks `opencut-wasm`
      globally, so it never exercised the real entry either way; the six failures are pre-existing
      and unrelated — see `evidence/regression.md`.)
- [ ] 4.6 `apps/web` Next build (the `node` condition's blast radius) and `apps/vite-example`
      build (`default` condition unchanged).
- [ ] 4.7 Checker-family sweep, before/after, with the exit-code census.
- [ ] 4.8 Executable dead-target scan over every path string this change introduced.

## 5. Documentation

- [x] 5.1 `packages/editor-classic/README.md` — the constraint section replaced by the repair.
- [x] 5.2 `BOUNDARIES.md` §16 amended (the carried finding, marked closed, original text kept) and
      §17 added with the full account and the "what is NOT claimed" list.
- [x] 5.3 `UPSTREAM.md` — dated amendment: the generated `package.json` is deliberately no longer
      byte-identical to published `0.2.10`, delta enumerated.
- [x] 5.4 `script/generate-sbom.mjs` D-4 — `verbatim` updated and the post-processing named, so the
      SBOM entry stays true (its probe still fires: the `./snippets/*` entry is untouched).

## 6. Delivery

- [ ] 6.1 Logical commits, explicit pathspecs, `.rasen/` staging guard, LF verified.
- [ ] 6.2 Independent review (author ≠ verifier), findings graded, fixes mutation-verified.
- [ ] 6.3 Push `fix/wasm-determinism`, open the PR to `DumoeDss/rocut` `main`, CI green on the
      3-OS matrix — which is this change's only cross-platform evidence, stated as such.
