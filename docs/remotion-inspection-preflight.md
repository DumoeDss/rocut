# Remotion discovery and metadata preflight

The authenticated Host supports `rocut programmatic inspect <spec.json>` with
`version: 1`, absolute `sourceDirectory`, declared `entryFile`/`files`, `seed`, and
optional `inputProps` and `frameRates` (composition ID to explicit rational rate).
Discovery runs the pinned native Remotion registration and `calculateMetadata`
inside a private, opaque-origin, no-network browser. Author modules never run in
the compiler Host. Returned compositions include resolved geometry, native FPS,
duration and props. Rust admits source manifests, geometry and props. Fractional
FPS without an explicit rational mapping is marked
`requires-explicit-frame-rate`; it is never rounded.

The receipt binds source descriptors, original input props, toolchain identity,
and returned metadata/props to a revision. The Host retains only one in-memory
snapshot. Discovery does not save project attachments or mutate the timeline.
New inspection, failure, cancellation or Host disposal invalidates old receipts.

`rocut programmatic compile-inspected <selection.json>` accepts only `revision`,
`compositionId`, and explicit `frameRate`. It uses the captured bytes, not the
author directory; checks the current toolchain identity; reruns native metadata
from that snapshot; rejects changed geometry or returned props; then prepares a
normal immutable source. Applying it still requires an editing transaction.
The receipt is consumed on compile, including failure.

## Remaining runtime identity gap

The response explicitly reports
`rechecked-before-compile; runtime-geometry-checked; runtime-props-not-pinned`.
The unchanged archived frame driver recalculates metadata at render time and
checks geometry/FPS, but does not compare returned props with this receipt.
Non-deterministic metadata may therefore change props after successful preflight.
This feature does **not** freeze `calculateMetadata` execution or claim full
Remotion ecosystem parity. Per-frame receipt/props pinning needs a separately
versioned runtime adapter identity; the existing frame-driver fingerprint is not
changed here.
