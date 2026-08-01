# C4 protected parity verification

Date: 2026-08-01  
Role: independent verifier (no product/task/run-state/provenance edits)  
Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c4`  
Branch/base: `feat/s02-asset-resource-ports` / `507cecf456ed68007c60829be5c3c41bebf64a5d`

## Verdict

**PASS.** The post-fix seconds-scale regression and Vite typecheck pass. The unchanged protected parity scenario passes all 10 interactions against fresh Vite and fresh Next production outputs. The cross-Host snapshot diff reports **9 differences: 0 semantic, 9 incidental**. Protected parity sources, the diff oracle, and the type baseline are byte-identical to the C4 base.

The only concern is inherited from the protected oracle: its exact-one-frame incidental rule matches the delta rather than re-deriving its cause. This run did not change or widen that rule.

## Fast independent checks

From the repository root:

```text
bun test apps/web/src/preview/components/__tests__/timecode-playback-subscription.test.ts
exit 0; 1 pass, 0 fail, 8 expectations, 83 ms

cd apps/vite-example
bun run typecheck
exit 0; tsc --noEmit -p tsconfig.json
```

The focused regression uses the real dual-channel playback subscription and verifies general updates, frame updates, and exact release of both subscriptions.

## Fresh Vite production parity

Build identity:

- base: `/c4-parity-verify/`
- output: `apps/vite-example/dist-c4-parity-verify` (absent before build)
- marker: `c4-parity-verify-20260801-507cecf4`
- build command, from `apps/vite-example`: `OPENCUT_PUBLIC_BASE=/c4-parity-verify/ C4_VITE_OUT_DIR=dist-c4-parity-verify VITE_C4_BUILD_MARKER=c4-parity-verify-20260801-507cecf4 bun run build`
- result: exit 0; Vite 7.3.6; 2,873 modules; 43.70 s Vite build / 45.5 s wrapper
- the emitted manifest recorded the exact marker and base

Server and test:

- server command: `bun run preview -- --port 43491 --strictPort --host 127.0.0.1`
- exact URL: `http://127.0.0.1:43491/c4-parity-verify/`
- owned process tree: launcher Bun PID 25360 -> `vite.exe` PID 50296 -> listener Node PID 34256
- test command: `PARITY_HOST=vite C4_VITE_OUT_DIR=dist-c4-parity-verify PARITY_BASE_URL=http://127.0.0.1:43491/c4-parity-verify/ PARITY_NO_WEBSERVER=1 bun run test:parity`
- result: exit 0; 1 passed; test 41.6 s; wrapper 44.3 s
- JSON reporter: start `2026-08-01T10:24:13.364Z`; duration 44,272.682 ms; expected 1, unexpected 0, flaky 0, skipped 0
- playback ledger: `00:00:00:00 -> 00:00:01:24 (playing) -> 00:00:02:01 (paused)`

All Vite interactions were asserted with `error: null`:

| interaction | result |
| --- | --- |
| `create-open` | asserted |
| `import-media` | asserted |
| `place-multi-track` | asserted |
| `drag` | asserted |
| `trim` | asserted |
| `split` | asserted |
| `snap` | asserted |
| `scrub` | asserted |
| `play` | asserted |
| `save-reload-reopen` | asserted |

The three owned server PIDs were checked against their command lines and stopped leaf-to-root. Port 43491 was released.

## Next production builds and protected parity

The pre-existing ignored `apps/web/.next` directory was moved intact to `.next-pre-c4-parity-verify` before verifier builds and restored after cleanup. This kept `distDir=.next`, so Next did not rewrite `tsconfig.json`; its SHA-256 remained `a9b6b3497121f1da40ac2108721d3d213b5e00fb6ed2bf8f39a5867e9646c135` with zero Git diff.

Nine required runtime/build environment names were supplied with local placeholder values: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_MARBLE_API_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `MARBLE_WORKSPACE_KEY`, `FREESOUND_CLIENT_ID`, and `FREESOUND_API_KEY`. Values are intentionally omitted here.

### Non-root production identity check

The verifier first reproduced the task 11 standalone method independently:

- base: `/c4-parity-verify-next`
- marker: `c4-final-commit-parity-verify-20260801-507cecf4`
- controls: `OPENCUT_PUBLIC_BASE=/c4-parity-verify-next OPENCUT_NEXT_DIST_DIR=.next C4_BUILD_MARKER=<marker> NEXT_TELEMETRY_DISABLED=1`
- command: `bun run build` from `apps/web`
- result: exit 0; Next 16.1.3; compile 25.5 s; 18/18 pages; wrapper 37.4 s
- exact standalone root: `apps/web/.next/standalone/elftia/_others/rocut-wt-c4/apps/web`
- standalone assembly: 336 public files, 100 `.next/static` files, Worker fixture present
- server: `node server.js`, listener PID 53588 on port 43492; exact prefixed `/projects` returned 200

An initial parity invocation incorrectly supplied the prefixed base URL. The protected `host-profile.ts` deliberately navigates to absolute `/projects`, so URL resolution reached origin-root `/projects`, which correctly returned 404 for a non-root Next build. The invocation produced no JSON reporter and timed out after 184 s; this was a verifier command mismatch, not a product or parity failure. Its owned Bun/Playwright/worker/Chromium process tree (PIDs 48712, 52132, 51564, 56880, 39892 and children 3180, 29668, 50540, 51516, 52456, 54588) was command-line/parent checked and stopped. No proxy bridge or oracle adaptation was used. PID 53588 was then stopped and port 43492 released.

### Fresh root-base protected Next parity

Task 12.4 parity is separate from task 11's non-root smoke. Following the repository README and unchanged Host profile, the verifier removed only its non-root output and produced a second fresh build:

- base: `/`
- output: fresh `apps/web/.next`
- marker: `c4-final-commit-parity-root-verify-20260801-507cecf4`
- controls: `OPENCUT_PUBLIC_BASE=/ OPENCUT_NEXT_DIST_DIR=.next C4_BUILD_MARKER=<marker> NEXT_TELEMETRY_DISABLED=1`
- command: `bun run build` from `apps/web`
- result: exit 0; Next 16.1.3; compile 30.3 s; 18/18 pages; wrapper 45.6 s
- `BUILD_ID`: `GEtFroLW0WXkFhivB2IAs`
- marker found in two compiled output files
- standalone assembly: 336 public files and 100 `.next/static` files
- exact server: `apps/web/.next/standalone/elftia/_others/rocut-wt-c4/apps/web/server.js`
- server command: `node server.js`, listener PID 44192 (parent shell PID 56956), port 43494; `/projects` returned 200 with root `_next` assets
- test command: `PARITY_HOST=next PARITY_BASE_URL=http://127.0.0.1:43494 bun run test:parity`
- result: exit 0; 1 passed; test 47.6 s; wrapper 50.7 s
- JSON reporter: start `2026-08-01T10:36:47.397Z`; duration 50,652.705 ms; expected 1, unexpected 0, flaky 0, skipped 0
- playback ledger: `00:00:00:00 -> 00:00:01:28 (playing) -> 00:00:02:00 (paused)`

All Next interactions were asserted with `error: null`:

| interaction | result |
| --- | --- |
| `create-open` | asserted |
| `import-media` | asserted |
| `place-multi-track` | asserted |
| `drag` | asserted |
| `trim` | asserted |
| `split` | asserted |
| `snap` | asserted |
| `scrub` | asserted |
| `play` | asserted |
| `save-reload-reopen` | asserted |

PID 44192 was checked against exact command line `node server.js`, stopped, and port 43494 released.

## Cross-Host snapshot classification

Command:

```text
node script/diff-parity-snapshots.mjs \
  apps/vite-example/tests/parity-artifacts/vite/snapshot-vite.json \
  apps/vite-example/tests/parity-artifacts/next/snapshot-next.json \
  <planning-root>/evidence/parity-verification-diff.md
```

Result: exit 0; **195 leaf values compared; 9 differences, 0 semantic, 9 incidental**.

The nine incidental paths are:

1. `project.metadata.duration` (one inherited placement frame)
2. `project.metadata.name` (Host-supplied name)
3. `project.scenes[0].tracks.audio[0].elements[0].startTime` (exactly one frame)
4. `project.scenes[0].tracks.audio[1].elements[0].duration` (exactly one frame)
5. `project.scenes[0].tracks.audio[1].elements[0].trimEnd` (exactly one frame)
6. `project.scenes[0].tracks.overlay[0].elements[0].startTime` (exactly one frame)
7. `project.scenes[0].tracks.overlay[0].elements[1].startTime` (exactly one frame)
8. `project.timelineViewState.playheadTime` (Host width/zoom-derived state)
9. `project.timelineViewState.zoomLevel` (7.13 vs 7.31, Host width-derived)

The full generated classification and side-by-side track summary are in `evidence/parity-verification-diff.md` (SHA-256 `247bd7b7122d31caee0a885dd74e404a56b36f3c3b41c00a51d82f97a40ecf10`).

Both hosts persisted two visual and two audio tracks with the same clips and ordering. The Next run blocked `https://cdn.databuddy.cc/databuddy.js`, producing the same two `net::ERR_FAILED` console messages recorded in baseline `PARITY.md`; Vite blocked none and had zero console errors. This is inherited first-party-only harness behavior, not a new delta.

## Protected-oracle and artifact integrity

Command:

```text
git diff --exit-code 507cecf456ed68007c60829be5c3c41bebf64a5d -- \
  apps/vite-example/tests/parity \
  script/diff-parity-snapshots.mjs \
  script/fixtures/type-baseline.json
```

Result: exit 0.

- protected parity tree: `e1fbb55b985f4fb490c6b233d18c50c58ea14c28`
- protected diff-oracle blob: `fa387ebea1e7f0cc1110eebcb922d393a1337842`
- protected type-baseline blob: `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8`

Retained generated parity artifacts:

| artifact | SHA-256 |
| --- | --- |
| `results-vite.json` | `5089ebc83703e1e74d6807c749cbe90cc6ae0c52cf9aaf225fa9e1966d1a6e04` |
| `vite/snapshot-vite.json` | `a49213df4f9d4f55b36f0a34dddd24238cc7e6bb588f5f7742a1909b157fd9bd` |
| `vite/ledger-vite.json` | `2b7790556217f1d579f12aadd009859393cf9e9be4c42f17d4d0060178b2fbc1` |
| `results-next.json` | `a7baf0545bc65ed77e6d9f53f8bc358c479eec1a89ad0ad0955768333bf1d137` |
| `next/snapshot-next.json` | `0e3813b4fccc2eb3a8b5a3b04b2d8adafb17a3e5408e03cd17d9011147fd3ed6` |
| `next/ledger-next.json` | `366e254a5b45f05dded0a1c180a1b79c61e2018fa97deaa8eb1c341601057349` |

Each Host retained 11 PNG captures (the ten final interaction screenshots plus the snap mid-drag capture).

## Cleanup and scope audit

- All verifier-owned Vite/Next/Playwright/Chromium processes were stopped; ports 43491, 43492, 43493, and 43494 have no listener.
- Verifier-created `dist-c4-parity-verify` and both verifier-created `.next` builds were deleted after evidence capture.
- The pre-verifier ignored `.next` output was restored to its original path; `.next-pre-c4-parity-verify` no longer exists.
- `apps/web/tsconfig.json` remained byte-identical and unmodified.
- No product, protected fixture/snapshot/oracle, task, run-state, PATCHES, inventory, Rust, or generated WASM file was edited by this verifier.
- Durable writes are limited to this evidence, the generated diff report, the two server log files, and the expected ignored parity artifacts/screenshots.

