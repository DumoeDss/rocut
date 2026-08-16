# Design — sdk-export-capability

## Context

S08 owns production export. Its frozen seam is
`packages/editor-ports/src/export-provider.ts` (S02), whose own header records
that the in-memory reference reports `unsupported` on purpose because
"S08 owns production export". The donor export machinery
(`editor-classic/src/export/`, `RendererManager.exportProject`,
`SceneExporter` over mediabunny/WebCodecs) is real but browser-renderer-local:
an `ArrayBuffer` handed to an anchor click, progress as a callback, cancel as
a 100 ms-polled flag, nothing the host participates in, nothing that survives
a crash. This change delivers the S08-ready capability subset the mainline
queue ruled on 2026-08-16: the gap audit, an additive experimental job
surface, a real FFmpeg reference adapter in the Electron desktop host, proven
job lifecycle semantics, a repeatable 2000-clip baseline, and the legal
review. It must not touch a frozen byte, the wasm build chain (parallel
`fix/wasm-determinism` session owns it), S07/Agent ground, or the Elftia
repository.

## Part 1 — The export gap audit (先行; every later decision cites it)

Measured against what production export needs, the frozen port and the donor
path have these named gaps:

- **F1 — No job identity.** `export(): Promise<ExportOutcome>` is an anonymous
  promise. Production needs an addressable job: observable, cancellable,
  discoverable after death, restartable. Nothing in the frozen shape can name
  one.
- **F2 — No progress channel.** The donor has progress internally (a callback
  plus 0.05-reserved audio share) but the port has nowhere to put it; a Host
  composing the frozen surface cannot show a user anything.
- **F3 — No cancellation.** The donor cancels by a polled flag that flips an
  internal boolean checked between frames. The port accepts no cancel signal;
  a Host cannot stop an export it started through the contract.
- **F4 — `bytes: ArrayBuffer` is whole-file-in-memory and destination-blind.**
  A desktop deliverable is a file at a location; the frozen outcome can only
  carry the entire file as renderer memory, and the donor then downloads it
  via an anchor click. No output-destination semantics exist anywhere.
- **F5 — No recovery.** Cancel or crash destroys everything; no job record
  survives, nothing is resumable. The donor has no notion of an interrupted
  export.
- **F6 — The port is unconsumed.** Nothing in `editor-classic`'s production UI
  routes through `exporter`; the export button calls
  `editor.project.export` → `renderer.exportProject` directly. The role is
  declared (so a Host author sees the shape) but no reference consumer
  exists — S08 inherits both the missing semantics and the missing consumer.
- **F7 — Format set unfixed.** `ExportRequest.format: string` is opaque by
  design ("S08 fixes the set"). The donor de-facto set is `{mp4, webm}`.

**Verdict: the frozen shape is insufficient for production export — but it is
not wrong; it is deliberately thin.** The ruled resolution is an *additive
experimental entry* (`@opencut/editor-ports/export-jobs`) declaring the job
surface beside the frozen file, classified `experimental` per P5's taxonomy
(may change or be removed in a minor; exactly what S08 needs while it ratifies
or revises). No frozen byte changes; no private revision; F1–F5's contract
pressure is recorded here and in the proposal for the Direction ledger, where
the S08-era freeze decision lives. F6's consumer question stays open for S08
(whether classic's UI should re-route through the port); this change's
consumer is the desktop host's own composition, which is exactly the
Host-owned role pattern `sdk-desktop-reference-host` already establishes.

## Part 2 — Decisions

### D1. The experimental surface: `ExportJobProvider` as a separate subpath, not a widened role

`packages/editor-ports/src/export-jobs.ts` exports:

- `ExportJobRequest` — `{ projectId, format: "mp4" | "webm" | (string & {}) }`
  (the donor set spelled literally for completion while staying open — F7 is
  S08's to close), `quality`, `includeAudio`, optional `fps`.
- `ExportJobPhase` — `queued | rendering | encoding | completed | failed |
  cancelled | interrupted`.
- `ExportJobSnapshot` — `{ jobId, request, phase, progress ∈ [0,1],
  output: { descriptor: string; bytes: number } | null, error: string | null,
  frames?: { accepted, total } }`.
- `ExportJobProvider` — `listJobs()`, `startJob({request}) → {jobId}`,
  `getJob({jobId})`, `cancelJob({jobId})`, `resumeJob({jobId})`,
  `discardJob({jobId})`, plus `onJobEvent({jobId, handler}) → unsubscribe` for
  push-style progress (a poll-only consumer can ignore it).
- `readJobOutputBytes({jobId}) → ArrayBuffer` — the explicit bytes bridge
  that makes the frozen `ExportProvider` semantics implementable on top.

*Why a new entry and not an optional member on `EditorHostPorts`:* the ports
barrel `src/index.ts` is one of the four byte-frozen surfaces (BOUNDARIES
§14); `EditorHostPorts.exporter`'s type cannot widen without editing it. An
exports-map addition is the P5-sanctioned additive move (monotone growth with
a named consumer: the desktop host's adapter). *Why the phase set includes
`interrupted`: it is a discovery state (persisted record, dead producer), not
a live phase — conflating it with `failed` would lose "resume is possible".

### D2. The in-memory reference: conforming, non-producing

The ports package ships `InMemoryExportJobProvider` **inside the
`export-jobs.ts` entry file itself**: it accepts jobs, advances them through
synthetic phases on a timer, honors cancel, and persists nothing. It lives
there — not beside `UnsupportedExportProvider` — because `./in-memory` is a
`frozen`-classified entry (surface.json) whose file must carry no markers and
no experimental-class symbols; self-containment also means Group A edits no
existing ports source file at all. The same entry exports a pure
`ExportJobStore` reducer (the state machine:
`start/frame/complete/fail/cancel/interrupt/resume/discard` transitions) for
**unit-level conformance testing of the lifecycle semantics without any
process, IPC or binary**. The reducer is the semantic SSOT; both the
in-memory provider and the desktop job manager transition through it, so the
mutation-verified tests cover the semantics once and both implementations
inherit the proofs.

### D3. The desktop adapter: render in a hidden window, accumulate raw frames in main, encode once with the binary

Architecture (every piece names an owner):

```
interactive window (index.html)
  └─ host export panel (job control only, addresses jobs by id)
       │ opencutExport:* (preload bridge, invoke-shaped)
  ┌────▼─────────────────────────────────────────────┐
  │ MAIN  JobManager (dist-main/main-export-ipc.cjs) │
  │       · job records: <exportsRoot>/jobs/<id>.json│
  │       · raw stream:   <exportsRoot>/jobs/<id>.raw│
  │       · audio:        renderer-extracted WAV     │
  │       · ffmpeg spawn at finalize (raw+wav → out) │
  │       · discovery: env → config → PATH           │
  └────┬─────────────────────────────────────────────┘
       │ opencut-export:* (preload bridge)
  hidden window (export-renderer.html, show:false)
  └─ headless session over the same opencutStore bridge
     · CanvasRenderer + wasm compositor (same path as preview)
     · renders frames [nextNeeded, total) → streams RGBA/RGB batches
     · extracts timeline audio → WAV bytes (donor's own extractor)
```

*Why render in a hidden second window rather than the interactive renderer:*
(1) export rendering must not contend with interactive playback for the
compositor; (2) recovery becomes real — the producer can die (window closed,
app killed) while the job record and raw stream live in main, and a fresh
producer resumes at `nextNeeded` because rendering is random-access
(`renderAndCapture` takes an arbitrary time); (3) it needs zero classic-UI
changes — the donor button keeps its browser path as the对照, the host owns
its export composition exactly as it owns its store. The host already has the
machinery: `--opencut-entry=<name>` selects a built entry, and the C6/C4
harnesses prove harness pages boot against a disposable store root.

*Why accumulate a raw file and invoke FFmpeg once at finalize, rather than
piping into a live FFmpeg stdin:* resume. A pipe's decode position dies with
the process; an append-only raw file plus a persisted frame count makes
"resume from frame N" a file fact, not a process fact. Cost: disk (the
reference demo runs 720p RGB ≈ 2.8 MB/frame; a 10 s @ 30 fps job ≈ 830 MB
transient, deleted at finalize/discard — scratch roots live on E: beside the
repo, never `%TEMP%`). Encode progress reads FFmpeg's `-progress pipe:1`
`out_time` against total duration.

*Why RGBA→RGB at the renderer:* one `Uint8ClampedArray → Uint8Array` channel
drop in the producer cuts transport and disk by 25% and FFmpeg accepts
`-pix_fmt rgb24` directly; no colorspace ambiguity (canvas is sRGB).

*Why main-process binary, not ffmpeg.wasm:* the ruled preference when the
wasm session's branch is unmerged (it is — both parallel worktrees still sit
at 661d7ac8), and independently the right call: a real binary exercises the
legal-distribution question S08 actually faces, needs none of the wasm
loading chain, and encodes orders of magnitude faster than wasm.

*Binary discovery, never bundling:* `OPENCUT_FFMPEG_PATH` → a configured
location under the exports root → `PATH`. Missing binary ⇒ `canExport`
false + `unsupported` reason (the frozen contract's own state). The reference
runs use the machine's existing `E:/Software/ffmpeg-6.0-full_build` (gyan.dev
full build, GPL — fine to *use*; the legal review owns what distribution
would require).

### D4. The bridge mirrors the store bridge, and the CSP does not move

`preload.cjs` gains exactly one more exposed object, `opencutExport`, over
`opencut-export:<operation>` channels; a surface-drift test guards the
operation lists the same way `store-bridge-surface.test.ts` does. Values are
identifier- and value-shaped; no filesystem path crosses (outputs are opaque
descriptors; "reveal in folder" would be a main-side shell action, not a
renderer one). IPC is not `connect-src`, so the committed CSP string stays
byte-identical.

### D5. Audio rides the donor's own extractor, as WAV bytes over the bridge

The hidden window uses classic's timeline audio extraction (`./media` entry —
its first consumer, exactly what the P1 entry table anticipated) to produce
the timeline WAV, sends the bytes once per job, and FFmpeg takes it as the
second input (`-f wav -i audio.wav`). AAC for mp4, copy-safe Opus for webm.
When the timeline has no audio, the video-only invocation runs (the spec's
"video and audio" case is exercised by the E2E fixture, which contains both).

### D6. The frozen-role bridge in the composition root

`createElectronEditorHost` gains the `exporter` final override:
`canExport` = binary discoverable; `export()` = `startJob` → await completion
via events → `readJobOutputBytes` → frozen `completed{bytes}`, or
`unsupported`/`failed` mapped by reason. This keeps the frozen contract
truthfully implemented (F4's memory cost is the frozen shape's own; the
experimental surface is where the descriptor-based path lives).

### D7. The 2000-clip harness is a project generator plus a driven host run

`apps/electron-host/scripts/` gains `generate-clip-project.mjs` (writes a
deterministic TProject — 2000 text/graphic elements distributed over overlay
tracks + main, no media pipeline, fixed seed, fixed 30 fps/canvas) through the
**real store classes** (`FilesystemProjectStore` over `NodeFsStoreBridge` —
the same classes the conformance evidence runs), and
`export-perf-baseline.mjs` (Playwright `_electron` boot against the generated
root, swiftshader launch args, CDP-driven interactions with timestamps,
playback fps via `requestAnimationFrame` counting in page, export job timing
via job events, memory via `process.memoryUsage()` in main +
`performance.memory`/heap in the renderer). Numbers land in
`evidence/perf-baseline-<date>.md` with method + shortfall-vs-S08 columns.
Deliberately **no gate**: the deliverable is the quantified shortfall.

### D8. The legal review is a cited research document, not a spec

`docs/export-legal-review-2026-08.md` (repo docs; conclusions each carry a
source): FFmpeg licensing families (LGPL vs GPL builds; which gyan.dev/BtbN
flavors are which; what bundling each forces), codec patent surfaces for the
FFmpeg path (H.264/HEVC/AAC) vs the mediabunny/WebCodecs path (browser-side
encoding shifts the patent posture), and third-party asset redistribution
(Google-Fonts atlas, stickers, audio). Sizing input for S08's distribution
decisions; deliberately no legal advice claim — it maps obligations with
citations.

## Goals / Non-Goals

**Goals:** the audit with named findings; the additive experimental surface
with reference implementation + reducer-level conformance; the desktop
FFmpeg adapter end-to-end with real evidence; progress/cancel/recovery each
proven with mutation-verified tests; the one-command 2000-clip baseline with
recorded numbers; the cited legal review; every checker green with census
movement recorded; PR to DumoeDss/rocut main, CI green, stop before merge.

**Non-Goals:** packaged-artifact verification and recovery hardening beyond
best-effort (Phase 5/6 dependency); any frozen-byte change; rewiring
classic's export UI (F6 stays a recorded finding for S08); wasm/ffmpeg.wasm
form; proxy export (Phase 7's later item); Elftia-side work; fixing the
pre-existing baseline reds (bun-version test failures, wasm api-surface
environment binding, electron surface-matrix pair — documented, owned
elsewhere).

## Risks / Trade-offs

- [Raw-file disk cost at 1080p+] → reference fixtures run 720p/short; jobs
  delete raw at finalize/discard; harness records disk usage per run; scratch
  roots on E: with cleanup in the scripts themselves.
- [IPC frame throughput bounds the render phase] → batches with ack
  backpressure (D3); measured, not assumed — the baseline's export-timing
  row is exactly this measurement.
- [Hidden window GPU variance] → swiftshader launch args proven by the parity
  seam; the export window uses the same; GPU-forced-none stays available.
- [Two-window store contention (same project, two sessions)] → the store
  bridge is already multi-session safe (session-keyed, migration-once); the
  export window opens read-only in practice (renders, never writes) and the
  job manager refuses to start when the project record's `updatedAt` moves
  mid-job (fail with a named reason rather than render a stale timeline).
- [`export-jobs` churn before S08 ratifies] → `experimental` class says so
  out loud; the reducer keeps semantics testable independent of shape churn.
- [FFmpeg licensing misunderstandings] → review is cited per conclusion; the
  adapter ships no binary and claims no legal advice.

## Migration Plan

All-additive; no existing consumer changes behavior. Rollback = revert the
branch. The `exports` map, `surface.json`, `boundary` census and the two
bridge surface tests move together in one commit with the census run recorded
beside them.

## Open Questions

- F6 (should classic's export UI route through the port?) — S08's call; this
  change records it, doesn't answer it.
- Whether S08 freezes `ExportJobProvider` as-is, revises it, or absorbs it
  into the frozen provider — the experimental label exists precisely to keep
  that door open.
- Output naming/location policy (project name vs timestamped ids) — the
  reference uses `<exportsRoot>/<projectName>-<jobId8>.mp4`; policy beyond
  the reference is S08's.
