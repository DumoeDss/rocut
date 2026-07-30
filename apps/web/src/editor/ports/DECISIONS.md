# Port-shape decisions

Four decisions about the Host port contract, each with **the measurement or
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
`blob:` URL, or serves it from its own origin, is *conforming*, not
working around the contract.

**What forced it.** E0 measured the packaged-Elftia refusal as
`SecurityError … cannot be accessed from origin 'app://bundle'`. That is the
browser's **same-origin rule**, and **no CSP token can fix it** — only the
serving origin can.

**What it rules out.** `createWorker(url): Worker` implemented by the editor, and
`worker: { baseUrl: string }` that the editor resolves against. Both leave
construction inside the editor, where the origin is fixed and, for the one Host
this workstream exists to serve, wrong. Either shape would have frozen the
contract *broken* — and, because nothing consumes the contract inside this
repository, nobody would have found out until the Elftia spike.

**What it does not claim.** That an Elftia-shaped Host can in fact implement it.
That is measured at E1, against a packaged build. What this change can do, and
does, is make the *failing* shape inexpressible.

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
  configuration that rendered it. Only a Host-side *force* makes it reachable
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
interchangeable.** The Host-side *force* satisfies §3.5's **constructibility**
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
degradation does **not** satisfy the acceptance — *a build that merely happens to
render one preview on WebGL, with no Host-askable answer, fails §3.6.*

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
concurrency edge between this child and the wasm-API child: *"C1 declaring, say, a
preview count while C0b exports a boolean."*

Note the carried risk this shape is designed around: the WebGPU result is one
machine. If typical users sit on integrated or blocklisted GPUs, **WebGL is the
ordinary path**, so the `livePreviewLimit: 1` branch is a first-class outcome,
not an error state.

---

## 3. Disposal — the registry mediates acquisition; it does not collect registrations

```ts
SessionResources.setTimeout / setInterval / requestAnimationFrame
                 createWorker / createAudioContext / createObjectUrl
                 trackGpuResource
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
*inside the wasm module*, so the session cannot be in their construction path and
no boundary check can scan for a syntactic form. Tracking alone would leave this
class as blind as `PluginDisposerRegistry` — and it is the worst class to be
blind on, being the one the Slice records as **demonstrably created** inside
packaged Elftia and **never measured for release**.

*An earlier version of this record claimed the asymmetry was already closed
because "the tracked id is the teardown's parameter". That was false as
implemented: the id was a session counter (`nextId({scope:"resource:gpuResource"})`)
with no type relating it to anything in the runtime, and `release` was an opaque
`() => void`. Nothing could have produced the claimed compile-time mismatch.*

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
teardown that did not take). A missed acquisition becomes a *reported
discrepancy* instead of nothing.

The wasm side is compelled to match:
`__tests__/runtime-graphics-query.compile-guard.ts` asserts that a
boolean-returning `liveHandles` and an unkeyed `release` both fail to compile.

**Ownership.** The session owns disposal; a Host never releases an individual
resource, it calls `dispose()`. `dispose()` is idempotent and releases in reverse
acquisition order.

**Why the report carries `created` as well as `released`.** E0's disposal numbers
were unusable because Workers, audio contexts and object URLs were **never
created** in that measurement — they were *unmeasured, not clean*, and nothing in
the numbers distinguished the two. Reporting both makes the later
"created before asserted released" obligation mechanical. The five classes are
**named fields, not a generic list**, so a class with no entries reads as an
explicit zero rather than as absence.

---

## 4. Migration — owned by the store, invoked once by the session

`ProjectStore` declares `schemaVersion` and an optional `migrate(ctx)`. The
**session** invokes it exactly once during `create`, before any project is
loaded, and surfaces progress through the diagnostics port. "Once" is enforced
per *store*, not per session.

**What forced it.** A migration transforms *persisted* records, and only the
store knows its own on-disk schema version; a second, non-browser store has
different legacy data or none at all. Separately: migration is now genuinely
live — an inherited-defect repair made the runner actually migrate — and still
**silent**, because progress is reported to a process-global service before any
session exists.

**What it rules out.** *Session-owned* migration: a second session would re-run
migrations against the same store, or race the first.

**A failed migration fails session creation.** Not "logs and proceeds" — that was
the shape shipped first, and combined with once-per-store memoisation it meant
the editor ran on data the store itself reported as un-migrated, permanently,
with only a diagnostics event. Of the two acceptable contracts, refusing can be
relaxed later without breaking a Host; silently proceeding cannot be tightened
later without breaking one. A failed run is also **evicted from the memo**, so a
later session retries rather than inheriting a poisoned store.

**"Once" memoises the promise, not a flag.** A flag set before the `await` lets a
second concurrent `createEditorSession` on the same store return *while migration
is still running* — violating "before any project is loaded" in precisely the
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
provider-private round-trip, and *"storage inversion cannot preserve
provider-private round-trip"* is a Slice **stop condition** rather than a
deviation. An opaque payload round-trips undeclared fields *by construction*; a
typed one loses them the first time the schema moves. **A later child must not
widen `data` to typed project content to ease its rewiring** — that spends the
stop condition silently. If the split between `ProjectStore` and a separate
media/sound port turns out not to survive contact with the rewiring, that is a
finding to report, not a widening to make.

**`mount()` returns the root handle synchronously.** Readiness is a promise *on*
the handle. Mounting awaits GPU initialisation, so a `Promise<Handle>` would
leave a Host holding **nothing to unmount** during a slow or failed mount — a
more general form of the exact gap E0 hit, where no root handle existed and true
unmount could therefore never be measured at all. Plus: `unmount()` is
idempotent, `dispose()` implies unmount, and a session has **at most one live
root** (mounting a mounted session throws). Preview concurrency is a property of
*sessions*, not of roots, so N roots per session would multiply the graphics
question with no use case behind it.

---

## 6. Why the port roles are `Partial` on `EditorHost`

**The durable reason — the one that does not expire.** Required members would
force both Host composition roots to construct all eight ports *now*, at a change
whose entire claim is that it wires nothing. That would pull
`editor/ports/**` into the production module graph and **destroy this change's
own central evidence**: the distributable bundle is 2,844 modules / 550 from
`apps/web/src` / **zero contract modules**, byte-for-byte the recorded baseline.
It would also drag storage and asset work — later children's, by design — into
this one, because a Host cannot construct a `ProjectStore` it has not been given
yet.

*A weaker reason was recorded here first: "neither Host's source is in this
change's write set." It is true, but it is a scheduling fact, not a design one —
there are exactly two construction sites, neither owned by the concurrent child,
and the argument **expires at the first child permitted to touch a Host**. A
decision defended by a reason that expires outlives its own justification, which
at a freeze is expensive.*

**Optionality is not softness, and it is guarded three ways.**

1. A session is created only from `ResolvedEditorHost`, where every role is
   required, and `resolveEditorHost()` **throws, naming the missing roles**. It
   never falls back to the in-memory implementation: a Host that forgot storage
   would otherwise run, appear to work, and lose the user's projects on reload —
   a failure that surfaces late and reads as data loss rather than as a missing
   port.
2. **Consumers never see the optional form.** `useEditorHost()` returns
   `EditorHostBase` — the five long-standing members only — so the port roles are
   not merely discouraged through context, they are *not visible* there. Ports
   reach code through the session, which is where later children wire them.

   **Do not add a resolving hook to the host context.** One was written and
   reverted, and the measurement is recorded here so the next contributor does
   not re-derive it: such a hook needs the role register at runtime, which pulls
   `editor/ports/**` into the production module graph — **2,848 modules / 554
   from `apps/web/src` / 3 contract modules**, against a baseline of
   **2,844 / 550 / 0**. It cost this change its central evidence to add an
   accessor with no caller. If a component ever genuinely needs a port before the
   session provides one, that is a signal the session wiring is late, not that
   the context should grow an accessor.
3. The role register is **compile-enforced complete** (`Record<PortRole, true>`),
   so the gate cannot silently narrow as roles are added. Proven both ways in
   `__tests__/port-roles.compile-guard.ts`; the `satisfies readonly PortRole[]`
   form that was here first checked membership only, and accepted an omission
   silently.

**Retirement trigger.** When the first child rewires a Host composition root and
that Host supplies every port, make the roles required on `EditorHost`, delete
`resolveEditorHost`'s throw, and collapse `EditorHost` into `ResolvedEditorHost`.
The condition to check at that point is the one the durable reason names: whether
the ports are by then genuinely consumed at runtime, so that pulling them into
the module graph is a true statement about the build rather than a regression in
it.
