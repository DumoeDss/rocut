## Why

S08 owns production export, and everything it needs that does *not* depend on
Phase 5/6 packaging can land now. The frozen `ExportProvider` port was declared
thin on purpose ("S08 owns production export" — its own header), nothing consumes
it, and the donor export path is browser-only: mediabunny/WebCodecs entirely
inside the renderer, an `ArrayBuffer` handed to an anchor click, no host
involvement, no job identity, no progress or cancellation the port can carry, no
recovery, no output destination a desktop host could honor. The mainline-side
queue's third item (ruled 2026-08-16) delivers the export capability subset S08
will accept against: a real FFmpeg reference adapter behind the port seam, the
job lifecycle production export needs, a repeatable 2000-clip performance
baseline with recorded numbers, and the codec/patent/third-party-asset legal
review that gates S08 acceptance.

## What Changes

- **Export gap audit (先行, shapes the rest).** Port现状 vs production needs,
  recorded in design.md with named findings. The frozen port shape is
  insufficient for production export (no progress, no cancellation, no job
  identity, no recovery, `bytes: ArrayBuffer` whole-file-in-memory, no output
  destination). Resolution follows the ruled path: an **additive experimental
  entry** beside the frozen surface — no frozen byte changes, no private
  revision. The `ExportProvider` file stays byte-identical; the finding and the
  proposed S08 revision shape are recorded for the Direction ledger.
- **New experimental surface `@opencut/editor-ports/export-jobs`.** Job-shaped
  export semantics: start → `jobId`, phase/progress reporting, cancellation,
  best-effort recovery (list/resume/discard), output as an opaque descriptor
  plus size (the renderer-holds-no-paths guarantee holds). Classified
  `experimental` in `surface.json` with an in-source `@opencutSurface` marker
  per the P5 rules; react-free, dependency-free, beside the in-memory reference
  implementation.
- **FFmpeg reference adapter in the Electron desktop host (main-process binary
  form).** The host's `exporter` role becomes a final override backed by the new
  surface. A hidden export-renderer window (a second built entry) boots the
  editor session headlessly, renders frames through the same
  CanvasRenderer/wasm-compositor path the preview uses, and streams them over a
  preload bridge to the main process, which accumulates a raw frame file and
  invokes the FFmpeg binary once at finalize (raw video + timeline WAV → real
  MP4 with video and audio). Real end-to-end evidence (command, logs, output
  fingerprint, playability/duration/track assertions) lands in `evidence/`.
  The binary is discovered/configured, never bundled (a legal-review-driven
  decision).
- **Job lifecycle with proven semantics.** Progress (frame-count during render,
  `out_time` during encode), cancellation (FFmpeg process terminated, raw and
  partial output cleaned), and best-effort recovery (durable job records; after
  a renderer or app death the job is listed `interrupted` and resumable from
  the last persisted frame index, because rendering is random-access). Each
  semantic has a test with mutation verification (revert → red).
- **2000-clip performance baseline harness.** One repeatable command that
  generates a deterministic clip-heavy project (text/graphic elements — no
  media pipeline), boots the Electron host against it, and records the
  baseline table: interaction latency, playback frame rate, export wall time
  (render phase and encode phase separately), and renderer/main memory.
  Deliverable is the *measurement*, not a gate: today's shortfall is
  quantified for S08.
- **Codec capability / patent / third-party asset legal review.** Research
  document with per-conclusion citations: FFmpeg GPL vs LGPL build families
  and what each forces on distribution; H.264/HEVC/AAC/Opus/VP9 patent
  surfaces for the FFmpeg path and the mediabunny/WebCodecs path; font (Google
  Fonts atlas), sticker and audio asset redistribution constraints.

## Capabilities

### New Capabilities

- `export-job-lifecycle`: the additive experimental export-job surface — job
  identity, phases, progress, cancellation, best-effort recovery, opaque
  output descriptors, and its in-memory reference implementation and
  conformance requirements.
- `sdk-desktop-export-adapter`: the Electron desktop host's FFmpeg reference
  adapter end to end — the preload bridge, the hidden export-renderer window,
  main-process job management over the raw-file + single-FFmpeg-invocation
  design, and the real end-to-end export evidence requirements.
- `export-performance-baseline`: the repeatable clip-heavy performance
  harness and the recorded baseline numbers with a stated method.

### Modified Capabilities

- `sdk-desktop-reference-host`: the host composition gains the `exporter`
  final override, the export IPC bridge, and a second built entry page —
  additive scenarios under the existing composition/CSP/no-renderer-paths
  requirements.

## Impact

- `packages/editor-ports`: new `src/export-jobs.ts` + `exports` map entry +
  `surface.json` row (all additive; the frozen barrel `src/index.ts` and
  `export-provider.ts` stay byte-identical; `check:packages`,
  `check:surface-labels` stay green with non-zero census movement recorded).
- `apps/electron-host`: `electron/main.cjs` (export IPC install, hidden
  export window), `preload.cjs` (the `opencutExport` bridge), new
  `export-renderer` entry + renderer-side export modules, `dist-main` build
  gains the export IPC bundle, host-owned export job-control UI, new proof
  scripts under `scripts/`.
- No `editor-classic` changes; the donor mediabunny path stays untouched as
  the browser-native对照.
- No wasm build-chain files (`rust/wasm/`, `script/*wasm*`) — the parallel
  wasm session's territory.
- Perf/legal artifacts live outside the repo tree (E: sibling scratch roots),
  committed evidence holds logs/fingerprints/tables only.
- Baseline state this change must not regress: parity editing scenario green
  on vite + electron with snapshot diff clean; `bun test` and
  `check:wasm`'s api-surface leg carry recorded pre-existing local reds
  (bun 1.2.2 vs CI 1.2.18; wasm-pack LICENSE/README hash drift) — documented,
  not caused or fixed here.
