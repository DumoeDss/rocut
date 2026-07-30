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
| Rust / cargo + `wasm-pack` | **only** the optional wasm rebuild-correspondence check | cargo ≥ 1.85 (the crate is edition 2024; verified on 1.88.0), `wasm-pack` 0.13.1. Not needed to build or run the editor — it consumes the published npm `opencut-wasm@0.2.10`. |

### Installing `wasm-pack` (only if you are rebuilding the wasm)

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
# 1. install (repo root) — resolves the whole bun workspace, including this example
bun install

# 2. production build of the example
cd apps/vite-example
bun run build            # -> dist/, plus dist/module-graph.json and dist/asset-manifest.json

# 3. serve the production build
bun run preview --port 4173 --strictPort --host 127.0.0.1
```

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
DATABASE_URL="postgresql://opencut:opencut@localhost:5432/opencut" \
BETTER_AUTH_SECRET="supersecret" \
NEXT_PUBLIC_SITE_URL="http://localhost:3000" \
UPSTASH_REDIS_REST_URL="https://your-upstash-redis-url" \
UPSTASH_REDIS_REST_TOKEN="your-upstash-redis-token" \
NEXT_PUBLIC_MARBLE_API_URL="https://placeholder.example.com" \
MARBLE_WORKSPACE_KEY="placeholder" \
FREESOUND_CLIENT_ID="placeholder" \
FREESOUND_API_KEY="placeholder" \
bun run build && bun run start &

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
