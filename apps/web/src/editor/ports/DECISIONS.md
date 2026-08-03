# Port-shape decisions

Eight decisions about the Host port contract, each with **the measurement or
constraint that forced it** and **the alternative that measurement rules out**.
A decision recorded as a preference is not recorded; if you cannot name what a
choice rules out, it has not been made yet.

Sited here, next to the code, rather than in a root document. Partly so it moves
with what it describes, and partly because this change was authored concurrently
with another that owns the repository's root metadata files — a root-level
document would have enlarged the surface where the two could collide, for no
benefit.

---

## 1. Worker construction — the Host constructs; the editor supplies a request

```ts
createWorker(args: { request: { id, url, type, name? } }): WorkerHandle
```

The editor supplies its bundler-resolved `new URL("./worker.ts", import.meta.url)`
and a stable logical `id`. The **Host** decides what to do with it and returns a
handle. The contract states explicitly that **the URL is a request the Host may
rewrite**: a Host that fetches the script and constructs from a same-origin
`blob:` URL, or serves it from its own origin, is _conforming_, not
working around the contract.

**What forced it.** E0 measured the packaged-Elftia refusal as
`SecurityError … cannot be accessed from origin 'app://bundle'`. That is the
browser's **same-origin rule**, and **no CSP token can fix it** — only the
serving origin can.

**What it rules out.** `createWorker(url): Worker` implemented by the editor, and
`worker: { baseUrl: string }` that the editor resolves against. Both leave
construction inside the editor, where the origin is fixed and, for the one Host
this workstream exists to serve, wrong. Either shape would have frozen the
contract _broken_ — and, because nothing consumes the contract inside this
repository, nobody would have found out until the Elftia spike.

**What it does not claim.** That an Elftia-shaped Host can in fact implement it.
That is measured at E1, against a packaged build. What this change can do, and
does, is make the _failing_ shape inexpressible.

---

## 2. Graphics — the Host declares the environment; the runtime produces the report

```ts
// Host-implemented
EnvironmentCapabilities.describeGraphics():
    { mode: "detect" } | { mode: "force"; rasterizer: "none" }

// Session-exposed, derived from the runtime
session.capabilities.graphics(): Promise<GraphicsCapabilityReport>
    | { rasterizer: "none"; backend: null;               livePreviewLimit: 0; reason; source }
    | { rasterizer: "gpu";  backend: "webgl" | "webgpu"; livePreviewLimit: number;  source }
```

**What forced it.** Two acceptance clauses that a single collapsed member cannot
satisfy at once:

- §3.5 requires a **constructible** no-rasterizer Host, and requires the
  degraded-renderer state to be observed at least once. S01 could never reach a
  configuration that rendered it. Only a Host-side _force_ makes it reachable
  without special hardware — and `RendererManager.setDegraded` already exists to
  receive it, so the no-rasterizer path drives state that is already there rather
  than introducing a parallel one.
- §3.6 requires a report the Host **cannot fake**: the answer must be truthful on
  **both** backends, with the selected backend recorded per run, so that a green
  result cannot come from having silently tested the same backend twice.

**What it rules out.** One member carrying both — e.g. a Host-supplied
`graphics: { backend, livePreviewLimit }`. That satisfies §3.5 and destroys §3.6,
because the thing under test would be supplied by the party being tested.

`source: "host-forced"` exists so a forced report is never mistaken for a
measurement, and a forced declaration **short-circuits the runtime entirely** —
the point of the force is that it works on hardware that would answer
differently.

**Both sides must be able to say "no rasterizer", and they are not
interchangeable.** The Host-side _force_ satisfies §3.5's **constructibility**
clause. The **runtime** side must be able to report it independently, because
§3.6's clause is about **truthfulness**: `selectedBackend()` returns
`GraphicsBackend | null`, and `null` under `{ mode: "detect" }` produces a
`rasterizer: "none"` report carrying `source: "runtime"`.

Without the nullable case the detect branch could only ever emit `"gpu"`, so a
genuinely GPU-less machine would receive a **fabricated** report — silent
degradation, on the one configuration §3.5 fact 3 records as **never having been
tried**. A non-nullable `selectedBackend` was the shape shipped first, and it
made the runtime side structurally incapable of the answer the clause requires.

`source` is derived from a marker on the runtime object itself, not from a
parameter a caller may pass. The parameter form was an escape hatch: any caller
could stamp `"runtime"` onto the placeholder, defeating the marker whose only job
is to stop an un-replaced placeholder from reading as a measurement.

### 2a. `livePreviewLimit` is a count, and the runtime query is declared here first

Per ruling D9=(B): more than one live preview on WebGPU; one on WebGL, where the
wgpu device is bound to a single canvas at device-creation time. Silent
degradation does **not** satisfy the acceptance — _a build that merely happens to
render one preview on WebGL, with no Host-askable answer, fails §3.6._

A **count**, not a flag, because the Host's real question is "how many preview
surfaces may I lay out?", which a boolean cannot answer and cannot grow to
answer.

`RuntimeGraphicsQuery` — the wasm-side query, owned by a later child — is
declared in TypeScript **here**, before its implementation exists, with a
placeholder that reports `livePreviewLimit: 1` and marks itself
`source: "unimplemented"`. The two-sided seam is therefore a **compile-time**
contract: an implementation exporting a boolean fails to build.
`__tests__/runtime-graphics-query.compile-guard.ts` asserts exactly that, in both
directions — every `@ts-expect-error` there also fails the build if it ever stops
being an error.

**What it rules out.** The failure the Slice Plan named when it withdrew the
concurrency edge between this child and the wasm-API child: _"C1 declaring, say, a
preview count while C0b exports a boolean."_

Note the carried risk this shape is designed around: the WebGPU result is one
machine. If typical users sit on integrated or blocklisted GPUs, **WebGL is the
ordinary path**, so the `livePreviewLimit: 1` branch is a first-class outcome,
not an error state.

---

## 3. Disposal — the registry mediates acquisition; it does not collect registrations

```ts
SessionResources.setTimeout / setInterval / requestAnimationFrame;
createWorker / createAudioContext / createObjectUrl;
trackGpuResource;
```

**What forced it.** E0 established that Elftia's `PluginDisposerRegistry` tracks
only disposers somebody explicitly registered, and is therefore blind to all five
of timers, Workers, audio contexts, object URLs and GPU resources.

**What it rules out.** `register(disposer)`. That API **inherits the blindness by
construction**: a forgotten call is invisible, so there is nothing to notice.
Mediating acquisition inverts it — a direct `setTimeout`, `new Worker`,
`new AudioContext` or `URL.createObjectURL` becomes a violation of
`script/check-port-boundary.mjs` rather than a leak.

**The one asymmetry, and what actually closes it.** GPU resources are allocated
_inside the wasm module_, so the session cannot be in their construction path and
no boundary check can scan for a syntactic form. Tracking alone would leave this
class as blind as `PluginDisposerRegistry` — and it is the worst class to be
blind on, being the one the Slice records as **demonstrably created** inside
packaged Elftia and **never measured for release**.

_An earlier version of this record claimed the asymmetry was already closed
because "the tracked id is the teardown's parameter". That was false as
implemented: the id was a session counter (`nextId({scope:"resource:gpuResource"})`)
with no type relating it to anything in the runtime, and `release` was an opaque
`() => void`. Nothing could have produced the claimed compile-time mismatch._

What closes it is **reconciliation**, declared as a type before the
implementation exists — the same move `RuntimeGraphicsQuery` makes:

```ts
RuntimeGpuResourceQuery {
    liveHandles(): readonly GpuHandleId[]
    release(args: { handle: GpuHandleId }): void
}
```

`trackGpuResource({ handle, label })` now takes the **runtime's own key**, and
release goes through the runtime's teardown rather than an opaque callback.
`dispose()` then compares the registry against `liveHandles()` and reports
`untracked` (live in the runtime, never tracked — a forgotten
`trackGpuResource`) and `leaked` (released by the session, still live — a
teardown that did not take). A missed acquisition becomes a _reported
discrepancy_ instead of nothing.

The wasm side is compelled to match:
`__tests__/runtime-graphics-query.compile-guard.ts` asserts that a
boolean-returning `liveHandles` and an unkeyed `release` both fail to compile.

**Ownership.** The session owns disposal; a Host never releases an individual
resource, it calls `dispose()`. `dispose()` is idempotent and releases in reverse
acquisition order.

**Why the report carries `created` as well as `released`.** E0's disposal numbers
were unusable because Workers, audio contexts and object URLs were **never
created** in that measurement — they were _unmeasured, not clean_, and nothing in
the numbers distinguished the two. Reporting both makes the later
"created before asserted released" obligation mechanical. The five classes are
**named fields, not a generic list**, so a class with no entries reads as an
explicit zero rather than as absence.

---

## 4. Migration — owned by the store, invoked once by the session

`ProjectStore` declares `schemaVersion` and an optional `migrate(ctx)`. The
**session** invokes it exactly once during `create`, before any project is
loaded, and surfaces progress through the diagnostics port. "Once" is enforced
per _store_, not per session.

**What forced it.** A migration transforms _persisted_ records, and only the
store knows its own on-disk schema version; a second, non-browser store has
different legacy data or none at all. Separately: migration is now genuinely
live — an inherited-defect repair made the runner actually migrate — and still
**silent**, because progress is reported to a process-global service before any
session exists.

**What it rules out.** _Session-owned_ migration: a second session would re-run
migrations against the same store, or race the first.

**A failed migration fails session creation.** Not "logs and proceeds" — that was
the shape shipped first, and combined with once-per-store memoisation it meant
the editor ran on data the store itself reported as un-migrated, permanently,
with only a diagnostics event. Of the two acceptable contracts, refusing can be
relaxed later without breaking a Host; silently proceeding cannot be tightened
later without breaking one. A failed run is also **evicted from the memo**, so a
later session retries rather than inheriting a poisoned store.

**"Once" memoises the promise, not a flag.** A flag set before the `await` lets a
second concurrent `createEditorSession` on the same store return _while migration
is still running_ — violating "before any project is loaded" in precisely the
two-sessions-in-one-page case the Slice requires. The second caller awaits the
first run.

**`from` is `number | null`, never a copy of `to`.** The store optionally
declares `persistedSchemaVersion()`; when it cannot, `from` is `null` rather than
defaulted to the target. A frozen event field that is structurally incapable of
carrying its meaning is worse than an absent one, and the later child repairing
`MigrationDialog` is the consumer that would have had to render it.

**The consequence a later child depends on.** `MigrationDialog` can only ever
observe a migration once progress stops being global. The session-scoped
diagnostics channel is therefore a **prerequisite** of that repair, not a nicety.
The dialog's own repair belongs to a later child.

The transformer set under `services/storage/migrations/transformers/` stays where
it is: it is browser-store implementation detail, not contract.

---

## 5. Two shapes recorded because a later child will be tempted to widen them

Not decisions this change had to take, but constraints it is spending, and which
a later child could quietly undo.

**`ProjectStore` carries an opaque payload plus a typed summary.** This is not
only the no-schema-types boundary rule. Target State §5.6 requires
provider-private round-trip, and _"storage inversion cannot preserve
provider-private round-trip"_ is a Slice **stop condition** rather than a
deviation. An opaque payload round-trips undeclared fields _by construction_; a
typed one loses them the first time the schema moves. **A later child must not
widen `data` to typed project content to ease its rewiring** — that spends the
stop condition silently. If the split between `ProjectStore` and a separate
media/sound port turns out not to survive contact with the rewiring, that is a
finding to report, not a widening to make.

**`mount()` returns the root handle synchronously.** Readiness is a promise _on_
the handle. Mounting awaits GPU initialisation, so a `Promise<Handle>` would
leave a Host holding **nothing to unmount** during a slow or failed mount — a
more general form of the exact gap E0 hit, where no root handle existed and true
unmount could therefore never be measured at all. Plus: `unmount()` is
idempotent, `dispose()` implies unmount, and a session has **at most one live
root** (mounting a mounted session throws). Preview concurrency is a property of
_sessions_, not of roots, so N roots per session would multiply the graphics
question with no use case behind it.

---

## 6. Why every port role is required on `EditorHost`

The temporary partial form existed while C1 declared ports that production did
not yet construct. C4 supplied the browser asset/resource roles and C5 supplied
the durable browser store in both composition roots, so that scheduling reason
has expired. Keeping a partial form now would preserve a path by which an omitted
store could compile and later look like data loss.

`EditorHost` therefore extends `EditorHostPorts` directly. The protected session
files retain `ResolvedEditorHost` and `resolveEditorHost` as a type alias and
identity function over that already-required shape; they do not narrow, cast,
validate or supply a fallback. Missing roles are compile errors at the Host
construction site, while the in-memory Host factory explicitly supplies the
same complete surface for tests and headless use.

UI consumers still use the deliberately narrow `EditorHostBase` view from
`useEditorHost()`. Runtime consumers receive the complete Host through their
owning session; adding a port React context or another session/factory parameter
would create a parallel dependency path. The role register remains
compile-enforced complete (`Record<PortRole, true>`) for reporting and
conformance membership. `script/check-host-composition.mjs` proves the required
shape and both production final overrides, including negative controls for the
retired optional/resolver paths.

---

## 7. Storage — deepen `ProjectStore`; do not create a private second path

`EditorHost.store` remains the one persistence role. It now carries project
attachments, namespaced durable library records, availability/capacity reports,
typed failures, cancellation and scoped clear operations in addition to opaque
project CRUD. Every value is mechanism-neutral and defensively structured-
cloned; `remove({ id })` cascades to that project's attachments but never to a
different project or to a user-library namespace.

**What forced it.** The C5 preflight found that the C1 project-only shape cannot
express these real production call families:

- media attachment `save`, `load`, `list`, `replace`, single remove and
  project-wide cascade, including opaque metadata and every body byte;
- saved-sound `load`, `save`, `remove`, membership and clear, plus the
  C3-deferred graph-preset `load`, `save`, `remove` and cross-tab replacement;
- support and capacity inspection (`isFullySupported`, `getStorageInfo`,
  `getProjectStorageInfo`, `canStoreFile`, and quota classification); and
- storage-provider project/all clear behavior.

Before C5, those operations escaped through the process-global browser service
or local storage. Packing their values into `ProjectRecord.data` would make every
binary change a whole-project rewrite and force a Host to understand editor
schema. Keeping the singleton would leave persistence outside Host composition.
The risk recorded in decision 5 has therefore materialized; this is an explicit
in-place amendment, not an incidental widening.

**What it rules out.** A `MediaStore`, `StoragePort`, `StorageContext`, an extra
session/factory argument, a hidden Host property, or a singleton escape hatch.
Each would make two owners for persistence and allow the public store to pass
while production data uses an untested private route. The one exported storage
conformance matrix instead exercises the amended role unchanged through adapter
fixtures, including defensive copies, isolation, failures, cancellation,
per-key ordering and opt-in disposable migration.

**Review outcome.** The independent contract review accepted the forcing
inventory and this in-place amendment without requiring the byte-exact C1
surface. Consumer wiring therefore proceeded through this one store role; the
rejected parallel shapes remain prohibited and mechanically checked.

---

## 8. Physical cleanup - authorize topology as well as durable identity

The browser implementation keeps one centralized private topology policy between
authenticated logical plans and IndexedDB/OPFS mutation. Library authority is an
exact `(database, store)` pair; media cleanup owns a whole database and an exact
OPFS root; migration cleanup owns whole databases. The policy reserves the
projects public store plus its cascade, media-ownership, library-clear-binding and
migration-maintenance control pairs, protects current and retained library/media
claims, and returns frozen permits for complete current or historical operation
batches before any logical commit or physical access.

**What forced it.** Attempt 3 proved exact durable identity and certificate
authenticity, but those proofs still allowed a certified media database to equal
the projects or library database, a migration stage or legacy target to alias a
live database, a library pair to alias a project control store, and two logical
media owners to name the same database or OPFS root. Exact identity answers
"is this the tuple that was recorded?"; it does not answer "what else would this
whole-database or recursive-root mutation destroy?". The observed mutation
granularity made a second, centralized topology proof mandatory.

Current media access and remove/clear plans preflight before owner registration,
descriptor/certificate writes, project deletion, tombstone/journal commit, store
clear, or browser-storage I/O. Migration preauthorizes the complete candidate
batch, including possible v1 transformer source databases, before transformer
I/O, staging or intent writes. Transformer sources are frozen read/transform
claims, not cleanup delete authority. Historical cascade and migration journals
receive the same full-batch check: one conflict runs zero targets and retains the
exact journal without shrink or rewrite. Failures cross the public store only as
generic mechanism-neutral unavailability; maintenance uses a fixed nonretryable
topology phase without physical identities or private payload details.

**What it rules out.** Target-local comparisons, which can protect a new path
while missing historical retry or a later target in the same batch; making media
cleanup store-scoped, which would change cleanup semantics and still leave OPFS
and migration aliases; a second public storage/topology port; and a new durable
global topology registry with its own schema, migration and control-store
ownership. This policy remains a browser-store implementation detail because no
Host-neutral caller needs physical database, object-store or directory concepts,
and the existing current/retained ownership records contain the claims needed by
this boundary.

**What it does not claim.** It does not reject every shared database: a library
store may share the projects database when its store is distinct from all five
reserved project/control stores. It does not identify arbitrary unregistered
same-origin OPFS owners, widen `ProjectStore`, revise persisted journal formats,
or automatically remap an intrinsically unsafe historical journal. Such a
journal remains unavailable and may continue to block same-project save until an
explicit audited repair exists; a topology-safe same-owner exact retry remains
permitted and idempotent.
