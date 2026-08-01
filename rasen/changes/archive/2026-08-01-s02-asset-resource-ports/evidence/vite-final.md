# C4 final Vite production proof

Date: 2026-08-01  
Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c4`

## Identity and fresh build

- Commit: `507cecf456ed68007c60829be5c3c41bebf64a5d`.
- Tree: `2dd46187ff2d31b026010cb3d6573dcf099441d3`.
- Marker: `c4-final-commit-507cecf456ed68007c60829be5c3c41bebf64a5d-tree-2dd46187ff2d31b026010cb3d6573dcf099441d3`.
- Base: `/c4-vite/`.
- Fresh output: `apps/vite-example/dist-c4-final` (the exact path did not exist before the build).
- Build command environment names: `OPENCUT_PUBLIC_BASE`, `C4_VITE_OUT_DIR`, and
  `VITE_C4_BUILD_MARKER`; command `bun run build`, exit 0, 2,871 modules, 42.56 s.
- Marker appeared in four compiled HTML/JS locations and exactly in
  `asset-manifest.json.build.marker`; the manifest base was exactly `/c4-vite/`.
- Build log: `evidence/vite-final-build.log`, 92,480 bytes,
  SHA-256 `3c0f4ece168aa66851088ad1941903f9a7e5e775008823beaf2c7f7501681047`.

## Exclusive preview and origin-root decoy

- Command: `vite preview --strictPort --host 127.0.0.1 --port 43381`.
- Exact URL: `http://127.0.0.1:43381/c4-vite/`.
- Listener PID: `55672`; parent wrappers were PIDs `248` and `32516`.
- PID 55672 start: `2026-08-01T16:52:56.2502955+08:00`.
- Exact listener command line:
  `node "...\node_modules\vite\bin\vite.js" preview --strictPort --host 127.0.0.1 --port 43381`.
- The origin-root landing returned only a 302 to `/c4-vite/`. Root-escape decoys
  `/assets/definitely-root-escape.js` and the actual hashed entry name below `/assets/`
  both returned 404 `text/plain`; they could not accidentally satisfy a classified request.
- The exact prefixed DOM carried the full marker above.
- stdout/stderr hashes:
  `80e28053ca81cc421578bd3a54e08e4eab6d0a129d61a5ccc8a141c4260061c4` /
  `0c2715c41fc6984388460c41bb8640b96777eced4d681dd2a83eca6a27b673e1`.

## Served manifest/content gate

Command:

`node script/check-asset-manifest.mjs --manifest apps/vite-example/dist-c4-final/asset-manifest.json --base http://127.0.0.1:43381/c4-vite/ --public-base /c4-vite/ --marker <full-marker>`

Exit 0: 298 copied files / 4,481,200 bytes and 7 emitted files / 29,875,274
bytes. MIME family, exact bytes, SHA-256, required categories, complete emitted graph,
atlas shape, every font chunk, effect image dimensions, flag/logo/favicon payloads,
served/local manifest equality, and exclusion probes passed. The manifest was 113,974
bytes with SHA-256
`4b89e9f5d8647b55d7d4d291ec745d2e35aac0c796ff052c4c14c6edf3e940ba`.
The retained checker log SHA-256 is
`e447d47c041db63599266355be7df2b651cb4ce80b9695fffc41fa829a41f8c0`.

## CDP surface and network log

Disposable CDP target: `7F2EC5CED13D81FD81A735B02BD83852`. Network and
console collection were enabled before navigation and cleared between routes.

1. Project boot: the requested project booted to a new persisted in-memory project
   `46ffc24e-4e51-45cf-9951-56f58f6ecc90`. The real editor surface, timeline, preview,
   and assets panel were visible with no error boundary. The Host logo resolved below
   `/c4-vite/` and decoded 32x32; favicon was prefixed. The atlas and all 15 AVIF chunks
   loaded below the base. The editor WASM request was 200 `application/wasm`, after
   which the WASM-backed editor session completed boot.
2. Stickers/flags/generated graphics: the real Stickers panel requested 12 visible
   flags below `/c4-vite/flags/`, all 200 `image/svg+xml`. Its generated graphic previews
   were `data:image/png` values; an activated-tab decode measured 512x512, and the
   generated-preview invocation added zero network requests.
3. Effects: the real Effects panel rendered a 160x160 preview canvas and requested
   `/c4-vite/effects/preview.jpg` as 200 `image/jpeg`.
4. Two mounted sessions: status `ready`, `cache-isolated=true`, with session ids
   `c4-a-session-1` and `c4-b-session-1`. Their bases, atlas names, fetches, preloads,
   chunk URLs, and quoted mask URLs remained respectively under `/c4-a/` and `/c4-b/`.
   These are injected two-base fixture acquisitions; the production page/assets in the
   other routes stayed below `/c4-vite/`.
5. Worker: status `ready`; logical id `c4-round-trip`; requested URL
   `https://request.invalid/original-worker.js`; module/name metadata preserved; Host
   rewrite `/c4-vite/workers/c4-worker-fixture.js`; result
   `{"kind":"pong","byteLength":4}`; created/released `1/1`. CDP marked the Worker
   request incomplete, but the browser round trip and registry counts prove execution.
6. Forced-none: status `ready`, scope `c4-host-constructibility-only`; source
   `host-forced`, backend null, capacity 0, banner and unavailable preview visible,
   one 160x160 effect schedule completed, render tree null, compositor null, GPU work 0,
   runtime graphics queries empty, live session true, page errors 0, unhandled rejections 0.
   Software-raster timing and an actual no-rasterizer machine remain E1 unknowns.

Per-route product network summaries were: main editor 34 events (12 flags, one effect,
one editor WASM), two-session harness 13 events, Worker harness 5 events, and forced-none
22 events. Every completed product request remained below `/c4-vite/`, had the expected
non-HTML MIME, and had no failure/status >=400. Product console exceptions/errors were
zero. One extension-only permissions-policy console message was excluded by its
`chrome-extension://` origin. Source/composition gates separately proved both final Hosts
override the three C4 roles after reference spreads; no production C4 role fallback was
observed.

Screenshots and SHA-256:

- `vite-final-flags-generated.png`:
  `887c5c6af1480ae2fbd469dfb0f0855b1364aab48b7dd183b67510ec1ff4c5d3`.
- `vite-final-effect.png`:
  `7754fe604efe1ecfb8c1478c9e98faf39ea533cddd3627490748cd81ebe4e84e`.
- `vite-final-two-session.png`:
  `68f9fcd6fc3ef9ca66e3d47d01fed0c4b255bd85e75318e81ac155ebf75aec0d`.
- `vite-final-worker.png`:
  `77198e24ee5d085faa2ea7e3d68967141d7958da96b6d1344bac52f6428880f1`.
- `vite-final-forced-none.png`:
  `a3582df543f0ddeebe8084cbac7817b63997464a66e7d0588c70bb828b0902c7`.

Key output hashes:

- entry JS `d87b46c3139d344cdacb431d4f882a0c2e82a55bd499a521d2e0688a7aaab265`;
- CSS `3d02dafeba48c61adc4b51148a913725cf346e9f166c5a5be8b3dde1509c2143`;
- editor WASM `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`;
- transcription Worker `b85031fd0d499343dd081d1aba3f4c604428719f08f549a934b119eb1f4edddf`;
- ORT sidecar `c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39`.

The disposable tab was closed. After verifying port 43381 was still owned by PID 55672,
only PID 55672 was force-stopped. It and the port were absent after two seconds; both
wrapper processes exited without an additional stop. The shared CDP proxy remained alive.

