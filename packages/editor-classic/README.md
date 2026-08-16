# @opencut/editor-classic

The OpenCut Classic provider and its React editor, including the embeddable Surface.
Depends on [`@opencut/editor-ports`](../editor-ports) and
[`@opencut/editor-contracts`](../editor-contracts). Classic's own machinery — the editor
core, session composition, browser runtime, storage with its migration chain, media,
timeline, renderer and the design-system UI atoms — lives here as the reference provider
implementation over the two contract packages.

## Compatibility policy (`0.x`)

This package is versioned `0.MINOR.PATCH`. Within the `0.x` range the public surface is
partitioned into three classes — recorded per export entry in this package's
[`surface.json`](./surface.json), which ships in the tarball beside this README — and a
minor release may change **exactly what the classes permit and nothing they don't**:

| class | promise within `0.x` |
| --- | --- |
| `frozen` | contract surface. Additive-only: entries and their signatures may be added, never changed, renamed, repointed or removed. A signature change at any `0.x` version is a contract finding, not a release. |
| `provider` | OpenCut Classic convenience. May change in any minor release; will not be silently removed within a minor. |
| `experimental` | explicitly unstable. May change **or be removed** in any minor release, without a deprecation window. |

- Patch releases fix defects without any public-surface change.
- This policy is the **only** stability claim this package makes. No `1.0`, GA or
  production-readiness claim exists in any published material.
- Non-frozen entries carry their class as an `@opencutSurface` marker in the entry's
  source file; frozen entries are classified in `surface.json` alone, so the frozen
  sources themselves stay untouched.

## Surface classes in this package

19 export entries (measurement: this manifest's `exports` map read at `0.2.0`, the
`./package.json` entry excluded as mechanical):

- **frozen (2)** — the embeddable Surface (`./surface`) and its stylesheet
  (`./surface.css`). This is the S03+S04 embedding contract; its `embedding/types.ts`
  is one of the four byte-identical frozen surfaces the portfolio's close-out control
  re-proves.
- **provider (13)** — Classic's own machinery: the root barrel (`.` — `EditorCore`,
  utils, wasm media-time helpers, defaults), session composition (`./session`), runtime
  (`./runtime`), browser runtime (`./browser`), storage (`./storage`,
  `./storage/conformance`, `./storage/migrations`), project, timeline, renderer, media,
  fonts and the UI atoms (`./project`, `./timeline`, `./renderer`, `./media`,
  `./fonts`, `./ui`).
- **experimental (4)** — the evidence harnesses (`./evidence`, `./evidence/headless`),
  the headless semantic fixture (`./evidence/headless-semantic-fixture`) and the wasm
  test-mock entry (`./evidence/wasm-test-mock`). Evidence/test infrastructure, unstable
  by intent: these may change or be removed as evidence needs evolve.

## `./storage/migrations` initialization (former constraint, repaired)

Earlier `0.x` text stated that the migration chain (the runner, the 31 transformers and
`CURRENT_PROJECT_VERSION`) required the wasm test-mock entry
(`@opencut/editor-classic/evidence/wasm-test-mock`) to initialize, because the chain died
with `wasm.__wbindgen_start is not a function` in any consumer that did not pre-initialize
the wasm module. **That is no longer true.** The chain loads in a plain TypeScript
consumer with no mock in the process.

The cause was never in this package, nor in the wasm binary. wasm-pack's
`--target bundler` entry initializes via `import * as wasm from "./opencut_wasm_bg.wasm"`,
which needs the WebAssembly/ESM integration; bun resolves a `.wasm` import to an asset path
string instead, so the module namespace had no `__wbindgen_start` to call. `opencut-wasm`
now also ships an explicitly-instantiating entry: bun reaches it automatically through the
package's `bun` export condition, and any other runtime that needs it imports
`opencut-wasm/sync` explicitly. Bundler and browser consumers keep resolving the same
bundler entry as before, byte-for-byte. `script/check-wasm-init.mjs` loads this exact chain,
mock-free, on every CI run and keeps the pre-fix failure as its negative control.

The chain still needs `culori` (a declared dependency since S05 P3) and a runtime that can
execute the shipped TypeScript source — in practice bun, which is the runtime the routing
above covers automatically.

## Consumer obligations (from-tarball adoption)

Four obligations the published examples proved the hard way (findings F-P6-3..6,
change `s05-published-examples`). Each names the failure you see when you miss it.

1. **Declare the `culori` module yourself.** This package ships TypeScript source
   that imports `culori`, and culori publishes no type declarations. In a
   from-tarball tree the typecheck fails on the first culori import until your
   project carries an ambient declaration (for example
   `declare module "culori"` in a `.d.ts`, as the published examples do).
2. **Self-register the Tailwind `@source`.** `surface.css` registers its class
   scan with `@import "tailwindcss/utilities.css" source("../../")`, which stops
   working once the stylesheet is consumed from `node_modules`. The failure is
   silent and specific: theme colours apply but utilities do not (`.size-full`,
   `.overflow-hidden`, `.flex-1`, `.min-h-0` never generate) — a coloured but
   inert editor where nothing sizes and nothing clips. Add
   `@source "../node_modules/@opencut/editor-classic/src";` to your own
   stylesheet; the in-repo Vite host performs the same self-registration.
3. **Give the mount a definite height.** `min-height: 100%` on html, body or your
   root element establishes no definite height, so the Surface's `size-full`
   resolves to content height — the editor mounts as a strip roughly a hundred
   pixels tall with the whole timeline rendered but clipped invisible. Wrap the
   mount in an element with an explicit height (`height: 100vh`, as the in-repo
   harnesses do).
4. **Seed the empty scene before asserting anything.** `buildDefaultScene` yields
   a project of zero duration and the seek controller clamps every ruler seek into
   that duration — the playhead of an empty project cannot move. Rendering an
   empty project gives you an inert but blameless-looking timeline; seed one
   element (for example `buildTextElement`, default duration 5s, on an overlay
   `TextTrack`) before asserting interaction.
