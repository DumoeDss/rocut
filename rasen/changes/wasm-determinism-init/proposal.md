## Why

S05 closed with two Direction-level wasm findings, both carried forward unrepaired:

1. **wasm-init.** classic's `./storage/migrations` chain cannot initialize outside the
   `@opencut/editor-classic/evidence/wasm-test-mock` entry: `TypeError: wasm.__wbindgen_start is
   not a function`. Recorded as bun-version-independent, identical in-repo and from installed
   tarballs, and honestly documented in `packages/editor-classic/README.md` as a constraint of
   the current `0.x` surface.
2. **Cross-platform determinism.** `check-wasm-api-surface` was described as a
   "recording-machine-bound" check — a contract recorded on Windows that the Linux CI toolchain
   could not satisfy. PR #2 merged with that leg red and the redness documented.

Both descriptions are now **measured to be wrong in their diagnosis**, and the measurements point
at two different, individually fixable causes:

- **wasm-init is not a wasm defect and not bun-version-dependent — it is a `.wasm`-import
  capability difference between runtimes.** wasm-pack's `--target bundler` entry is
  `import * as wasm from "./opencut_wasm_bg.wasm"; …; wasm.__wbindgen_start();`, which requires
  the WebAssembly/ESM integration. Measured at HEAD on this build:
  - **Node 24.14.0**: `import("opencut-wasm")` succeeds, 38 exports, `TICKS_PER_SECOND() === 120000`.
    The bundler entry already works there.
  - **Bun 1.2.18**: `import("…/opencut_wasm_bg.wasm")` returns `{__esModule, default}` where
    `default` is a **string** (asset URL) — bun treats `.wasm` as an asset, so `wasm.__wbindgen_start`
    is `undefined`. That is the whole error.

  The fix is therefore a real one and small: ship a second, generated entry that instantiates the
  same binary explicitly and select it through the package's `exports` conditions. Prototyped
  against the built artifact: identical results under **both** bun 1.2.18 and node 24
  (`TICKS_PER_SECOND()=120000`, `mediaTimeFromSeconds({seconds:2})=240000`,
  `roundToFrame({time:12345,rate:30/1})=12000`).

- **The api-surface redness is two unrelated causes, neither of them "machine-bound recording".**
  Reproduced at HEAD on this Windows machine with the pinned-equivalent local toolchain
  (rustc 1.88.0, wasm-pack 0.13.1): the check fails with **exactly two** errors —
  `LICENSE changed from the C0 before-state` and `README.md changed from the C0 before-state`.
  Every other assertion (`opencut_wasm.d.ts`, `opencut_wasm.js`, `opencut_wasm_bg.wasm.d.ts`,
  the 38/646/58/609 export-import signatures, `package.json`) **passes**. The two recorded
  hashes are the **CRLF-era bytes**, proven by construction:
  `sha256(crlf(LICENSE)) = 8117f9bb…3f59d3d` and `sha256(crlf(rust/wasm/README.md)) = a09d7957…6b4d3191`
  are *exactly* the two values in `wasm-api-surface-contract.mjs`, while the LF bytes in the tree
  today hash to `81463236…8ca39a6e` / `c8fe27ab…3d90a128`. Commit `1646ee5a` normalized those
  blobs to LF **after** the contract was recorded, so the contract has been unsatisfiable on
  *every* platform since — Windows included. This is a stale recording, not a platform binding.

  The genuinely platform/CI-specific part is the remaining three CI errors
  (`package.json`, `opencut_wasm_bg.wasm.d.ts`, `wasm-exports: not the exact recorded set of 58`),
  and their cause is **an unpinned toolchain**, not the operating system: the CI run installed
  **wasm-pack v0.15.0** (`version: latest`) against this repo's 0.13.1-recorded output, and the
  workflow never pins rustc at all — it runs whatever the runner image ships, while the recorded
  surface carries `rustc 1.88.0 (6b00bc388 2025-06-23)` verbatim in the binary's `producers`
  section, and three of the 58 wasm exports are rustc-symbol-hash names
  (`wasm_bindgen__convert__closures_____invoke__h6e68ca372e8bf468`, …) that move with the compiler.

## What Changes

- **A generated, explicitly-instantiating package entry** (`opencut_wasm_sync.js`) emitted into
  `rust/wasm/pkg` by `script/build-wasm.mjs`, plus an `exports` map on the generated
  `package.json` routing the **`bun`** condition (and a declared `./sync` subpath) to it, leaving
  every other condition on the untouched `--target bundler` entry. Re-exports exactly the same
  public names as the bundler entry, derived from that entry's own export block at build time. No
  second cargo build, no second binary, no change to `opencut_wasm.js`. A `node` condition was
  implemented first and removed after it broke the Next Host's SSR build twice — see design D1a;
  the contract now asserts that condition is absent.
- **Toolchain pinning as the determinism fix**: a root `rust-toolchain.toml` (`1.88.0`,
  `wasm32-unknown-unknown`), a pinned `wasm-pack` version in CI instead of `latest`, and a
  **build-time assertion** in `script/build-wasm.mjs` that refuses to build on a mismatched
  `rustc`/`wasm-pack`, so the pin is enforced rather than conventional.
- **Re-recorded contract values** for the two stale CRLF-era hashes, with the derivation written
  into the contract file so the next reader can re-verify rather than trust.
- **Contract coverage of the new entry**: its byte hash and its export set join the recorded
  surface, and the negative-control table gains controls for both, so the added entry cannot
  drift silently.
- **A same-machine byte-reproducibility check** (`script/check-wasm-reproducible.mjs`) plus a
  recorded cross-platform (Windows vs Linux) hash table, so "deterministic" is a measured claim
  with a population, not an adjective.
- **Documentation updated to the measured truth**: the `packages/editor-classic/README.md`
  constraint and the BOUNDARIES §16 "carried finding" record.

## Capabilities

### New Capabilities

None. No product capability is added; this is build-toolchain and packaging work behind the
existing wasm gates.

### Modified Capabilities

None. No frozen public signature of `@opencut/editor-ports`, `@opencut/editor-contracts` or
`@opencut/editor-classic` changes. The `opencut-wasm` artifact keeps the identical 38 public
exports; only the *resolution condition* under which a non-bundler runtime reaches them is added.

## Impact

- `rust-toolchain.toml` (new), `script/build-wasm.mjs`, `script/check-wasm-api-surface.mjs`,
  `script/wasm-api-surface-contract.mjs`, `script/check-wasm-reproducible.mjs` (new),
  `script/check-wasm-source.mjs` (gate registration), root `package.json` (`check:wasm`),
  `.github/workflows/bun-ci.yml`.
- `packages/editor-classic/README.md`, `BOUNDARIES.md` §16.
- Tests: a non-mock initialization test for the real entry and the real migration chain.
- **Out of scope, unchanged**: any frozen public signature (S03/S04/S05 freeze surfaces),
  `apps/desktop`, and the 255-error lint debt.
