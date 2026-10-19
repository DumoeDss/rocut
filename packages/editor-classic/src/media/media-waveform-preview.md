# Native audio card waveform

Audio cards request the existing session-owned waveform summary and sample 48 display buckets. Loading, offline files, unsupported decoding and other failures have separate visible states. Only a successful summary renders the waveform; all-zero samples are a valid silent waveform.

Retry is an explicit card action. Failed summary requests are already evicted by `WaveformCache`; retry does not invalidate a successful shared summary or create another decoder. Unmount and source/project replacement detach the old listener without cancelling cache work used by other views. Cache lifetime remains owned by the media manager.

Regression coverage: `__tests__/media-waveform-preview.test.ts` checks failure versus silence, offline/unsupported classification, explicit recovery, successful-summary reuse and ignored late results.

The shared cache distinguishes actual sources under the same media key using decoder precedence: AudioBuffer object, File object, then URL string. Reusing a File with a different object URL shares its pending or ready summary. Replacing the File does not reuse the old waveform or invalidate consumers of the old source. Object identities use a WeakMap so historical Files and AudioBuffers are not retained by the cache. Each media key retains at most eight ready URL summaries (LRU); pending URLs have a separate index only for their active work. Eviction never cancels consumers' returned promises. Source/project teardown still aborts pending work and clears every identity in scope. Cache ownership tests cover pending and ready replacements, bounded URL retention, retry and late failures.
