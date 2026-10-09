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

## Versioned runtime metadata pinning

The inspected path now uses `rocut-remotion-html` adapter version **2** and reports
`rechecked-before-compile; runtime-geometry-and-props-pinned-v1`. Its immutable
receipt binds the original input props, inspection revision, composition,
toolchain lock, rational frame rate, geometry, duration and complete returned
props. Each new frame or audio realm still runs native `calculateMetadata`, then
rejects a result that disagrees with that receipt. Returned props are compared as
strict JSON: object key order is irrelevant, while array order remains material.
They are never fed back as the next invocation's original input props.

Ordinary `programmatic/build/compile` intentionally retains the legacy version-1
adapter and does **not** gain this guarantee. Existing archives are not silently
upgraded. Rebuild preserves an archive's profile; revising an inspected source
requires fresh inspection. A version-2 source with a missing or invalid receipt
fails closed instead of falling back to the legacy path. Metadata execution has
a bounded lifetime and observes cancellation; late settlement cannot publish a
successful source after disposal.

## Verified checkpoints and remaining coverage

The [native regression checkpoint](evidence/remotion-pinned-regression.json)
records 11 successful private-Chromium checks. The main positive visual and
native-video samples use real Host `inspect` then `compile-inspected`, including
GPU preview/export and independently decoded short WebM clips. Intentionally
invalid explicit-geometry cases and the additional attachment-video resource
sample still use legacy compilation; this is not a claim that every branch of
the probe is pinned.

The separate [pinned audio checkpoint](evidence/remotion-pinned-audio.json)
exercises real version-2 compilation, native observations, FFmpeg decoding and
Rocut/Rust PCM mixing, including nonsequential seek, gain, silence windows and
audio-realm metadata drift rejection. It does not establish sample-exact phase
identity or a decoded final master A/V container.

Neither checkpoint establishes installed Electron acceptance, a whole MV,
arbitrary ecosystem dependencies or all author prop/media combinations. The
earlier [preflight evidence](evidence/remotion-inspection-preflight.json) remains
a historical version-1 checkpoint; its then-unpinned runtime limitation is not
the current version-2 contract.
