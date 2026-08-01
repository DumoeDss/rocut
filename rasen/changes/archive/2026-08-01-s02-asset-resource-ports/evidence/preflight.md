# C4 preflight: asset and runtime-resource ports

Date: 2026-08-01  
Audited worktree: `rocut-wt-s02`  
Audited commit: `507cecf456ed68007c60829be5c3c41bebf64a5d`  
Slice: `s02-asset-resource-ports` (C4)  
Mode: read-only adversarial implementation preflight

## Verdict

C4 is implementable on the current C3 tree without widening the frozen C1 public contracts. The
implementation must close two different boundaries together:

1. logical first-party asset resolution/loading through the existing `AssetResolver` and
   `RuntimeAssetLoader`; and
2. runtime-resource acquisition through the existing `RuntimeResourceHost`/session registry,
   including emitted Worker and WASM sidecars after bundling.

A source-only replacement of `fetch("/...")` is not sufficient. The current Vite production output
still contains root-absolute entry assets, editor WASM, Worker, and ORT WASM sidecar URLs. Likewise,
the C3 tree already sets `RendererManager.setDegraded(...)`, but the preview surface can still call
the compositor after the Host reports `rasterizer: "none"`. Both are C4 release blockers.

The Host-declared `force-none` path is a constructibility and survival proof. It is not evidence of
an actual no-rasterizer machine and is not the still-unmeasured software-rasterization timeline.
Those physical measurements remain E1 work under direction correction C-5.

## Frozen seams C4 must use

Do not change these C1 shapes:

- `AssetRef` is a logical path with no leading slash.
- `AssetResolver.resolve({ ref })` returns an opaque string.
- `RuntimeAssetLoader.loadBytes(...)` and `loadJson(...)` are the byte/JSON loading seam.
- `WorkerRequest` carries `id`, a resolved `URL`, `type`, and optional `name`; the Host may rewrite
  the requested URL to satisfy same-origin execution.
- `EnvironmentPort` declares only detect or forced-none. It never declares backend or capacity.
- the runtime graphics query, not the Host, produces backend/capacity/unavailable reason.
- production consumers receive a narrow Host/session surface; do not add `useEditorPorts` or a
  parallel asset context.
- the public `CreateEditorSessionArgs`, `EditorSession`, and the port files are protected.

The current production roots spread `createInMemoryPorts()`. Its default `assets/` resolver, empty
asset loader, and echo Worker are reference implementations, not production implementations. C4
must override all three relevant roles in both production Hosts and prove that the production graph
cannot fall back to those placeholders.

## Implementation map

### Host composition and injection

| Surface | Current seam/risk | C4 action | Required proof |
| --- | --- | --- | --- |
| `apps/vite-example/src/host/vite-editor-host.tsx` | Spreads in-memory ports; logo is root-absolute | supply browser asset resolver/loader/resource Host using Vite base; resolve branding logo | non-root production preview, no placeholder imports in the production dependency path |
| `apps/web/src/app/editor/[project_id]/page.tsx` | Spreads in-memory ports; logo uses root-absolute default | supply browser implementations using the Next build-time base path; resolve logo and base-path Host services | fresh Next build/start under an exclusive prefix; no root `_next`, asset, or Host-service request |
| Vite project-picker Host and Next picker/session roots | production session roots can retain reference ports even if editor root is fixed | audit and inject the same production roles wherever a session is created | graph assertion includes both Host roots and picker/session flows |
| `editor/session/editor-session-host.tsx` | C3 already prepares live WASM providers | preserve the live provider injection; do not introduce asset/global defaults here | production dependency graph contains no `UNIMPLEMENTED_*` runtime provider |
| `EditorProvider` | already calls `session.capabilities.graphics()` then `editor.renderer.setDegraded(...)` | retain and test; do not create a second degraded state | force-none assertion reaches the existing manager and banner |

Prefer one browser implementation package configured per Host, with an immutable base for each
session. Do not solve relative paths with a mutable module-global base: two sessions with different
bases must not contaminate one another.

### First-party static assets

| Site | Current acquisition | Classification and action |
| --- | --- | --- |
| `apps/web/src/fonts/google-fonts.ts` | `fetch("/fonts/font-atlas.json")`, preloads `/fonts/font-chunk-N.avif` | first-party; load atlas through `RuntimeAssetLoader`, resolve chunks through the session resolver; key/remove global atlas/load caches so bases cannot cross-contaminate |
| `apps/web/src/components/ui/font-picker.tsx` | CSS `url(/fonts/font-chunk-${ch}.avif)` in mask styles | first-party; resolve before constructing a safely quoted CSS URL; source scanners must inspect CSS URL literals, not only `fetch` |
| `apps/web/src/stickers/providers/flags.ts` | singleton provider rooted at `DEFAULT_FLAGS_BASE_URL = "/flags"` | first-party and omitted from the slice touch list; make resolution session-aware without a mutable global base |
| `apps/web/src/services/renderer/effect-preview.ts` | module singleton loads `new Image()` from `/effects/preview.jpg` | first-party; inject resolution and avoid first-session-wins initialization; C4 owns path/load/survival, while deterministic disposal remains C6 |
| Vite/Next branding | `/logos/opencut/svg/logo.svg` | first-party Host chrome; resolve at each composition root through its Host asset resolver |
| Vite `index.html` | `/favicon.ico`, `/src/main.tsx`; production emits `/assets/...` | configure Vite `base` and validate emitted HTML, CSS and scripts from a non-root prefix |
| Vite asset-copy plugin and manifest | copied assets and manifest paths start with `/` | emit logical/base-relative paths and make the checker base-aware; retain complete inventory |
| graphics/sticker preview | `data:image/svg+xml` and canvas `toDataURL(...)` | generated data, not first-party static assets; do not rewrite, but exercise it as a negative classification control |

The existing asset manifest currently covers fonts, flags, effect preview, logos, and favicon. The
checker verifies existence, exact size, and rejects HTML for non-HTML entries, but it does not yet
prove an expected MIME type or verify the recorded SHA-256. Add those checks and a deliberate
failure fixture. The checker must also assert a non-empty, category-complete inventory so that an
empty/truncated scan cannot pass.

### Worker and WASM chain

| Layer | Current state | C4 action/proof |
| --- | --- | --- |
| transcription service | direct module-global `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })` | acquire via the owning session's resource registry and `RuntimeResourceHost`; the Host sees logical id/type/URL and returns the handle; no direct Worker constructor remains in the editor graph |
| Host Worker implementation | in-memory echo Worker can escape into production | construct a real same-origin browser Worker and permit URL rewrite; assert the reference implementation is absent from production wiring |
| emitted transcription Worker | Vite emits `/assets/worker-*.js` today | scan/execute served production output under the prefix; source correctness does not prove emitted correctness |
| editor WASM | Vite emits `/assets/opencut_wasm_bg-*.wasm` today | make bundler output respect the Host base; fetch with `application/wasm`, exact manifest bytes/hash, and instantiate from served production output |
| ONNX Runtime sidecar | emitted Worker contains `new URL("/assets/ort-wasm-simd-threaded.jsep-*.wasm", self.location.href)` | make the nested emitted URL prefix-safe and inspect the Worker chunk; fixing only the outer Worker is a false pass |

Use a tiny dedicated Worker fixture to prove Host rewrite, round-trip messaging, handle ownership,
and termination without downloading a model. Separately inspect the actual transcription Worker and
ORT sidecar in the emitted graph and network capture. A remote Hugging Face model fetch is external,
not a first-party asset, and must not be required for the core C4 gate.

### Deliberately out of the asset resolver

Do not rewrite the following through `AssetResolver`:

- Google Fonts CSS and gstatic font files;
- Hugging Face model URLs and other external model delivery;
- Brandfetch platform-guide icons;
- Freesound result/preview URLs;
- imported media URLs, OPFS/blob/object URLs, waveform sources, and thumbnail/data URLs;
- SVG `url(#fragment)` and `data:` cursor/preview values;
- navigation destinations such as `/editor` and `/projects`.

`/api/sounds/search` and `/api/feedback` are first-party Host services, not static assets. They must
remain under `EditorHost.services`, but the Next Host must make them base-path-aware or the non-root
smoke test can still fail. Vite may continue to omit unsupported services.

## Degraded renderer: required behavior

`RendererManager.isDegraded`/`setDegraded` and `DegradedRendererBanner` already exist, and C3's
provider already drives the manager from the live capability report. C4 must use this path rather
than add another flag.

The current preview surface still constructs a renderer, calls `getOutputCanvas()` and then starts
`renderer.render(...)`; the latter path lacks a rejection handler. Merely displaying the banner can
therefore coexist with a compositor attempt or unhandled rejection. Under forced-none, rasterized
preview work must be skipped or safely substituted while the editor remains usable.

Required force-none test:

1. create a real session through a production-like Host with `{ mode: "force", rasterizer: "none" }`;
2. poison both runtime query methods so the test fails if either is consulted;
3. mount the real providers/editor surface;
4. assert the report is `source: "host-forced"`, `backend: null`, capacity `0`;
5. assert the existing degraded-renderer banner is visible;
6. wait for the preview/effect path that would normally render;
7. assert the page/session is still live, with zero page errors and zero unhandled rejections;
8. assert `getCompositorHandle() === null` after the UI settles.

This is the C4 constructibility gate. Do not label it "actual no-rasterizer hardware", "GPU
acquisition measurement", or "software-rendering timing".

## Adversarial acceptance matrix

### Non-root base for both Hosts

- Build Vite with an exclusive base such as `/c4-vite/`, serve the fresh `dist`, and open the exact
  prefixed URL. Fail any first-party network request outside that prefix.
- Build Next from an empty `.next` with an exclusive build-time `basePath`/asset prefix such as
  `/c4-next`, start that exact output, and open only the prefixed editor route. Fail root `/_next`,
  root static-asset, and root Host-service requests.
- Serve a decoy or failure response at the origin root so accidental `/assets`, `/fonts`, `/flags`,
  `/effects`, and `/logos` requests cannot succeed by coincidence.
- Require fresh C4 build markers in the DOM and compiled bundle, bound to the exact tested commit;
  do not reuse C3 markers or servers.

### Asset bytes and fallback rejection

- For every manifest entry, assert status, expected MIME family, exact byte length, and SHA-256.
- Negative control A: requested asset returns SPA HTML with status 200; checker must fail on MIME
  and bytes/hash.
- Negative control B: same MIME but wrong bytes; checker must fail on length/hash.
- Negative control C: delete/omit one copied entry or truncate the manifest; completeness/anti-
  vacuity assertion must fail.
- Atlas JSON must parse with the expected shape; every referenced chunk must exist and
  `Image.decode()` successfully.
- Effect preview must have image MIME, expected bytes, non-zero natural dimensions, and produce a
  nonblank preview without a root request.
- Generated graphics preview must decode to non-zero dimensions while causing no first-party
  network request.

### Source and emitted URL controls

The positive check scans both the source production dependency graph and production outputs. Each
negative fixture must exit non-zero and name the violation:

1. root-absolute `fetch("/fonts/...")`;
2. CSS `url(/fonts/...)`;
3. a dynamic prefix such as `"/flags"`;
4. direct `new Worker(...)` in the editor graph;
5. emitted Vite/Next entry or CSS path rooted at `/`;
6. emitted Worker URL rooted at `/assets`;
7. emitted editor WASM URL rooted at `/assets`;
8. the nested ORT sidecar rooted at `/assets`;
9. an empty or truncated graph that omits either Host root or the Worker/WASM modules.

The Host browser adapter is the one permitted Worker constructor location. Tighten the production
boundary check for Worker acquisition now. Do not broaden C4's claim to AudioContext, object URL,
timer, or full graphics disposal; those are C6 gates.

### Worker functional control

- Ask through `session.resources.createWorker(...)` with a known logical id, module/classic type,
  requested URL, and optional name.
- Record what the Host received and prove that it may replace the URL with a same-origin location.
- Round-trip one message through the real browser Worker handle, terminate it through the handle,
  and show the session registry owns it.
- Negative fixture calling `new Worker` in editor production code must fail the boundary check.
- Inspect the actual transcription Worker chunk and its sidecar URLs even if model inference is not
  run.

### Font CSS and cache isolation

- Mount two sessions in one process with distinct asset bases and distinct atlas fixture bytes.
- Resolve/load atlas, font chunk CSS masks, flags, logos, and effect previews from each.
- Assert every URL retains its session base and no first-session cache/singleton value leaks to the
  second session.
- Assert the computed font mask URL is quoted/valid and that the browser requested the prefixed
  chunk.

## C5/C6 boundary and overlap

### C5 overlap

C5 also touches the Host roots/session factory and media/store wiring. C4 may add/inject the static
asset and runtime-resource Host roles there, but must not invert project persistence, expose storage
mechanisms, or shape provider-private persistence payloads. Keep edits small enough for C5 to
compose on the frozen session/port surface.

### C6 overlap

C6 is expected to touch `gpu-renderer.ts`, `effect-preview.ts`, video/waveform/transcription
services, audio modules, object-URL sites, and the editor root. C4 may:

- mediate Worker construction;
- make asset paths Host-relative;
- stop compositor calls on the forced-none path; and
- perform the minimum cleanup required by a C4-owned test fixture.

C4 must not claim deterministic cleanup for all five resource classes, all object URLs, last-owner
GPU shutdown, multi-cycle leak freedom, or complete transcription/preview lifetime ownership. Leave
those claims and the leak harness to C6, and make any temporary ownership limitation explicit.

## Protected files and provenance

Do not edit or rebaseline:

- `script/fixtures/type-baseline.json`;
- `apps/vite-example/tests/parity/**` or `script/diff-parity-snapshots.mjs`;
- `apps/web/src/editor/ports/**`;
- the public C1 session factory/session shape;
- `rust/wasm/**` or generated `rust/wasm/pkg/**` output.

After product changes:

- regenerate `SOURCE_INVENTORY.json` and `SOURCE_INVENTORY.md` with
  `node script/generate-source-inventory.mjs`; do not hand-merge them;
- add `PATCHES.md` rows for every behaviorally modified inherited file, preserving existing rows;
- do not add newly created files to `PATCHES.md`;
- leave SBOM/upstream records untouched unless C4 actually changes their assertions/dependencies;
- run `git diff --check` and finish with a clean, fully classified worktree.

## Inherited red and classification ceiling

The exact inherited full-suite red from C3 is:

- 222 pass, 8 fail, 2 module errors, 552 expectations, 230 tests/38 files;
- six `resolveTrackPlacement` failures caused by
  `ReferenceError: Cannot access 'ZERO_MEDIA_TIME' before initialization`;
- `masks/__tests__/snap.test.ts`: `wasm.__wbindgen_start is not a function`;
- `timeline/__tests__/update-pipeline.test.ts`:
  `ReferenceError: Cannot access 'DEFAULTS' before initialization`.

The pinned type ceiling is exactly three diagnostics. C4 must not add a new failure identity,
signature, or type diagnostic and must not update the baseline fixture to hide one.

## Fresh-build and browser hygiene

- Use a C4-specific full-SHA/tree marker, for example `C4_BUILD_COMMIT` and
  `VITE_C4_BUILD_COMMIT`; verify it in source, DOM, and compiled output.
- Use exclusive ports for Vite and Next. Record exact PIDs and stop only those PIDs.
- Never reuse a running dev/preview server or an existing `dist`/`.next` directory.
- Run the Vite test against served production output, not the dev server.
- For Next, use a fresh forced build and provide the known nine required environment variables:
  `DATABASE_URL`, `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`,
  `NEXT_PUBLIC_MARBLE_API_URL`, `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`, `MARBLE_WORKSPACE_KEY`, `FREESOUND_CLIENT_ID`, and
  `FREESOUND_API_KEY`, plus the C4 base-path configuration at build and start.
- Keep `.content-collections/generated` present for the Next build.
- If a Rust build becomes necessary, put `CARGO_TARGET_DIR` on the spacious C: volume and do not
  alter generated Rust/WASM sources.

## Suggested validation order

1. frozen-contract and source boundary checks, including every negative fixture;
2. focused unit/conformance tests for browser asset resolver/loader and Worker Host;
3. two-base cache-isolation tests for atlas/flags/effect preview;
4. forced-none real-surface survival test and compositor-null assertion;
5. fresh Vite non-root production build, emitted graph scan, asset manifest/hash/MIME check,
   Worker fixture, WASM instantiate, font/effect/graphic preview browser checks;
6. fresh Next non-root production build/start and the same URL/network controls;
7. existing C3 WASM surface/binary integrity, capability, Vite boundary, and parity gates;
8. focused tests, type ceiling, then full classified suite;
9. provenance regeneration and clean-tree/diff checks.

Record exact commands, exit codes, browser URLs, ports, PIDs, commit/tree marker, inventory counts,
network violations, artifact paths, and generated hashes. A prose statement that a page "loaded"
is not evidence for these gates.

## Hard stopping conditions

Stop and escalate instead of silently widening scope if any of the following occurs:

- a C4 implementation appears to require changing a frozen port signature or public session shape;
- a production Host still reaches the in-memory asset loader/resource Host;
- any first-party request escapes the configured non-root prefix;
- the emitted outer Worker is correct but the nested ORT sidecar remains root-absolute;
- the force-none surface constructs a compositor, throws asynchronously, or needs a fabricated
  Host backend/capacity to survive;
- fixing the path requires editing Rust/generated WASM rather than bundler/Host resolution;
- the boundary/manifest check passes an empty graph, HTML fallback, wrong bytes, or a direct Worker
  mutation;
- either Host was tested from a stale output/server or lacks the exact C4 marker;
- a new test failure/type diagnostic is not bit-for-bit attributable to the inherited red set;
- C4 begins claiming C6's complete disposal/leak guarantees or E1's physical renderer timing.

## Stale assertions to correct during C4 planning/spec work

1. The current `runtime-asset-delivery` spec requires production-build Worker/WASM success and
   visible degradation, but it mentions only the Vite example. C4's direction requires non-root
   proof for both Vite and Next production Hosts.
2. Its asset scenario says only "no 404". A SPA HTML fallback can return 200, so the delta must
   require MIME plus exact bytes/hash and a deliberate failure control.
3. Its Worker scenario says only that the script starts. The delta must require construction through
   the runtime-resource port, Host rewrite permission, session ownership, and no editor-graph
   constructor.
4. The Host-port spec still calls the no-rasterizer visible delivery a C4 boundary; C4 should
   falsify/replace that deferred wording once the banner/survival test is real, without claiming E1.
5. The editor-session-runtime spec says all five resource classes are acquired through the session.
   C4 can close Worker acquisition only; AudioContext/object URL/timer/full graphics acquisition
   remains C6. Do not mark that broad requirement satisfied early.
6. Any plan or evidence that says the spec sweep contains eight specs is stale. The active main spec
   set has grown; perform a fresh complete enumeration and list every falsified spec explicitly.
7. The C4 touch list omits the `/flags` singleton and can miss CSS `url(...)`, Host branding, emitted
   entry assets, and the nested ORT sidecar. Treat this report's inventory as a minimum, then verify
   it by graph/output scanning.

## Completion definition

C4 is complete only when both fresh production Hosts work at exclusive non-root bases, all
first-party static resources and bundled Worker/WASM layers remain under those bases with verified
content, Worker construction crosses the frozen session resource port, forced-none renders the
existing degraded UI without creating a compositor, negative controls prove the gates can fail,
the inherited failure ceiling is unchanged, and provenance/spec deltas accurately describe the
result. Software-raster timing and an actual no-rasterizer-host observation remain explicitly open
for E1.
