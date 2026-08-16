# sdk-export-capability — S08 pre-work: export adapter, job lifecycle, perf baseline, legal review

> Third item of the mainline-side parallel queue (roadmap "Ledger unification",
> ruled 2026-08-16). Delivers the S08 capability subset whose dependencies are
> already satisfied — everything that does NOT need Phase 5/6 packaging. Merge
> order: `fix/wasm-determinism` → `feat/sdk-ecosystem-enablement` → this.

## What lands

1. **Gap audit → additive experimental surface.** The frozen `ExportProvider`
   is declared-thin by design ("S08 owns production export" — its own header);
   the audit (design.md Part 1, findings F1–F7) shows it cannot carry job
   identity, progress, cancellation, recovery or an output destination, and
   that nothing in classic's UI consumes the port at all (F6). Resolution per
   the ruled path: **`@opencut/editor-ports/export-jobs`** — a new
   `experimental`-classified entry (surface.json census 35→36; experimental
   6→7) with `ExportJobStore` (the pure state-machine SSOT),
   `InMemoryExportJobProvider`, and the `ExportJobProvider` port shape. The
   five frozen port files stay **byte-identical to 661d7ac8** (guarded,
   re-asserted at close-out).
2. **FFmpeg reference adapter in the Electron desktop host (main-process
   binary form — ruled preference while the wasm branch is unmerged).**
   Main-process `ExportJobManager` (durable job records, append-only rgb24 raw
   stream, single FFmpeg invocation at finalize with `-progress` parsing,
   discovery env→config→PATH, binary never bundled — the legal review's
   Audacity-precedent posture). A hidden `export-renderer` window boots the
   editor session headlessly over the same `opencutStore` IPC bridge and
   streams frames through the same CanvasRenderer/wasm-compositor path the
   preview uses. `exporter` becomes a final override in the composition root
   (design E3 pattern) with a documented frozen-outcome mapping table.
3. **Job lifecycle, proven.** Unit level (real FFmpeg + ffprobe, mutation-
   verified red/green for cancel-cleanup and resume-accounting): progress
   per phase, cancel terminates the encoder + cleans raw/wav/partial,
   interrupt across manager instances resumes frame-accurately (ffprobe
   `[58,62]` frames on a 60-frame job), raw-stream reconciliation (surplus
   truncated / short refused by name) — the close-out of review B-1/M-1.
   Real-app level: D1 end-to-end (below) + D2 fast legs (cancel through the
   panel; kill-the-app → relaunch → interrupted discovered in the panel →
   resume continues from the persisted frame count).
4. **2000-clip performance baseline — the measurement, not a gate.** One
   repeatable command (`export-perf-baseline.mjs`) over a deterministic
   generator-written project (real store classes). Numbers in
   `evidence/perf-baseline-20260816.md`, incl. cold open, interaction
   latencies, playback fps, export phase split, memory, real-GPU vs
   swiftshader per-frame cost. Headline: **dense-2000 (every frame composites
   all 2000 elements) crashes the wasm preview compositor on swiftshader**
   (`unreachable` + `parking_lot` panic + GPU process exit 34 — signatures
   verbatim in the artifact); export render throughput measured at
   5s/frame@2000-elements (pre-freeze) vs 18.9s/frame@800 (loaded box) vs the
   real-GPU number; staggered (sparse long-timeline) shape recorded as the S08
   follow-up.
5. **Legal review with citations** (`docs/export-legal-review-2026-08.md`,
   36 sources): FFmpeg GPL/LGPL build families and what bundling each forces;
   the discover-only design matches the Audacity patent-restriction precedent;
   codec patent surfaces (AVC/AAC/HEVC pools, VP9 Sisvel dispute, Opus clean)
   for BOTH the FFmpeg and mediabunny/WebCodecs paths; OFL fonts rendered into
   video = use not redistribution; **new repo finding: the freesound
   `commercial_only` allowlist admits NC-licensed sounds** (S08 decision 4).

## Acceptance evidence (all under `rasen/changes/sdk-export-capability/evidence/`)

- **D1 real end-to-end export**: image+audio project → panel export →
  `ffprobe`: 1×h264 + 1×aac, duration exact (5s), both streams decodable,
  transients cleaned, producer window closed. Render 3.83s / encode 4.96s.
- Negative leg: no discoverable binary → `unsupported` naming ffmpeg.
- Frozen bytes: `git diff 661d7ac8` empty over the five frozen surfaces.
- Checkers: `check:packages` (1146 files, +8 over base), `check:surface-labels`
  (36 entries), `check-wasm-source/paths`, C6 session boundary — green with
  census movement recorded. Baseline reds unchanged (`check-wasm-api-surface`
  environment-bound; 6 deterministic `bun test` failures pre-existing —
  cross-proven on the eco worktree; wrapper-timeout family machine-bound).
- Parity: editing scenario green on vite + electron; snapshot diff within the
  documented idempotency/one-frame classes.

## Findings for S08 (direction-level, recorded not fixed here)

1. **F6** — classic's export UI bypasses the port entirely; S08 decides
   whether the donor button re-routes through `exporter`.
2. **dense-2000 wasm compositor crash** on swiftshader (signatures above);
   the 2000-clip gate needs the hardware-GPU leg and/or a density ceiling.
3. **loadProject thumbnail-save race — FIXED IN THIS PR (final shape:
   render-input projection digest).** The panel becomes interactive before
   the post-open thumbnail save, and the thumbnail lands INSIDE
   `data.metadata.thumbnail` — so both an `updatedAt` guard AND a
   whole-`data` content digest deterministically broke the recovery path
   (`project-updated-mid-job` on every resume). The guard now compares a
   sha256 over the **render-input projection** (`scenes`, `currentSceneId`,
   `settings`, `version` — `projectTimelineDigest`, one recipe shared by
   main.cjs and the producer window): thumbnail churn is immune, timeline
   edits still fail by name. Proofs: kill-mid-render → relaunch → panel
   lists interrupted → Resume → completed (three green real-app runs; ffprobe
   242/242 frames, 8.096s vs 8.067s, 1280×720 h264+audio, byte-exact raw
   accounting). One observed intermittent (a resume's first batch started at
   frame 0 once, not reproducible, candidate race documented) is recorded in
   the D2 close-out with a hardening note for S08.
4. **freesound NC leak** in `commercial_only` (legal review §4.4).
5. Render throughput is swiftshader-dominated (see baseline); the export
   render path needs the hardware-GPU posture S08 will set.

## Non-goals (unchanged)

Packaged-artifact verification and recovery hardening beyond best-effort
(Phase 5/6 dependency); any frozen-surface revision (the experimental entry
is the sanctioned additive path); wasm build-chain files; classic UI rewiring.
