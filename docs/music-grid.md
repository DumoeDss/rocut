# Reviewed music grids

The Rust `editor-api::music_grid` domain owns reviewed source points, clip binding,
source-clock projection, musical candidates and frame quantization. The project
persists `musicGridState` as a complete value through existing `update-project`
transactions, project serialization, revision CAS and compensating undo. It does
not alter Motion Text overrides or the original MV analysis resource.

## Live entry points

`@opencut/editor-classic/editing` exports `isMusicGridAvailable`, `queryMusicGrid`,
`planMusicGridEdit` and `editMusicGrid`. Query/plan accept `{engine, request,
sourceAvailability}`. Edit also needs `engine.apply`; it submits the native batch
through that existing transaction owner. The wrapper captures live project,
tracks, clips, assets and revision on every call, rejects an inconsistent capture,
and checks revision again after the asynchronous source probe. A caller-supplied
projection or cached list of beats cannot be used as live state.

The platform's `sourceAvailability({assetId, sourceSha256})` resolves the current
asset through its own storage/File owner and returns `available`, `unavailable`
or `unknown`. It must verify current accessible bytes and their pin. Metadata or
an old successful probe is insufficient. Missing/unknown probes return unavailable;
removing a grid has no source requirements and remains possible while offline.

The matching native runtime must export `queryMusicGridJson`,
`planMusicGridEditJson` and `validateMusicGridStateJson`. Older WASM returns an
explicit unavailable result. Source implementation and native unit tests do not
mean that a running or packaged WASM artifact has been rebuilt or installed.

## Editing

Requests use the types in `editor-contracts/src/music-grid.ts`:

```ts
await editMusicGrid({
	engine,
	sourceAvailability,
	request: {
		expectedNativeRevision: 12,
		idempotencyKey: "review-song-grid-1",
		operation: {
			kind: "create-manual",
			clipId: "song-clip-instance",
			reviewReference: "review-document@revision-3",
			points: [{ id: "beat-a", sourceTick: 120000 }],
		},
	},
});
```

`create-measured` instead accepts a validated `rocut-mv-audio/1` analysis whose
input hash and duration match the live song source. Its provenance must be
explicitly accepted; downbeats must refer to measured beat positions. Empty
downbeat evidence stays unknown. Grid and binding IDs come from the project
operation identity, not a caller-chosen business ID. `replace-points` is an
explicit manual review, increments grid revision and retains analysis provenance.
`bind` creates another binding to a specific clip instance of the same pinned
source. `remove` removes that grid and its bindings. All three require the
expected grid revision; every edit also requires the native revision.

A mutation plan returns `status: admitted`, `created` IDs when applicable,
`requiredSources` and a normal transaction `batch`. `editMusicGrid` returns
`status: applied` with its durable receipt. Revision/source changes return
conflict; missing ownership or unsupported mappings return unavailable.
The native placement policy is mandatory for transactions containing grid state;
generic hosts cannot silently accept it without the Rust validator.

## Read, list, snap and validate

Every query requires an explicit `bindingId`. Optional `expectedNativeRevision`,
`expectedGridRevision` and `expectedMappingHash` pin a previously reviewed result.
Read/list operate in `scene-timeline-ticks` at 120000 ticks/second and return the
scene ID, source pin, grid/native revisions, current mapping facts and mapping
hash. Ranges are half-open. List supports `pointKind: beat | downbeat`, `offset`
and `limit` (at most 10000). Unknown downbeats produce an empty downbeat list and
`downbeatsKnown: false`, never an inferred four-beat bar.

Snap/validate require caller-keyed `samples: [{key, tick}]` and an explicit
`maxDistanceTicks`. `direction` is `nearest`, `before` or `after`; nearest ties
select the earlier musical point. Results retain input order and caller keys.
`delta = snappedTick - originalTick`. `frameQuantize` selects the point's shared
frame boundary. Tolerance checks both musical distance and the resulting boundary.
No candidate, an empty downbeat set or excessive distance returns an unmatched
item, rather than altering the requested time. These are point constraints;
complete cut-plan coverage/collision validation remains a separate operation.

Each projected point returns exact rational ticks (`exactTick`), the nearest
integer `tick`, `frameTick`, `frameQuantizationDelta = frameTick - tick`, the exact
rational `frameQuantizationResidual`, and `sourceMappingDelta` against the native
source-clock policy. Rational frame rates must have an integer tick step at the
native timebase; ties round earlier. Shared music boundaries should be computed
once and reused by both adjacent shots.

## Mapping and current limits

Each query recomputes trim/start/duration/rate/reverse from the bound live clip.
The native `video_time.rs` directional source clock determines valid endpoints
and the reverse last-source-tick convention. Source positions outside the
half-open playable interval are omitted. Distinct clip instances have distinct
bindings and independently projected points. Freeze frames, rate curves,
nonconstant mappings, invalid source spans and rates requiring more than six
decimal places return unavailable. Exact rational coordinates that cannot be
represented safely by the JSON transport also return unavailable.

The default clock is scene-local. `clock: "project-timeline-ticks"` is supported
only for the main scene, with authoritative offset zero. Native `scenes.rs`
defines scenes by ID, name, main flag and main track; it has no sequence parent,
placement order or offset. Other scene-to-project or nested-sequence requests
return unavailable. The grid does not assert Director-to-Rocut placement.
Creator's retained-media adapter verifies the completed Director job, original
manifest bytes and decoded video frame schedule before exposing its 48000 Hz
scope tick and 120000 Hz asset source tick. This is source-frame provenance,
not a project/global offset; a plain tick ratio cannot replace the frame schedule.

## Meter, pickup and manual BPM

A grid can hold reviewed `meterSegments`, each with a stable `id`,
`sourceStartTick`, exclusive `sourceEndTick`, `meter: {numerator, denominator}`,
`beatUnit: {numerator, denominator}`, `phaseQuarterNotes: {numerator, denominator}`,
optional `barNumber` (zero may label a pickup) and optional `confidence`.
Beat unit is a whole-note rational: eighth-note beats are 1/8 and dotted-quarter
beats are 3/8. Phase is a nonnegative rational in quarter notes at that segment's
source start, strictly below `meter.numerator * 4 / meter.denominator`.
Missing segments or confidence stay unknown. Ranges must be ordered,
nonoverlapping and within the pinned source; meter denominators are powers of
two through 64. Segment boundaries are explicit changes, never inferred from
detected beat spacing.

`replace-structure` requires `gridId`, `expectedGridRevision`,
`meterSegments` and `reviewReference`; it retains source points and analysis
provenance and increments grid revision. It clears an old BPM generator
provenance because the reviewed structure has changed.

`create-manual-bpm` requires `clipId`, `segments` and `reviewReference`.
Each segment has the fields above plus rational `quarterNoteBpm` and mandatory
`interpolation: "step"`. Each range has a constant quarter-note BPM; changes
between segments are explicit steps. Linear or arbitrary tempo curves are
unavailable. The generator uses the declared beat unit, not the meter numerator,
to space beats. Downbeats follow the rational phase modulo the complete bar
length. For example, a 6/8 segment with phase 5/2 quarter notes starts in pickup;
at 120 quarter-note BPM its next eighth-note beat is the downbeat 30000 ticks
later. A 7/8 bar spans 7/2 quarter notes.

Each absolute rational boundary is rounded once to source ticks, with ties
earlier; rounded beat lengths are never accumulated. The original generator
segments are retained as `manualBpmProvenance` and validated against points
and meter segments on every native state validation. `replace-points` is an
explicit manual override and clears generator provenance. All changes use the
same grid state, source pin, revision CAS, save and compensating-undo owner.
The review reference and structure participate in the mapping hash.

## Independent section and lyric anchors

`kind: "project-anchors"` uses the normal binding, clock, range and revision/hash
pins plus `anchorSource: {sourceSha256, resourceSha256, resourceRevision,
reviewReference, anchors: [{key, sourceTick}]}`. The platform adapter must read
and hash the actual reviewed resource; the public transport must not accept
unverified caller snapshots as resources. Native validates the pinned source,
resource identity and keyed source points, then uses the same live clip mapping.
It returns `anchorResource` identity and ordered `results`; projected items
carry `key`, `sourceTick`, `tick`, `exactTick`, `frameTick` and quantization
residuals. Independent anchors accept the closed source range `[0, sourceDurationTick]`
and both playable trim boundaries. Forward end boundaries map to the clip end;
reverse boundaries use the continuous rational span (source end maps to clip start),
without the sample-point one-tick offset. Beat points retain their half-open rules.
An anchor outside the playable closed boundary window is an individual
`status: "unavailable"` with a reason. Duplicate positions are allowed;
duplicate caller keys are rejected. Anchors never enter grid state or change
the independent resource's review intent.

## Proposal section 7 coverage and remaining boundaries

| Requirement                      | Current support                                                                                                                     | Remaining boundary                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Beats/downbeats/free timing      | Reviewed explicit source points, stable IDs, optional downbeat evidence, irregular timings                                          | No inferred average BPM or confidence                                                               |
| 6/8, 7/8, changing meter, pickup | Reviewed rational meter/unit/phase segments, range/identity/confidence, optional bar labels; native validation and revisioned edits | No automatic meter detection or arbitrary curved tempo interpolation                                |
| Manual equal-spacing grid        | Explicit quarter-note BPM, phase, meter, beat unit, effective range and step policy; preserved input provenance                     | No silent conversion of measured grids                                                              |
| Sections/lyrics                  | Independent reviewed resource identity projected through the same source/clip mapping                                               | Adapters own real resource bytes and review; semantic section recognition is not proven by snapping |
| Scene/project clock              | Scene-local plus main-scene project clock at zero offset                                                                            | No authoritative nested/global sequence topology exists in current Native model                     |
| Director clock                   | Creator retained-media adapter verifies manifest/frame provenance and exposes distinct scope/source clocks                         | Native grid does not assert a Rocut placement or global sequence offset                            |
| Cut-plan application             | Shared query and quantization owner available to the cut-plan module                                                                | Coverage, collision and atomic apply are owned by that separate module                              |

Existing artwork, Motion Text overrides and visual clip positions remain
untouched. New musical metadata does not silently migrate old artistic timing.

## Finite cut-plan validation

`editor-api/src/cut_plan.rs` is the shared boundary/coverage validator. The
classic editing wrapper and authenticated `cut-plan/validate` route pass live
Native state and verified source availability; validation itself does not edit
the project. Creator's `validate_cut_plan` / `apply_cut_plan` freeze Author,
grid and Native revisions and derive finite changes to existing media nodes.
Unchanged nodes in the coverage range also participate in collision/gap checks.
Source lengths come from actual pinned media probes. Full-song visual coverage
uses the real audio sample endpoint and explicit tail policy, not a stretched
song or invented source duration.

Author scene/song origin offsets are mapped in Rust. Shared boundaries are
quantized once and mapped back to Author ticks; an offset outside the supported
frame grid is unavailable. Apply recomputes prepared intent. Author atomic edits
and Native application have separate existing receipts and recovery identities;
an unknown acknowledgement never authorizes re-editing over later manual changes.

The real binary gate is `script/check-cut-plan-wasm.mjs --out-dir <private-pkg>`.
It verifies exports and actual shared quantization, sample endpoints, visual
tail, nonzero Author origin and collision/revision guards. Private builds do not
update shared WASM or installed applications.

## Reusable actual WASM check

Build to an explicit private directory with the installed pinned toolchain, then
run the source verification script against that directory:

```sh
node script/build-wasm.mjs --out-dir <absolute-private-directory> --dev --offline
node script/check-music-grid-wasm.mjs --out-dir <absolute-private-directory>
```

The check inspects actual binary exports, loads the generated synchronous JS
binding and asserts create, state validation, list, live clip movement, rate
projection, snap and stale/source conflict behavior. It does not mock native
functions, install packages or modify a running runtime. The generated WASM
package is a local verification artifact, not source to commit or distribute.
