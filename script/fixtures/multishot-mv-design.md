# Multishot integration fixture visual contract

This is a deterministic six-second diagnostic MV, not a finished creative work.
The task explicitly requires controlled markers, native lyrics and wrong-order
counterexamples; those requirements take precedence over general promo styling.

## Palette and type

- Three opaque scene fields: midnight `#18204c`, forest `#1c5a36`, wine `#6a2632`.
- Remotion frame marker: jade `#3cd691`; foreground occluder: coral `#e94560`.
- Native lyrics: white IBM Plex Mono Medium, loaded from Rocut's licensed asset.
- The excluded recipe background is magenta, an intentional role-leak sentinel.

## Motion and framing

160×90, 25 fps, 150 frames. Three two-second shots use ten-frame incoming-over-
opaque-outgoing crossfades at frames 40–50 and 90–100. Each shot has its own
bottom-rule entrance. A transparent Remotion marker advances two pixels per
frame and resets with each shot. Native JIZURA cues are SYNC / BEAT / GLOW at
0 / 2 / 4 seconds. A narrow foreground sprite crosses the lyric center while
preserving visible glyphs outside it.

## Do not

- Do not bake or hand-paint lyrics, mock native frame contexts or use fallback fonts.
- Do not fetch fonts, media, scripts or dependencies from the network.
- Do not replace full-frame export with sampled frames or performance claims.
- Do not apply generic large-format typography rules to this diagnostic resolution.
- Do not treat this fixture as installed-Electron or a user's full-song acceptance.

## Reproduction and evidence

Use process-local TEMP/TMP on a task-owned volume, an already installed pinned
engine toolchain, and explicit `ROCUT_TEST_WASM_DIRECTORY`, `ROCUT_TEST_FFMPEG`,
`ROCUT_TEST_FFPROBE`. No script installs dependencies or connects to shared Elftia.

```text
node script/probe-multishot-mv.mjs <private-engine-toolchain>
node script/probe-multishot-mv.mjs <private-engine-toolchain> --prepare-only
node script/probe-multishot-mv.mjs <private-engine-toolchain> --trace-audio
node script/probe-multishot-mv.mjs <private-engine-toolchain> --trace-audio-inner
node script/probe-multishot-mv.mjs <private-engine-toolchain> --overall-timeout-ms=1800000
```

The prepare-only mode compiles, relocates and rebuilds both sources, and builds
the isolated browser probe; it is not an export acceptance. Full mode exports
all 150 frames, retains original source WAVs, independently derived expected PCM,
actual mixed PCM, native glyph reference PNGs, an intentionally wrong-layer PNG,
the WebM, independent FFmpeg output, timestamps and verification measurements.
The fixture enforces a 200 MiB retained-artifact limit per run; coordinate repeated
runs within the session's overall artifact and shared-resource budget as well.

The overall browser observation budget defaults to `900000` milliseconds. An
explicit `--overall-timeout-ms=1800000` (or `--overall-timeout-ms 1800000`) permits
a thirty-minute observation window. Only integer values from `60000` through
`3600000` are accepted; missing, duplicate, malformed or out-of-range values fail
before an artifact directory is created. This option changes only the probe's
`page.waitForFunction` ceiling, not the production fifteen-second per-frame
watchdog, audio preparation budgets, PCM/pixel checks or negative controls.
`prepared.json`, `run-status.json` and a successful verification summary record
the actual budget. The run status also retains elapsed time, the last browser
milestone, client/WASM identity and any terminal failure. Extending the ceiling
does not turn an earlier timeout into a pass: preserve that run's evidence and
require a newly completed 150-frame output with independent verification.

The optional audio trace records the real native collector's frame index and CDP
method start/end/error timings to the invocation's `audio-trace.jsonl`. It delegates
every call to the original collector/browser, without changing timeouts, ordering,
results, or the independent acceptance gates. Expressions and media are never
logged; arbitrary error/abort messages are represented only by a SHA-256 hash.
Transparency tests cover original return/error identity, protocol ordering,
redaction, and failed logging. This is diagnostic instrumentation, not a substitute
for completing the export.

The inner variant additionally observes named generated-bootstrap stages, using
shape-checked instrumentation. It supports both the historical double-RAF audio
settlement and the corrected immediate settlement; the latter records
`outer-resolved`, never fictitious RAF events. Authored HTML stays byte-identical,
and transparency checks retain original awaits, RAF counts, return identity and
rejection behavior. Arbitrary source text is not written to the trace.

For an explicitly approved frozen client, `--reuse-web-from=<absolute-artifact>`
uses its existing `web` directory read-only, after checking the genuine WASM and
hashing every asset. The new host/store and caches remain in the new invocation's
TEMP directory. `prepared.json` records the complete reused manifest. This proves
artifact identity, not freshness against subsequently edited client sources:
reassess input changes before reuse, and do not claim coverage of code written
after the reused build or the running host's module load.

Retained output can be checked without another browser run:

```text
node script/fixtures/multishot-mv-verify.mjs <retained-artifact-directory>
```

For an audio-preparation failure, the dedicated diagnostic reads the existing
source/archive and project store, then calls the actual native analyzer with its
unchanged 15-second per-frame watchdog. Default mode checks 14 boundary frames;
`--all` observes every frame in order and records the failing index and elapsed
times. Neither mode constitutes editor export or performance acceptance.

```text
bun --preload ./script/fixtures/isolated-web-wasm-preload.mjs script/fixtures/multishot-mv-audio-diagnostic.ts <retained-artifact-directory> --all
bun --preload ./script/fixtures/isolated-web-wasm-preload.mjs script/fixtures/multishot-mv-audio-diagnostic.ts <retained-artifact-directory> --frames=79,80,81,80,79
```

Selected-frame diagnostics retain unique reports and full-observation SHA-256
values, allowing forward/reverse and instrumented/baseline equivalence checks.

## Completed integration acceptance

On 2026-10-08, fresh-client run `rocut-multishot-mv-RmIJrr` completed all 150
frames and passed independent FFmpeg decoding, per-frame pixels/timestamps,
stereo audio alignment, exact full/partial PCM, wrong-layer rejection and the
one-frame visual/audio offset controls. Retained-file re-verification passed
without another browser; the contact sheet was also inspected. The WebM is
204,894 bytes, SHA-256
`d0a37517781551f99eeef06d9afd5c8cebd25c9ca6eeefb33ae96188d77adca0`.

The run used the isolated `a26908cee5c00d37d61f115b1c68560c96589d986e7620ab3ba4ab3de8ca9cde`
WASM and the explicit `1800000` ms observation budget. Its recorded elapsed
time was `953025` ms, so this pass is not a performance claim. The original
900-second failure remains retained and failed; no production watchdog or
acceptance gate was relaxed. This run does not cover later image-sequence
changes, installed Electron, or a user's full-song MV.

See [the acceptance record](./multishot-mv-acceptance-20261008.md) for exact
source/client identities, measurements, evidence paths and recovery receipt.
