# sdk-desktop-export-adapter Specification

## ADDED Requirements

### Requirement: The adapter composes behind the frozen exporter role of the desktop Host

The Electron host's composition root SHALL final-override the inherited
reference `exporter` role with an adapter that implements the frozen
`ExportProvider` by bridging to the experimental export-job surface:
`canExport` SHALL be truthful about the adapter's real preconditions (a
discoverable FFmpeg binary and a loadable project), and `export()` SHALL
return the frozen outcome shapes — `completed` with the output's bytes, or
`unsupported` / `failed` with reasons. The override SHALL follow the host's
existing owned-roles pattern (design E3 of `sdk-desktop-reference-host`).

#### Scenario: The role is a final override beside the store override

WHEN the host composition is constructed THEN the composed `exporter` is the
adapter instance, not the in-memory `UnsupportedExportProvider`, and the
store/graphics/reference roles are unchanged.

#### Scenario: No binary means unsupported, not failure

WHEN no FFmpeg binary can be discovered THEN `canExport` returns false and
`export()` settles `unsupported` with a reason naming the missing binary.

### Requirement: A real FFmpeg invocation produces a real playable deliverable

The adapter SHALL produce exports by invoking a discovered FFmpeg binary in
the main process over a raw frame stream plus the timeline's extracted audio,
producing a container with both a video and an audio track. The reference
invocation, its logs, and the output's fingerprint (size, duration, tracks)
SHALL be recorded as end-to-end evidence in the change's `evidence/`
directory. The output SHALL be verified playable with duration and track
layout matching the project.

#### Scenario: End-to-end export with video and audio

WHEN the reference export runs against a project with visual and audio
content THEN the produced file contains one video track and one audio track,
its duration matches the project's timeline duration, and the evidence
records the command, the log, and the fingerprint.

#### Scenario: The encoder runs in the main process

WHEN an export encodes THEN the FFmpeg process is a child of the Electron
main process, and the renderer performs no encoding.

### Requirement: Frame production lives in a hidden export-renderer window

The host SHALL ship a second built entry page that boots an editor session
headlessly over the same IPC store bridge and renders frames through the
editor's own renderer path (CanvasRenderer over the wasm compositor). The
export-renderer window SHALL be hidden and SHALL receive its assignment
(project id, job id) from the main process, never from a filesystem path.
Frames SHALL be transported to the main process over the preload bridge with
acknowledged flow control, and the main process SHALL accumulate them as the
job's raw stream.

#### Scenario: The hidden window renders from the same store

WHEN an export job starts THEN the hidden window loads the project through
the same `opencutStore` bridge the interactive window uses and renders frames
at the project's fps and canvas size.

#### Scenario: Frames flow with backpressure

WHEN the renderer produces frames faster than the main process accepts THEN
the bridge's acknowledgement discipline throttles production rather than
buffering unboundedly.

### Requirement: The renderer holds no filesystem capability and the CSP does not relax

The export path SHALL cross the process boundary only through the preload
bridge with identifier- and value-shaped messages. No renderer-facing value
SHALL contain an absolute filesystem path. The committed CSP SHALL gain no
directive for the export path.

#### Scenario: Bridge surface parity is guarded

WHEN the preload's export operation list and the main process's export IPC
operation list drift THEN a surface test fails (the store bridge's own
guard pattern).

#### Scenario: No CSP change

WHEN the export path is exercised THEN the committed CSP string is
byte-identical to the pre-change policy.

### Requirement: Job control is host-owned and survives restart

The interactive window SHALL expose host-owned export job control (start with
format/quality, observe progress, cancel) that addresses jobs by identity
only. After an app restart, previously interrupted jobs SHALL be listable and
resumable from the job-control surface.

#### Scenario: Job control drives a real export

WHEN a user starts an export from the interactive window THEN progress is
observed from both the render and encode phases and completion reports the
output's opaque descriptor and size.

#### Scenario: Interrupted jobs resume after restart

WHEN the app is killed mid-render and restarted THEN the job control lists
the interrupted job and a resume completes the original export.
