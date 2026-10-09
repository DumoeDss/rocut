# Multishot MV integration acceptance: 2026-10-08

## Result and scope

Passed one complete six-second, 160 by 90, 25 fps export: all 150 output frames
were independently decoded and checked. This is a synthetic integration fixture,
not an installed-Elftia/Electron acceptance, full-song creative MV, or performance
acceptance. It does not cover image-sequence work added after this run started.

The fixture combines genuine archived HyperFrames and Remotion sources, native
Rust/JIZURA lyrics, a native MV recipe foreground, native HyperFrames audio and
ordinary WAV audio through Rocut's real project codec, FileProjectStore and
SceneExporter. The original author directories are relocated before archive-only
rebuild. A fresh store instance reloads the saved project; native pixels remain
exactly equal. This was a fresh client build, not reuse of an earlier bundle.

## Reproduction identity

```text
node script/probe-multishot-mv.mjs C:/Users/Sayo/AppData/Local/Temp/rocut-media-toolchain-YbloF9 --trace-audio-inner --overall-timeout-ms=1800000
```

Process-local TEMP, TMP and TMPDIR were under the private C-volume artifact root.
The private WASM directory was
`C:/Users/Sayo/AppData/Local/Temp/rocut-light-leak-build-50fa90bf/web`.
The native preload and fresh browser build both consumed that initialized web
artifact. The sibling bundler WASM had identical bytes; no shared copy changed.

| Identity               | SHA-256                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| WASM                   | `a26908cee5c00d37d61f115b1c68560c96589d986e7620ab3ba4ab3de8ca9cde` |
| Browser JS             | `538f49dcd50815a61ae4bbde07d9aa37bf888af0f8422f914e523386cce7fedf` |
| Browser asset manifest | `4ae2874d2030d2bda1d10a7d7d6908f00289841016bbec0da3d0d8511aa184c9` |
| Output WebM            | `d0a37517781551f99eeef06d9afd5c8cebd25c9ca6eeefb33ae96188d77adca0` |

The terminal run was `rocut-multishot-mv-RmIJrr`, retained beneath
`C:/Users/Sayo/AppData/Local/Temp/rocut-multishot-20261008-7ca2b1-c`.
Its evidence includes `prepared.json`, `run-status.json`, `verification.json`,
`reverification.json`, `ffprobe.json`, `audio-trace.jsonl`, source archives,
source WAVs, expected/mixed/decoded PCM, native reference PNGs, the wrong-order
PNG, `contact-sheet.png`, and `multishot-mv.webm`.

## Verified gates

- Complete WebM: 204,894 bytes, 150 decoded frames, every timestamp exactly
  `frameIndex / 25`, 160 by 90, 25 fps.
- All-frame background/crossfade, Remotion marker clock, and native lyric
  foreground-occlusion checks passed. The contact sheet was also inspected.
- Genuine wrong-layer render rejected; a one-frame marker offset rejected on
  all 150 frames. Recipe background-role leakage remained excluded.
- Native audio: 150 consecutive observations with the unchanged production
  fifteen-second per-frame watchdog; zero trace errors, 150 immediate-settlement
  stages, zero outer-RAF stages. Observations took approximately 1059 to 1804 ms.
- Full mixed PCM: 48 kHz, stereo, 288,000 samples, maximum arithmetic error
  `2.3283064365386963e-10`; partial export slice error exactly zero. The source
  collector was requested once across full/partial preparation.
- Independent Opus decode: 288,648 samples, including 648 codec-padding samples
  within the permitted 960; neither source nor trailing content was truncated.
- Both decoded channels: best alignment lag zero samples; zero-lag correlation
  `0.9999238359776697` and `0.9999221314433994`; maximum section RMS error below
  `0.000635`. Quiet boundaries and one-frame audio-offset controls passed.
- Host counts: 156 HyperFrames and 156 Remotion frame requests (six preliminary
  snapshots plus 150 export requests), one audio request, one save, one reload,
  two font loads, two ordinary-audio loads.
- Re-verification using only retained files and FFmpeg passed without reopening
  any browser or rebuilding the client.

## Timing, evidence retention and limits

The run's recorded elapsed time was 953,025 ms (about 15 minutes 53 seconds), with
an explicit 1,800,000 ms overall observation budget. Only that harness ceiling
changed; the production watchdog, PCM/pixel assertions and negative controls
were not relaxed. This is not evidence of a performance improvement.

The earlier 900,000 ms timeout run, `rocut-multishot-mv-1mQ5Yd`, remains intact
and remains a failure. Its source/client identities differ from this fresh run;
the new pass does not retrospectively change its outcome or prove the historical
frame-80 stall was caused by RAF settlement.

Only the explicitly approved, terminal `rocut-multishot-mv-tbZSm9/web` generated
client was newly archived: all three ZIP entries were verified by size/SHA-256,
then sources were rechecked and removed individually. Its 13,220,717-byte
recovery ZIP and per-file receipt are retained in the private root; ZIP SHA-256:
`79db1805d55b7ed4b59c62150f1fc6adf31272f328025714522abf674652de6c`.
No other artifact tree, media or log was removed by this archival operation.

After browser cleanup and standalone re-verification, this run occupied
35,875,678 bytes; all session artifacts across its E/C roots occupied
176,903,290 bytes, below the 200 MiB limit. All run processes exited normally.
No installed plugins, shared Elftia session, dependency installation or shared
WASM copy was modified. No Git write operation was performed.
