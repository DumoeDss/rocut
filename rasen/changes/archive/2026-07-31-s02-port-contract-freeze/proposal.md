## Why

Everything the rest of S02 does depends on one interface existing first. C2 replaces
`EditorCore.getInstance()` with a factory that takes dependencies; C3 gives each session its own
graphics instance; C4 injects the asset base; C5 inverts storage; C6 disposes sessions; C0b exposes
the wasm query that answers a capability question C1 defines. If two of those children each add
their own slot to the dependency object, they are each authoring part of the same interface while
blind to one another — which is exactly the failure the portfolio's serial spine exists to prevent.
This change freezes that interface, and it is why the spine is serial.

The seam it widens already exists and already promises this. `apps/web/src/editor/host/editor-host.ts`
carries the commitment in its own header: *"Storage, media and clock ports are a later concern; when
they arrive they widen this one interface rather than scattering new props."* This change is that
widening.

Two measured facts make specific parts of the contract non-negotiable, and both are the kind of
thing a contract gets wrong when it is designed from first principles rather than from measurement:

- **The Worker refusal inside packaged Elftia is the same-origin rule, not CSP.** E0 recorded
  `SecurityError … cannot be accessed from origin 'app://bundle'`. **No CSP token can fix it**; only
  serving origin can. A runtime-resource port whose only expressible form is an off-origin URL is
  therefore *known in advance* to be unimplementable by an Elftia-shaped Host — it would be frozen
  broken.
- **There is no root handle, so true unmount has never been triggerable.** E0 could not measure
  unmount disposal at all, and Elftia's own `PluginDisposerRegistry` is blind to timers, Workers,
  audio contexts, object URLs and GPU resources. The SDK's registry must not inherit that blindness,
  and the handle that makes unmount callable is this change's to create — spec §3.3 says so
  explicitly: *"creating it is this Slice's job, not the Spike's."*

The current subscription seam is the third input. `useEditor()` called **without** a selector
subscribes with `subscribeNone` (`apps/web/src/editor/use-editor.ts:19,72`), so such a consumer reads
state once at mount and never re-renders — the mechanism that makes `MigrationDialog` unable to
render even now that migration genuinely runs. C1 does not repair that (C3 does), but the session
contract must not make the same shape expressible again.

## What Changes

- **A single coherent port surface**, widening `EditorHost` rather than adding parallel props, at
  minimum covering the Target State §5.5 roles: `ProjectStore`, `AssetResolver`,
  `RuntimeAssetLoader`, `ExportProvider`, `NavigationHost`, `Logger`/`Diagnostics`, `IdGenerator`,
  `EnvironmentCapabilities`. The existing `navigation` / `services` / `branding` / `links` members
  are preserved unchanged, so both Hosts keep compiling.
- **A Session lifecycle contract**: `create`, `mount`, `suspend`, `resume`, `unmount`, `dispose` —
  and **`mount` returns a root handle**, which is what makes `unmount` callable by a Host at all.
- **Five decisions taken and recorded, not deferred**, in a committed port-shape decision record:
  Worker expression under the same-origin rule; the root handle's shape and ownership; graphics
  capability negotiation including the **no-rasterizer** report **and preview concurrency**; disposal
  ownership and what the resource registry must be able to see; and who runs schema migrations once
  storage is a port.
- **`EnvironmentCapabilities` carries preview concurrency.** Per ruling D9=(B), how many live
  previews the runtime can drive is a *contract obligation*, not an implementation detail: a Host
  must be able to **ask** before it lays out two preview surfaces, and get a truthful answer. This
  change owns the **shape of the question**; C0b supplies the wasm-side answer. That two-sided seam
  is why C0b depends on this change — get the shape wrong and C0b cannot answer it.
- **An in-memory reference implementation of every port**, and a **conformance suite** any adapter
  author can run, green against that implementation.
- **A boundary rule, mechanically enforced**: no port signature exposes an OpenCut schema type, a
  command class, a Zustand store, an IndexedDB name or an OPFS path.
- **Nothing is wired and no behaviour migrates.** `EditorCore` keeps working exactly as it does
  today; `EditorCore.getInstance()` is not removed (that is C2); `storageService` importers are not
  rewired (C5); no manager body, no build config and no `rust/` file is touched. Both Hosts build and
  pass the parity fixture **unchanged** — an unchanged snapshot is this change's evidence, and any
  movement is a defect.

## Capabilities

### New Capabilities

- `host-port-contract`: the typed, single-surface set of ports a Host implements — their roles,
  their boundary rule, their in-memory reference implementation and the conformance suite that
  decides whether an implementation is one.
- `editor-session-runtime`: the Session value and its lifecycle — `create` / `mount` / `suspend` /
  `resume` / `unmount` / `dispose`, the root handle `mount` returns, and the disposal ownership model
  including which resource classes the registry must be able to see.

### Modified Capabilities

- `host-service-boundary`: the `EditorHost` seam is currently specified as carrying identity,
  navigation and server endpoints and **explicitly not** a port contract. It becomes the single port
  surface. The existing server-endpoint requirements keep their behaviour and are preserved
  verbatim; what changes is that the seam is no longer scoped to *"server-backed features"* and its
  per-feature record extends to every port role.
- `browser-persistence-boundary`: *"The persistence boundary is explicitly provisional"* asserts that
  the adapter is not presented as the final Host port contract, and its documentation scenario
  requires the boundary documentation to state that **no stable storage contract is being
  published**. `BOUNDARIES.md:141` says exactly that. This change publishes a `ProjectStore` port
  with a reference implementation and a conformance suite, so that statement becomes false **here**,
  at C1 — not at C5. The requirement is amended so the provisional label attaches to the *adapter
  implementation*, which stays provisional until C5 retires it, and points forward to where the
  storage contract now lives. **This is a deliberate divergence from the Slice Plan**, which assigns
  this spec to C5 alone; the retirement of `BrowserHostAdapter` remains entirely C5's.

## Impact

**Files written by this change** (the complete write set; it must not intersect C0's):

| Path | Nature |
| --- | --- |
| `apps/web/src/editor/host/editor-host.ts` | widened, additively |
| `apps/web/src/editor/ports/**` | new — port types, in-memory reference implementation, decision record |
| `apps/web/src/editor/session/**` | new — session types, lifecycle, root handle, resource registry types |
| `apps/web/src/editor/ports/__tests__/**` | new — conformance suite |
| `script/check-port-boundary.mjs` | new — the leak rule, with a negative control |
| `BOUNDARIES.md` | one forward pointer, per the `browser-persistence-boundary` delta |

**Explicitly not written**: `script/fixtures/type-baseline.json`; anything under `rust/`; either
Host's build config; `package.json` / `bun.lock`; `UPSTREAM.md`; `SBOM.md`; `PATCHES.md`
(`editor-host.ts` is a file this fork **added**, not an inherited one, so it is not a patch — see
`PATCHES.md`'s own header and `SOURCE_INVENTORY.md`'s added-file list, which already names it);
`apps/web/src/editor/use-editor.ts` (C2 and C3 own it); any manager, command or store body.

**Known collision with the concurrent C0, reported rather than assigned away.**
`SOURCE_INVENTORY.md` and `SOURCE_INVENTORY.json` are both tracked, and
`script/generate-source-inventory.mjs` enumerates files **added** under
`["apps/web/src", "rust", "apps/web/public"]`. C0 adds `rust/wasm/LICENSE`; this change adds modules
under `apps/web/src/editor/`. Both therefore change the inventory's added-file list, and
`upstream-provenance` requires a derived inventory to be regenerated after the commit that changes
its compared set. The Slice Plan's claim that *"No file appears in both"* is **false for these two
files**. It is benign but must not be silent: the inventory is *generated*, both children regenerate
correctly on their own branches, and a merge conflict there is resolved by re-running the generator,
never by hand-merging. Escalated to the LEAD as a correction to §5's independence evidence.

**Systems.** Type-check and both Host production builds; the Playwright parity fixture on both
Hosts, expected unchanged. No runtime path changes, because nothing consumes the contract yet.

**Downstream.** C2 (session factory), C0b (the wasm side of preview concurrency), C4 (asset and
runtime-resource ports), C5 (storage port and migration ownership), C6 (disposal), C7 (headless),
and E1 in the Elftia repository — which is **forbidden from defining ports privately** and consumes
this contract instead (decision D6).
