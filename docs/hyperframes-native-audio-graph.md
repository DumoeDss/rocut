# HyperFrames native audio graph integration

## Current boundary

The existing gain-envelope/source-audio path is implemented. The grouped/FX
chain now has an explicit production Host route selected by
`source.audio.profile: "hyperframes-graph-v1"`, verified with real Rust/WASM,
FFmpeg, private Chromium and HTTP PCM transport. Omit the profile to retain the
legacy collector/cache behavior (including its rejection of groups/FX).
The graph profile requires an archived DSP identity and a freshly checked Host
runtime identity. Bounded native FX/preset automation and native variable-rate
preparation, including bounded source-domain loops, are implemented in this
profile. The variable-rate preparation and downstream native FX/Rust mix matrices
pass; see the 2026-10-09 checkpoints below for precise coverage. Fractional
clip/trim/loop sample phases and participating fallback gain histories remain
separate gaps.
This is source-level standalone Host acceptance, not installed-plugin acceptance.
Electron adaptation and shared installations are outside this workstream.

The fixed reference is `@hyperframes/core@0.8.139`. The same-version engine
package was downloaded for inspection only, without dependency installation or
script execution. Its npm archive integrity is
`sha512-Tfl0SlYbru9IFdAL9iGRU8hmx1jrfW2LxFyf5sjnMJzybbGuULfg+ffAwAsT/wiXBHFrzoQumQV+F12TfXUE+Q==`.
The runnable oracle records SHA-256 hashes of the actual source files it uses.

## Editor output sample-rate negotiation — 2026-10-08

The collector now requests the AudioContext's actual sample rate when advertised
by Rust `programmaticAudioPolicyJson().sampleRates`. Timeline export passes its
requested output rate explicitly, since a supplied AudioContext may have a
different device rate. This avoids an unnecessary 48 kHz → 44.1 kHz → 48 kHz path.
Unadvertised device/output rates retain the runtime's existing 44.1 kHz default
and downstream resampling; direct unsupported native-runtime requests still fail
Rust admission before Host IO. Cache identity continues to include sample rate;
source gain/mute are never baked into the cached raw PCM.

`programmatic-audio-collection-rate.test.ts` uses the real runtime and private
WASM, substituting only Host PCM IO and the browser AudioBuffer storage shell.
It covers 44.1/48 kHz cache separation, 96 kHz device fallback, both opposite
device/output-rate combinations through real `createTimelineAudioBuffer`, raw
gain/mute behavior and invalid native requests. Together with runtime,
graph-cache and audio-range-mix regressions: 32 tests / 231 assertions passed.
This fixes source preparation; the full 150-frame mixed-engine MV acceptance
is a separate gate, not implied by these tests.

## Native evidence and required order

### Audio observation settlement — 2026-10-08

`html-document.ts` now resolves audio-only observation immediately after the
sandbox's successful snapshot message. The snapshot has already crossed the
structured-clone boundary; the outer document's two painting turns are irrelevant
to audio metadata and could otherwise keep a completed observation pending.
Picture capture, including pictures with a native soundtrack, retains both outer
paint turns. Inner resource/font/author readiness, native media checks, source
window filtering and error propagation are unchanged.

`html-document-settlement.test.ts` evaluates the real generated outer expression
with a deliberately non-firing animation-frame scheduler. Before the fix, two
tests failed while picture/error controls passed. All four now pass; together
with the HyperFrames/Remotion bootstrap tests, 14 tests / 89 assertions pass.
This proves the unnecessary audio paint dependency, **not** the root cause of
the intermittent frame-80 cancellation in the full multi-shot run. Continuous
browser analysis and full mixed-engine export remain separate acceptance gates.

### Native processing order

The native preview graph and inspected engine mixer agree on the essential
ordering: dry source → track FX → track gain/fades → group sum → bus FX → bus
gain/mute. Rocut applies its own final master only once, outside this soundtrack.
In particular, current gain-scaled PCM must not be reused as dry FX input, and
bus FX must not be distributed over its members: the native compressor oracle
produces about 0.09317 for FX(0.15+0.15), versus 0.15669 for FX(0.15)+FX(0.15).
Floating-point group intermediates must retain headroom until final mastering.

Reference locations inside core `dist/`:

- `runtime/media.js`: actual track gain callback, post-interpolation clamp and
  fades; `audioGroups.js`: flat membership and compiled render-instance keys.
- `audio/audioFxGraph.js`: all 16 native builders, actual AudioParam exposure,
  and wet/dry wrappers around contiguous runs sharing `fromPreset`.
- `audio/audioFxAutomation.js`: AudioParam scheduling, 100 points/second curved
  segments bounded to 8..4096 points, clip-local FX time and unit mappings.
- `audio/audioFxTail.js`: serial tail sum capped at five seconds. This is an
  output extension rule, not proof that five seconds of preroll restores state.
- `speedRamp.js`: logarithmic rate interpolation and 48-cell per-segment
  trapezoidal integration. Matching this mapping alone does not verify PCM.
- `generated/audio-fx-runtime-inline.js`: trusted `getAudioFxRuntimeScript()`
  exposes an OfflineAudioContext renderer; FFmpeg remains source decoding, not
  an approximate substitute for the native effect graph.

Membership is flat, not bus-to-bus. A bus attribute on a bus does not imply
nesting; ordinary DOM ancestors do not confer FX or fades. Repeated compiled
compositions require instance IDs; the preview helper still has author-ID
routing paths, so repeat-instance routing needs a separate browser acceptance.

## Preview and upstream export are not identical

Keep three different semantics separate: track gain/fades, bus fader scheduling,
and FX AudioParams. Do not reuse TrackGainEnvelope as a generic bus envelope.

The fixed native preview bus can schedule a legal via curve below zero
(observed minimum -0.124232217669487); the track path clamps the corresponding
resolved gain to zero. However, the engine export path in
`dist/services/audioMixer.js::volumeLaneKeyframes` samples only segments with
`curve`, at 30 Hz. A pure via segment is reduced to its endpoints. The engine's
`audioVolumeEnvelope.js::createEnvelopeWalker` then interpolates keyframes
after core `runtime/mediaVolumeEnvelope.js::normaliseEnvelope` clamps them.
The actual pure-function oracle demonstrates:

- Pure via at t=.25: export gain .25; native continuous lane about -.12425.
- Exponent curve at t=.51: export .26033333333333336; continuous lane .2601.
- Negative sampled keyframes are clamped in the engine envelope path, unlike
  the preview bus's dynamically scheduled values.

The implementation direction is to retain authored native preview fader
semantics and share one Rocut soundtrack between Rocut preview and export, not
deliberately straighten via curves to reproduce this upstream export discrepancy.
This is a Rocut composition of selected semantics, not blanket equivalence to
either upstream transport or exporter. Acceptance must label the reference path;
no upstream exporter byte-equivalence claim is justified. The inspected engine
also slices variable-rate audio into bounded
constant-tempo segments before pitch-preserving FFmpeg processing; video/source
time agreement is not proof of equivalence to that audio algorithm.

Two additional execution gates were established by source/actual-function review:

- Native fallback author gain depends on DOM volume, Web Audio routing and the
  previous runtime-applied volume. Four actual `syncRuntimeMedia` cases with
  identical captured clip facts produced .25, .75, 1 and 1. Capture the resolved
  **pre-fade author gain**, distinguish normalized envelopes from fallback, and
  reject unreproducible dynamic fallback rather than substitute `clip.volume`.
- The inactive branch in `runtime/media.js` pauses and evicts sync state; it
  does **not** send a zero-volume callback. Separately, the preview buffer path
  disposes its track FX/gain on BufferSource `ended`, whereas the offline FX
  renderer allocates tail frames and waits for rendering to finish. This does
  not imply the bus FX or every media-element path has the same lifetime.
  Track/bus tails and export lifetime therefore need independent acceptance.

## Rust admission foundation

`programmatic_audio/graph/fx*.rs` normalizes the complete 16-effect registry via
`normalizeHyperframesFxChainJson`. Input is the native `{version,nodes}` JSON;
output is `{chain,staticTailSeconds}` or `{error}`. Parameters retain native
defaults, numeric-string coercion, range clamping without UI-step rounding,
exact enum matching and unknown-param dropping. Stable IDs, preset metadata,
disabled nodes and native optional-field behavior are retained. Unknown effect
types fail even when disabled. `staticTailSeconds` excludes automation and must
not be used as a final render duration or state-recovery plan.

Rocut adds explicit safety rejection, never truncation: 128 KiB JSON, 32 nodes,
depth 8 (root 0), 4096 decoded values including containers, 64 keys/object,
4096 UTF-8 bytes per string/key, and 256 bytes per retained metadata string.
Rocut also requires Unicode-scalar strings: paired UTF-16 surrogate escapes are
accepted, unpaired escapes are explicitly rejected, never silently replaced by
U+FFFD. These are Rocut policies, not undocumented native restrictions.
Attribution and the Apache-2.0 license remain in `rust/wasm/NOTICE`.

## Independent checks and remaining integration

`script/fixtures/hyperframes-audio-graph-oracle.mjs <private-toolchain>` runs nine
core cases. `--engine-root=<extracted-engine-package>` adds two actual engine
pure-function cases. Eleven cases pass, with deterministic output. It imports
the pinned upstream functions, records graph/AudioParam operations, and executes
real upstream worklet `process()` on PCM. It does not claim that recording
adapters execute AudioParam interpolation, convolution, browser routing, native
decoding or the full exporter. Each evidence class is labeled in the output.

The independent FX normalization test is
`script/fixtures/hyperframes-fx-normalization.test.ts`; it compares against the
actual pinned `parseAudioFxChain` and `chainTailSeconds`, not a second handwritten
registry. It uses a real isolated WASM artifact through
`isolated-web-wasm-preload.mjs`. Rust admission tests are
`cargo test -p editor-api --test hyperframes_fx_contract`.
The isolated WASM differential run passed 32 tests / 25,270 assertions, including
all 16 effects, coercions, metadata, numeric overflow, invalid JSON, Unicode and
exact-limit/over-limit cases. The Rust contract suite passed 10 tests. The
isolated TypeScript consumer check also passed. These checks validate admission,
not execution of those effects in a Rocut soundtrack.

The pinned bundler WASM was built in a private directory. Its existing surface
validator passed with all 27 negative and two positive mutation controls, and
the unchanged runtime-contract TypeScript fixture passed against that artifact.
The canonical generated sync entry also initialized and called the normalizer.
No existing stable export was removed; the recorded set gained only the FX
normalizer. Previously recorded audio-clock names were retained while their
stale counts/hashes were refreshed. The shared `rust/wasm/pkg` was not replaced.

### Real native browser PCM oracle

`node script/probe-hyperframes-audio-graph.mjs <private-toolchain>` runs the
pinned native runtime in a private Chromium OfflineAudioContext. Three behavior
groups passed on Chromium 151.0.7922.34: actual track/bus ordering and
nonlinearity, AudioParam/FX gain curves, and stateful crop/tail behavior. It uses
native single-context routing versus independently staged native render calls,
mathematical curve controls, and a bare Web Audio feedback graph. Observed:

- Full graph versus staged native oracle maximum error: 7.45e-9. Wrong track
  or bus gain/FX order and distributing bus compression all produce clear
  nonzero differences.
- Native curved scheduling is discretized, not an analytically exact curve.
  The inline FX renderer ignores outer volume lanes: Rocut must route those
  faders separately.
- Warm-from-zero crop equals full stateful output exactly for the tested delay;
  resetting the local window differs by up to .5. This is not proof that a
  bounded preroll restores every effect's history.
- At 48 kHz, the 100 ms / .5-feedback delay echoes appear at samples 4800,
  9728 and 14656. The independent bare Web Audio graph matches exactly: this
  Chromium adds 128 samples per feedback cycle. The native ideal tail estimate
  neither includes that overhead nor proves the feedback reaches exact zero.

The runner writes `verification.json`, source hashes and six hashed stereo-f32
artifacts to its private temporary directory, then closes its own browser and
server. This is upstream browser PCM evidence, not Rocut graph integration,
full-16-FX coverage, video export, Electron or installed acceptance.

### Instance-aware collection preparation

`hyperframes-audio-graph-{types,bootstrap}.ts` defines a separate raw-fact
collector, not yet wired into the gain-only soundtrack. Its lifecycle is
register admitted media/mute → begin frame → collect native clip → snapshot.
Compiled instance stamps are mandatory; author IDs remain diagnostic. It
retains inactive/muted tracks and rejects changed identities, sources or
post-collection declarations. Raw FX/automation/bus-volume attributes are not
interpreted in the browser adapter.

The compiler now runs upstream `assignMediaRenderIds` after inlining, because
`bundleToSingleHtml` alone does not perform that pass. The separately pinned
`hyperframes-audio-graph-patch.ts` hook captures the native resolved clip before
its active-window branch; absent a collector it is inert. Its bytes are included
in the existing compiler adapter digest. Real isolated compilation verifies
that repeated author clip/bus IDs remain unchanged while instance identities
and memberships remain distinct. The old graph/automation rejection remains.

`node script/probe-hyperframes-audio-graph-collector.mjs <private-toolchain>`
also passed real runtime collection through five independent native seeks
(.36, 0, .12, .60, .12 seconds), each retaining nine tracks and two buses with
fresh native timestamps. Checks include eleven unique instance stamps despite
repeated author IDs, scoped memberships, two-level root-resolved starts,
inactive/muted/hidden tracks, trim, loop, rate and source duration. It uses the
real compiler and native player seek barrier, not synthetic clip objects. This
is collector-only evidence; it does not make the snapshot an executable fader
or an enabled soundtrack graph.

The Host now exposes a separate internal `withHyperframesAudioGraphAnalyzer`
in `hyperframes-audio-analysis.ts`. It shares source-only Rust preflight,
resource/archive loading, private Chromium lifetime, denied network access,
serial frame checks and fresh opaque-origin documents with the gain-only
analyzer. Only this entry selects `hyperframesGraph: true`; browser snapshots
remain `unknown` until Rust admission. The ordinary analyzer and soundtrack
continue to reject groups/FX. No external capability or Electron IPC changed.

`hyperframes-audio-graph-analysis.test.ts`, run with the isolated WASM preload
and `ROCUT_TEST_HYPERFRAMES_TOOLCHAIN`, verifies actual archived compilation
through this Host path: four seeks retain nine tracks/two buses, stable stamped
identities, original mute and active resolved-gain facts. Repeated fresh-frame
results agree; concurrent collection and a pre-aborted job are rejected.
The test passed 43 assertions. The affected gain-only diagnostic also passed
30,720 sample comparisons (maximum error 1.86e-8), full/partial PCM equality,
Host response bytes, audible video pictures/soundtrack and archive rebuild.
These are source-tree/private Chromium checks, not installed/Electron evidence.
`hyperframes-audio-analysis-lifecycle.test.ts` adds two actual Windows Chromium
checks (17 assertions): an observed native-seek debugger checkpoint is aborted
in flight, and a consumer throws after a real frame. Both verify process exit,
private profile removal and observer disconnect; the consumer case also checks
frame-target reclamation and original-error propagation. Neither test replaces
the analyzer/browser/close implementation or touches a shared app instance.

Fresh video-frame seeks are **not** a complete gain-history strategy: an audio
clip can start and end between adjacent video frames. Rust-only
`resolve_hyperframes_audio_discovery_json` in `graph/discovery.rs` now reuses
complete graph admission and plans bounded native-time seeks inside clip
windows, without snapping them to picture/sample frames. Equal times coalesce
by compiled instance; muted/hidden tracks remain. Full and cropped requests use
the same exact composition window, not rounded PCM duration. Empty/outside
windows are explicitly reported, never labeled silent. Discovery and observed
gain admission now share the pinned native `isInClipWindow` tolerance. If
neither midpoint nor start qualifies, an ordered-f64 binary search finds the
first nonnegative instant admitted by the start predicate (at most 63 probes).
The end/composition predicates only turn false after that point, so failure
proves no representable active instant exists. This can find an epsilon sliver
before the declared start, even when start equals the composition end.
`boundaryLimitedInstanceIds` remains for descriptor compatibility but is empty;
proven absent windows appear in `noActiveIntervalInstanceIds`.
Seven Rust tests cover subframe clips, native floating-point boundary cases,
canonical discovery, NTSC end bounds, retained identities and admission
rejection. The discovery result remains a preparation plan and says `gain-discovery-only`,
`executionReady: false`, `historyComplete: false`. Dynamic fallback gain still
needs a defined full-history strategy. Do not infer it from `clip.volume` or
treat unobserved tracks as silent. The integration below now executes this plan
through precise native Host seek IO.

Resolved-gain collection now has real fixed-seek evidence for DOM volumes
0.25/0.75, prior-runtime-volume fallback and normalized lane/GSAP envelopes.
Inactive tracks explicitly retain an unobserved gain state. The collector probe
reports `routedPreview: "not-exercised"` by default; its optional strict
`--routed-preview` check remains incomplete because the private native preview
AudioContext stayed suspended. Paused `renderSeek` stops routing and cannot be
used as proof of the routed=true branch.

### Rust graph preparation, not execution

`programmatic_audio/graph/{model,snapshot,facts,topology,validation,plan_model,plan}.rs`
accepts the separate collector DTO through
`resolve_hyperframes_audio_graph_json`, exported as
`resolveHyperframesAudioGraphJson` through WASM. The fixed internal profile is
`rocut-hyperframes-0.8.139-audio-graph-v1`: selected native fader/FX semantics
under Rocut's common soundtrack and fixed-duration policy, not a promise of
complete upstream preview/export equivalence.

Every returned graph admission plan says `stage: "admission-only"`,
`executionReady: false`; track/bus faders are distinct and both say
`evaluated: false`. Bus volume stays raw. The initial volume-only parser has
since been extended by the bounded native FX admission described below; rate
lanes and nonconstant rate specifications remain explicit errors. Admission
alone does not execute a soundtrack. Compiled identities are unique across tracks/buses; there
is no author-ID fallback, implicit missing bus or nested bus routing.

Canonical render history always starts at zero and covers the complete fixed
composition. Full and partial requests share that history; the requested output
uses the existing absolute rational sample grid. Tails may continue inside the
composition, never extend its public duration. No inactive/muted tracks are
discarded while constructing the plan or estimating buffers.

Additional explicit preparation limits are 2 MiB request JSON, 64 tracks,
32 buses, 256 total FX nodes and 32,768 total native volume points (4,096 per
track). Existing source count/encoded-byte and 128 MiB PCM policies are reused.
The complete canonical output and deduplicated full dry-source estimate are
each bounded, even for a tiny requested crop. These estimates do **not** bound
the future executor's full working set, stage buffers or convolution storage.

`cargo test -p editor-api --test hyperframes_graph_contract` passed 12 cases:
identity/schema/source/clock rejection, actual boundaries, retained tracks,
distinct unevaluated faders, fixed history, and 44.1/48 kHz NTSC sample grids.
The existing/new bootstrap and real-compiler suites also passed together:
17 tests / 75 assertions; the existing unsupported-feature rejection remained.

### Rust dry PCM and fader preparation

The `resolve_hyperframes_audio_execution_plan_json` WASM entry now prepares
decoded-source identities, track-local dry stages, distinct track/bus faders,
native FX stage geometry and a conservative working set. It still reports
`executionReady: false`: this kernel prepares a plan, while the admitted Host
graph runner executes the IO and stages separately.
`prepare_hyperframes_audio_dry_track_pcm` takes one complete tempo-adjusted,
un-gained source, applies clip trim/loop/zero padding in the local clock, and
does not reuse the legacy gain-scaled mix. Native loops restart at mediaStart.
`apply_hyperframes_audio_track_gain_pcm` applies the verified author envelope
and fades only after the complete native FX stage; no final master or clipping
is applied here. Their length-prefixed binary manifests carry the source
request for revalidation, not a caller-asserted trusted plan/allocation limit.

Participating track preparation requires complete normalized volume-lane/GSAP evidence and
checks observed gain/fades/points for consistency. Missing observations or
dynamic fallback history remain explicit unsupported cases. Clip placement,
trim and loop period currently require sample alignment; fractional phase is
not silently approximated. `resolve_hyperframes_bus_fader_json` prepares the
native AudioParam set/ramp/Float32-curve schedule (including negative via
overshoot), not an already-applied bus gain buffer. The assembly kernels below
complete the track→bus→master mixing stages. The 512 MiB estimate includes both
encoded source copies, decoded cache, retained track/bus outputs, canonical mix
buffers, dry/assembly transport and WASM copies, explicit native buffers
and conservative opaque-DSP reserves; `browserTotalMemoryGuaranteed: false`
is intentional. At this earlier checkpoint, native variable rate, unresolved
discovery boundaries and full dynamic fallback history were integration gaps;
later checkpoints below supersede the rate/discovery status.
The targeted Rust run passed 57 cases across bus scheduling (6), execution
preparation (8), dry/post-FX PCM (5), graph admission (12), discovery (7), FX
normalization (10) and existing gain envelopes (9). Bus curve expansion has
separate per-bus/global budgets; normalized volume-lane evidence is retained
in admission plans rather than accepted and then discarded.

### Trusted native FX execution component

`hyperframes-fx-{runtime,executor,target,bootstrap,types}.ts` provides a private
serial Chromium executor for a Rust-admitted complete-history stage. The loader
checks the configured core version/lock, pins the reviewed module and returned
runtime code SHA-256, and imports those exact verified bytes. Only loader-issued
frozen runtime objects are accepted; project attachments or a project-provided
hash are not permission to execute host code.

Stages use fresh trusted pages, denied external network access and the pinned
runtime's data-URL AudioWorklets. Transfer chunks are bounded to 64 KiB; input is
snapshotted before awaits, finite PCM and exact stereo input/output geometry are
checked, including before native OfflineAudioContext allocation. The executor
does not apply track/bus gain, mix, clip, master or choose timing/tail budgets.
Runtime/module/adapter/browser provenance and input/output hashes accompany PCM.
Cancellation/timeouts terminate only the private executor. Explicit buffer
geometry is bounded; Chromium's hidden DSP/RSS allocation is not a proven hard
memory cap and must remain a conservative estimate in the Rust working set.

`hyperframes-fx-{runtime,executor}.test.ts` and the dedicated PCM fixtures passed
10 tests / 135 assertions, including real output from all 16 FX types. All
outputs have finite samples, expected lengths and nonzero/different-from-dry
signals; this is not exhaustive acoustic equivalence for every parameter.
Independent gain arithmetic has maximum error 1.23e-7 and preserves peaks above
one; native gain automation and 128-sample feedback overhead were also checked.
Fresh delay stages reproduce byte-identical PCM. Invalid geometry, NaN input,
serial execution, disposal, in-flight cancellation and timeout are covered.
Private evidence: `rocut-native-fx-executor-ZTIq0z/verification.json` in the
session's temp directory, with hashed `.f32le` artifacts and browser identity.
The opt-in Host graph soundtrack now selects this component; the legacy path
does not.

### Integrated private graph chain (2026-10-08)

`hyperframes-graph-{kernels,render}.ts` packages binary manifests and performs
only decoding/native FX IO. Rust `graph/{assembly,assembly_wire,bus_pcm}.rs`
owns post-FX track gain, canonical placement, group summing, post-FX bus gain,
stable accumulation order and final crop. Missing, duplicate, extra, wrong-stage,
nonfinite or wrong-length buffers are errors. Headroom above one remains intact;
this soundtrack does not apply Rocut's final master a second time.

`hyperframes-graph-audio.ts` is the archive-to-PCM integration seam:
baseline collection → Rust discovery → exact native seeks → complete snapshot
stability checks → dry decode → track FX/fader → bus FX/fader → canonical crop.
The analysis browser closes before the separate trusted DSP browser opens.
`graph/seek.rs` preserves exact native f64 seconds while the picture context
retains its integer frame/tick mapping. `serde_json/float_roundtrip` fixes a real
one-ULP loss between JS JSON serialization and Rust parsing; tests retain exact
bit equality rather than weakening the timing assertion.

`graph/observations.rs` admits every full snapshot and compares all static clip,
resource, mute/visibility, FX and routing facts. Track/bus array order is also
fixed because floating-point accumulation is order-sensitive. Only snapshot
time, observation time and validated resolved gain may change. It returns
bounded deduplicated envelope evidence, not a claim that arbitrary scripts are
stable between seeks. Unobserved clips are not silently dropped.

Verified with isolated artifacts, not the installed Elftia plugin:

- Real decode/Rust/native-DSP/Rust chain: nonzero starts, trim/repeated loops,
  overlapping tracks, delay tails, nonlinear track/bus FX and mute. Independent
  fixture arithmetic matched with maximum error 0; the deliberately wrong
  fader-before-FX ordering fails. Peak 2.188 is retained without clipping.
- Full versus crop and repeated complete history are byte-identical. Separate
  44.1 kHz, 30000/1001 cases cover fractional video-frame sample boundaries.
- Real archived native engine → discovery → PCM preserves all 96 samples of a
  2 ms clip at .101 seconds which every 25 fps picture-frame probe misses.
- A real video-only MP4 returns `hasAudio:false` and zero PCM. All-muted stage
  execution bypasses decoder/FX IO. Here `hasAudio` means an admitted routed
  audio stream exists, not that measured samples are nonzero.
- These six real tests passed 102 assertions. Rust additionally passed 68
  integration cases plus four fixed native-PCM unit cases, six seek cases and
  twelve observation-stability/bounds cases. Native bus oracle compared 530,496 values
  across 36 cases; maximum error 1.073e-6 against Chromium, within the declared
  2e-6 absolute-gain tolerance. Native AudioParam is **not** claimed bit-exact
  with portable scalar interpolation.

Web test artifact and release bundler artifact live under
`.tmp-probe/hf-graph-20261008-a4c721/`; PCM reports are in its private `tmp/`.
The release build uses the canonical builder's pinned toolchain/path remaps with
only its output redirected. Its measured API delta is exactly ten added graph
exports, zero removed; the API guard passes 27 negative and two positive
controls. Shared `rust/wasm/pkg` and installed dependencies were not replaced.

### Opt-in Host and cache identity (2026-10-08)

Compile/rebuild a HyperFrames 0.8.139 source with
`audio: { version: 1, mode: "native", profile: "hyperframes-graph-v1" }`.
Rust only admits this profile on compiled `html-document` HyperFrames sources;
null/unknown profiles, other engines and other native versions fail. Merely
adding the field to a legacy archive does not create its required DSP lock.
Graph compilation adds `toolchainLock.audioGraph`; legacy HyperFrames and
Remotion compilation do not load or require the graph FX runtime.

The authenticated `programmatic/audio/identity` route takes `{source,sampleRate}`.
It verifies the archive against reviewed runtime/module/adapter bytes, hashes
the actual decoder files with bounded streaming IO, and probes the actual
private Chromium `Browser.getVersion`. The returned object is exactly
`{version:1,profile:"hyperframes-graph-v1",id:<sha256>}`; its digest also includes
a private per-Host epoch. No local file selectors or epoch secret are returned.
The browser tuple is process-reported provenance of a trusted local installation,
not cryptographic attestation against a malicious browser binary.

Graph `programmatic/audio` requests require that object as `expectedIdentity`.
The Host prepares identity again, rechecks decoder files before/after execution,
uses the prepared branded DSP runtime and decoder selectors, and verifies the
actual DSP browser provenance before running effects. PCM carries matching
`x-rocut-audio-profile`/`x-rocut-audio-identity` headers. Source/range admission
precedes expensive identity IO. Both routes share bounded jobs, cancellation
and disposal. Configured is not health-probed; Electron never silently falls
back to standalone Chromium.

`ProgrammaticAudioRuntime` preserves the profile, preflights before every graph
cache lookup and keys source PCM by the returned identity. Source mute/gain stay
outside cached PCM, and response mismatches never populate the cache.
Invalidation aborts and drains preflight and render work. A changed Host epoch,
decoder content or native runtime cannot reuse the previous identity's PCM.
Concurrent callers retain independent cancellation; preflight itself currently
runs per caller rather than being memoized.

Rust `graph/participation.rs` now shares inert/participating classification
between observations and execution. Valid fallback facts on muted, hidden,
non-audible-video or out-of-history tracks need no complete gain history. Every
fact still validates native clock/fade/fallback-branch rules; TS does not hide
tracks to evade admission. Participating fallback is rejected even if the
requested output crop misses it. The fixed fallback branch is adapted from
native `runtime/media.js`, not guessed from the last media element volume.

Verification added: 55 targeted Rust cases for participation and graph rules;
20 source-profile/runtime/cache tests with 145 assertions; 12 legacy transport,
runtime and job-slot tests with 73 assertions (these counts overlap).
Identity/archive tests add five cases and 52 assertions; HTTP identity shape and
response binding pass 18 assertions, and the real Host authentication/capability
test passes 15 assertions. Concurrent graph callers preflight independently,
share one PCM request and can cancel independently.
`hyperframes-graph-host.test.ts` uses a real compiled archive, private Chromium,
native decoders and actual HTTP provider: full stereo PCM matches independent
track-FX/group/bus-FX/gain arithmetic within 2e-7; crop is byte-identical;
missing/stale identity fails; a recreated Host changes the cache namespace;
graph picture PNG succeeds. The test passed 14 assertions.

Current private artifacts are under `.tmp-probe/hf-host-20261008-1d90ad/`.
The canonical release bundler rebuild has no further API delta; its guard passes
27 negative/two positive controls, runtime contract typechecking and the build
path-disclosure scan. The NOTICE digest was updated from that measured artifact.
Shared `rust/wasm/pkg` is unchanged.

### Editor graph export acceptance (2026-10-08)

`node script/probe-hyperframes-graph-editor.mjs <private-toolchain>` uses
`ROCUT_TEST_WASM_DIRECTORY`, `ROCUT_TEST_FFMPEG` and `ROCUT_TEST_FFPROBE`.
Set process-local TEMP/TMP to a private volume with sufficient free space.
It compiles/archives a real multi-frequency source with track gain/saturation,
group sum, nonlinear bus FX and bus gain, then uses the actual HTTP provider,
`ProgrammaticAudioRuntime`, collector, timeline mixer, `buildScene` and
`SceneExporter`. It does not run the installed UI or connect to shared Electron.

The 64x64, nine-frame WebM contains stereo Opus. A fixture-only independent
WaveShaper/scalar oracle finds maximum native PCM error 4.47035e-8 and final
timeline error 2.28175e-8; the partial timeline is sample-identical. Wrong-order
controls differ by 0.0016843 (track gain before FX), 0.0423805 (bus FX before
group sum) and 0.108358 (bus gain before FX), so this is not just a nonzero-audio
test. Source mute/gain, editor placement/trim and ordinary audio mix are covered.
Five identity preflights share one PCM render; six source pictures are captured.

Independent FFmpeg decoding validates the moving picture marker and silent
boundaries; both audio channels have best lag zero samples, correlation at
least 0.9998988 and worst section RMS error 0.0008501. The codec adds 596 padding
samples, recorded rather than hiding them by shifting/truncating the reference.
Evidence remains in private `tmp/rocut-hf-graph-editor-J6TZKQ/verification.json`
and `hyperframes-graph-editor.webm` (12,545 bytes; SHA-256
`8a0b3acea53e6886308fd0aaf4675f398c8589b7128a74f67caabebf0e5bf23f`).

Still required: installed UI playback/synchronization acceptance for this graph
profile; participating fallback history and fractional clip/trim/loop phase
support; installed Electron/full-MV acceptance. Variable-rate preparation and
bounded source-domain looping have since been implemented; see the 2026-10-09
checkpoints below.
The remaining gaps are not replaced with silent approximations.

### Native FX automation acceptance (2026-10-08)

The graph profile now admits native `fx.<nodeId>.<parameter>` and
`fx.preset.<presetId>` lanes alongside `volume`. Probe
`programmaticNativeAudio.hyperframesGraph.fxAutomation` for
`native-parameters-and-preset-mix-v1`; older installations may still reject FX
automation. The legacy omitted-profile route remains unchanged.

Rust `graph/fx_automation*.rs` owns normalization, target resolution, budgets,
volume projection and native dynamic-tail geometry. Track FX is scheduled from
clip-local zero and bus FX from composition zero; only the final soundtrack is
cropped. Native knob units, exponent/via curves, logarithmic interpolation,
mapped AudioParams and preset wet/dry splits are retained. Volume remains a
separate post-FX fader. Duplicate lanes keep declaration order: the final lane
drives scheduling, but the first matching lane supplies native tail maxima.
Orphan/enum targets are dropped with diagnostics. Disabled and unexposed knobs
remain native no-ops, not newly supported audible modulation; their retained
lanes can still change the native tail policy.

Admission bounds every stage, including muted and out-of-crop stages: 128 KiB
raw automation, 32 lanes, 4,096 raw points, 512 normalized points per lane and
262,144 expanded FX curve values per stage. Global limits are 32,768 retained
points and 1,048,576 expanded FX plus bus-fader values. The conservative working
set now accounts for curve copies and point/event bookkeeping. Native tail is
an output-extension policy, **not a physical decay bound**: a reverb size lane
can shorten output without changing its static IR and truncate audible decay.

Verification in a private WASM/Chromium environment:

- 14 parser/target/tail unit tests, five new graph integration tests, and 62
  affected graph, fader, PCM, assembly, participation and seek regressions passed.
- `hyperframes-fx-automation-oracle.test.ts` and `-clock.test.ts` passed 135
  assertions, comparing separate upstream modules with the trusted native IIFE;
  wrong track/bus clocks and crop-first processing produce observable differences.
- `hyperframes-fx-automation-rust.test.ts` compares actual Rust plans with the
  upstream oracle: 68 cases / 1,360 assertions covering 25 exposed knobs,
  duplicate IDs/lanes, no-ops, preset splits, volume projection and curve bounds.
  All 3,684,342 Float32 samples rendered from Rust-normalized plans match the
  independent upstream PCM exactly for these cases. This is not exhaustive
  equivalence for arbitrary projects or parameter combinations.
- `hyperframes-graph-automation-host.test.ts` passes seven assertions through
  real compile/archive, current identity, HTTP provider, FFmpeg and Chromium.
  Track-local gain/delay plus global bus gain match the independent native
  oracle within 2e-7; partial output equals the full PCM slice byte-for-byte.

The differential report is in private
`tmp/rocut-fx-automation-rust-zAml9S/verification.json`; new artifacts are under
`.tmp-probe/hf-automation-20261008-b935e1/`. No shared WASM, installed plugin or
Electron process was replaced. Installed playback/full-MV and the remaining
fallback/fractional-phase gaps still require separate work. The later
variable-rate/loop checkpoints below supersede those earlier gaps.

The new private canonical release has no public API delta. Its measured NOTICE
digest is recorded; API validation passes all 27 negative/two positive controls,
runtime-contract and targeted TypeScript checks, and the build-path scan.
Ten static graph/Host/legacy transport regressions pass 114 assertions against
the new private web artifact; this is not an unrelated full-workspace test run.

### Exact native clip-window discovery (2026-10-08)

`graph/native_window.rs` shares the pinned `clipFacts.sameInstant` and
`runtime/clipWindow.isInClipWindow` rules between discovery and gain evidence
validation. Previously, strict start/end comparison could reject a legitimate
pre-start observation and admit a time already excluded by the native end
tolerance. The ordered-f64 fallback above closes the unresolved discovery gap
without guessing epsilon offsets or rounding seeks onto a frame/sample grid.
This concerns native clip-window gain discovery, not the broader cue-ahead or
terminal-video-hold branches in `syncRuntimeMedia`.

Four new boundary tests and 37 affected Rust regressions pass. The independent
`hyperframes-native-window.test.ts` compares 81 ULP-neighbor window combinations
with the actual pinned upstream predicates (931 assertions), including first
eligible predecessors, empty windows, observation admission and unchanged PCM
placement. A sub-sample eligible observation still does not invent an audible
PCM sample. Fractional clip/trim/loop phase remains separately gated.

The private pinned release passes all 27 negative/two positive API controls,
runtime-contract TypeScript and build-path scanning. Only the measured NOTICE
and declaration-comment hashes changed; callable exports did not. This is not
installed Electron or full-MV acceptance.

The new font-axis private web build also passes two real browser regressions
(53 assertions): `hyperframes-audio-native-seek.test.ts` and
`hyperframes-graph-audio.test.ts`. Archived native collection still finds the
2 ms frame-gap clip, retains all 96 decoded samples and produces a crop exactly
equal to the complete PCM slice. These regressions supplement, rather than
replace, the boundary-predicate oracle above.

### Fractional and fallback research boundaries (2026-10-08)

`hyperframes-fractional-oracle.test.ts` records actual native buffer-fallback
OfflineAudioContext output, DOM/native loop mapping and the separate engine
exporter's filter builder. Same-rate nonloop buffer starts retain a fractional
phase even though their first output index is rounded upward; crop-first and
integer-loop substitutes demonstrably differ. But the default native preview
uses HTMLMediaElement routes first, while its buffer fallback does not set loop
fields. The engine exporter uses another placement policy (integer-millisecond
delay). No real MediaElement playback PCM or complete upstream FFmpeg export
was captured. These are not interchangeable evidence for lifting the graph's
fractional-phase restriction or adding a generic resampling approximation.

`hyperframes-fallback-native-oracle.mjs` passes eight cases against actual native
control functions/route methods. A declaration of volume 0.5 can produce author
gains 0.25, 0.5 or 0.75 depending on active-route lifetime and external writes;
route eligibility alone is not active routing. Stop/restore and eviction also
change subsequent values. This Node control-function probe is not browser PCM.
Sparse matching snapshots cannot certify arbitrary fallback history. A future
restricted authoring proof or explicitly distinct engine-export semantic needs
its own implementation and acceptance; neither is silently substituted here.

### Native variable-rate preparation checkpoint (2026-10-09)

The graph profile now plans variable-rate preparation in Rust, per participating
lane from canonical zero through the complete clip. Host FFmpeg performs the
bounded media IO. The native intermediate is stereo PCM16 at 48 kHz and is
explicitly converted to the requested graph rate before native FX, the post-FX
fader, bus/master processing and the final crop. Rate bounds remain 0.1 to 10;
the native atempo decomposition tolerance is preserved. The existing constant-rate
decoder path is unchanged. At this checkpoint, variable-rate loops still failed
admission. The following loop checkpoint adds source-domain preparation rather
than repeating already prepared output.

The independent oracle extracts unchanged functions from the pinned engine;
only process selection and IO transport are adapted. Its expanded preparation
closure includes video audio extraction, with SHA-256
`50549e28c052dac76250024559546c4b135c9737421bfa30a681bc81a2fdb1a3`.

Private standalone verification:

- `rocut-hf-rate-production-bLCbAO/verification.json`: 18 preparation cases,
  including five curves at 48/44.1 kHz and MP4/WebM with or without audio.
  All 14 audible cases match the independently prepared native PCM with zero
  maximum/RMS error; all four silent videos report `hasAudio=false`.
- `rocut-hf-rate-production-80KR5x/verification.json`: 10 native nonlinear FX
  to actual Rust mix cases at both rates have zero sample error. Ten crops
  equal complete-output slices byte-for-byte; repeat, source-mutation and
  geometry-rejection checks pass. Audible wrong-order controls differ by
  maximum 0.02445 to 0.02529, so pre-FX fader substitution is detected.

The real compile/archive → browser graph collection → Host HTTP → editor
`ProgrammaticAudioRuntime` consumer subsequently passes at its default 44.1 kHz:

| Input       | Private report directory    | Result                                     |
| ----------- | --------------------------- | ------------------------------------------ |
| WAV         | `rocut-hf-rate-host-nxj141` | Native expected and Host PCM hashes equal  |
| Audible MP4 | `rocut-hf-rate-host-uBriNa` | Native expected and Host PCM hashes equal  |
| Silent MP4  | `rocut-hf-rate-host-RL7ee6` | `hasAudio=false`, editor `null`, zero crop |

Each directory retains `verification.json`. The two audible directories also
retain `verification-exact-hash.json`: independently recomputed native FX/fader
output matches all 58,653 recorded Host PCM frames, establishing zero maximum/RMS
sample error. Each 4,851-frame crop at sample 16,317 equals its full-output slice;
the silent crop is all zero. Two editor loads use one full PCM render, and stale
identity requests are rejected. The Host matrix uses private
`web-title-riff-rect-U60hQ1`; no shared binary or installation is replaced.

These checks do not establish full upstream `processCompositionAudio`
equivalence, continuous MediaElement preview, Electron transport, installed UI
or encoded variable-rate/full-MV export. Fractional sample phase and participating
fallback histories remain open requirements; bounded loops are covered below.

### Variable-rate source-domain loop acceptance (2026-10-09)

The same graph v1 profile now supports variable-rate loops with explicit
sample-grid and working-set limits. This preserves native author/preview loop
intent; it does **not** claim to reproduce the upstream exporter's omission of
loop. The pinned engine's parsed audio/track objects do not carry a loop field,
whereas actual core `syncRuntimeMedia` requests
`mediaStart + sourceTimeAt(rate, clipLocalTime) % (sourceDuration - mediaStart)`.
Rate, fader and FX clocks continue across wraps; none restart on each source lap.

Rust owns source period, full consumed span, finite repeat count, filter strings
and memory admission. Host performs two bounded IO stages:

1. Decode the trimmed source window, canonicalize it to stereo Float32/48 kHz
   with amplitude-preserving mono duplication, loop **source** samples, and
   materialize a bounded canonical WAV.
2. Apply the unchanged full-clip native rate-slice preparation once to this WAV,
   followed by the established PCM16/48 kHz → graph-rate conversion. Process
   native FX/faders/buses once over complete history, then crop the final output.

The independent reference instead repeats decoded source samples in fixture
code, writes a virtual WAV, and invokes the unchanged pinned native preparation.
It does not use the production Rust filters or repeat stretched/prepared PCM.
The separate source WAV is required by observed behavior: an inline
mono-canonicalization/loop/ramp candidate differed in 1,336 frames across five
short windows, maximum error `0.134033203125`. The same source prepared in two
stages matches exactly. This isolates the required IO seam, not the precise
internal FFmpeg packetization/format-negotiation cause.

The restricted admission contract is:

- Trim, loop period, clip start and duration must align at both native 48 kHz
  and the requested 44.1/48 kHz graph rate. Fractional-phase and participating
  fallback-history gates remain unchanged; a zero/negative period is rejected.
- The whole source-span and loop tile each obey the 128 MiB PCM bound; finite
  repeat counts never use an infinite FFmpeg loop. Canonical WAV output adds a
  bounded 64 KiB header allowance. Source transport/native buffer reservations
  join the existing conservative 512 MiB working set, even for a tiny final crop
  or muted clip. This is not a hard process-RSS guarantee.
- Per-clip rate/source geometry cannot share a decoded buffer merely because
  encoded source identity matches. Prepared variable-loop clips disable the dry
  kernel's scalar-loop modulo, avoiding a second loop. Scalar and nonloop
  preparation paths are unchanged.

Acceptance reports are retained under the local temporary directory:

| Report directory                       | Evidence                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `rocut-hf-rate-loop-clock-UUqalm`      | Five original runtime clock cases with IO-only element stubs; source/rate requests, not playback PCM                           |
| `rocut-hf-rate-loop-oracle-oxrd24`     | Retained failed inline mono candidate; `verification-source-stage.json` records exact two-stage recovery                       |
| `rocut-hf-rate-loop-oracle-A9DgQH`     | Five independent real-source cases, including mono and 44.1 kHz input; maximum/RMS error zero                                  |
| `rocut-hf-rate-loop-production-IVF47b` | Actual private WASM and Host: 10 preparation cases, two stateful FX/mix cases at both graph rates; all maximum/RMS errors zero |
| `rocut-hf-rate-loop-host-hUJHl4`       | Compiled author loop → real browser graph collection → HTTP → editor `ProgrammaticAudioRuntime`, default 44.1 kHz              |
| `rocut-hf-rate-loop-boundary-rFC3BQ`   | Seven source-span EOF boundary cases around half a source sample and the six-decimal native time grid; exact PCM               |

The independent oracle detects 16 incorrect implementations: repeating the first
prepared lap, looping through source zero, restarting preparation for a crop,
and resetting the real native delay at the first wrap. The delay-reset control
differs by maximum `0.28971198201179504`, RMS `0.025858744009024225`.
Production stateful saturate+delay cases preserve full/crop byte identity,
deterministic rerenders and source-identity rejection; wrong pre-FX faders differ
by maximum `0.0288953` to `0.0290159`.

The real Host cases use mono WAV, audible AAC MP4 and silent MP4, with a 0.4 s
source, 0.1 s source trim and 1.6 s clip. Audible complete/cropped PCM matches the
independent expected SHA-256 exactly, with zero maximum/RMS error. The 10,143-frame
crop begins at sample 27,783 and equals the full-output slice. Silent video
returns `hasAudio=false`, editor `null` and a zero crop. Each case performs two
editor loads with one cached full render, one crop and one stale-identity
rejection. These are genuine encoded videos, not WAV bodies relabeled as MP4.

The EOF experiment compares current bounded source materialization against an
independently oversized virtual source. It covers six consecutive whole-sample
residues at fraction `.4999` and one `.5001` control; all seven pass exactly.
It does not enable fractional source trim or claim exhaustive floating-point
equivalence for every rate curve.

The tested private artifact is `web-title-riff-rect-nhvakA`, WASM SHA-256
`57b1a4b0975091d8c2efd5e0a390915c31e2d3d6483b057fd50b61fdbacd747e`.
Relevant Rust source was frozen before its build and unchanged during acceptance.
The seven-file implementation hash captured during acceptance is
`0cdaac8a3ec5bd2dbb926f3d5c2dce3ee79c15a855b51ceac3fc5696e9e83c56`.
Its ordered inputs under `rust/crates/editor-api/src/programmatic_audio/graph/`
are `rate_loop.rs`, `rate_prepare.rs`, `rate_clock.rs`, `rate_lane.rs`,
`execution.rs`, `working_set.rs`, `mod.rs`; the hash concatenates each repository
relative slash path, NUL, exact file bytes and NUL.
No build-time source-hash manifest was retained, so source/artifact provenance
here combines coordination records with actual plan/PCM checks; it is not a
cryptographic reproducible-build claim. No shared dependency, installed plugin
or Electron process was replaced.

Entry points: `rate_loop.rs`, `hyperframes-rate-loop-source.ts`, and the
`hyperframes-variable-rate-loop-{oracle,production,host,boundary}` fixtures
(the latter three use `.test.ts`). Native Rust loop geometry/budget and graph
tests, scoped TypeScript and explicit recommended-rule lint checks also pass.
Continuous MediaElement audio equivalence, installed UI/Electron transport and
encoded variable-loop/full-MV export remain outside this acceptance.

### Fractional-phase oracle checkpoint (2026-10-09; not enabled in production)

The independent `script/fixtures/hyperframes-fractional-phase-oracle.test.ts`
now passes two tests and 66 assertions against pinned 0.8.139 native code.
Ten source-rate/boundary cases invoke the original preparation 80 times, retaining
its actual output lengths rather than padding away fractional duration behavior.
Reports are `rocut-hf-fractional-phase-c7w7hL/verification.json` (SHA-256
`0c11c50a8d17f527cd23770e7b6af921bf8c1ad058dcb6006c0adc8691c9d1fa`)
and `rocut-hf-fractional-placement-XdoLaU/verification.json` (SHA-256
`e5345c38ed64f37bc17403129b40c0277ff43b57b954aba7a3fec6818b0ce8d3`)
under the local temporary directory.

The original preparation passes unrounded trim, duration and source-clock values
to FFmpeg; only ramp filter slice times use its six-decimal formatting. Separate
negative controls detect premature trim rounding (maximum PCM error 0.651978),
duration rounding (0.805298), and crop-first preparation even with the corrected
source clock and shifted lane (0.737091). Some fractional inputs are equivalent
after decoding; the oracle retains those cases and does not claim every fractional
input changes PCM. A quarter-sample duration offset across 0.5 seconds also changes
the original slice count. The same requested fractional duration can produce
different actual frame counts for 48 kHz versus 44.1 kHz sources.

The original exporter's integer-millisecond placement is confirmed using real
PCM, but is not a replacement for Rocut's intended graph placement phase. Four
original runtime loop-clock cases preserve fractional source periods; rounding
the period causes accumulated clock drift. These use IO-only element stubs and
do not establish fractional-loop PCM equivalence.

No production admission gate changes in this checkpoint. The next bounded slice
is nonloop variable-rate fractional source trim while retaining full-history
preparation. Fractional duration needs distinct capacity, semantic duration and
actual PCM geometry; fractional clip placement and loop periods remain separate
requirements. Neither arbitrary rounding nor crop-first processing is an
acceptable substitute for those semantics.

### Nonloop fractional source-trim acceptance (2026-10-09)

The next bounded slice is now accepted: nonloop variable-rate `mediaStart`
preserves its fractional value and original JavaScript string formatting, while
preparation and stateful FX retain full-clip history before the final crop.
At that checkpoint, duration, placement and loop alignment restrictions remained
unchanged. Host production transport was not modified.

The private `web-scene-transition-KpO0zH` build passes 22 parameter recipes,
six remaining-gate negatives, eight real-source PCM cases at 48/44.1 kHz and
two saturate-plus-delay graph cases. PCM maximum/RMS errors are zero; cropped
output is byte-identical to the full slice and rerenders are deterministic.
Premature trim rounding and pre-FX gain controls produce measurable errors.

Fourteen tiny-trim IO cases retain both successes and original failures.
Zero, `1e-6` and its upper neighbor succeed at both graph rates with exact PCM.
The original FFmpeg rejects `5e-324`, `1e-12`, `1e-7` and the lower neighbor of
`1e-6`; Host also exits 1 for all eight cases, without replacing them with silence.
These rejected exponent-form inputs are not claimed as supported audio.

Reports, hashes, native checks and remaining scope are recorded in
[fractional trim evidence](evidence/hyperframes-fractional-trim.json).
That trim-only checkpoint did not establish fractional duration/start/loop support,
browser author-collection acceptance, installed Electron or full-song export acceptance.

### Nonloop fractional-duration acceptance (2026-10-09)

The next bounded slice preserves nonloop variable-rate fractional duration through
original native preparation, graph-rate conversion, complete track FX and final
mix/crop. It does not round the authored duration or force decoded PCM to its
declared coverage. The existing floating-point alignment tolerance is unchanged;
aligned clips and the separately characterized source-loop path retain their
previous geometry contract.

Rust now admits conservative native/graph PCM capacities before decoder IO. For a
participating measured-duration source, actual `frames`, `pcmBytes` and track
`fxStage` are initially `null`; PCM/assembly kernels cannot execute that pending
plan. Host retains the immutable, SHA-256-checked original source and runs native
stereo PCM16/48 kHz preparation followed by an **unpadded, untrimmed** graph-rate
conversion. It reports actual native and graph frame counts, bound to the source
identity and exact Rust-generated clip/preparation key. Rust rejects missing,
duplicate, stale, foreign, inert or over-capacity observations before resolving
actual FX geometry. Host does not accept caller-prefilled decoder observations.

The full capacity-based working-set and final observation-payload checks precede
IO; muted tracks, small crops and empty results cannot bypass full-history
reservations. FX retains
the entire actual prepared clip, including samples beyond canonical composition
coverage; only final mixing applies placement/cropping. Post-FX buffers are
validated against actual output length, separately from their capacity bound.

The same authored duration `0.5 + 0.25 / 48000` retains this observed difference:

| Original source rate | Native prepared frames | Graph rate | Actual graph frames | Graph capacity |
| -------------------- | ---------------------- | ---------- | ------------------- | -------------- |
| 48 kHz               | 24,000                 | 48 kHz     | 24,000              | 24,003         |
| 48 kHz               | 24,000                 | 44.1 kHz   | 22,050              | 22,053         |
| 44.1 kHz             | 24,001                 | 48 kHz     | 24,001              | 24,003         |
| 44.1 kHz             | 24,001                 | 44.1 kHz   | 22,051              | 22,053         |

Private build `web-scene-transition-1ST2Rf` passes 12 independent real-source PCM
cases and four saturate-plus-delay graph cases at both graph rates. Maximum/RMS
errors are zero, crops are byte-identical and repeated renders are deterministic.
Rounding duration before preparation produces maximum errors 0.805298 and 0.736816;
pre-FX gain is also an observable wrong-order control. Existing aligned, loop and
fractional-trim production regressions pass on the same binary.

Real tiny-duration IO distinguishes successful emptiness from failure. For the
tested rate-2 lane, original preparation at `1e-6` and `1e-5` seconds succeeds with
zero native frames; graph conversion at 48/44.1 kHz also returns zero. Four real
Host/Rust/native-FX runs preserve zero input/output and **no FX tail**, while
retaining the pre-IO capacity and required fader history. Independent invocation
of the unchanged native FX root returns its original two empty channel arrays.
At `1e-7` seconds, the original source-span argument uses exponential notation
and FFmpeg rejects it; Host likewise exits 1 at both rates, without silent fallback.

Retained failed checks are not reported as passing runs: an initial Rust wrapper
needed an explicit `Result<ExecutionPlan, String>` type; one test incorrectly
hardcoded `0.10000520833333334`. V8 `String(0.1 + 0.25 / 48000)` actually produces
`0.10000520833333335`, with bits `0x3fb999f0fb38a94e`, matching production. The
test now checks original fixture, serde JSON roundtrip and recipe bits against
that independent golden value; all eight duration tests pass. A loop regression
invocation missing `ROCUT_TEST_LOOP_EVIDENCE` was corrected and rerun alone.

Exact reports, hashes, failed-run provenance and commands are recorded in
[fractional duration evidence](evidence/hyperframes-fractional-duration.json).
Fractional clip start, scalar fractional duration/trim, fractional loop
trim/period/duration and participating fallback gain histories remain unsupported.
The new duration slice is validated with trusted graph declarations and real WAV
sources, not browser author collection, installed Electron, encoded video or
full-song/full-MV export acceptance.
