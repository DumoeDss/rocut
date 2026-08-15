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

## Known constraint on `./storage/migrations`

The published migration chain (the runner, the 31 transformers and
`CURRENT_PROJECT_VERSION`) currently requires the wasm test-mock entry
(`@opencut/editor-classic/evidence/wasm-test-mock`) to initialize in plain TypeScript
consumers: the chain's wasm initialization fails with
`wasm.__wbindgen_start is not a function` in any consumer that does not pre-initialize
the wasm module — a runtime property of the current surface, identical in-repo and from
installed tarballs. This is stated as a constraint of the current `0.x` surface, not a
fix commitment: a fix is tracked at Direction level, not in this package.
