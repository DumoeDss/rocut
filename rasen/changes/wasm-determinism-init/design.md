# Design — `wasm-determinism-init`

## Context

Two S05 Direction findings, both about `rust/wasm/pkg`, both re-measured at HEAD (`661d7ac8`)
before anything was designed. The measurements moved the design substantially, so they are stated
first and the decisions are derived from them.

### M1 — what actually fails at runtime

| runtime | `import "opencut-wasm"` at HEAD | why |
| --- | --- | --- |
| node 24.14.0 | **works** — 38 exports, `TICKS_PER_SECOND() = 120000` | implements the WebAssembly/ESM integration, so the bundler entry's `import * as wasm from "./opencut_wasm_bg.wasm"` yields instance exports |
| bun 1.2.18 | **fails** — `TypeError: wasm.__wbindgen_start is not a function` | resolves a `.wasm` import to an asset: the namespace is `{__esModule, default: "<path string>"}` |
| vite / webpack (`vite-plugin-wasm` + `topLevelAwait`) | works | that is what the bundler target is for |

So the S05 record's "bun-version-independent, identical in-repo and from tarballs" observation was
right, and its implied diagnosis — a property of the artifact — was wrong. It is a **runtime
capability gap**, and the artifact is fine.

### M2 — what actually fails in CI

`check-wasm-api-surface` at HEAD, Windows, rustc 1.88.0 + wasm-pack 0.13.1, fails with **exactly
two** errors: `LICENSE` and `README.md` "changed from the C0 before-state". Everything else passes.
The CI (ubuntu) run of the same commit failed with **five**: those two, plus `package.json`,
`opencut_wasm_bg.wasm.d.ts` and `wasm-exports … not the exact recorded set of 58`.

- The two shared errors are **stale recordings, not platform binding**:
  `sha256(crlf(LICENSE)) = 8117f9bb…3f59d3d` and `sha256(crlf(rust/wasm/README.md)) =
  a09d7957…6b4d3191` are precisely the two recorded values. Commit `1646ee5a` normalised the blobs
  to LF after recording. wasm-pack copies both byte-for-byte, so they are platform-independent.
- The three CI-only errors are **toolchain drift**: the merge run installed wasm-pack **v0.15.0**
  (`version: latest`) and never pinned rustc. The repo's own `UPSTREAM.md` § WASM rebuild
  correspondence already documents that the three
  `wasm_bindgen__convert__closures_____invoke__h…` export names are rustc symbol hashes that differ
  between compiler versions (measured there across rustc 1.94.1 vs 1.88.0) — which is the
  `wasm-exports` error verbatim.

Neither cause is "the contract is bound to the recording machine". Both are fixable without
weakening a single assertion.

## Decisions

### D1 — Repair wasm-init by adding an entry, not by changing the target

Rejected: switching wasm-pack to `--target web` or `--target nodejs`. `web` still requires an
explicit async `init()` before any call, which the consumers cannot do — `packages/editor-classic/src/wasm/media-time.ts`
calls `TICKS_PER_SECOND()` at *module evaluation* time, so a top-level-await-free consumer breaks
identically. `nodejs` emits CommonJS and would break every bundler consumer. Both rewrite
`opencut_wasm.js`, whose bytes are a recorded contract term and whose behaviour three Hosts depend
on.

Chosen: keep `--target bundler` untouched and **add** `opencut_wasm_sync.js`, which does explicitly
what a bundler does implicitly — compile the binary from disk, instantiate it against the glue
module, `__wbg_set_wasm`, `__wbindgen_start()` — then route the `bun` condition to it via the
generated manifest's `exports` map, with a declared `./sync` subpath for other runtimes. `default`
stays on the bundler entry, so browsers and bundlers resolve exactly what they resolved before.

### D1a — `node` and `require` were implemented, measured, and removed

The first implementation routed `bun` / `node` / `require`. It **broke this repository's own Next
Host**, twice, and the failures are why the final map is narrow:

1. `readFileSync(new URL("./opencut_wasm_bg.wasm", import.meta.url))` → turbopack SSR build failed
   with `The "path" argument must be of type string or an instance of Buffer or URL. Received an
   instance of URL` (node's `instanceof URL` check against its own realm; turbopack bundles its own).
2. Rewritten to a realm-independent path string → the same build failed with
   `ERR_INVALID_URL, input: '/_next/static/media/opencut_wasm_bg.00e3ae0a.wasm'`: turbopack had
   rewritten the URL to a **browser asset path**, which no server-side `readFileSync` can open.

`bun` and `deno` are runtime-only conditions; `node` is claimed by every bundler targeting node,
none of which can serve an entry that reads its own `.wasm` off disk. So the map declares `bun` plus
an explicit `./sync` subpath, and `check-wasm-api-surface` asserts a `node` condition is **absent**
(`node-condition-added` is a negative control). With `bun` narrowed this way, `apps/web`'s Next
build is green again — verified, not assumed.

Consequences accepted:

- The manifest gains an `exports` map, which *seals* deep paths unless declared. `"./*": "./*"` is
  included so every path that resolved before still resolves — including
  `opencut-wasm/opencut_wasm.js`, which the init gate's negative control imports by name.
- No `require` condition is needed: Node's `default` is a catch-all, so
  `createRequire(…).resolve("opencut-wasm")` in `check-wasm-source.mjs` still resolves (to the
  bundler entry) instead of throwing `ERR_PACKAGE_PATH_NOT_EXPORTED`. Verified by running that gate.
- Node consumers older than the WebAssembly/ESM integration must import `opencut-wasm/sync`. Stated
  in `packages/editor-classic/README.md` and reported by the init gate as an `INFO` line carrying
  the running node version, rather than asserted — a gate that failed there would be gating node's
  release schedule.
- Condition **order** matters (`types` first, `default` last) and is therefore pinned in the
  contract by comparing the serialised object, not a key set.

### D2 — Generate the entry; never hand-maintain the export list

The re-exported names must equal the bundler entry's exactly, and wasm-bindgen rewrites them on
every surface change. `emitSyncEntry` slices `opencut_wasm.js`'s own `export { … } from` block and
splices it verbatim, so drift is impossible by construction — and `check-wasm-api-surface`'s new
`entry-parity` assertion checks the equality anyway, because "impossible by construction" is the
kind of claim this repository requires to be measured.

### D3 — Pin the toolchain, and enforce the pin at the build

`rust-toolchain.toml` pins rustc (rustup applies it to every cargo invocation, locally and in CI);
`WASM_PACK_VERSION` in `script/wasm-toolchain.mjs` pins wasm-pack, which selects both the
wasm-bindgen CLI that writes the glue and the `wasm-opt` build that rewrites the binary.
`script/build-wasm.mjs` asserts both **before** wasm-pack runs, because a mismatched build produces
an artifact that passes the source gate, the path gate, the type baseline and both Host builds, and
only fails three steps later in a way that reads like a source change.

`check-wasm-source.mjs` additionally asserts the *wiring* of the pins — that the workflow's
`jetli/wasm-pack-action` input is the recorded tag rather than `latest`, that a CI step runs
`rustup toolchain install` (the command that actually applies `rust-toolchain.toml`; a bare
`rustup target add` installs against the image's default rustc, which is the state that produced
the red leg), and that `build-wasm.mjs` still calls the assertion. Same reasoning as the existing
gate-wiring section it sits beside: a pin nobody applies is indistinguishable from no pin.

Pin values: **rustc 1.88.0**, **wasm-pack 0.13.1** — the toolchain the current contract was recorded
with, so the pin costs zero re-recording. Bumping either is a deliberate operation that re-records
the surface, stated in `rust-toolchain.toml`'s own header.

### D4 — Re-record the two stale hashes; do not relax the assertion

The alternative — dropping `LICENSE`/`README.md` from the pinned set because "they are only
metadata" — is the silent-widening move this repository has a history with. They stay pinned; the
values are corrected to the LF bytes, and the contract file carries the derivation
(`sha256(crlf(x))` equals the old value) so the correction is checkable rather than assertable.
`unchangedHashes` is renamed `pinnedHashes` because after this change one of its members
(`package.json`) is deliberately *not* the C0 byte-state, and a name that lies is worse than a
rename.

### D5 — Add a runtime gate, because every existing wasm gate is static

The source gate compares bytes, the path gate scans strings, the API gate hashes files and counts
exports. All three were green for the whole S05 portfolio while the artifact could not be
initialized outside a bundler. `script/check-wasm-init.mjs` runs it: the bare specifier under node
and bun, cross-runtime agreement on four computed values, and classic's **real** 31-step migration
chain — the exact consumer S05 recorded as unloadable — with no `mock.module` and no
`evidence/wasm-test-mock` in the process.

Its negative control is the pre-fix world rather than a synthetic mutation: importing the
`--target bundler` entry directly under bun must still fail with `__wbindgen_start`. If bun ever
implements the integration that control fails loudly, which is the correct outcome — it means the
generated entry became redundant and someone should decide that on purpose.

### D6 — Reproducibility is a measurement with a population, and a local gate

`script/check-wasm-reproducible.mjs` rebuilds and compares all nine files. By default the second
build uses a **different `CARGO_TARGET_DIR`**, so it is a full recompile at a different absolute
path — which also measures path-independence by construction rather than by scanning. It is
registered as `check:wasm:reproducible`, **not** added to `check:wasm` or to `check-wasm-source`'s
`GATED` list, because that list means "runs in CI" and a multi-minute recompile does not. Saying so
here is the point: the honest shape is a local gate that is named as local.

## Cross-platform claim

Cross-platform byte-identity is **not** asserted by this change. What is asserted, and what CI
proves on the 3-OS matrix, is that the *recorded surface* holds everywhere: the pinned hashes, the
wasm-bindgen-generated declarations and glue, the 38/646/58/609 export and import signatures, the
entry parity and the exports conditions. The binary's own bytes are pinned only negatively (they
must differ from the C0b baseline), exactly as before this change — no new cross-platform byte
claim is introduced, and none is needed for the gate to be green on all three runners.

A local Linux reproduction was attempted (WSL Ubuntu-24.04) and **abandoned, stated rather than
hidden**: the distribution has no C toolchain and no passwordless sudo to install one, so proc-macro
crates cannot link. The Linux evidence in this change is therefore CI's own matrix, which is the
surface that has to be green anyway.
