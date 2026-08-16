# export-performance-baseline Specification

## ADDED Requirements

### Requirement: The harness is one repeatable command over a deterministic clip-heavy project

The performance baseline SHALL be produced by a single documented command
that (a) generates a deterministic clip-heavy project — 2000 clips by default
— without any media-asset pipeline (text/graphic elements only), (b) writes
it into a fresh throwaway store root through the real store classes, (c) boots
the Electron host against that root, and (d) records the metric table. Re runs
SHALL start from fresh state; nothing the harness measures SHALL depend on a
previous run's artifacts.

#### Scenario: One command, fresh state, repeatable

WHEN the harness command runs twice THEN both runs complete, each against a
freshly created store root, and each writes a complete metric table artifact.

#### Scenario: The clip population is stated, not hand-waved

WHEN the harness generates its project THEN the method (element kinds, per-
element duration and distribution, track layout, total timeline duration,
canvas size, fps) is recorded in the artifact and the generation is
deterministic for a fixed clip count.

### Requirement: The baseline records the four metric families with a stated measurement method

The harness SHALL record, for the clip-heavy project: interaction latency
(noted interactions measured as event-to-effect wall time in the renderer),
playback frame rate (observed frames over wall time during timeline
playback), export wall time (the export job's render phase and encode phase
separately), and memory (renderer heap and main-process RSS sampled at
defined points). Every number SHALL carry its measurement point and method.

#### Scenario: The table is complete and attributed

WHEN the baseline artifact is committed THEN every metric family has at least
one measured number with its method, and no cell is a placeholder or an
estimate.

#### Scenario: Export time is split by phase

WHEN the export wall time is recorded THEN the render phase and the encode
phase are reported separately with the frame count and output size beside
them.

### Requirement: The deliverable is the measurement, not a gate pass

The baseline artifact SHALL state, against each metric family, where the
measured number stands relative to the S08 acceptance expectation, including
"how far off" where it falls short. The harness SHALL make no passing or
failing claim about the 2000-clip gate — that verdict is S08's.

#### Scenario: Shortfalls are quantified

WHEN a measured number falls short of the S08 expectation THEN the artifact
states the shortfall explicitly rather than omitting the metric.
