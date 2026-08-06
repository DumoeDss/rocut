## ADDED Requirements

### Requirement: Lifecycle transitions are serialized and disposal wins permanently
The session SHALL serialize `suspend`, `resume`, and `dispose` transitions, publish a transition's
closed-admission state before its first asynchronous yield, and return one stable disposal outcome
to every concurrent or repeated disposer. No transition SHALL resurrect a disposed generation.

#### Scenario: Concurrent disposal joins one teardown
- **WHEN** two callers dispose the same live session concurrently
- **THEN** they observe the same teardown promise and every owned resource is released at most once

#### Scenario: Dispose wins over a queued resume
- **WHEN** resume and dispose race after a session has been suspended
- **THEN** disposal closes admission permanently and resume cannot reopen managers, acquire a resource, or publish state

#### Scenario: Repeated suspend and resume are idempotent
- **WHEN** suspend is called on an already suspended session or resume is called on a non-suspended live session
- **THEN** the call completes without duplicating cleanup, subscriptions, timers, Workers, or runtime ownership

#### Scenario: Host replacement cannot publish from a stale generation
- **WHEN** Host generation A is replaced by generation B while A is suspending, resuming, or disposing
- **THEN** A's continuations cannot acquire through, publish into, or release resources owned by B

### Requirement: Suspend is quiescent while retaining session identity
Suspending a session SHALL retain its session identity, project state, durable persistence
coordinator, and mounted root while preventing session-owned activity from continuing. Resume SHALL
restart only the same live session and SHALL reacquire activity resources only on demand.

#### Scenario: Suspend stops active publications
- **WHEN** a mounted session with save, playback, audio, render, and transcription activity is suspended
- **THEN** no timer callback, Worker result, audio scheduling callback, rendered frame, or save publication from the suspended generation is accepted

#### Scenario: Suspend retains non-activity identity
- **WHEN** a mounted session is suspended
- **THEN** its session id, project id, C5 persistence coordinator, live stores, and root handle remain the same and its root remains mounted

#### Scenario: Resume restarts only the owner
- **WHEN** session A is resumed while session B remains live
- **THEN** only A reopens activity admission and B's managers, resources, and publications are unchanged

#### Scenario: Retained resources are not falsely reported released
- **WHEN** an inert object URL or compositor remains owned across suspend because the mounted root retains it
- **THEN** inspection continues to report it live and only its later terminal release increments the released count

### Requirement: Every live resource acquisition crosses the owning session seam
Every production live timer or animation frame, Worker, `AudioContext`, object URL, and compositor SHALL
be acquired through the owning session's `SessionResources` in either editor Host graph. A
generic post-acquisition disposer registry SHALL NOT be an allowed escape hatch.

#### Scenario: The complete editor graph has one acquisition mediator
- **WHEN** the resource boundary scans tracked plus uncommitted source and both emitted Host graphs
- **THEN** every live acquisition resolves through the one session mediator or an exact documented Host/test/shell classification

#### Scenario: Direct acquisition fails mechanically
- **WHEN** a direct timer, Worker, live audio context, object URL, default compositor, or second mediator is introduced in an editor-runtime fixture
- **THEN** the boundary command exits non-zero and names the exact rule and path

#### Scenario: Empty or truncated scanning cannot pass
- **WHEN** either Host root, the session factory, or an expected resource-owning area is missing from the scanned inventory
- **THEN** the boundary command exits non-zero rather than reporting a vacuous clean result

#### Scenario: Operation-bounded offline rendering is classified
- **WHEN** an `OfflineAudioContext` is used for finite resampling or mastering
- **THEN** it remains local to one awaited operation, associated media inputs are disposed in `finally`, and storing or exporting the context fails the ownership gate

### Requirement: Session timers are cancelled and cannot publish after quiescence
Timeouts, intervals, and animation frames owned by editor managers, hooks, and services SHALL use
tracked timer handles. A fired one-shot SHALL self-release; explicit cancellation, suspend, unmount
cleanup, and disposal SHALL be idempotent.

#### Scenario: A fired timeout self-releases
- **WHEN** a tracked timeout fires before disposal
- **THEN** it is counted created and released exactly once and disposal does not release it again

#### Scenario: Suspend cancels activity timers
- **WHEN** save, playback, renderer polling, or UI activity timers are live at suspend
- **THEN** their handles are cancelled before the suspended state can accept a callback and resume creates only the timers it needs

#### Scenario: Disposal cancels every remaining timer kind
- **WHEN** a session owns a timeout, interval, and animation frame at disposal
- **THEN** all three reach terminal cancellation, no callback publishes afterward, and the timer report has positive created and equal released counts

### Requirement: Worker lifetime is session-owned and pending work settles
Every editor Worker SHALL be created by the Host through the requesting session's resource seam.
Suspend or disposal SHALL terminate activity-bound Workers, remove their listeners, and settle each
pending initialization or request exactly once.

#### Scenario: Transcription Worker stops on suspend
- **WHEN** transcription initialization or a request is pending while its session suspends
- **THEN** the Worker is terminated, listeners are removed, and the pending promise rejects once with a lifecycle reason

#### Scenario: Resume creates a fresh Worker generation
- **WHEN** the suspended session resumes and requests transcription again
- **THEN** it obtains a newly tracked Worker and no message from the terminated generation can settle the new request

#### Scenario: Disposal observes platform termination
- **WHEN** a real local module Worker has exchanged a message and the session is disposed
- **THEN** the Worker is counted CREATED before release is checked, the platform observer reports it terminated with zero listeners, and created equals released

### Requirement: Live audio contexts are owned, awaited, and generation-safe
Every live `AudioContext` used by playback, decode, waveform, sounds, or export preparation SHALL be
obtained through the owning session. Finite callers SHALL close in `finally`; disposal SHALL await
closure and SHALL NOT count a rejected close as released.

#### Scenario: Audio decode closes its finite context
- **WHEN** audio decode succeeds, fails, or is cancelled
- **THEN** its tracked context close is awaited in `finally` and no decode continuation publishes after session quiescence

#### Scenario: Audio playback quiesces and resumes
- **WHEN** a playing session is suspended and later resumed
- **THEN** scheduling and nodes stop while suspended and resume uses only the same session's live or newly acquired context

#### Scenario: Disposal waits for terminal closed state
- **WHEN** an audio close is delayed
- **THEN** session disposal remains pending, released does not increment early, and completion reports the platform context closed

#### Scenario: Rejected close is not clean release
- **WHEN** an audio handle's close rejects
- **THEN** later resources are still attempted, disposal rejects with the attributed failure, and audio created remains greater than audio released

### Requirement: Object URLs have explicit session ownership
Every editor-created object URL SHALL retain a session-owned handle until it is revoked. Early
revocation and disposal SHALL be idempotent, and a bare URL string SHALL NOT be the sole ownership
record for media, thumbnails, processing, undo, downloads, or cached preview state.

#### Scenario: Loaded media retains its URL owner
- **WHEN** a persisted attachment becomes a live media asset
- **THEN** the owning session retains its object-URL handle while exposing only the opaque URL string to render callers

#### Scenario: Replacement and removal revoke once
- **WHEN** an asset URL is replaced, removed, undone/redone, or its project is switched
- **THEN** the corresponding prior handle is revoked exactly once without affecting another session's URL

#### Scenario: Transient processing revokes on every exit
- **WHEN** image, video, SVG, export, or download processing succeeds, fails, or is cancelled
- **THEN** each transient object-URL handle is revoked in the operation's terminal path

#### Scenario: Disposal drains retained URLs
- **WHEN** a session with retained media and preview URLs is disposed
- **THEN** every URL was counted CREATED before release is asserted, all platform URL handles are revoked, and the object-URL residual is zero

### Requirement: Resource-holding caches and services have deterministic owners
Video, waveform, effect-preview, transcription, audio, renderer, and media resource holders SHALL be
owned by one session or by an explicit reference-counted resolver lease with a deterministic final
disposer. Immortal mutable module instances SHALL NOT retain live resource state.

#### Scenario: Two sessions do not share live cache identity
- **WHEN** two sessions load media with equal logical keys
- **THEN** their live media inputs, waveform promises, cancellation generations, and object-URL handles are distinct

#### Scenario: Project replacement drains prior live state
- **WHEN** one session replaces or clears its current project
- **THEN** prior media inputs, waveform work, preview sources, transcription work, and URLs are cancelled or disposed without clearing C5 durable data

#### Scenario: Session disposal drains every service owner
- **WHEN** a session is disposed after exercising video, waveform, effect preview, transcription, audio, and renderer paths
- **THEN** every service disposer is attempted before weak owner indexes are removed and no service can publish afterward

#### Scenario: Shared resolver lease releases only on the final owner
- **WHEN** an implementation retains resolver-scoped preview sharing across two sessions
- **THEN** disposing the first lease preserves the second and disposing the final lease destroys its image/canvas state exactly once

### Requirement: Disposal is an exhaustive asynchronous drain
Disposal SHALL close admission, stop all publishers and service owners, imply unmount, release
remaining resources in reverse acquisition order, reconcile GPU handles while the query is live,
and remove weak owner bindings only after their cleanup has been attempted.

#### Scenario: Reverse acquisition order is terminal order
- **WHEN** dependent resources were acquired in a known order
- **THEN** disposal awaits their terminal releases in reverse order and records that same order

#### Scenario: One failure does not skip later cleanup
- **WHEN** one resource release throws or rejects
- **THEN** every remaining resource, root, service owner, query wrapper, and eligible runtime lease is still attempted

#### Scenario: Multiple failures are preserved
- **WHEN** two or more cleanup owners fail
- **THEN** disposal rejects with an aggregate containing each attributed cause and no failure is replaced by a later one

#### Scenario: Repeated disposal preserves the first outcome
- **WHEN** disposal has fulfilled or rejected and is called again
- **THEN** the later caller observes the same outcome without retrying or double-releasing an owner

#### Scenario: No acquisition occurs after disposal admission closes
- **WHEN** a stale async continuation attempts to acquire after disposal begins
- **THEN** acquisition fails with an actionable disposed-generation error and the resource never enters platform state

### Requirement: Shared GPU teardown is owned by the final runtime lease
Each session SHALL release and reconcile only its exact nonzero compositor handle. A serialized
process lease SHALL invoke C0b's shared `disposeGpu()` exactly when the final runtime owner leaves
and every compositor handle is gone; it SHALL never let one session invalidate another.

#### Scenario: First of two owners releases only its compositor
- **WHEN** sessions A and B own distinct live compositor handles and A disposes
- **THEN** A's handle disappears exactly once, B's handle remains live and renderable, and shared GPU teardown is not called

#### Scenario: Final owner tears down shared state
- **WHEN** B is the final owner and its exact handle has been released
- **THEN** the live-handle query is empty before one `disposeGpu()` call, selected backend becomes `null`, and B reports no GPU residual

#### Scenario: Live handles prevent a false final release
- **WHEN** final-owner teardown observes any tracked, leaked, or untracked live handle
- **THEN** teardown refuses, disposal is non-clean with the handles named, and the runtime is not reported released

#### Scenario: Concurrent owner release calls one teardown
- **WHEN** the final two lease releases race
- **THEN** lease accounting is serialized, never drops below zero, and exactly one caller invokes shared teardown after both handles are gone

#### Scenario: A fresh generation can initialize after final teardown
- **WHEN** all owners have disposed successfully and a new session prepares the runtime
- **THEN** GPU initialization creates a new valid generation with a non-null backend when the environment supports one

#### Scenario: Runtime query wrappers outlive session reconciliation
- **WHEN** a Host generation is cancelled during session creation or disposal
- **THEN** its GPU query wrapper remains callable until the session has drained and is freed exactly once afterward

### Requirement: The multi-cycle leak oracle proves all five classes non-vacuously
A shared browser oracle SHALL run no fewer than six complete lifecycle cycles, record per-cycle
created/released/residual observations for all five classes, and assess monotonic residual growth.
It SHALL reject a run before release assertions if any class was not CREATED.

#### Scenario: Every ordinary cycle creates all five classes
- **WHEN** the ordinary harness mounts and exercises one cycle
- **THEN** timer, Worker, audio-context, object-URL, and GPU observations each have `created > 0` before disposal begins

#### Scenario: Every ordinary cycle has zero exact residuals
- **WHEN** an ordinary cycle finishes disposal
- **THEN** each class has created equal to released, every platform observer is terminal, GPU reconciliation is empty, and each exact residual is zero

#### Scenario: Residual growth is assessed across cycles
- **WHEN** all six or more cycles complete
- **THEN** the report emits each class's residual series and explicitly reports that no series grows monotonically

#### Scenario: Missing creation fails before release proof
- **WHEN** one class is omitted or its created observation is forced to zero
- **THEN** the same evaluator returns non-clean and does not accept `0 released` as evidence for that class

#### Scenario: Deliberate leakage is caught by the same evaluator
- **WHEN** the otherwise identical negative-control run fault-injects a platform resource that remains live after its disposer is invoked
- **THEN** the evaluator returns non-clean/non-zero, names the class and cycle, and cannot be made green by the session's attempted-release counter

### Requirement: Vite and Next produce independent production-shaped disposal evidence
The complete positive and negative-control oracle SHALL run against fresh, uniquely marked Vite and
Next production artifacts through their real C5-composed Hosts. Neither Host result SHALL substitute
for the other or inherit an in-memory production fallback.

#### Scenario: Fresh Vite evidence is attributable
- **WHEN** the Vite disposal run executes
- **THEN** its report records the expected unique marker/base, owned server identity, six-cycle results, negative-control detection, and clean process/port teardown

#### Scenario: Fresh Next evidence is attributable
- **WHEN** the Next disposal run executes
- **THEN** its report records the expected unique marker/base, owned standalone server identity, six-cycle results, negative-control detection, and clean process/port teardown

#### Scenario: Host fallback cannot pass
- **WHEN** either production composition omits its C4 runtime roles or C5 browser store and falls back to an in-memory/default role
- **THEN** Host composition or the disposal harness fails before accepting lifecycle evidence

#### Scenario: Supplemental process metrics cannot override exact leakage
- **WHEN** heap or listener metrics are flat but any exact timer, Worker, audio, URL, or GPU observer remains live
- **THEN** the run fails and records the noisy metrics only as supplemental diagnostics

### Requirement: C3, C4, and C5 invariants remain protected
C6 SHALL preserve per-session state/renderer ownership, Host asset/runtime-resource composition,
forced-none degradation, and C5's durable storage topology and opaque round trip. Disposal SHALL
remove only live/transient ownership and SHALL NOT clear durable user data.

#### Scenario: Disposing one session preserves another session
- **WHEN** two sessions share a durable store and one is suspended or disposed
- **THEN** the other session's stores, renderer, Worker/audio/URL handles, project operations, and committed durable data remain usable

#### Scenario: Durable data survives all session disposal
- **WHEN** every live session using a C5 browser store is disposed and a new session reopens the project
- **THEN** projects, attachments, libraries, provider-private sentinels, and topology journals remain intact

#### Scenario: Forced-none remains allocation-free
- **WHEN** a Host forces no rasterizer after C6
- **THEN** the existing C4 degraded path allocates no compositor, calls no live query, and completes lifecycle cleanup without inventing a GPU creation claim

#### Scenario: Backend capacity behavior remains unchanged
- **WHEN** the existing distinct WebGL and WebGPU C3 jobs run
- **THEN** WebGL still reports/renders one live preview and WebGPU still reports/renders two distinct live previews before exact disposal

### Requirement: Verification preserves inherited oracles and scope boundaries
Delivery SHALL preserve protected public session/port types, parity/type fixtures, Rust/generated
WASM, exact inherited failures, and all existing capability assertions. Every new scenario SHALL be
executed or explicitly reported unverified; an aspirational green SHALL NOT be archived.

#### Scenario: Protected artifacts remain identical
- **WHEN** the final C6 diff is audited
- **THEN** public port/session-type, parity fixture/oracle, type fixture, Rust trees, and generated WASM identities match the recorded base

#### Scenario: Existing regression identity does not grow
- **WHEN** the exact type gate and full Bun suite run
- **THEN** type diagnostics do not exceed the exact three inherited identities and full-suite reds contain no identity beyond the six placement plus two loader failures

#### Scenario: The complete capability corpus is swept both ways
- **WHEN** C6 is ready for review and archive
- **THEN** all 13 current main capability specs are checked for assertions made false and every added C6 scenario is confirmed by execution rather than code reading alone

#### Scenario: C7 and E1 remain out of scope
- **WHEN** the final write set is reviewed
- **THEN** it contains no headless no-React implementation, Elftia adapter/packaging work, React-choice decision, private port, or production-only SDK interface

#### Scenario: Review and delivery stages remain independent
- **WHEN** implementation finishes
- **THEN** a fresh non-author review/fix loop reaches no open Blocker or Major before separate local ship, integration, and archive stages are attempted
