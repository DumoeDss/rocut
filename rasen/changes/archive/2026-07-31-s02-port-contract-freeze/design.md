## Context

At `main@49f8a88a` the editor's host seam is `apps/web/src/editor/host/editor-host.ts`: an
`EditorHost` carrying `projectId`, `navigation`, `services`, `branding` and `links`, read through
`editor-host-context.tsx` by five narrow hooks. Its header says what it is and what it is not — *"This
is deliberately **not** a Host port contract… Storage, media and clock ports are a later concern;
when they arrive they widen this one interface rather than scattering new props."* This change is
that widening, and it makes no other change.

The surfaces it must anticipate, measured rather than assumed:

- `EditorCore` (`apps/web/src/core/index.ts`) is a private-constructor singleton with
  `getInstance()` / `reset()`, twelve managers constructed in its constructor, plus
  `registerDefaultEffects()` / `registerDefaultMasks()` / `registerTranscriptionDiagnostics()` and
  `save.start()` called there. C2 replaces it; C1 only has to make its replacement expressible.
- `useEditor()` with no selector subscribes with `subscribeNone`
  (`apps/web/src/editor/use-editor.ts:19,72`) — a consumer that reads once at mount and never
  re-renders. C3 repairs it; C1 must not make the shape re-expressible through the session type.
- Exactly **one** `new Worker(...)` site exists: `apps/web/src/services/transcription/service.ts:114`,
  `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })`.
- Ten `URL.createObjectURL` sites exist in `apps/web/src`.
- `storageService` (`services/storage/service.ts`) exposes ~25 async methods spanning projects,
  media assets, saved sounds, quota and support probes. `BrowserHostAdapter` is a thin facade over
  it, labelled *"PROVISIONAL — NOT A HOST PORT CONTRACT. SUPERSEDED IN S02."*
- `RendererManager` already carries `isDegraded` / `setDegraded`, and
  `apps/web/src/editor/surface/editor-root.tsx` already renders the degraded-renderer banner. The
  state exists; what does not exist is a way for a Host to *cause* it.

Two E0 measurements are load-bearing and constrain the shape rather than merely informing it:
the packaged-Elftia Worker refusal is the **same-origin rule** and no CSP token can fix it; and
**no root handle exists**, which is precisely why true unmount could never be measured.

## Goals / Non-Goals

**Goals:**

- One coherent port surface, widening `EditorHost`, covering the Target State §5.5 roles.
- A Session lifecycle whose `mount` returns a **root handle**, so unmount is callable by a Host.
- Five decisions taken and recorded — Worker expression, root handle, graphics negotiation
  (including no-rasterizer *and* preview concurrency), disposal ownership, migration ownership.
- An in-memory reference implementation of every port, and a conformance suite green against it.
- A mechanically enforced leak rule: no port signature exposes an OpenCut schema type, a command
  class, a Zustand store, an IndexedDB name or an OPFS path.
- Both Hosts build and pass parity **unchanged**.

**Non-Goals:**

- Wiring anything. `EditorCore.getInstance()` stays; no manager, command, store or service body is
  touched; no `storageService` importer is rewired; no build config changes.
- Deciding **D2** (React 18 shared import map vs isolated React 19). The contract is deliberately
  React-version-agnostic and must stay so — D2 gates S04 and E1's rebuild, not this Slice, and it is
  deferred *by design*, not by omission.
- Any public transaction, revision, idempotency-key or draft concept. If the contract turns out to
  need one to be coherent, that is **S03 leaking in** and a stop condition — bring the boundary back
  to Direction rather than absorbing it.
- Retiring `BrowserHostAdapter` (C5), repairing the subscription seam (C3), repairing
  `MigrationDialog` (C3), or authoring any Rust API (C0b).

## Decisions

### D1 — The port surface widens `EditorHost`; it does not sit beside it

`EditorHost` gains one member per port role, and the existing `navigation` / `services` / `branding`
/ `links` members are preserved **verbatim** so both Hosts keep compiling and
`host-service-boundary`'s existing scenarios keep passing unchanged. The port types themselves live
in a new `apps/web/src/editor/ports/` module with a single entry point; `EditorHost` composes them.

*Why not a second object.* Six independently evolving props is the outcome spec §3.3 explicitly
rules out, and the file's own header already committed against it. One surface also gives the
boundary check (D6) a single thing to assert on.

`NavigationHost` is **not** a new port: `EditorHostNavigation` already is one. It is renamed in the
role table and left structurally identical, so no Host code changes.

### D2 — Worker: the port **returns a constructed Worker**; it never merely receives a URL

```
createWorker(request: { id: WorkerId; url: URL; type: "module" | "classic"; name?: string })
    : WorkerHandle
```

The editor supplies its bundler-resolved `new URL("./worker.ts", import.meta.url)` and a stable
logical `id`. The **Host** decides what to do with it and returns the handle. A browser Host does
`new Worker(url, { type })`. An Elftia-shaped Host, whose renderer origin is `app://bundle`, may
fetch the script and construct from a same-origin `blob:` URL, or serve it from its own origin —
and the contract states explicitly that **the URL the editor passes is a request, not a
guarantee**, so a Host rewriting it is conforming behaviour rather than a workaround.

*Why this shape and not `worker: { baseUrl: string }` or `createWorker(url): Worker`.* E0 measured
that the refusal is the same-origin rule and that **no CSP token can fix it**. A port that accepts a
URL and constructs the Worker itself, or that takes a base URL the editor then resolves against,
leaves construction inside the editor — where the origin is fixed and wrong. Freezing that shape
would freeze the contract broken for the one Host the workstream exists to serve, and it would not
be discovered until E1.

`WorkerHandle` carries `terminate()` and is **acquired through the session's resource registry**
(D5), so a Worker cannot exist outside the registry's view. The editor calling `new Worker` directly
becomes a boundary-check violation (D6).

### D3 — `mount` returns the root handle **synchronously**; readiness is a promise on the handle

```
mount(target: Element): EditorSessionRootHandle
EditorSessionRootHandle {
    readonly sessionId: SessionId
    readonly container: Element
    readonly ready: Promise<void>
    unmount(): Promise<void>
    readonly state: "mounting" | "mounted" | "unmounting" | "unmounted"
}
```

*Why synchronous.* Mounting awaits GPU initialisation, which is exactly the slow path
`runtime-asset-delivery` already requires a loading state for. If `mount` returned
`Promise<Handle>`, a Host whose mount never resolves would hold **nothing to unmount** — which is a
more general form of the precise failure E0 hit. Returning the handle first makes unmount callable
at every instant of the lifecycle, including during a failed mount.

Further rulings, taken here rather than deferred:

- `unmount()` is **idempotent**; a second call resolves without error. A Host racing an unmount
  against a route change is the ordinary case, not an error case.
- `dispose()` on the session implies unmount of a live root; a Host is never required to sequence
  them.
- **One live root per session.** Mounting a mounted session throws. Preview concurrency is a
  property of *sessions*, not of roots, so allowing N roots per session would multiply the graphics
  question (D4) with no use case behind it. S04 may revisit this; S02 does not.

### D4 — Graphics: the **Host declares the environment, the runtime produces the report**

This is the decision most likely to be got wrong by collapsing two different things into one member.

```
// Host-implemented port — what the Host knows or wants to force.
EnvironmentCapabilities {
    describeGraphics(): { mode: "detect" } | { mode: "force"; rasterizer: "none" }
    ...
}

// Session-exposed truth — derived from the runtime, never asserted by the Host.
session.capabilities.graphics(): Promise<GraphicsCapabilityReport>

GraphicsCapabilityReport =
  | { rasterizer: "none";   backend: null;              livePreviewLimit: 0; reason: string }
  | { rasterizer: "gpu";    backend: "webgl" | "webgpu"; livePreviewLimit: number }
```

Three things this split buys, each tied to a clause it satisfies:

1. **A no-rasterizer Host is constructible without special hardware.** §3.5 requires exactly that,
   and requires the `DegradedRendererBanner` — which S01 could never reach a configuration to render
   — to be observed at least once. `{ mode: "force", rasterizer: "none" }` makes it reachable in a
   test, and `RendererManager.setDegraded` already exists to receive it.
2. **The Host cannot lie about the backend, and the runtime cannot be silently believed either.**
   `livePreviewLimit` is only ever produced by the report. §3.6 requires a test proving the answer
   truthful **on both backends** with the selected backend recorded per run, so a green cannot come
   from having silently tested the same backend twice — `backend` is in the report for that reason
   and not for display.
3. **`livePreviewLimit` is a count, not a boolean.** The Slice Plan names the exact failure mode it
   feared for this seam: *"C1 declaring, say, a preview count while C0b exports a boolean."* A count
   is correct because the Host's real question is "how many preview surfaces may I lay out?", which
   a boolean cannot answer and cannot grow to answer.

**The obligation this places on C0b, stated exactly, because C0b depends on this change for it:**
C0b must export a query that yields (a) the selected backend as an **enumeration**, not a boolean,
and (b) the number of compositor instances that can be driven concurrently on it — from which
`livePreviewLimit` is derived, not guessed. C1 lands the TypeScript-side declaration of that query
plus a temporary implementation that reports `livePreviewLimit: 1` with an explicit
`source: "unimplemented"` marker, so that C0b's export **satisfies a declaration that already
exists** and an incompatible pair fails to compile rather than at runtime.

Per D9=(B): dual preview on WebGPU; on WebGL the runtime **reports** one. Silent degradation does not
satisfy the acceptance — a build that merely happens to run one preview on WebGL, with no
Host-askable answer, fails §3.6. And per the carried generalisation risk: WebGL may well be the
ordinary path rather than the degraded one, so the `livePreviewLimit: 1` branch is designed as a
first-class outcome, not an error state.

### D5 — Disposal: the registry **mediates acquisition**; it does not collect registrations

```
SessionResources {
    setTimeout / setInterval / requestAnimationFrame  -> tracked handles
    createWorker(...)        -> WorkerHandle          (D2)
    createAudioContext(...)  -> AudioContextHandle
    createObjectURL(blob)    -> ObjectUrlHandle
    trackGpuResource(...)    -> GpuResourceHandle     (released via C0b's teardown)
}
```

*Why acquisition-mediated rather than `register(disposer)`.* E0 established that Elftia's
`PluginDisposerRegistry` tracks only disposers that were explicitly registered, and is therefore
blind to all five of timers, Workers, AudioContext, object URLs and GPU resources. A
register-after-the-fact API **inherits that blindness by construction**, because a forgotten call is
invisible. Mediating acquisition inverts it: a direct `setTimeout` / `new AudioContext` /
`URL.createObjectURL` / `new Worker` in editor source becomes a detectable boundary violation (D6),
so the blind spot becomes a check failure instead of a leak.

Ownership rulings:

- **The session owns disposal.** A Host never releases an individual resource; it calls `dispose()`.
- `dispose()` is idempotent, releases in reverse acquisition order, and **returns a report** with
  per-class created and released counts. This is deliberate: E0's disposal numbers were unusable
  because Workers, audio and object URLs were *never created* there, so they were **unmeasured, not
  clean**. A registry that reports "created" alongside "released" makes C6's *"created before
  asserted released"* obligation mechanical rather than something C6 must reconstruct.
- The five classes are **named types, not a generic `Disposable[]`**, so a class with zero entries
  reads as an explicit zero rather than as absence.

### D6 — The leak rule is a check with a negative control, not a review convention

`script/check-port-boundary.mjs` asserts that the ports module's public surface references no
OpenCut schema type, command class or Zustand store, and contains no IndexedDB database name or OPFS
path literal — implemented as an **import allowlist** over the ports module's graph plus a literal
scan (`indexedDB`, `video-editor-`, `navigator.storage`, `getDirectory`). It also asserts the
converse direction that D2 and D5 depend on: no editor-graph module constructs a `Worker`,
`AudioContext` or object URL outside the registry.

A **negative control** is required — a fixture that deliberately violates each rule must be caught.
This follows the repository's established pattern (`check-storage-boundary`, `check-next-imports`,
`check-distributable-boundary` all carry one) and the Slice's standing rule that a green result must
not be vacuous.

### D7 — `ProjectStore` moves an **opaque document plus a typed summary**

```
ProjectRecord  = { id: ProjectId; schemaVersion: number; data: unknown }
ProjectSummary = { id; name; createdAt; updatedAt; thumbnail?: AssetRef }
```

The store never sees an OpenCut schema type. It persists an opaque `data` payload and a small
metadata projection a Host genuinely needs to render a project list —
`storageService.loadAllProjectsMetadata()` already exists for exactly that reason, and
`BrowserHostAdapter.listProjects()` already returns metadata only, with the stated rationale that a
host should not deserialize every scene to render a list.

This is not only the §3.3 boundary rule; it is what protects a **Slice stop condition**. Target
State §5.6 requires provider-private round-trip, and *"storage inversion cannot preserve
provider-private round-trip"* is listed as a stop, not a deviation. An opaque payload round-trips
unknown fields **by construction** — a typed one loses them the first time the schema moves.

### D8 — Migrations are owned by the **`ProjectStore` implementation**, run once by the session

`ProjectStore` declares `schemaVersion` and an optional
`migrate(ctx): Promise<MigrationOutcome>`; the **session** invokes it exactly once during `create`,
before any project load, and surfaces progress through the diagnostics port.

*Why the store and not the session or the editor.* A migration transforms *persisted* records; only
the store knows its own on-disk schema version, and C5's second, non-browser implementation has
different legacy data or none at all. The transformer set
(`services/storage/migrations/transformers/v0-to-v1` … ) stays where it is — it is
browser-store implementation detail, not contract.

*Why the session invokes it rather than a module-scope runner.* Today
`services/storage/migrations/runner.ts` runs against a process-global service before any session
exists, and Track 1's repair made it genuinely migrate — so migration is now **real and still
silent**. Routing progress through a session-scoped diagnostics channel is what later lets
`MigrationDialog` observe it; the dialog's own repair is C3's, but it is unachievable if the
progress channel stays global.

*Rejected: session-owned migration.* A second session would re-run migrations against the same
store, or race the first. The store is the natural once-per-store owner.

### D9 — The decision record is committed **next to the code**, not in a root document

The port-shape decision record required by spec §3.3 lives at
`apps/web/src/editor/ports/DECISIONS.md`, covering Worker construction, graphics negotiation,
disposal ownership and migration ownership. Siting it inside `apps/web/src/editor/` keeps this
change's write set inside its declared boundary during the concurrent window with C0 — a root-level
document would enlarge the surface where a collision could occur for no benefit.

## Risks / Trade-offs

- **The contract is frozen wrong and six children build on it.** → The three shapes most likely to be
  wrong (Worker, root handle, preview concurrency) are each pinned to a *measurement* rather than to
  a preference, and each records the alternative that the measurement rules out. The conformance
  suite is the second line: a shape no second implementation can satisfy fails before anything
  consumes it.
- **A type-only contract that nothing consumes compiles clean and proves nothing.** → This is the
  real hazard of a freeze child. Mitigation: the in-memory reference implementation is a *working*
  implementation, not stubs, and the conformance suite is written to be run by C5's second store and
  by E1 — if a port cannot be implemented twice, it is not a port.
- **The Worker port cannot actually be implemented by an Elftia-shaped Host.** → Not fully
  falsifiable inside `rocut`: E1 is where it is measured against a packaged build. What C1 can do,
  and does, is make the *failing* shape impossible — the editor never constructs the Worker, so the
  origin decision belongs to whoever owns the origin.
- **Scope creep into C2.** → `EditorCore.getInstance()` is untouched and `use-editor.ts` is not in
  the write set. If the contract seems to require editing them, that is the boundary moving and it
  is a stop, not a judgement call.
- **`SOURCE_INVENTORY.md` / `.json` collide with the concurrent C0.** → Real, and reported rather
  than assigned away (see the proposal's Impact section). Both are *generated*; both children
  regenerate correctly on their own branch; the merge is resolved by re-running
  `node script/generate-source-inventory.mjs`, never by hand-merging.
- **Parity moves.** → A change that wires nothing cannot legitimately move parity. Movement means
  something was wired; report it, do not re-baseline.

## Migration Plan

None. Nothing consumes the contract when this change lands, so there is no runtime path to migrate
and rollback is deletion of the new modules plus reverting `editor-host.ts` to its current shape.
That property is the point of a freeze child, and it is also what makes the concurrent edge with C0
safe.

## Open Questions

1. **Does `ExportProvider` belong in S02 at all?** Spec §3.3 lists it among the minimum roles and
   Target State §5.5 names it, but nothing in S02's acceptance exercises export, and S08 owns
   production export. **Resolution taken here**: declare the role and its types so the surface is
   complete and Hosts are not surprised later, implement it in-memory as a no-op that reports
   unsupported, and state in the decision record that its semantics are S08's. Raising it rather
   than silently omitting a Target State role.
2. **Does `IdGenerator` need to be a port, given the editor already generates ids internally?** It is
   in the §5.5 minimum list. Declared, with the reason recorded: deterministic ids are what make a
   headless (C7) and an automation (S03) run reproducible, so a Host that wants determinism needs the
   seam even though no S02 acceptance exercises it.
3. **Which `storageService` methods are `ProjectStore` and which are a separate media/sound port?**
   The service currently spans projects, media assets, saved sounds, quota and support probes — five
   concerns behind one object. C1 splits them in the contract; **whether the split survives contact
   with C5's rewiring is a real open risk**, and C5 is instructed to report a needed reshape as a
   finding rather than quietly widening `ProjectStore`.
