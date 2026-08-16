# Group B evidence — export bridge, job manager, producer entry (B1–B4)

Worktree: `_others/rocut-wt-export`, branch `feat/sdk-export-capability`.
FFmpeg suite: `E:/Software/ffmpeg-6.0-full_build/bin/{ffmpeg,ffprobe}.exe`
(6.0 full build — libx264, libvpx-vp9, aac, libopus verified by the encodes below).
Scratch: `_others/rocut-export-scratch/` (never %TEMP%). Every log below carries a
`REAL_EXIT_CODE:` trailer because background/quiet exit codes are untrustworthy.

## Files delivered (all `tr -dc '\r' | wc -c` = 0)

| Task | File |
|---|---|
| B1 | `apps/electron-host/src/export/export-ipc-contract.ts` — 13 frozen ops, wire types, event channels |
| B2 | `apps/electron-host/src/export/job-manager.ts` — `ExportJobManager` (records, raw stream, WAV, FFmpeg, cancel/interrupt/resume) |
| B2 | `apps/electron-host/src/export/main-export-ipc.ts` — `installExportIpc` (pure Node bundle) |
| B2 | `apps/electron-host/electron/preload.cjs` — second frozen global `window.opencutExport` |
| B2 | `apps/electron-host/electron/main.cjs` — exportsRoot, `installExport`, hidden producer window, boot `interruptAllLive` before `createWindow`, CSP byte-untouched |
| B2 | `apps/electron-host/src/export/__tests__/export-bridge-surface.test.ts` — 7 drift/wiring tests |
| B2 | `apps/electron-host/src/store/__tests__/store-bridge-surface.test.ts` — pinned global count 1→2 (edit, see deviations) |
| B2 | `apps/electron-host/package.json` — build chain += `dist-main/main-export-ipc.cjs` |
| B3 | `apps/electron-host/src/export/__tests__/job-manager.test.ts` — 6 tests, real FFmpeg + ffprobe |
| B4 | `apps/electron-host/export-renderer.html` — CSP byte-identical to index.html, no #root |
| B4 | `apps/electron-host/src/export-renderer/main.ts` — plain-TS producer entry (no React) |
| B4 | `apps/electron-host/vite.config.ts` — rollupOptions.input += `export-renderer` |

`grep -c MUTATION job-manager.ts` = 0 (mutation scaffolding fully reverted).

## Frozen IPC operation list (13, drift-pinned by test)

`startJob, beginExport, frame, audio, finalize, failJob, listJobs, getJob,
cancelJob, resumeJob, discardJob, readJobOutputBytes, jobDone` on prefix
`opencut-export:`, plus main→renderer events `jobEvent`, `frameAck`,
`jobsChanged`. `frame` is the one `ipcMain.on` op (sender-directed ack); the
other twelve are `ipcMain.handle`.

## Gate ladder (order: build → typecheck → targeted → full → check:packages → C6)

### build — GREEN

```
cd apps/electron-host && bun run build        # groupb-final-build.log
✓ built in 2m 47s                              # vite: app + surface-evidence + export-renderer
  main-store-ipc.cjs   14.11 KB (3 modules)
  main-export-ipc.cjs  50.15 KB (4 modules)
REAL_EXIT_CODE:0
```

`dist/export-renderer.html` + `dist/assets/export-renderer-*.js` emitted; the
producer's editor graph lands in the shared `electron-host-config-*.js` chunk
(the same chunk app/surface-evidence import — `renderAndCapture`/`createCanvasRenderer`
present there, 9 `export-renderer:` strings in the entry chunk).

### typecheck — GREEN

```
cd apps/electron-host && bun run typecheck    # groupb-b4-typecheck2.log
$ tsc --noEmit -p tsconfig.json
REAL_EXIT_CODE:0
```

(One iteration: first run exit 2 — `FrameBatchMessage` missing from the
producer's import list, `groupb-b4-typecheck.log`; fixed, re-run green. An
earlier-session run over B1/B2 was also green: `groupb-typecheck-early2.log`.)

### targeted tests — GREEN

```
bun test apps/electron-host/src/export apps/electron-host/src/store   # groupb-b4-targeted.log
 19 pass / 0 fail / 121 expect() calls / 5 files / 15.29s
REAL_EXIT_CODE:0
```

Composition: job-manager 6 (B3, real FFmpeg), export-bridge-surface 7 (B2),
store-bridge-surface 4 (Group-store + my count edit), plus 2 pre-existing
store-suite tests. Earlier-session checkpoints: bridge suites alone
11 pass/0 fail/51 expects (`groupb-bridge-tests.log`); job-manager alone
6 pass/0 fail/69 expects (`groupb-jobmgr-run3.log`).

#### B3 test bodies (real binaries, deterministic payloads)

- Frames: per-frame RGB24 gradient `(x+i)%256, (y+2i)%256, (x+y+i)%256`; audio:
  hand-rolled 44.1 kHz stereo PCM16 WAV (440/443 Hz sines, amp 0.3) — the same
  shape `extractTimelineAudio` emits.
- happy path (320x180@30/1, 60f + 2 s WAV): ffprobe `-show_streams -show_format`
  asserts h264 + aac, 320x180, duration |d−2.0| < 0.2; output descriptor
  `file:Happy-Path-…`; `readJobOutputBytes` byteLength === output.bytes; raw/wav
  cleaned; rendering progress strictly inside (0,1) monotone, encoding progress
  ≥1 sample monotone.
- cancel mid-render: cancelled record kept, raw/wav/partial/output all absent,
  idempotent re-cancel.
- cancel mid-encode (640x360, 240f): polls to `phase === "encoding"`, cancels
  INSIDE the encode; a resolved cancel is the child-exit proof (cancelJob awaits
  the SIGTERM→3s→SIGKILL→exit chain); partial/raw absent.
- interrupt+resume across manager instances: 25/60 → `interruptAllLive()=1` →
  dispose → fresh manager lists interrupted 25/60 → resume `nextNeededFrame=25`
  → 35 more frames → audio → finalize → completed; ffprobe `-count_frames`
  nb_read_frames ∈ [58,62], duration |d−2.0| < 0.25.
- boot scan: dispose WITHOUT interrupt leaves record `rendering` at rest → new
  manager `interruptAllLive()=1` → interrupted 10/60, second scan 0; discard
  removes record + raw, list empty.
- gap/duplicate: startIndex 3 on a 0-frame record and a doubled batch both throw
  `ExportJobManagerError`, phase failed with `FRAME_STREAM_DESYNC_REASON`;
  re-attach on a failed job refuses `/already settled/`.

### full bun test — deterministic failures = exactly the 6 baseline; 9 additional are machine-speed flakes (analysis below)

```
bun test                                        # groupb-b4-fulltest.log
 752 pass / 15 fail / 767 tests / 121 files / 343.74s
REAL_EXIT_CODE:1
```

Counts reconcile exactly: 754 baseline tests + 6 (job-manager.test.ts, Group B)
+ 7 (Group A's export-jobs.test.ts, merged into the worktree between sessions)
= 767; files 119 + 2 = 121.

The 15 fails split:

1. **The 6 baseline failures, unchanged** — mask snapping ×3 (uniform scale,
   text mask movement, custom point insertion), editor singleton boundary,
   resolveTrackPlacement batch spans, and the ports-suite migration case
   (`the ports suite passes with the migration case exercised`, fails in
   16 ms deterministically — re-verified `groupb-rerun-migration.log`).
2. **9 machine-speed flakes in shared `Bun.spawnSync` wrappers** — every one is
   an "…runs in an isolated … process" wrapper whose child needs 6–16 s while
   the wrapper keeps bun's DEFAULT 5 s test timeout. Proofs:
   - session-lifecycle child standalone: **43 pass / 0 fail, 11.8 s, exit 0**
     (`groupb-child-lifecycle.log`).
   - C5 coordinator child standalone (`OPENCUT_C5_COORDINATOR_ISOLATED=1`):
     **4 pass / 0 fail, 6.1 s, exit 0** (`groupb-child-coordinator2.log`).
   - Under lower load the same suites pass in-suite: fonts 6/6 at 1.2 s,
     persistence-rewire, headless migration, C5 REDs (`groupb-rerun-isolated.log`,
     `groupb-rerun-migration.log`).
   - No child imports any file Group B touched (my surface is
     `apps/electron-host/**`; the children are editor-classic/script fixtures).
   The 5 s default on those wrappers is a pre-existing landmine on this box
   (E: at 931.5 GB used; an ENOSPC transient hit this session too) — files live
   in `packages/**`, outside Group B's write surface, so NOT adjusted here.
   Flagged for LEAD.
3. **The `error:` lines about "C6 … closure fixture integrity drifted" and
   "emitted vite graph is truncated" in the full log are EXPECTED noise from
   PASSING negative-control tests** (they feed tampered fixture copies and the
   checker logs its intended refusals). Verified directly:
   `sha256(JSON.stringify({requiredRoots, common, hosts}))` of
   `script/fixtures/c6-session-resource-expected-closure.json` = `703efb9c…`
   (the pinned value) under BOTH node and bun.

### check:packages — GREEN

```
bun run check:packages                          # groupb-final-checkpackages.log
 PASS acyclic-direction (1019 files, 425 edges) / public-entry-only (424 specifiers)
     / no-internal-reexport (872) / no-elftia-import (1146) / react-free-base (76)
REAL_EXIT_CODE:0
```

Census 1146 files vs 1140 baseline = +6, exactly Group B's six new source files
(export-ipc-contract.ts, job-manager.ts, main-export-ipc.ts, two test files,
export-renderer/main.ts).

### C6 checker — GREEN (session-adjacent code touched)

```
node script/check-session-resource-boundary.mjs  # groupb-final-c6.log (post-rebuild)
clean — all non-exempt web editor acquisitions cross the session seam
REAL_EXIT_CODE:0
```

The producer entry is inside the `apps/electron-host/src` scan root and is
clean: fully event-driven (frameAck promise backpressure + settled event), no
bare timers, no aliases through globalThis.

## Mutation red/green (both pairs)

| Mutation | Red run | Green run |
|---|---|---|
| A: comment out `this.cleanupArtifacts(args.jobId, true);` in `cancelJob` | `groupb-mut-a-red.log` 4 pass/2 fail, exit 1 (both cancel tests fail: artifacts survive) | `groupb-mut-a-green.log` 6 pass/0 fail, exit 0 |
| B: `resumeJob` returns `nextNeededFrame: 0` | `groupb-mut-b-red.log` 5 pass/1 fail, exit 1 (resume test: re-sends from 0 → desync) | `groupb-mut-b-green.log` 6 pass/0 fail, exit 0 |

Tree verified clean afterwards: 0 `MUTATION` strings, 0 CR bytes.

## Deviations (each a decision, not an accident)

1. **`failJob` added as the 13th operation.** The producer needs a channel to
   report load/render/audio failures with a named reason; frozen in the ops
   list and pinned by the drift test like the other twelve.
2. **`store-bridge-surface.test.ts` pinned global count 1→2.** Adding the
   second frozen-role global is a design-level contract change (D4); the test
   now pins TWO globals with an in-test comment explaining why a third cannot
   appear silently.
3. **FFmpeg `-f <format>` explicit container flag.** The `.partial` output
   suffix defeats ffmpeg's muxer inference ("Unable to find a suitable output
   format"); the explicit `-f` before `-y <out>.partial` fixes it (found via
   scratch `diag-encode.ts` capturing the stderr tail).
4. **Resume-by-replay.** A fresh process reconstructs the store by
   `open → beginRendering(total) → acceptFrames(accepted)` and cursors past the
   replayed events; the raw stream on disk is the resumable truth.
5. **`LiveJob.cancelRequested` is a manager-level fact, never persisted** — it
   bridges `cancelJob` to the FFmpeg exit handler so a killed child settles
   `cancelled`, not `failed`. The store deliberately hides it in snapshots.
6. **B4 reuses `createElectronEditorHost` with stubbed interactive callbacks**
   (`onProjectIdChange`/`onExitProject` no-ops, documented in-file): it is the
   single composition root owning the durable store bridge and wasm runtime
   resources; the interactive roles are inert without a mounted React surface.
   The session is NOT mounted — `editorForSession` works unmounted and
   `editor.project.loadProject({id})` completes the full load internally
   (persistence → fonts → drain → media → transactions → scenes).
7. **Producer declares the stale guard via `window.opencutStore.loadRecord`** —
   the same summary source main's `getProjectMeta` used at `startJob`, so the
   two-window contention row is exercised end-to-end (mismatch fails with
   `PROJECT_UPDATED_MID_JOB` before any render).

## Findings for LEAD

1. **Fonts**: the producer awaits `loadFontAtlas` (the use-font-atlas
   discipline) before rendering, so text elements have glyph chunks. Whether
   text renders with real glyphs in the hidden window is Group D's E2E to
   observe; the graphic/shape fallback fixture was NOT exercised (no smoke run
   in Group B scope).
2. **Project load**: minimal complete load = `editor.project.loadProject({id})`
   — no extra orchestration, no mount required. `getActive()` THROWS (not
   returns null) when nothing is loaded; the producer wraps it in the
   failJob path.
3. **Isolated-process wrappers' 5 s default timeout vs 6–16 s child runtimes on
   this machine** (see full-test analysis) — pre-existing, outside Group B's
   surface; a future explicit-timeout bump in those shared tests would de-flake
   full-suite runs on loaded Windows boxes.
4. **Transient ENOSPC on E:** during B3 (0 GB free reported, then 1.5 GB free
   moments later; external process). Write succeeded on retry; no action taken.
5. **Group A's `export-jobs.test.ts` (+7 tests) landed into the worktree
   between Group B sessions** — reconciles the 754→767 test count with
   Group B's +6.

## Post-review fixes (B-1, M-1) — fixer fork, 2026-08-16 (review: review-ab-pass1.md)

**B-1 (Blocker) — the producer's frame read path.** `export-renderer/main.ts`
no longer reads the compositor canvas (a wgpu surface — `getContext("2d")` is
null by spec) — the frame loop now renders through the donor's own
`CanvasRenderer.renderToCanvas({node, time, targetCanvas})` onto a producer-
owned 2D canvas (`willReadFrequently`), then `getImageData`s THAT canvas —
byte-for-byte the preview path's proven readout. The dead mid-loop size check
went with the rewrite (the target is now our own canvas, constructed at the
assignment size).

**M-1 (Major) — the raw stream must agree with the record on every
disk-attach.** New `ExportJobManager.reconcileRawStream(record)` +
`RAW_STREAM_SHORT_REASON = "raw-stream-short"`, called from BOTH disk-attach
sites (`resumeJob`; `beginExport`'s interrupted branch; both guarded to
spec-carrying records so a queued-interrupted job keeps its existing refusal):
`size > acceptedFrames × frameBytes` → frame-aligned truncate (the dead
producer's unpersisted tail); `size <` → `failJob(RAW_STREAM_SHORT_REASON)`
and a named throw — the job can never be completed honestly, so it never
reaches FFmpeg.

**Regression tests added** (`job-manager.test.ts`):
- *surplus tail*: 25 frames fed, 5 more frame-bytes appended directly to the
  raw file (the M-1 path-a/c signature), interrupt → new manager → `resumeJob`
  truncates back to exactly 25×frameBytes (asserted on disk) → completes;
  ffprobe `-count_frames` ∈ [58,62] and |duration−2.0| < 0.25 — the tightened
  bounds are exactly what a silent-tail bug (65 frames read) would break.
- *short stream*: raw truncated to 20 frames' bytes against a 25-frame record
  → `resumeJob` throws the named reason; job settled `failed` with
  `raw-stream-short` in the error; the dishonest stream is cleaned.

**Stride proof (B-1 follow-up).** `rgbaToRgb24` extracted to
`src/export-renderer/rgb24.ts` (import-safe — `main.ts` still self-runs at
module top, so the entry itself is untestable) and unit-asserted on crafted
buffers (`src/export-renderer/__tests__/rgb24.test.ts`): a 2×2 proves channel
order + alpha-drop (alpha ignored, not premultiplied), and a **3-wide row**
proves the source stride is 4 bytes/pixel — a `width*3`-source-stride bug
would emit `[1,2,3,4,5,6,7,8,9]` instead of `[1,2,3,5,6,7,9,10,11]` and the
test goes red. Per the brief this unit assertion replaces a temporary
mutation (synthetic gradients satisfy any uniform-but-wrong drop).

**m-2 (Minor) — dispose invariant named.** The `dispose()` docblock in
`job-manager.ts` now records review m-2's invariant: nobody calls dispose on
quit today, mid-encode crash recovery depends on that, and quit-wiring it
requires first teaching the exit handler to treat an already-`interrupted`
record as an expected death.

**Skipped, out of the fixer's file scope (per brief):** m-1 (producer
`settledSeen` self-termination flag — lives in `main.ts`'s ack machinery but
explicitly excluded by the brief; behavior is correct today via main's window
destruction), m-3 (window-open stranding — `main-export-ipc.ts`/`main.cjs`),
m-4 (latent `whenSettled`-on-discard — noted by review, nothing awaits it).

**Gates** (logs `.fix-b1m1-tests.log`, `.fix-b1m1-typecheck.log`):
`bun test job-manager.test.ts rgb24.test.ts` — **10 pass / 0 fail / 85
expects, REAL_EXIT_CODE:0** (6 original + 2 M-1 regressions + 2 stride);
`bun run typecheck` (electron-host) — **REAL_EXIT_CODE:0**. LF verified 0 CR
on all five touched files (`job-manager.ts`, `job-manager.test.ts`,
`export-renderer/main.ts`, `export-renderer/rgb24.ts`,
`export-renderer/__tests__/rgb24.test.ts`). No git commands run.
