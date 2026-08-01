# C4 final Next production evidence

## Identity and fresh build

- Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c4`
- Baseline commit: `507cecf456ed68007c60829be5c3c41bebf64a5d`
- Baseline tree: `2dd46187ff2d31b026010cb3d6573dcf099441d3`
- Marker: `c4-final-commit-507cecf456ed68007c60829be5c3c41bebf64a5d-tree-2dd46187ff2d31b026010cb3d6573dcf099441d3`
- Base/output: `/c4-next`, `apps/web/.next-c4-final`
- Build environment names (values intentionally omitted): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_MARBLE_API_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `MARBLE_WORKSPACE_KEY`, `FREESOUND_CLIENT_ID`, `FREESOUND_API_KEY`; build-only controls were `OPENCUT_PUBLIC_BASE`, `OPENCUT_NEXT_DIST_DIR`, `C4_BUILD_MARKER`, and `NEXT_TELEMETRY_DISABLED`.
- Command: from `apps/web`, set the names above, `OPENCUT_PUBLIC_BASE=/c4-next`, `OPENCUT_NEXT_DIST_DIR=.next-c4-final`, the marker, and run `bun run build`.
- Result: exit 0; Next 16.1.3; optimized compile 28.8 s; 18/18 static pages; log `next-final-build.log`.
- Two earlier retries failed only while downloading Inter from Google Fonts. Direct and proxy probes then returned 200, and the forced-fresh third attempt succeeded. The first standalone start omitted runtime environment values and failed validation before serving; its separate stdout/stderr logs are retained.
- Next's build-time `tsconfig.json` rewrite was restored byte-for-byte. Final SHA-256: `a9b6b3497121f1da40ac2108721d3d213b5e00fb6ed2bf8f39a5867e9646c135`; `git diff -- apps/web/tsconfig.json` is empty.
- Standalone public assembly copied 336 public files and 98 `.next-c4-final/static` files into the exact standalone root. The Worker fixture was present.

## Exact standalone and origin-root decoys

- Exact server: `apps/web/.next-c4-final/standalone/elftia/_others/rocut-wt-c4/apps/web/server.js`
- URL: `http://127.0.0.1:43382/c4-next/editor/c4-next-final`
- Final owned listener: PID 51580, command line `"C:\nvm4w\nodejs\node.exe" server.js`; Next reported ready in 290 ms.
- `GET /` -> 404 `text/html`; `GET /_next/static/c4-root-decoy.js` -> 404 `text/plain`.
- `GET /c4-next/manifest.json` -> 200 `application/json`; `GET /c4-next/favicon.ico` -> 200 `image/x-icon`; Worker fixture -> 200 `application/javascript`, 201 bytes.
- The first CDP pass exposed origin-root metadata URLs for the manifest/favicon/icons. Metadata was changed to use the injected public base, and manifest/browserconfig nested locations were made relative. A completely rebuilt artifact and fresh CDP capture then recorded 44 product-origin requests, zero outside `/c4-next/`, and zero hard failures.
- The disposable CDP tab was closed. Only PID 51580 was stopped after checking its exact command line; port 43382 no longer listened.

## Real Chrome paths

Normal editor path:

- EditorProvider/EditorRoot booted and an invalid route identity was replaced by a newly persisted project identity; the editor, timeline, preview, and property surface were present and no application error boundary appeared.
- `data-c4-build-marker` contained the full marker. The marker occurs in compiled server/client output.
- Host logo resolved to `/c4-next/logos/opencut/svg/logo.svg` and decoded 32x32. Manifest, shortcut, favicon, and all apple-icon DOM links were below `/c4-next/`.
- Editor WASM instantiated from `/c4-next/_next/static/chunks/27a88e35df72eaf6.wasm`.
- The Next Host contract resolves `soundSearchEndpoint` and `feedbackEndpoint` with the same immutable public base. The focused Host test includes the explicit same-base service-location assertion, while the final browser capture proved that every actual first-party request stayed below that base.
- Raw logs: `next-final-normal-network.json`, `next-final-normal-console.json`; screenshot: `next-final-normal.png`.

Worker probe (real EditorProvider/session, final-marker + explicit-query double gate):

- Logical request: id `c4-next-round-trip`, URL `https://request.invalid/next-worker.js`, type `module`, name `OpenCut C4 Next Worker fixture`.
- Host rewrite: `/c4-next/workers/c4-worker-fixture.js`.
- Round trip: `{kind: "pong", byteLength: 4}`; registry created/released `1/1`; page errors/unhandled rejections `0/0`.
- 40 product-origin requests, zero root violations and zero hard failures. Raw logs: `next-final-worker-network.json`, `next-final-worker-console.json`; screenshot: `next-final-worker.png`.

Forced-none probe (same production-like Host/provider/editor surface):

- Graphics report: rasterizer `none`, backend `null`, live-preview limit `0`, reason `host declared no rasterizer`, source `host-forced`.
- Existing renderer-unavailable banner and preview-unavailable surface were visible; one 160x160 effect preview canvas settled.
- Render tree `null`, compositor handle `null`, GPU-resource created count `0`; session remained created/live; page errors/unhandled rejections `0/0`.
- 40 product-origin requests, zero root violations/hard failures and zero product console errors. Raw logs: `next-final-forced-none-network.json`, `next-final-forced-none-console.json`; screenshot: `next-final-forced-none.png`.
- This proves construction/settling only. Software-raster timing and a physically no-rasterizer machine remain E1 work.

The welcome dialog visible in screenshots is an incidental persisted UI overlay; the probes run inside the real provider/session and completed independently of it.

## Emitted output and hashes

Command:

`node script/check-emitted-runtime-assets.mjs --vite-output apps/vite-example/dist-c4-final --vite-base /c4-vite/ --next-output apps/web/.next-c4-final --next-base /c4-next/ --inventory-output E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/rasen/changes/s02-asset-resource-ports/evidence/emitted-inventory-final.json`

Result: exit 0. The source pass scanned 697 production modules and passed all five rules. Next inventory contains 9 editor entry chunks, 1 transcription Worker, 1 editor WASM, and 1 ORT sidecar; every recorded URL is non-empty and base-contained. See `emitted-final-check.log` and `emitted-inventory-final.json`.

- Transcription Worker: `static/chunks/4880b7cee4117398.js`, 869901 bytes, SHA-256 `dc1c5c41309ce68e4c8b1f40f5b59815f09df9c9ef8728dca75031b6deba4ab7`.
- Editor WASM: `static/chunks/27a88e35df72eaf6.wasm`, 3286340 bytes, SHA-256 `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`.
- ORT sidecar: `static/media/ort-wasm-simd-threaded.jsep.232c7845.wasm`, 21596019 bytes, SHA-256 `c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39`.
- Standalone Worker fixture SHA-256: `47868a75389bcd03fcb39f8bf5a568e4323caf2e306979732a4632429089c094`.
- Screenshot SHA-256: normal/Worker `9d5f61329fd76439d2ec3111a6d358f26d4a54afc92f67bc35c453a7ce94704a`; forced-none `686e6a29a5db7c9facf90a7f5481ff956ed759408c7927e4ace3fcc83070fd4c`.

The broad diagnostic scan of every Next output file also sees marketing-page public URLs and framework server-route manifest strings. Those do not belong to the editor client dependency graph and are not runtime acquisitions in the tested route. The authoritative emitted gate follows the editor client manifests plus the actual Worker/WASM graph, and the complete CDP origin capture independently found zero root first-party request after the metadata/manifest repair.
