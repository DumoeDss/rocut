# Remotion native media metadata lease

Development update, 2026-10-10. This reference describes the browser IO lifetime
leaf, not a new engine, media timing implementation or completed browser/export
acceptance.

`remotion-media-metadata-lease.ts` is embedded into the existing
`REMOTION_MEDIA_WRAPPER`. Both native Html5Video and analyzed Html5Audio preload
metadata through this lease. Native Remotion still owns its duration context,
Sequence/trim/loop behavior, delay handles and cancellation policy.

The lease provides these IO guarantees:

- A retired effect aborts its metadata read and cannot publish `setDurations`.
- A late result or rejection from an old source cannot affect its replacement.
- Success, failure and effect cleanup release the native delay handle once.
- Cleanup clears the owned media source even if the read already completed.
- Pinned native `cancelRender` records `remotion_cancelledError` before throwing;
  the existing frame-driver readiness checks still see that recorded error. Its
  intentional throw is consumed rather than becoming a detached rejection.

The embedded wrapper already participates in the toolchain/archive fingerprint;
this source change consequently requires the normal recompile/rebuild path.
Existing asset admission, metadata watchdogs and network restrictions are not
relaxed. No new shared type or dependency is introduced.

Lightweight evidence: six CPU tests / twenty assertions in
`apps/cli/src/__tests__/remotion-media-metadata-lease.test.ts` cover cleanup before
late completion, successful completion then cleanup, cancellation throwing,
source replacement, synchronous read/apply errors, decoder cleanup throwing and
both wrappers embedding the lease. These tests do not launch a browser or media
process. Real native React effect ordering, image/audio decoding and final export
remain part of the later concentrated acceptance pass.

Within the audited declared-assets Remotion adapter, CSS fonts, archived static
data/captions, native audio observations/mixing and OffthreadVideo are implemented.
Broader codec/HDR/device and arbitrary author combinations are verification scope,
not evidence that those implementations are missing. Native artifact registration
and inline/raw PCM remain explicit unsupported capabilities requiring separate
resource DTO, admission and output-consumer design if requested. The ongoing
metadata receipt/dynamic configuration work is separate from this media IO lease.
