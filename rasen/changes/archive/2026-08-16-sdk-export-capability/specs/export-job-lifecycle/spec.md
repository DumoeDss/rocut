# export-job-lifecycle Specification

## ADDED Requirements

### Requirement: The export-job surface is additive, experimental, and leaves every frozen byte alone

The job lifecycle SHALL live in its own module exported as the
`@opencut/editor-ports/export-jobs` subpath. It SHALL be classified
`experimental` in `packages/editor-ports/surface.json` with an in-source
`@opencutSurface experimental — <reason>` marker in the entry file. The frozen
port files (`src/export-provider.ts`, `src/index.ts`, and the other four
byte-frozen surfaces named in BOUNDARIES §14) SHALL remain byte-identical to
base `661d7ac8`. The surface SHALL import no React, no DOM global, and no
`editor-classic` module (the `react-free-base` rule).

#### Scenario: The entry is classified and labeled at birth

WHEN `bun run check:surface-labels` runs THEN the census includes the
`./export-jobs` row as `experimental` with a non-empty reason, and the entry
file carries exactly one matching `@opencutSurface` marker.

#### Scenario: The frozen surfaces are untouched

WHEN the change's diff is compared against base `661d7ac8` THEN
`packages/editor-ports/src/export-provider.ts` and
`packages/editor-ports/src/index.ts` show zero byte changes.

#### Scenario: The package boundary stays green with live census movement

WHEN `bun run check:packages` runs THEN it passes with a file census strictly
greater than the recorded baseline (the new entry files are scanned), and the
new specifier resolves only through the declared `exports` subpath.

### Requirement: An export job is an addressable thing with phases

Starting an export SHALL return a job identity (`jobId`) before any rendering
work is awaited. Every job SHALL expose a snapshot carrying its request, a
phase from the fixed set `queued | rendering | encoding | completed | failed |
cancelled | interrupted`, a progress value in `[0, 1]`, and — when completed —
an opaque output descriptor with a byte size.

#### Scenario: Start returns an identity immediately

WHEN a job is started with a valid request THEN a `jobId` is returned and the
first snapshot names the `queued` or `rendering` phase with progress `0`.

#### Scenario: A completed job names its output without exposing a path

WHEN a job completes THEN the snapshot's output is an opaque descriptor plus a
byte count, and no filesystem path appears in any renderer-facing value.

### Requirement: Progress is reported per phase and is monotonic

The surface SHALL report progress within the live phases: during `rendering`
as accepted frames over total frames, during `encoding` as the encoder's own
time progress. A consumer SHALL be able to observe progress either by
subscription or by polling snapshots. Reported progress SHALL never decrease
within a run.

#### Scenario: Render progress tracks frames

WHEN N of T total frames have been accepted THEN a snapshot reports render
progress `N / T`.

#### Scenario: Encode progress tracks encoder time

WHEN the encoder reports `out_time` covering D of the total duration T THEN
the encode progress is `D / T`.

### Requirement: Cancellation stops work and cleans resources

Cancelling a job in a live phase SHALL stop accepting further work, terminate
any spawned encoder process, remove intermediate artifacts (raw frame data and
partial outputs), and settle the job in the `cancelled` phase. Cancellation
after completion or failure SHALL be a no-op that reports the settled state.

#### Scenario: Cancel during rendering terminates work and cleans up

WHEN a job is cancelled mid-`rendering` THEN no encoder process for the job
remains alive, no raw frame file or partial output remains, and the final
snapshot is `cancelled`.

#### Scenario: Cancel is idempotent

WHEN cancel is requested twice, or requested after completion THEN the second
request does not error and reports the settled phase.

### Requirement: Recovery is best-effort, durable, and frame-accurate where rendering allows

Job records SHALL persist such that a process death leaves the job
discoverable as `interrupted` with its persisted frame count. A resume SHALL
continue frame production from the persisted frame index (rendering is
random-access) into the same accumulated stream, so a resumed job's final
output has exactly the total frame count. A discard SHALL remove all of the
job's artifacts. Recovery is best-effort: a resume whose source project no
longer matches SHALL fail with a named reason rather than produce a corrupt
output.

#### Scenario: An interrupted job is discoverable after death

WHEN the owning process dies mid-`rendering` and is restarted THEN listing
jobs includes the job as `interrupted` with the persisted frame count.

#### Scenario: Resume produces the complete output

WHEN an interrupted job is resumed and completes THEN the output carries the
full total frame count and the same duration a non-interrupted run would
produce.

#### Scenario: Discard removes artifacts

WHEN an interrupted job is discarded THEN none of its raw, partial, or record
artifacts remain.

### Requirement: A conforming reference implementation and suite ship with the surface

The ports package SHALL ship an in-memory reference implementation of the
export-job surface suitable for tests and headless composition, and a
conformance suite covering identity, phases, progress, cancellation, and
recovery semantics. Every semantic's test SHALL have a mutation verification
recorded in evidence (reverting the semantic's implementation turns the test
red).

#### Scenario: The reference implementation passes the suite

WHEN the conformance suite runs against the in-memory reference
implementation THEN every case passes.

#### Scenario: Each semantic is mutation-verified

WHEN any single semantic's implementation is reverted (progress, cancellation,
recovery) THEN the corresponding test fails.
