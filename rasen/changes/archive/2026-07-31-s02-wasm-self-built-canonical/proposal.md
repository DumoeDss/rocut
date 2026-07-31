## Why

The editor consumes the **published npm `opencut-wasm@0.2.10`**, not the artifact built from this
repository's own `rust/` sources. That was deliberate in S01 — it kept the parity baseline free of
toolchain variables — but upstream is archived, so the published package can never gain a function
again. Slice S02 §4.1(c) measured the consequence: the WASM module exports exactly ten functions,
a case-insensitive search for `dispose|destroy|teardown|shutdown` across `rust/wasm/src`,
`rust/crates/gpu/src` and `rust/crates/compositor/src` returns **zero** hits, and
`COMPOSITOR_RUNTIME` / `GPU_RUNTIME` are `thread_local!` singletons. Releasing them requires **new
Rust exports**. C6's disposal claim and C0b's handle-keyed graphics API are therefore both
unreachable while the consumed artifact comes from a registry nobody can publish to.

This change is the spine prerequisite that unblocks them. It is **not** a provenance tidy-up, and it
is deliberately scoped so that it does not become one: no API change, no runtime behaviour change,
no new export.

Its entire observable outcome is that the self-built artifact **corresponds** to published
`opencut-wasm@0.2.10`. S01 established that the fork reproduces it byte-for-byte on the declaration
(`opencut_wasm.d.ts`), the manifest (`package.json`) and the entry glue (`opencut_wasm.js`), with
all **638 exported symbols identical** in `opencut_wasm_bg.js`. That correspondence is the whole
reason the switch is de-risked, and it is why the teardown and handle exports belong to C0b: adding
an export here would make the correspondence unprovable and the switch un-de-risked. C0 proves
*"same artifact, new origin"*; C0b then proves *"new origin, new API"*.

The provenance debt closes in the same change because it becomes a genuine release gate the moment
the built artifact is what ships. `rust/wasm/Cargo.toml` declares `license = "MIT"` while neither
`rust/wasm/LICENSE` nor `rust/LICENSE` exists — recorded as defect **D-5** in `SBOM.md` §4, whose
own text already says it "becomes a genuine release-gate defect at S02, when building the wasm from
source becomes the canonical path and the built package would be redistributed without its licence
text". Target State §9.4 and locked decision 11 make notices a release gate.

## What Changes

- **The `opencut-wasm` dependency resolves to the locally built `rust/wasm/pkg`** rather than the
  npm registry, in the root `package.json` and in `apps/web/package.json`, with `bun.lock`
  regenerated. **BREAKING for the developer path**: building the wasm becomes a required step before
  `bun install`, not an optional correspondence check. The upstream CI workflow already performs it
  in exactly that order (`.github/workflows/bun-ci.yml` installs the `wasm32-unknown-unknown`
  target, installs `wasm-pack`, and runs `wasm-pack build rust/wasm --target bundler --out-dir pkg`
  **before** `bun install`), so today that step is vestigial and this change makes it load-bearing.
- **`rust/wasm/LICENSE` is added**, byte-identical to the root MIT `LICENSE`, satisfying the crate's
  own `license = "MIT"` declaration and silencing the `wasm-pack` warning that fires on every build.
- **A new committed check, `script/check-wasm-source.mjs`**, asserts that the `opencut-wasm` the
  build actually resolves is the self-built artifact and not a registry copy, and that it is not
  stale relative to `rust/wasm/src`. It carries a **negative control** proving a green result is not
  vacuous. Without this, a leftover `node_modules/opencut-wasm` from the registry would silently
  satisfy every import and every downstream child in the Slice would be measuring the wrong
  artifact.
- **`script/generate-sbom.mjs` stops asserting D-5 is present.** Its probe currently returns true
  only while no LICENSE exists, and the generator `process.exit(1)`s when any documented defect goes
  missing. Adding the LICENSE therefore *breaks the generator* unless the defect's disposition moves
  from "recorded, not repaired" to "repaired, with patch id and evidence" — which is the same
  per-defect disposition discipline `upstream-provenance` already requires.
- **`UPSTREAM.md` records the switch**: the canonical artifact is now self-built, the toolchain moves
  from optional to required, and the correspondence evidence is re-established against the artifact
  that is actually consumed rather than carried forward on S01's word.
- **`PATCHES.md` gains entries** for every modified inherited file, per its own standing rule.
- **Not changed**: `rust/wasm/src/**`, `rust/crates/**`, any exported function, any call site,
  `apps/web/src/**`, and `script/fixtures/type-baseline.json`.

## Capabilities

### New Capabilities

- `self-built-wasm-artifact`: the wasm the editor loads is built from this repository's `rust/`
  sources, that fact is mechanically verifiable rather than documented, and the built artifact
  corresponds to the published `opencut-wasm@0.2.10` it replaces.

### Modified Capabilities

- `upstream-provenance`: two requirements change. **"The wasm rebuild correspondence result is
  recorded"** currently ends with *"the published npm package remains the recorded parity source"* —
  false once the self-built artifact is canonical; the correspondence criterion also has to survive
  a deliberate, attributed divergence rather than assuming equality forever. **"Repairing a donor
  code defect does not repair a recorded metadata defect"** asserts that *every* recorded metadata
  defect is still detected as present when the probe runs; D-5 is deliberately repaired here, so the
  requirement must distinguish an in-scope, patch-logged repair from an undocumented one instead of
  being left standing as a false assertion. (The separately-worded scenario enumerating the four
  pre-known metadata defects — `"opencut": "."`, root `next`/`better-auth`, the stale
  `repository` URL, `sideEffects` `./snippets/*` — is **not** touched: none of those four is
  repaired here.)
- `developer-reproducibility`: *"the required bun, Node and (**for the optional wasm rebuild**) Rust
  and wasm-pack versions"* becomes false — the wasm rebuild is no longer optional. The clean-checkout
  scenario's *"without an undocumented manual step"* likewise requires the wasm build to be a
  documented, ordered step in the developer path rather than an aside.

## Impact

**Files written by this change** (the complete write set; it must not intersect C1's):

| Path | Nature |
| --- | --- |
| `rust/wasm/LICENSE` | new file |
| `package.json` | `opencut-wasm` dependency source |
| `apps/web/package.json` | `opencut-wasm` dependency source |
| `bun.lock` | regenerated by `bun install` |
| `apps/vite-example/vite.config.ts` | module resolution only, if resolution needs help |
| `apps/web/next.config.ts` | module resolution only, if resolution needs help |
| `script/check-wasm-source.mjs` | new check |
| `script/generate-sbom.mjs` | D-5 disposition |
| `SBOM.md` | regenerated |
| `UPSTREAM.md` | canonical-artifact switch, toolchain, correspondence |
| `PATCHES.md` | patch entries |
| `README.md` / `apps/vite-example/README.md` | developer path ordering, if they document install |

**Explicitly not written**: `script/fixtures/type-baseline.json` (a pin snapshot regenerated only
from `git archive cf5e79e9`, never from HEAD — no child needs to edit it and none may),
`apps/web/src/**`, `rust/wasm/src/**`, `rust/crates/**`.

**Systems.** Both Hosts' production builds; the Playwright parity fixture on both Hosts; CI on three
runners. Downstream, every later S02 child inherits a worktree that needs the Rust wasm toolchain
before `bun install` — the cost is one cold build per machine, not per worktree, provided
`CARGO_TARGET_DIR` points at a shared path.

**Disk.** `E:` had 10.5 GB free at cohort launch against a ~2.5 GB per-worktree budget. The Rust
`target/` must be directed to `C:` via `CARGO_TARGET_DIR`; it is not allowed to land on `E:`.

**Concurrency.** Runs concurrently with C1 (`s02-port-contract-freeze`). The edge is safe only while
the write sets stay disjoint and neither child edits `script/fixtures/type-baseline.json`. If this
change discovers it must touch a file in C1's set, it stops and reports rather than proceeding.
