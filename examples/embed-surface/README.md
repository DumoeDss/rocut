# embed-surface

Mount the OpenCut editor Surface in a real app, from freshly packed tarballs.
Vite + React; `vite build` against the installed TypeScript source, then a
Playwright smoke that boots headless Chromium and interacts with the timeline —
build success alone is not execution (the P1 vite Blocker is the precedent).

## What it demonstrates

- **The peer contract working as designed.** classic declares `react` and
  `react-dom` as peers; this example supplies its own `react`/`react-dom`
  `18.3.1`, and Vite's `dedupe` keeps one copy across the host/editor boundary.
- **The stylesheet through its declared entry.** `@import
  "@opencut/editor-classic/surface.css"` in this example's `styles.css` — the
  export map is the only mapping. That file is Tailwind 4 CSS carrying its own
  `@plugin` directives (`@tailwindcss/typography`, `tailwindcss-animate`), so
  the example's devDependencies provide them; node resolution finds them from
  classic's nested path. One consumer-side obligation the import does NOT
  carry: the `source()` scan registration inside surface.css does not survive
  being consumed from node_modules, so this example registers the editor's
  source tree itself (`@source "../node_modules/@opencut/editor-classic/src"`).
  Without it the build succeeds with the editor silently unstyled — theme
  tokens present, every layout utility missing, the surface collapsed to its
  header strip. The smoke run, not the build, is the judge.
- **A definite box.** The Surface fills its container; the host owes it a
  definite height. `min-height` on the mount chain is not definite — percentage
  heights resolve against it as auto — so this example wraps the Surface in a
  `100vh` box (with `overflow: hidden`), the same wrapper the in-repo harnesses
  use. The smoke's mount assertion requires near-viewport extent, so a host
  that reintroduces the collapse fails the gate instead of shipping it.
- **A GPU-free boot.** The host forces the rasterizer to `"none"`
  (`src/host.ts`), and the smoke launches Chromium with `--disable-gpu` plus
  SwiftShader fallback flags. The editor boots degraded-but-interactive — the
  smoke asserts the degraded-renderer banner AND two interactions, so the
  degraded path is exercised, not just survived.
- **A scrubbable timeline.** The fixture project carries one text element
  (the published `buildTextElement` builder at the published default duration,
  5s). This is not decoration: an empty scene has zero duration and the
  timeline clamps every seek to the duration — the playhead of an empty
  project provably cannot move, and the scrub interaction would be a vacuous
  gate.
- **Runtime assets an adopter must serve.** The editor fetches a small set of
  files by absolute path at run time. This example commits a minimal set under
  `public/` (`fonts/font-atlas.json`, `logos/opencut/svg/logo.svg`); the
  canonical allowlist, with per-asset consumers, lives at
  `apps/vite-example/build/editor-assets.ts` in the repo. The font chunks
  (`/fonts/font-chunk-<n>.avif`) are deliberately absent: the editor falls
  back to system fonts, and the smoke tolerates exactly that URL pattern's
  404s — any other failed request or console error fails the gate.

## Consumed surface (labels are documentation, never runtime)

| Specifier | Class | Why this class fits this use |
| --- | --- | --- |
| `@opencut/editor-ports/host` | frozen | The `EditorHost` type — the one complete surface a host author implements. |
| `@opencut/editor-ports/in-memory` | frozen | The published in-memory port set this embed starts from. |
| `@opencut/editor-classic` (`.`) | provider | Default constants (`DEFAULT_FPS`, canvas, background) — provider machinery. |
| `@opencut/editor-classic/surface` | frozen | `SessionEditorSurface` — the embeddable editor, the point of this example. |
| `@opencut/editor-classic/surface.css` | frozen | The Surface's stylesheet through its declared entry. |
| `@opencut/editor-classic/session` | provider | `createEditorSession` / `EditorSessionProvider` — session plumbing. |
| `@opencut/editor-classic/runtime` | provider | `editorForSession` — the facade the host saves the fixture project through. |
| `@opencut/editor-classic/browser` | provider | Browser runtime ports (assets, asset loading, workers). |
| `@opencut/editor-classic/ui` | provider | `TooltipProvider`, `Toaster` — the chrome the editor expects around it. |
| `@opencut/editor-classic/project` | provider | The `TProject` type for the fixture project. |
| `@opencut/editor-classic/storage` | provider | `CURRENT_PROJECT_VERSION` for the fixture project's version. |
| `@opencut/editor-classic/timeline` | provider | `buildDefaultScene` / duration helper — builders, not contract. |

This example deliberately consumes **no experimental-labeled entry** and
inherits no experimental instability.

## Manifest-truth note

Building this example against the tarballs is the forcing consumer that
surfaced classic's undeclared runtime closure (the P6 report's F-P6-1); classic
now declares it. `@napi-rs/canvas` is measured test-only and stays undeclared;
`@huggingface/transformers` is declared because the transcription worker ships
in classic's source and every bundling consumer resolves it.

Type-checking the installed source meets three further gaps, all
consumer-side: `culori` publishes no types while classic's UI closure
type-imports `Rgb` (this example carries `@types/culori`, the same dev
dependency the in-repo web host uses); classic's ambient declarations
(`EyeDropper`, `soundtouchjs`) ship in `src/types/` but are reachable only by
tsconfig inclusion, never through the export map (the `include` entry in
`tsconfig.json`); and `import.meta.env` needs `vite/client` types. A consumer
that only imports the React-free entries (custom-storage's shape) meets none
of these.

One build-time pin: `vite-plugin-top-level-await@1.6.0` breaks against
`@swc/core` 1.16+ (its chunk rewrite dies at swc's changed AST), so this
example pins `@swc/core` to the exact version the in-repo Vite host resolves —
`1.15.47`. Lift the pin when the plugin publishes a fix.

## Run it

Through the repo runner (packs the tarballs, installs, builds, smokes):

```sh
OPENCUT_EXAMPLES=embed-surface node script/run-published-examples.mjs
```

Standalone (with the tarballs staged beside this directory as `tarballs/`,
which the runner materializes for you):

```sh
npm install --legacy-peer-deps
npm run typecheck && npm run build && npm run smoke
```
