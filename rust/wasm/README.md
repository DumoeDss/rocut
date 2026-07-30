# opencut-wasm

Shared video editor logic compiled to WebAssembly. Used by the [OpenCut](https://github.com/opencut/opencut) web app.

## Install

```bash
npm install opencut-wasm
```

## Usage

```ts
import { formatTimecode, mediaTimeFromSeconds } from "opencut-wasm";

const ticks = mediaTimeFromSeconds(1.5);
const label = formatTimecode({ ticks });
```

All exports are documented in the [TypeScript definitions](./opencut_wasm.d.ts).

## Source

Functions are implemented in Rust under [`rust/crates/`](../crates/). This package is the compiled WebAssembly output — do not edit it directly.

## Local development

**This fork builds the package from source; the published npm `opencut-wasm` is not consumed.**
Both the root `package.json` and `apps/web/package.json` declare `opencut-wasm` as a `file:`
dependency on `rust/wasm/pkg`, so `bun install` resolves the specifier to the build output. No
`bun link` step is involved, and building the wasm is a required step **before** `bun install`
rather than an opt-in for wasm contributors.

```bash
# From the repo root, once per machine
script/setup-rust                        # or script/setup-rust.ps1 on Windows
rustup target add wasm32-unknown-unknown

# Then, before installing dependencies
bun run build:wasm
bun install
```

While you work, rebuild on changes from the repo root:

```bash
bun dev:wasm
```

**Re-run `bun install` after each rebuild.** bun installs a `file:` dependency as hard links, and
`wasm-opt` replaces `opencut_wasm_bg.wasm` instead of rewriting it, so that one file's link breaks
and the resolved copy silently keeps the previous build's pre-`wasm-opt` intermediate while every
other file looks current. `node script/check-wasm-source.mjs` asserts the resolved package really is
the current build output and names the command to run when it is not.
