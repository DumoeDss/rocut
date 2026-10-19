# Browser waveform resources

`WaveformCache` owns session generation fences and shares derived source summaries between card and timeline consumers. It does not persist project metadata. Source-time, retime, gain and clip mapping remain in the existing Rust-backed timeline path; the card's 48 bars are never a timeline source.

The default browser codec adapter uses MediaBunny `AudioSampleSink` to consume PCM blocks sequentially, computes channel-inclusive absolute peaks, and closes every sample in `finally`. No whole-track `AudioContext.decodeAudioData` is used. Invalid/missing metadata, unavailable codecs, non-finite PCM and budget violations reject explicitly; failures are not cached as silent waveforms and can be retried.

Admission is global across cache owners: two active jobs, 128 waiting jobs, with 160 MiB reserved per job (320 MiB total). The model accounts for a 64 MiB encoded source, SHA input copy, a 16 MiB decoded block and summary overhead. URL reads enforce the encoded limit even without Content-Length; a standard four-minute 48 kHz stereo 16-bit WAV fits. These are application admission limits, not a hard cap on browser/codec internal scratch allocations or garbage-collector scheduling. Extremely large encoded sources reject with `NotSupportedError` rather than doing an unbudgeted full decode.

Summaries use a finest layer of at least 128 samples per bucket, capped at 262144 buckets, plus 16x peak levels. Queries retain source-sample intervals and use coarser levels only for fully covered aligned ranges, preserving the finest-layer peak result. Long sources may have coarser finest-layer temporal resolution, not stretched card geometry.

Content keys are actual SHA-256 bytes, not file names, object URLs or asset IDs. Equal bytes can reuse summaries across source keys; changed bytes cannot reuse stale summaries. Ready session entries and content memory caches are independently bounded at 64 entries / 8 MiB. IndexedDB derived data is disposable and bounded at 64 entries / 16 MiB, with a 2 MiB per-summary limit. Records are structurally and numerically validated before use; peak levels are rebuilt rather than trusted from disk. Corrupt records are removed and regenerated from the source. Storage denial does not prevent decoding.

The optional codec injection is for platform adapters and deterministic tests. Ownership tests use deliberate non-media byte fixtures and therefore inject their fake codec explicitly; real browser decoding is validated separately.
