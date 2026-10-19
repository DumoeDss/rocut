# Editor derived media

Thumbnails and waveform summaries are disposable presentation data. They do not
update project revisions, import receipts, selected asset versions or undo history.

## Video previews

`packages/editor-classic/src/media/preview-resource.ts` owns leases, deduplication,
visible-poster priority, cancellation, a 128-entry waiting queue and two active
browser requests. The completed in-memory cache and IndexedDB cache each have an
8 MiB budget. The key includes the project, content SHA, source time and explicit
size/orientation/color/encoding/generator policies. Legacy files without a known
SHA retain session-local object identity; the preview path does not read an entire
large file merely to hash it.

`preview-storage.ts` validates cached image decoding. Invalid entries are discarded
before one fresh decode, not repeatedly returned as ready. Cards expose an explicit
retry; image presentation errors become failures. `preview-native-frame.ts` checks
bounded native PNG headers, converts to the browser thumbnail profile, and closes
its bitmap. Frame generation has a 15-second request deadline.

Hosts may implement the optional `MediaPreviewProvider` in `editor-ports/host`.
`apps/vite-example/src/host/http-media-previews.ts` probes version 1 of the
authenticated `GET api/media/preview` capability. Only failed or unsupported
browser decoding with a known media ID and SHA can invoke the native fallback.
An older host, offline source or cancelled request does not trigger speculative
native execution.

`apps/cli/src/media-preview.ts` and `media-preview-route.ts` own native IO. The POST
accepts only `mediaId`, `sourceSha256` and `timeSeconds`; it never accepts a path,
URL, executable or media upload. It reads a contained imported attachment, verifies
the actual bytes, and uses host-configured FFmpeg/FFprobe. Existing ancestor and
file containment checks, bounded reads, two decoder slots, cancellation, process
cleanup and host shutdown remain active. Native sources are currently limited to
64 MiB MP4/WebM, source dimensions to 4096, and output PNGs to 512 pixels and 1 MiB.
These are preview budgets, not new project/import/export size limits.

## Waveforms

`services/waveform-cache/decode-source.ts` uses streamed `AudioSampleSink` blocks
instead of a whole-track `AudioBuffer`. Each decoded block is closed; summaries
combine all channels and retain source-time resolution for timeline consumers.
`decode-budget.ts` bounds global concurrency and admission; `summary-storage.ts`
owns SHA/profile-keyed, disposable memory/IndexedDB summaries and validates stored
data before reuse. A valid zero summary is silence; offline, unsupported and failed
decoding remain distinct and retryable. Exceeding a preview budget does not replace
the waveform with a fabricated flat line.

The source limit is 64 MiB, each decoded block is capped at 16 MiB, and the summary
has at most 262,144 finest-level buckets plus reduced levels. There are two active
tasks and at most 128 waiting tasks. Reservation budgets account for encoded/hash
buffers, a decoded block and summaries; they do not claim to cap codec-internal
scratch allocations. Completed caches are bounded to 64 entries, 8 MiB in memory
and 16 MiB on disk. Source lifecycle generation fences reject late writes.

## Verification scope

The relevant suites live under `media/__tests__/preview-*`,
`services/waveform-cache/__tests__/`, `apps/cli/src/__tests__/media-preview.test.ts`
and `apps/vite-example/src/host/http-media-previews.test.ts`. The native suite accepts
explicit `ROCUT_TEST_FFMPEG_PATH`, `ROCUT_TEST_FFPROBE_PATH` and
`ROCUT_TEST_OUTPUT_ROOT`; it never discovers or replaces installed application
plugins. Real browser evidence covers corrupt-cache recovery and a formally
imported HEVC file that Chromium cannot decode but the native adapter can.
Source/browser evidence is not installed Electron or GPU acceptance.
