# Tasks — sdk-export-capability

Every task ends with its own evidence line (population count beside each
green; real exit codes; mutation verifications where the spec demands them).
Phase lint runs once at the end per the house convention, not per task.

## Group A — the experimental surface (ports)

- [x] A1. `packages/editor-ports/src/export-jobs.ts`: the types + the
  `ExportJobStore` reducer (state machine for
  start/frame/complete/fail/cancel/interrupt/resume/discard) + the
  `InMemoryExportJobProvider`. In-source `@opencutSurface experimental`
  marker with reason. No React, no DOM, no classic import.
- [x] A2. Exports map + `surface.json` row (`./export-jobs`, experimental).
  No other ports source file changes (the reference provider lives inside
  `export-jobs.ts`; `./in-memory` is frozen-classified and stays untouched).
  Verify: `bun run check:surface-labels` census 35→36 entries (experimental
  6→7); `bun run check:packages` green with census movement recorded
  (baseline 1138 repo files → N).
- [x] A3. Reducer-level conformance suite
  (`src/__tests__/export-jobs.test.ts`): identity/phases, progress
  monotonicity, cancel idempotence + cleanup, interrupt/resume from persisted
  frame index, discard. Plus mutation verifications: revert each semantic
  (progress, cancel, resume) in turn → its test red → restore (record all
  three red/green pairs).
- [x] A4. Frozen-byte guard: assert `git diff 661d7ac8 --` over the five
  frozen files is empty after Group A (recorded in evidence; also asserted
  again at close-out).

## Group B — the desktop job manager + bridge (main process)

- [x] B1. `apps/electron-host/src/export/main-export-ipc.ts` → built to
  `dist-main/main-export-ipc.cjs` (extend the package build script): the
  `JobManager` — job records (`<exportsRoot>/jobs/<id>.json`), raw stream
  append + frame accounting, FFmpeg discovery (env → config → PATH) and the
  finalize invocation (`rgb24` raw + WAV → `-c:v libx264 -c:a aac` mp4 /
  `-c:v libvpx-vp9 -c:a libopus` webm, `-progress pipe:1`), cancel (kill +
  cleanup), boot-time interrupted-job scan. Exports root: `userData/exports`
  overridable (`OPENCUT_EXPORT_ROOT`) — E: scratch in runs.
- [x] B2. Preload bridge `opencutExport` + operation-list surface test
  (store-bridge pattern). `main.cjs`: install export IPC; hidden
  export-renderer window lifecycle (create on start, destroy on
  settle/cancel/discard).
- [x] B3. Job-manager unit tests under `bun test` (no Electron): fake frame
  feeder + real ffmpeg binary against a tiny 2-second synthetic raw stream —
  progress events, cancel-mid-render cleanup (process gone, files gone),
  interrupt-by-record + resume completes with exact total frames, discard
  cleanup. Mutation verifications for cancel and resume semantics.
- [x] B4. `export-renderer` entry (`export-renderer.html` +
  `src/export-renderer/main.ts`): headless session over `IpcStoreBridge`
  against the assigned project; frames `[nextNeeded, total)` via
  CanvasRenderer + wasm compositor (RGBA→RGB24 batches, ack backpressure);
  timeline WAV extraction via classic `./media`; job event reporting. Add
  entry to the vite build config.

## Group C — composition + job control UI

- [x] C1. `createElectronEditorHost` `exporter` final override
  (`ElectronExportProvider`: canExport truthfulness, job bridge → frozen
  outcome mapping incl. bytes read-back). Composition test asserting the
  override and untouched sibling roles.
- [x] C2. Host-owned export panel (format/quality/audio, progress by phase,
  cancel, interrupted-job resume after restart) — host code only, addresses
  jobs by id, no paths.

## Group D — end-to-end evidence

- [x] D1. `scripts/export-e2e-proof.mjs` (Playwright `_electron`, minimal
  env, swiftshader): generate a small mixed project (text/graphic clips +
  generated tone WAV audio) via the real store classes → boot → start export
  from the panel → await completion → assert output file: exists, nonzero,
  `ffprobe` (same binary dir) reports 1 video + 1 audio track, duration
  within one frame of the timeline, container mp4. Record command, logs,
  sha256 + size. Positive and negative (no-binary → unsupported) legs.
- [x] D2. Progress/cancel proofs through the real app: progress reaches both
  phases with monotonic values; cancel mid-render leaves no ffmpeg process
  (tasklist assert) and no raw/partial files; kill-the-app-mid-render →
  relaunch → job listed interrupted → resume → complete + verify output.

## Group E — performance baseline

- [x] E1. `scripts/generate-clip-project.mjs`: deterministic 2000-element
  project (method recorded: kinds, durations, distribution, tracks, fps,
  canvas) through the real store classes into a caller-given root.
- [ ] E2. `scripts/export-perf-baseline.mjs`: one command — generate fresh
  root → boot → measure interaction latencies, playback fps, export wall
  time (render/encode split), renderer/main memory → write
  `evidence/perf-baseline-<date>.md` with method + shortfall columns. Two
  consecutive runs recorded to demonstrate repeatability.

## Group F — legal review

- [x] F1. `docs/export-legal-review-2026-08.md`: FFmpeg license families &
  distribution obligations; codec patent surfaces (FFmpeg path vs
  mediabunny/WebCodecs path); third-party asset redistribution (fonts atlas,
  stickers, audio). Every conclusion cited. Reviewed for accuracy of sources
  (not legal advice — stated).

## Group G — no-regression + close-out

- [ ] G1. Re-run the checker family (census recorded), `bun test` (failures
  exactly the 6 baseline ones), parity editing scenario on vite + electron +
  snapshot diff (within documented classes), frozen-byte guard A4.
- [ ] G2. Lint the touched trees once (`eslint` over new/changed files; the
  repo's disclosed-lint-errors posture unchanged), `typecheck` the electron
  host.
- [ ] G3. Commit series (logical groups), review cycle (author≠verifier),
  push branch, PR to DumoeDss/rocut main, CI green, **stop**.
