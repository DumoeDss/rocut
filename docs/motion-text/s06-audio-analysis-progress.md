# S06 audio analysis and lyric timing progress

Date: 2026-09-27

Status: complete. Audio binding, analysis, manual beat overrides, lifecycle cleanup, direct cue/cut timing, manual tapping with optional beat snapping, cue-loop preview, range export, single-audio-stream export, and previewed lyric re-synchronization are implemented. G6 is closed.

## Implemented ownership boundaries

- `rust/crates/motion-text/src/audio.rs` owns platform-independent PCM analysis, fixed-tempo estimation, energy envelopes, exact beat-grid generation, beat snapping, clip/source geometry, and binding synchronization assessment.
- `rust/crates/motion-text/src/factory.rs` owns validated audio-binding, audio-timing synchronization, manual beat-override, cue-tap, and stable cut-boundary mutations. Each mutation rebuilds the resolved plan and advances the sequence revision exactly once.
- `rust/crates/time/src/media_time.rs` owns the strict half-open timeline-range contract `[startTime, endTime)` and its stable validation reasons. TypeScript calls that contract through the canonical WASM seam instead of duplicating boundary rules.
- React only selects a timeline clip, starts/cancels analysis, publishes a revision-bound render candidate, presents the Rust result, and submits the accepted sequence once through `editor.project.updateMotionTextSequence`.
- The existing rocut audio element remains the only playback/export source. Analysis never creates a JIZURA player, track, or mixer input.

## Data and timing semantics

- Analysis cache identity is `(project id, asset id, SHA-256 content digest, analysis version)`.
- `audioBinding.sourceOffset` maps sequence time zero to audio-source time and is derived from the visible motion-text/audio clip geometry in Rust.
- `audioBinding.analysis.firstBeat` is an audio-source position. The Rust beat-grid resolver applies `sourceOffset` and returns the detected phase in sequence-local time.
- `audioBinding.beatOverride.firstBeat` is explicitly sequence-local. `beatOverride` is additive and separate from detected `analysis` values, so persisted data and UI can report whether BPM/phase came from detection or manual input.
- Re-analysis/rebinding preserves `beatOverride` and opaque future fields under `audioBinding`; clearing the binding intentionally removes the complete binding object.
- `sync-audio-timing` updates binding metadata and cue timing atomically. A changed clip geometry uses `oldSourceOffset - newSourceOffset`; with unchanged geometry, detected first-beat movement can shift derived timing, while a manual first-beat override suppresses that automatic phase shift.
- Only `lrc` and `estimated` cues without locks can move. Each contiguous movable run uses one delta clamped between neighboring protected cues and the sequence bounds. `manual`, `tap`, unknown/legacy provenance, any locked cue, durations, `cutDurations`, and timing provenance remain unchanged.
- Retimed audio clips are disabled in the first UI version because the binding schema does not yet carry playback rate.
- Cue timing provenance persists as `lrc`, `estimated`, `manual`, or `tap`. Ordinary cue edits only switch to `manual` when their timing actually changes.
- Optional `cue.cutDurations` is the persisted source for custom internal cut boundaries. It contains one positive duration per resolved cut and must exactly partition the cue; `resolvedPlan` remains derived. Boundary mutations address a stable cut ID and atomically resize that cut and its following neighbor without changing the cue range.
- An omitted export range means the complete timeline. A supplied range is validated against the current project duration, retains absolute project-timeline bounds, and uses an exclusive end.
- The selected export range is session state, not project data. Project switch, close, or deletion clears it, so there is no second persisted timeline truth.
- Range export still builds the complete scene. Video samples at `range.startTime + outputFrameOffset`, while the output timeline begins at zero. Audio mixing intersects clips against the same absolute range and preserves relative silence for clips that enter after the range start.

## UI and lifecycle behavior

- The motion-text properties panel lists upload audio clips from the current scene.
- Rust rejects clips that do not cover the visible motion-text clip or whose source cannot cover the full sequence alignment.
- Analysis decodes through session resources, stores no PCM in the project, and displays a bounded downsampled energy preview.
- Cancel, media removal, project clear/switch, and session disposal invalidate the generation, abort pending work, and wait for decoding/AudioContext cleanup.
- Synchronization status distinguishes synchronized, unchecked, missing asset, missing clip, asset changed, content changed, and timing changed. Content replacement is only claimed after the current file digest has been checked.
- Existing bindings expose `Preview re-sync` instead of committing after analysis. The candidate reports moved and protected cue counts plus the old/new source offsets, renders on the real canvas, and leaves the project untouched until `Apply sync`.
- `Cancel preview`, unmount, sequence switch, or audio-clip selection change clears only the candidate owned by this editor. Apply rejects stale base revisions and candidates replaced by another canvas preview. A true no-op reports `Audio timing is already synchronized` instead of surfacing an error.
- Manual BPM and sequence-local first beat are a separate one-revision transaction and support normal project undo/redo.
- Manual tapping can start from the selected stable cue ID, records the current sequence-local playhead, optionally snaps within 150 ms of the resolved beat grid, supports undo-last-tap before commit, and applies all recorded taps as one project transaction. Rust rejects non-increasing/out-of-bounds taps, locks, and overlap with adjacent untouched cues.
- The existing cue editor can optionally snap only the start/end boundaries the user changed within 150 ms. Rust/WASM remains the sole beat-grid and snap implementation; the resulting cue mutation still passes through Rust overlap, range, and lock validation as one project transaction.
- The cut timing editor exposes internal boundaries for multi-cut cues. It can use the same Rust/WASM 150 ms snap threshold, rejects final/locked/invalid boundaries in Rust, and commits the complete duration partition in one revision.
- The selected cue exposes `Loop selected cue` and `Use cue as export range` actions only when the cue intersects the visible trimmed/split clip. Bounds are obtained from the existing Rust sequence-to-timeline mapping, then clipped to the element's half-open visible range.
- Loop playback seeks to the cue start when entered from outside, wraps at the exclusive end, and publishes the wrap seek so the existing audio scheduler restarts from the same timeline tick. Invalid ranges are cleared automatically if the timeline becomes shorter.
- The export popover reports either the active absolute range or `Full timeline`, passes the range through web, CLI, Electron IPC, hidden-renderer, and job-manager boundaries, and can restore full-timeline export without altering the project.

## Verification evidence

Passed:

- `cargo test -p motion-text`: 53/53, including geometry offset shifts, detected phase shifts, manual first-beat suppression, per-run protected-boundary clamping, manual/tap/lock preservation, binding updates, one-revision replanning, and fail-closed behavior without a binding.
- `cargo test -p time`: 11/11, including strict half-open range validation.
- `cargo check -p opencut-wasm --target wasm32-unknown-unknown`.
- focused Bun contract/WASM tests: 40/40, including click-track detection, silence, source-offset phase mapping, eight-minute no-drift grid, snap threshold, clip coverage, sync-state classification, binding mutation, beat override, cue tapping, custom cut partitions, stable cut-boundary mutation, timing provenance, and contract validation.
- focused range tests: 4 WASM seam cases, 5 isolated playback-manager scenarios, and 3 audio-intersection scenarios. CLI parsing, editor-port export jobs, and Electron provider propagation also pass their focused suites.
- motion-text analysis-cache tests cover same-file reuse, project isolation, same-ID content replacement, cancellation cleanup, and disposal rejection.
- relevant Prettier/ESLint checks and CLI, Vite example, and Electron host TypeScript checks.
- Electron export job-manager and bridge suites: 15/15, including a real 60-frame gradient plus WAV FFmpeg encode with one video and one audio stream.
- `node script/check-wasm-api-surface.mjs`: 57 JS exports, 74 stable WASM exports plus three compiler trampolines, 612 imports, and 79 declaration lines.
- `bun test packages/editor-classic/src/wasm/__tests__/motion-text-factory.test.ts`: 13/13 canonical factory seam tests, including atomic `sync-audio-timing` behavior.
- `node script/probe-motion-text-ui.mjs`: a generated 30-second 120 BPM WAV was imported as one rocut audio clip; analysis binding reached revision 3 and manual 128 BPM / 0.25-second phase reached revision 4. A three-cut cue boundary entered as 1.64 seconds snapped to exact 1.65625 seconds at revision 5, persisting `[51477, 46705, 49091]` ticks. A direct cue edit then snapped 4.92 seconds / 1.10 seconds to exact 4.9375 seconds / 0.9375 seconds at revision 6. Tapping resumed at cue 11 with beat snap enabled, exercised undo-last-tap, then committed revision 7 with both cues marked `tap`. Moving the motion-text clip produced `Audio clip timing changed`; `Preview re-sync` changed the 12-second canvas frame, and `Cancel preview` restored that frame byte-for-byte. Re-preview plus `Apply sync` committed revision 8, undo returned to revision 7, redo returned to revision 8, the manual cue remained at 592500/112500 ticks, and cues 11/12 remained `tap`. Every timing transaction and the synchronized binding survived durable reopen.
- The same browser probe moved, trimmed, split, and reloaded the motion-text clip, selected a cue with a visible range, played for longer than one cue duration, and proved the playhead remained inside the cue after wrapping. It then exported only that range. The latest 28,661-byte MP4 duration was 0.580499 seconds for an expected 0.566667-second range, `ffprobe` observed exactly one audio stream, and the range-relative preview/export frame comparison passed with RGB MAE 5.6112/255.

Canonical WASM after this slice:

- `opencut_wasm_bg.wasm`: 5,078,137 bytes.
- SHA-256: `17e3778769aefb2cf945304914f93e30ede6bf9d918e95b0661d02c6c16f56cd`.

The root and `apps/web` installed WASM copies were not modified. Full `check:wasm` remains blocked until the normal dependency installation path is explicitly authorized.

## Non-blocking follow-up

- Move CPU analysis to a session-owned Worker if cancellation must interrupt already-running synchronous WASM rather than only preventing stale commit and releasing resources afterward.
