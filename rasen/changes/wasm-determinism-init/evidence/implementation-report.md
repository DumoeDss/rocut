# Implementation report — `wasm-determinism-init`

Base `661d7ac8`, branch `fix/wasm-determinism`. Numbers live in
[`regression.md`](./regression.md); this file records what was built, what was measured before
building it, and the two things that turned out differently from the brief.

## What the brief said, and what the measurements said

The task carried two S05 Direction findings with their S05 diagnoses attached. Both diagnoses moved
under measurement, and the design follows the measurements rather than the brief.

| | S05's diagnosis | measured at HEAD |
| --- | --- | --- |
| wasm-init | a property of the artifact, "bun-version-independent", a fix owned at Direction level and possibly outside `0.x` | a **runtime capability gap**: node 24 imports `opencut-wasm` fine (38 exports, `TICKS_PER_SECOND()=120000`); bun resolves the `.wasm` import to `{__esModule, default: "<path string>"}`, so there is no `__wbindgen_start`. Nothing in the binary or in `@opencut/editor-classic` had to change. |
| api-surface red leg | a contract "bound to its recording machine", Windows-recorded vs Linux CI | **two unrelated causes**: two stale CRLF-era hashes that fail on *every* platform (reproduced on Windows: exactly `LICENSE` and `README.md`, nothing else), and three CI-only errors caused by an **unpinned toolchain** (`wasm-pack: latest` installed v0.15.0; rustc never pinned at all) |

The CRLF claim is proof by construction, not inference: `sha256(crlf(LICENSE))` and
`sha256(crlf(rust/wasm/README.md))` are byte-for-byte the two values the contract carried, while
`git ls-files --eol` reports `i/lf w/lf` for both today. Commit `1646ee5a` normalised those blobs
after the contract was recorded.

The rustc claim did not need new work either — this repository had already measured it and written
it down in `UPSTREAM.md` § WASM rebuild correspondence: three of the 58 wasm exports are
`wasm_bindgen__convert__closures_____invoke__h…` symbol-hash names that differ between rustc
versions (measured there across 1.94.1 vs 1.88.0). `wasm-exports: binary export set is not the
exact recorded set of 58` is that, verbatim.

## What was built

**wasm-init.** `script/build-wasm.mjs` gains `emitSyncEntry()`: after wasm-pack succeeds it writes
`rust/wasm/pkg/opencut_wasm_sync.js` — compile the binary from disk, build the import object from
the binary's own declared import module names, instantiate, `__wbg_set_wasm`, `__wbindgen_start()`,
then re-export the public names — and patches the generated manifest with `files`, `sideEffects`
and an `exports` map. The re-export list is **sliced from `opencut_wasm.js`'s own
`export { … } from` block**, so the two entries cannot disagree.

**The routing is narrower than the obvious answer, and that is a finding.** The first
implementation routed `bun` / `node` / `require` and broke this repository's own Next Host twice
(both logs committed):

1. `readFileSync(new URL(…))` → turbopack SSR: `Received an instance of URL` (node's `instanceof`
   check against its own realm; turbopack bundles its own `URL`).
2. realm-independent path string → `ERR_INVALID_URL, input:
   '/_next/static/media/opencut_wasm_bg.00e3ae0a.wasm'` — turbopack had rewritten the asset URL to a
   browser path no server-side read can open.

`bun` and `deno` are runtime-only conditions; `node` is claimed by every bundler targeting node.
The shipped map declares `bun` plus an explicit `./sync` subpath, `check-wasm-api-surface` asserts
a `node` condition is **absent**, and `node-condition-added` is one of its negative controls. With
that, the Next build is green again.

No `require` condition is needed: Node's `default` is a catch-all, so
`createRequire(…).resolve("opencut-wasm")` in `check-wasm-source.mjs` still resolves rather than
throwing `ERR_PACKAGE_PATH_NOT_EXPORTED` — verified by running that gate, not assumed.

**The runtime gate.** `script/check-wasm-init.mjs` is the 4th wasm gate and the first non-static
one. Its negative control is the pre-fix world rather than a synthetic mutation: the
`--target bundler` entry imported directly under bun must still fail with `__wbindgen_start`. Node's
bare-specifier behaviour is reported as an `INFO` line carrying the running version, deliberately
not asserted — a gate that failed there would be gating node's release schedule.

**Determinism.** `rust-toolchain.toml` (rustc 1.88.0 + wasm32 target), `WASM_PACK_VERSION` in
`script/wasm-toolchain.mjs` (0.13.1), asserted by `build-wasm.mjs` **before** wasm-pack runs, with
the wiring itself asserted by `check-wasm-source.mjs` (the workflow's literal action version, the
presence of `rustup toolchain install`, and that `build-wasm.mjs` still calls the assertion). Both
pins are the toolchain the contract was recorded with, so pinning cost zero re-recording of the
wasm surface.

**Reproducibility.** `script/check-wasm-reproducible.mjs`, registered as
`check:wasm:reproducible` and **not** added to `check:wasm` or to `GATED` — that list means "runs in
CI", and a multi-minute recompile does not. Naming it as a local gate is the point.

## Two defects found in the checkers while wiring, both fixed

1. **`check-wasm-source` reported a false gate-ordering failure.** It located a CI gate with
   `workflow.indexOf(gate)`, which also matches the *comment* above a step. Adding an explanatory
   comment that mentioned `script/check-wasm-source.mjs` above `bun install` made it report the gate
   as running before the install. Tightened to match the `run:` command line.
2. **`check-wasm-api-surface` stack-traced on a missing recorded file** instead of reporting it
   (`ENOENT` out of `readFileSync`). It now reports
   `generated-files: <name> is absent from rust/wasm/pkg` and exits 1 — found while producing the
   mutation evidence, which is exactly the situation it now handles.

## Documentation updated to the measured truth

`packages/editor-classic/README.md` (constraint → repair, with the consumer-facing routing),
`BOUNDARIES.md` §16 (finding marked closed, original text kept verbatim as the record of what was
known then) and new §17 (the full account plus an explicit "what is NOT claimed" list),
`UPSTREAM.md` (dated amendment: the generated `package.json` is deliberately no longer byte-identical
to published `0.2.10`, delta enumerated), and `script/generate-sbom.mjs` D-4 (`verbatim` updated and
the post-processing named, so the entry stays true — its probe still fires because the
wasm-pack-emitted `./snippets/*` entry is untouched).

## Cross-platform: what is and is not claimed

No cross-platform byte-identity claim is made. The binary's bytes stay pinned only negatively
(they must differ from the C0b baseline), exactly as before. What has to hold everywhere is the
*recorded surface* — pinned hashes, wasm-bindgen's generated declarations and glue, the
38/646/58/609 signatures, entry parity, exports conditions — and the evidence for that is CI's own
3-OS matrix.

A local Linux reproduction was attempted and abandoned: WSL Ubuntu-24.04 has no C toolchain and no
passwordless sudo to install one, so proc-macro crates cannot link. Stated rather than quietly
dropped; the CI matrix is the surface that has to be green regardless.
