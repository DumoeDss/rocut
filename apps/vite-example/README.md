# `@opencut/vite-example`

The OpenCut Classic editor, built and served by **Vite with no Next.js runtime**, embedded in a
bounded container inside an ordinary page.

This is the S01 portability baseline: it exists to prove that the editor in `apps/web/src` can be
built, served and *edited in* by a host that is not Next, and to record exactly where that is not
yet true. It is an example, not a product surface — there is no published API, no `exports` map and
no stability promise. See [`../../BOUNDARIES.md`](../../BOUNDARIES.md) §2.

The example reaches into the editor through the `@` path alias (`@` → `../web/src`), so **one source
tree serves both hosts**. Editing the editor changes both; that is deliberate, because `apps/web` is
the behavioural reference this example is compared against.

---

## Requirements

| Tool | Needed for | Version |
| --- | --- | --- |
| bun | install, all builds | `bun@1.2.18` is pinned in the root `packageManager`. **This work ran on bun 1.2.2** — older than the pin. It resolved the committed `bun.lock` without modifying it and both production builds succeed, but prefer 1.2.18; if a resolution difference ever appears, check this first. Recorded in [`../../UPSTREAM.md`](../../UPSTREAM.md) § Toolchain. |
| Node.js | Vite build, `script/check-*.mjs` | Any version Vite 7 supports; verified on `v24.14.0`. |
| A working GPU **or** SwiftShader | running the editor at all | Not optional. See "The editor needs a GPU" below. |
| Rust / cargo + `wasm-pack` + the `wasm32-unknown-unknown` target | **required** — building the editor at all | cargo ≥ 1.85 (the crate is edition 2024; verified on 1.88.0), `wasm-pack` 0.13.1. **Since S02 the editor consumes the wasm built from `rust/`**, not the published npm package: `opencut-wasm` is declared as `file:./rust/wasm/pkg`, so `bun install` cannot resolve it until the wasm has been built. `script/setup-rust` (or `script/setup-rust.ps1`) installs rustup and `wasm-pack`. |

### Installing `wasm-pack`

Use the **official prebuilt release tarball** and put the binary on your `PATH`, rather than
`cargo install wasm-pack`: installing from source additionally compiles `wasm-bindgen-cli`, which
cost about **3.3 extra minutes** here for an identical result.

Budget about **15 minutes cold** for `bun run build:wasm` on a machine with no Rust wasm toolchain.
Roughly **4 of those minutes are completely silent** — the Cargo workspace includes `apps/desktop`
(`gpui`), so cargo resolves the whole workspace before compiling only the wasm crate. That silence
is normal and is not a hang.

---

## From a clean checkout

```sh
# 0. Rust toolchain — once per machine
script/setup-rust                 # or script/setup-rust.ps1 on Windows
rustup target add wasm32-unknown-unknown

# 1. build the wasm (repo root) — REQUIRED, and it must come BEFORE `bun install`,
#    because `opencut-wasm` is declared as `file:./rust/wasm/pkg`.
#    Point the Rust build directory at a volume with several GB free; it does not
#    have to live beside the checkout, and a shared path makes later worktrees warm.
export CARGO_TARGET_DIR=/path/with/room     # PowerShell: $env:CARGO_TARGET_DIR = "..."
bun run build:wasm       # -> rust/wasm/pkg/  (~5 min warm registry, ~15 min fully cold)
                         # runs script/build-wasm.mjs, which applies --remap-path-prefix so the
                         # redistributed binary carries no path from your machine

# 2. install (repo root) — resolves the whole bun workspace, including this example
bun install

# 3. production build of the example
cd apps/vite-example
bun run build            # -> dist/, plus dist/module-graph.json and dist/asset-manifest.json

# 4. serve the production build
bun run preview --port 4173 --strictPort --host 127.0.0.1
```

**Re-run `bun install` after every `bun run build:wasm`.** bun installs a `file:` dependency as hard
links; `wasm-opt` replaces `opencut_wasm_bg.wasm` rather than rewriting it, which breaks the link for
that one file, so a rebuild propagates *partially* — every other file looks current while the
resolved `.wasm` silently stays at the previous build's pre-`wasm-opt` intermediate. The re-install
is fast (< 1 s; it re-links only). Verify with:

```sh
bun run check:wasm                  # asserts the RESOLVED opencut-wasm is the self-built one
```

CI runs that same check immediately after `bun install`, and the check additionally asserts its own
gate wiring, so removing the CI step makes every local run fail rather than quietly disarming it.

**If you skip step 1 entirely**, `bun install` fails with bun's own
`opencut-wasm@file:./rust/wasm/pkg failed to resolve` rather than a message naming the build command:
dependency resolution runs before any `preinstall` hook, so the repository cannot intercept it. The
ordering above is what avoids it. A *partial* build — the state a failed or interrupted `build:wasm`
leaves, since wasm-pack writes the manifest before the binary — **is** caught, by the `preinstall`
guard, with the rebuild command named.

Open http://127.0.0.1:4173/ and you get a project picker; create a project and the editor opens
inside the bordered box. **Smoke check:** the editor chrome must be *styled* (Tailwind content
detection across app roots is the known tripwire — an unstyled build otherwise looks like a
successful one), and the preview canvas must render.

### Boundary and asset checks

Run from the repo root, against a fresh production build (checks 2 and 4 need the preview server
from step 3 above):

```sh
node script/check-distributable-boundary.mjs   # no Next / app / site / blog / db / auth / desktop module in the bundle
node script/check-asset-manifest.mjs           # every manifested asset is really served, by content-type and byte length
node script/check-next-imports.mjs             # no editor-graph file imports next/*
node script/check-storage-boundary.mjs         # host code touches browser storage only through the adapter
node script/check-reference-boundary.mjs       # the AGPL no-copy boundary
node script/check-type-baseline.mjs            # no type regression against the pin
node script/check-wasm-source.mjs              # the resolved opencut-wasm is the self-built artifact
node script/check-wasm-paths.mjs               # the redistributed wasm leaks no build-machine path
```

---

## The parity scenario

A single Playwright spec drives the whole §3.3 editing scenario — create, import image + video +
two audio files, place clips on two visual and two audio tracks, drag, trim, split, snap, scrub,
play, save, full page reload, reopen — and reads the persisted project straight out of IndexedDB to
produce a normalized snapshot.

It runs against **either host, unchanged**. Only reaching the editor differs
(`tests/parity/host-profile.ts`).

```sh
# once per machine: fetch the browser Playwright drives
cd apps/vite-example
bunx playwright install chromium

# Vite host (starts/reuses `vite preview` on 4173 itself)
bun run test:parity

# Next host — production build + `next start`, never `next dev --turbopack`
cd ../web
(
  export DATABASE_URL="postgresql://opencut:opencut@localhost:5432/opencut"
  export BETTER_AUTH_SECRET="supersecret"
  export NEXT_PUBLIC_SITE_URL="http://localhost:3000"
  export UPSTASH_REDIS_REST_URL="https://your-upstash-redis-url"
  export UPSTASH_REDIS_REST_TOKEN="your-upstash-redis-token"
  export NEXT_PUBLIC_MARBLE_API_URL="https://placeholder.example.com"
  export MARBLE_WORKSPACE_KEY="placeholder"
  export FREESOUND_CLIENT_ID="placeholder"
  export FREESOUND_API_KEY="placeholder"
  bun run build
  exec bun run start
) &

cd ../vite-example
PARITY_HOST=next PARITY_BASE_URL=http://127.0.0.1:3000 bun run test:parity
```

(The env values are the placeholders from `.github/workflows/bun-ci.yml`. They are needed because
the Next app's shell imports auth and database modules; the editor does not.)

Then diff the two snapshots:

```sh
cd ../..
node script/diff-parity-snapshots.mjs \
  apps/vite-example/tests/parity-artifacts/vite/snapshot-vite.json \
  apps/vite-example/tests/parity-artifacts/next/snapshot-next.json \
  PARITY.md
```

Artifacts land in `tests/parity-artifacts/<host>/`: ten screenshots, `snapshot-<host>.json` (the
normalized project record) and `ledger-<host>.json`, which records for **every** interaction what
was asserted, what was only captured, and any third-party request that was blocked. The committed
outcome is [`../../PARITY.md`](../../PARITY.md).

### Useful environment variables

| Variable | Effect |
| --- | --- |
| `PARITY_HOST` | `vite` (default) or `next`. |
| `PARITY_BASE_URL` | Overrides the host's default URL. |
| `PARITY_HEADED=1` | Runs with a visible browser window — the fastest way to see why a step failed. |
| `PARITY_BROWSER_CHANNEL` | Defaults to `chromium`. Set to `chrome` to drive an installed Chrome instead. |
| `PARITY_NO_WEBSERVER=1` | Do not manage `vite preview`; assume it is already running. |

---

## The editor needs a GPU

Under `--disable-gpu --disable-software-rasterizer` the editor does **not** degrade — its React tree
crashes during bootstrap, because WebGPU surface creation fails. Neither host reaches editor chrome.
That is upstream behaviour at the pin, not something this example introduced: the same run against a
production `next build` + `next start` of `apps/web` fails identically. The full finding is in
[`../../BOUNDARIES.md`](../../BOUNDARIES.md) §5.

**Neither host goes blank, and this was measured, not assumed.** `apps/web` surfaces Next's own
framework error boundary (*"Application error: a client-side exception has occurred"*, 29 samples
over 58 s, `wentBlankAtSomePoint: false`). This example surfaces `src/editor-error-boundary.tsx`,
whose diagnostic held in 44 of the 45 samples taken over 88 s — the one exception is the first
sample at 1 ms, which still showed the project picker's "Loading projects…" and so was not blank
either (`everRenderedNothing: false`, `alwaysHadVisibleText: true`, `diagnosticTextSeen: true`).

Consequences:

- Any CI or container running this scenario needs a real GPU or SwiftShader. The Playwright config
  therefore uses `channel: "chromium"` (a full Chromium, not the headless shell) with
  `--use-angle=swiftshader --enable-unsafe-swiftshader`. Removing those flags does not make the
  test slower; it makes it fail.
- The example ships `src/editor-error-boundary.tsx` so the crash produces a visible diagnostic
  instead of a blank page. It is **host code only** and deliberately does not try to recover. This
  is what satisfies §3.4's "visible diagnostics rather than a blank editor" for this host.
- Two paths remain **unverified** and must not be read as passing. `DegradedRendererBanner` has
  never been observed rendering: reaching it needs `isGpuAvailable()` false *without* the bootstrap
  crashing first, and no configuration producing that has been found. The `window.__wasmPanic`
  channel has never been exercised: it was readable throughout at value `null`, but a WebGPU surface
  error is not a Rust panic, so nothing ever wrote to it.

## Behind a proxy

`playwright.config.ts` forces `127.0.0.1`, `localhost` and `::1` into `NO_PROXY`. Without it, a
system `HTTP_PROXY` makes Playwright's "is the server already up?" probe fail against loopback, so
it starts a second preview server and dies on `EADDRINUSE`.

---

## Nothing here requires Elftia

There is no Elftia dependency, import, environment variable, config value or build step anywhere in
this example, in the editor source it uses, or in the check scripts. The install is `bun install` at
the repo root; the build is `vite build`; the run is `vite preview`. This example is the portability
evidence precisely because it is a plain Vite app.

## Agent-first editing (source implementation, 2026-10-06)

The host-served editor now exposes native editing through the same guarded
transaction engine as UI commits. This section describes the source checkout,
not the capabilities of an older installed Elftia plugin. Rebuild/package the
CLI, Vite surface and WASM together before deployment; no plugin installation
or shared-environment E2E is implied by the source tests.

### Discover, read, modify, verify

```sh
rocut capabilities --target <target-id>
rocut editing catalog --target <target-id>
rocut read --target <target-id>
rocut apply batch.json --target <target-id>
rocut read --target <target-id>
```

`capabilities` returns the running Host's context directly, including supported
operations, editing/task routes and `mediaImport`. CLI catalogs wrap their data in
`catalog`; CLI tasks wrap theirs in `result` (a caption batch is therefore
`result.result.batch`). Scene plans are unwrapped transaction batches.

### Import real media files

`rocut media import spec.json --target <target-id>` maps to `POST media/import`.
It takes `{filePath, expectedRevision, idempotencyKey}` with an absolute local path,
probes audio/video container metadata, persists original bytes, and creates an
asset through the shared transaction engine. `create-asset` alone has no path
field and does not persist bytes. The returned `asset.id` can then be used by
`create-clip`; importing does not insert a clip or change project fps.

For images, add `image: {mimeType:"image/png", width:320, height:180}` using
verified dimensions. PNG/JPEG/WebP/GIF/AVIF declarations are accepted; images are
not decoded/probed by this route, explicitly reported as `metadataSource:"caller"`.
Audio/video returns `metadataSource:"container"`. One file is limited to 512 MiB;
there is no URL download, external process, codec installation or model download.
Check actual decoding, alpha and playback separately.

The response includes `asset`, `sourceSha256`, `result` and `replayed`. Identity
binds the idempotency key to bytes/name/metadata; exact retries survive Host
restarts and changed content conflicts. Keep the source for retries. The project
uses its copied attachment thereafter. A failed commit can retain a prepared
attachment for retry; no multi-file atomicity or automatic orphan cleanup is
claimed. A missing/changed attachment refuses replay rather than reporting success.

### Native editing catalog

`GET editing/catalog` describes the actual registered element, graphic, effect
and mask parameters: names, defaults, ranges, units, select options and
keyframability. Domain validation lives in `rust/crates/editor-api`; do not
guess parameter names from UI labels or bypass it with native JSON writes.

| Existing editor capability | Agent entry |
| --- | --- |
| Text content, fonts, size, alignment, background | `Clip.editing.params` on a text clip |
| Position, scale, rotation, opacity, blend mode | Registered visual parameters in `editing.params` |
| Scalar/discrete/color animation and curve handles | `editing.animations` |
| Clip effect insertion/removal/toggle/order/parameters | Ordered `editing.effects` |
| Whole-frame registered effect layers | Effect track + `editing.type: "effect"`, `effectType`, `params`; color adjustment also retains `Clip.adjustment` |
| Graphic definitions and geometry | `editing.type: "graphic"`, `definitionId`, registered params |
| Stickers | `editing.type: "sticker"`, `stickerId`, intrinsic dimensions and visual params |
| Rectangle/ellipse/freeform masks | Ordered `editing.masks`, using catalog defaults |
| Audio volume, volume automation, source-audio enable | `editing.params.volume` (dB), `params.muted`, animations, video `isSourceAudioEnabled` |
| Track mute/visibility | `update-track.patch.muted` / `hidden` |
| Project backdrop | `update-project.patch.background`: color/gradient or blur intensity 0–500 |
| Track compositing order | `reorder-tracks` with an exact permutation of all current track IDs |
| Scenes | `rocut scenes list`, `rocut scenes plan scene.json`, then ordinary `apply` |
| SRT/ASS import and local ASR | Attached-session caption tasks returning a proposed batch |
| Existing session Undo/Redo | Attached-session history tasks; actual command stack, not draft rejection |

An editing object is a **full replacement**, not a recursive patch. Read the
current clip first, preserve fields that should remain, then replace
`update-clip.patch.editing`. Empty `{}`/`[]` clear animation/effect/mask
collections. Missing optional collections also mean none. Copy complete
effect/mask defaults from the catalog before changing individual parameters.
Parameter maps also replace completely: omitted keys revert to renderer defaults.
Track order controls the relative order within each scene's overlay/audio group;
the canonical main video track remains below overlays. It does not move tracks
between scenes. Preserve every current track ID, including inactive-scene tracks,
when submitting `reorder-tracks`.
Include the read revision and an idempotency key in each mutation:

```json
{
  "expectedRevision": 12,
  "idempotencyKey": "title-style-001",
  "operations": [{
    "kind": "update-clip",
    "clipId": "title",
    "patch": { "editing": {
      "type": "text",
      "name": "Title",
      "params": { "content": "Hello", "fontSize": 48, "opacity": 0.8 },
      "animations": {}, "effects": [], "masks": []
    }}
  }]
}
```

Times are integer ticks at 120,000 ticks/second. Keyframe times are local to
the element, sorted and unique; scalar keys carry `segmentToNext` and
`tangentMode`. Color channels are linear RGBA component channels. Effect
animation paths use `effects.<effect-id>.params.<parameter>`; graphic-specific
animation paths use `params.<parameter>`. Existing renderer limitations still
apply: whole-frame effect-layer parameter animation is rejected rather than
advertised as rendered. Clip-effect animation is supported.

### Scene plans

`read` now returns tracks/clips/markers from **all scenes**. Use
`projectEntity.sceneState.currentSceneId`, `Track.sceneId` and `Marker.sceneId`
to select a scene; do not assume the returned timeline is only the active one.

```json
{
  "idempotencyKey": "scene-create-001",
  "operation": {
    "kind": "create", "id": "chorus", "name": "Chorus", "mainTrackId": "chorus-main"
  }
}
```

Other operations are `rename` (`id`, `name`), `switch` (`id`) and `delete`
(`id`). Planning is read-only and returns a batch. Save that exact batch and
apply it normally: durable replay belongs to `apply`, not replanning after a
restart. Deleting the canonical main scene, orphaning tracks/markers, or
replacing a surviving scene's canonical main track is rejected atomically.

### Attached-session tasks

```sh
rocut task list --target <target-id>
rocut task start task.json --target <target-id>
rocut task get <job-id> --target <target-id>
rocut task cancel <job-id> --target <target-id>
```

These map to `GET/POST editor-tasks`, `GET editor-tasks/<id>` and
`POST editor-tasks/<id>/cancel`. Jobs are polled; the start response is not
completion. The current Vite host-served pane advertises its capability through
the existing SSE connection. With multiple panes, specify a `surfaceId` from
`task list`; tasks are never broadcast. With no capable pane, the host refuses
the task. Headless transaction/scene editing does not require a pane.

Example SRT import request (the same endpoint accepts `.ass`):

```json
{
  "request": {
    "kind": "captions.import", "expectedRevision": 12,
    "idempotencyKey": "captions-import-001", "sceneId": "chorus",
    "trackId": "chorus-captions", "fileName": "lyrics.srt",
    "input": "1\n00:00:00,000 --> 00:00:02,000\nHello\n"
  }
}
```

For ASR, use `kind: "captions.transcribe"` with the same revision, scene and
new track ID; optionally specify `language` and `modelId` (for example
`whisper-small`). Discover supported values and the default in
`editing/catalog.transcription`. `allowModelDownload: true` is mandatory: model acquisition
may access the network. Audio is extracted and transcribed locally by the
existing session service, not uploaded. Concurrent UI/Agent inference is
refused so cancelling one caller cannot terminate another caller's worker.

A completed caption job contains cues, warnings, skipped-cue count and a
`result.batch`. It has **not inserted anything**. Save `result.batch`, review it,
and use `apply` or a draft; a stale source revision or wrong active scene is
refused. Layout and frame alignment reuse the native caption/insert pipeline.
Cancellation, disconnect and project changes prevent late results from
inserting into another timeline. SRT/ASS support does not imply VTT import or
singing/phoneme forced alignment.

History requests use `history.status`, `history.undo` or `history.redo` plus
`expectedRevision` and `idempotencyKey`. Undo/Redo run on the selected pane's
real serialized command stack and publish only after persistence succeeds.
History commits cannot be cancelled once dispatched. A timeout/disconnect
reports `outcome-unknown`; inspect the project before deciding what to do next,
and never automatically retry with a fresh key.

### Explicit lifecycle boundaries and remaining acceptance work

- History is **attached-session history**, not a durable global history log.
  Reloading the pane can clear it; Host/CLI applies are not automatically added
  to that pane's UI history. A persistent unified UI/Agent history remains work
  to finish before claiming that broader guarantee.
- Task idempotency and job results live for the Host process lifetime, with a
  bounded 128-job book. They are not a cross-restart job journal. Normal
  transaction batches retain their existing durable replay contract.
- Source tests cover native persistence/reopen, invalid-input atomic rejection,
  revisions, drafts, actual history, caption planning, ownership and cancellation.
  Real attached-pane task dispatch, visual rendering/export and model inference
  through this new route still require isolated E2E acceptance.
- Project background and track-order edits also use the shared transaction path.
  Their values and empty editing maps are tested after native save/reopen.
- UI final keyframe/effect/mask/mute/scene edits now use transactions; preview
  overlays remain local. Multi-keyframe methods now return promises: await them
  before observing the committed history or issuing dependent work.
- The new provider entries are `@opencut/editor-classic/editing` (catalog and
  Rust policies) and `@opencut/editor-classic/agent-tasks` (session runner). The
  latter is deliberately separate from the CLI's renderer-free imports.

Verification snapshot (2026-10-06): 244 targeted Bun tests
across 43 files and 8 Rust tests passed; later catalog/conformance refinements
passed the affected 47-test subset. CLI/Vite TypeScript, transaction-boundary,
vector-manifest, surface-label, SDK tarball dependency-closure and four WASM gates passed. This is not an
installed-plugin or render/export E2E result. Changed-file ESLint retains 33
existing errors across six contract files (same counts confirmed against HEAD);
the CLI paths are outside that ESLint configuration. The full package-boundary
gate is blocked by pre-existing `.tmp-probe` files naming Elftia runtime objects;
those unrelated local probes were left untouched. Dependency-closure checks use
local SDK test tarballs, not a released plugin. The follow-up media-import CLI
test uses real WAV/MP4/PNG fixtures, LRC composition and Host restart/replay,
including stale/changed-source refusal; CLI dispatch regressions also pass.
The Vite production surface builds with a relative base. Installation, visual
render/export acceptance and model download are not part of this verification.

## Related documents

- [`../../UPSTREAM.md`](../../UPSTREAM.md) — provenance, the pin, toolchain, known upstream defects.
- [`../../PATCHES.md`](../../PATCHES.md) — every local change to an inherited file, with rationale.
- [`../../BOUNDARIES.md`](../../BOUNDARIES.md) — the distributable boundary, export inventory,
  persistence boundary, runtime assets, and the GPU finding.
- [`../../FEATURE_HANDLING.md`](../../FEATURE_HANDLING.md) — per-feature record of what is excluded
  or degraded without a server, and what the user sees.
- [`../../PARITY.md`](../../PARITY.md) — the deviation report from the two-host snapshot diff.
- [`../../SBOM.md`](../../SBOM.md), [`../../REFERENCE_SOURCES.md`](../../REFERENCE_SOURCES.md).
- `tests/fixtures/FIXTURES.md` — how the fixture media was generated, and why it is redistributable.
