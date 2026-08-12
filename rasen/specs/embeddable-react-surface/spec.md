# embeddable-react-surface Specification

## Purpose
TBD - created by archiving change s0304-surface-embedding-contract-freeze. Update Purpose after archive.
## Requirements
### Requirement: Public Surface component type

The system SHALL define a public `EditorSurfaceProps` type that is the embedding contract for `<EditorSurface session={...} />`. The type SHALL accept a required `session: EditorSession` and SHALL NOT accept any prop that assumes a Next router, page, auth runtime, `h-screen`, `w-screen`, or any viewport-ownership assumption. The Surface SHALL create no implicit global state.

#### Scenario: Surface accepts a session

- **WHEN** a host renders `<EditorSurface session={session} />`
- **THEN** the `EditorSurfaceProps.session` field is the only required prop
- **AND** no other prop is mandatory for the Surface to mount

#### Scenario: No viewport ownership assumption

- **WHEN** the Surface contract is compiled
- **THEN** no prop or type in the contract references `h-screen`, `w-screen`, `window`, `document.body`, a Next router, a page component, or an auth runtime
- **AND** the Surface fills its container, not the viewport

#### Scenario: No implicit global state

- **WHEN** two `<EditorSurface>` instances are mounted in the same document
- **THEN** neither instance creates global state that the other reads or writes
- **AND** no module-level singleton, window event listener, or global CSS variable definition is introduced by the contract

### Requirement: Surface does not own canonical save semantics

The Surface contract SHALL NOT define save, autosave, or persistence semantics. The `EditorSession` and its Host ports own persistence; the Surface renders and delegates.

#### Scenario: Save is not a Surface responsibility

- **WHEN** the Surface contract types are examined
- **THEN** no `save`, `autosave`, `persist`, or equivalent method appears on `EditorSurfaceProps` or any type it exports
- **AND** persistence is accessed only through `session.host` (the frozen Host port contract)

### Requirement: Focus mode types

The system SHALL define a `FocusMode` union type with exactly three members: `'passive'`, `'focused'`, and `'full'`. Each member defines a distinct keyboard, pointer, and wheel ownership scope. The Surface SHALL NOT claim window-level key or pointer capture in any mode.

#### Scenario: Three focus modes exist

- **WHEN** the `FocusMode` type is compiled
- **THEN** it is a union of exactly `'passive' | 'focused' | 'full'`
- **AND** no additional modes exist

#### Scenario: Passive mode does not intercept host input

- **WHEN** `focusMode` is `'passive'`
- **THEN** the Surface does not register keyboard-shortcut listeners
- **AND** wheel events propagate to the host (page scroll is not prevented)
- **AND** the Surface root has `tabIndex` set to `-1` (programmatically focusable, not in tab order)

#### Scenario: Focused mode activates editor shortcuts without window capture

- **WHEN** `focusMode` is `'focused'`
- **THEN** editor keyboard shortcuts are active (bound to the Surface root container, not `window`)
- **AND** wheel events inside the container are handled by the editor (`preventDefault` stops page scroll)
- **AND** the Surface root has `tabIndex` set to `0` (in tab order)
- **AND** no `window.addEventListener` call is made by the contract

#### Scenario: Full mode adds focus containment

- **WHEN** `focusMode` is `'full'`
- **THEN** all `focused` behaviour applies
- **AND** Tab and Shift+Tab cycle within the Surface root container (practical focus containment)
- **AND** no hard window-level focus trap is claimed (a determined user can still Tab out)

### Requirement: Focus mode is host-controllable

The Surface SHALL accept a `focusMode` prop and an `onFocusModeChange` callback. The host MAY drive focus mode programmatically; the Surface MAY request a mode change through the callback. The prop is the source of truth.

#### Scenario: Host sets focus mode

- **WHEN** the host renders `<EditorSurface session={session} focusMode="focused" />`
- **THEN** the Surface operates in `focused` mode
- **AND** no other prop value is required for focused operation

#### Scenario: Default focus mode is passive

- **WHEN** the host renders `<EditorSurface session={session} />` without `focusMode`
- **THEN** the Surface defaults to `passive` mode

### Requirement: CSS namespace strategy

The system SHALL define a `CssNamespaceStrategy` type that documents the three-layer CSS isolation contract: attribute-scoped custom properties, CSS containment, and no `body`/`html`/`:root` style ownership. The strategy SHALL produce zero host computed-style deltas when verified by the E0 measurement method.

#### Scenario: Editor CSS variables are attribute-scoped

- **WHEN** the editor's CSS custom properties are defined
- **THEN** they are scoped to `[data-editor-surface="<namespace>"]`, not `:root`
- **AND** the host supplies the namespace value
- **AND** a host element outside the Surface container does not inherit any editor CSS variable

#### Scenario: Surface root uses CSS containment

- **WHEN** the Surface root container is mounted
- **THEN** its computed style includes `contain: layout style paint` (or the equivalent containment declared by the contract)
- **AND** editor layout does not affect host layout outside the container

#### Scenario: No body style ownership

- **WHEN** the Surface is mounted in a host
- **THEN** the host's `body` computed style is unchanged from before mount
- **AND** no editor CSS rule targets `body`, `html`, or `:root`

#### Scenario: Zero host computed-style deltas

- **WHEN** host element computed styles are snapshotted before and after Surface mount
- **THEN** the diff is empty for all host elements outside the Surface container

### Requirement: Lifecycle binding to the EditorSession

The system SHALL define a `SurfaceLifecycleBinding` contract that maps Surface lifecycle events to the S02 `EditorSession` lifecycle. The mapping SHALL be: mount → `session.mount({ target })`; visibility hidden → `session.suspend()`; visibility visible → `session.resume()`; React unmount → `session.unmount()`; permanent removal → `session.dispose()` (host-driven, not auto-dispose).

#### Scenario: Mount calls session.mount

- **WHEN** the Surface mounts in the React tree
- **THEN** `session.mount({ target })` is called with the Surface root container as `target`
- **AND** the returned `EditorSessionRootHandle` is stored for lifecycle management
- **AND** `handle.ready` is awaited before signalling `onReady`

#### Scenario: Visibility hidden triggers suspend

- **WHEN** the `visibility` prop transitions to `'hidden'`
- **THEN** the Surface calls `session.suspend()`
- **AND** preview/decoder work stops (via the S02 resource-drain path)
- **AND** no parallel suspend mechanism is invoked

#### Scenario: Visibility visible triggers resume

- **WHEN** the `visibility` prop transitions from `'hidden'` to `'visible'`
- **THEN** the Surface calls `session.resume()`
- **AND** preview/decoder work may resume (via the S02 two-phase resume)

#### Scenario: React unmount calls session.unmount

- **WHEN** the Surface component unmounts from the React tree
- **THEN** the Surface calls `session.unmount()`
- **AND** the call is idempotent (safe even if the session was already unmounted)
- **AND** the session's identity and project state are retained

#### Scenario: Disposal is host-driven

- **WHEN** the Surface component unmounts
- **THEN** `session.dispose()` is NOT called automatically
- **AND** disposal remains the host's decision (the host may re-mount the same session)

### Requirement: Typed commit-binding seam

The system SHALL define a `SurfaceCommitBinding` interface that is an opaque slot on `EditorSurfaceProps`. The interface SHALL declare that a commit path exists without naming transaction types (`Transaction`, `Revision`, `IdempotencyKey`, `Batch`). The slot SHALL be optional; its absence means the Surface renders without commit wiring (R1 fills the concrete binding against T0's frozen types).

#### Scenario: Commit-binding slot exists but is optional

- **WHEN** `EditorSurfaceProps` is compiled
- **THEN** a `commitBinding?: SurfaceCommitBinding` field exists
- **AND** the field is optional (the Surface mounts without it)

#### Scenario: Commit-binding does not name transaction types

- **WHEN** the `SurfaceCommitBinding` interface is compiled
- **THEN** no import from a transaction-contract module appears in the type declaration
- **AND** the interface does not reference `Transaction`, `Revision`, `IdempotencyKey`, `Batch`, or `Operation`
- **AND** the interface captures only the Surface's side of the binding (how a user edit is handed off)

### Requirement: Surface contract is additive-only

The Surface embedding contract SHALL consist entirely of new type files under `apps/web/src/editor/surface/embedding/**`. No existing file — `editor-root.tsx`, `create-session.ts`, `editor-host.ts`, `use-editor.ts`, `ports/**`, `commands/**` — SHALL be modified by this change.

#### Scenario: No existing files are modified

- **WHEN** the change diff is examined
- **THEN** all added files are under `apps/web/src/editor/surface/embedding/`
- **AND** no file outside that directory is modified

#### Scenario: Both Hosts remain buildable

- **WHEN** the change is applied and both Hosts are built
- **THEN** the Next Host builds successfully
- **AND** the Vite Host builds successfully
- **AND** the parity fixture is unchanged

### Requirement: No OpenCut type leaks in the Surface contract

The Surface contract SHALL NOT expose any OpenCut schema type, command class, Zustand store, IndexedDB name, or OPFS path in any public type it defines. This is the same boundary the S02 port contract established.

#### Scenario: Contract types are Host-neutral

- **WHEN** the Surface contract's public types are examined
- **THEN** no type references an OpenCut schema entity, a command class name, a Zustand store, an IndexedDB database name, or an OPFS path
- **AND** all types are expressible in terms of `EditorSession`, Host callbacks, and Surface-local types

### Requirement: Public Surface runtime mounts the editor in its supplied container

The system SHALL export a runtime `EditorSurface` component through the public Surface barrel. Rendering `<EditorSurface session={session} />` SHALL create exactly one Surface root in the caller's React tree, SHALL render `EditorRoot` beneath Host and Session providers derived from that same `session`, and SHALL bind the root element to `session.mount({ target })`. The Surface SHALL fill only the supplied container and MUST NOT create a nested React root, create a session, or acquire a Next/page/auth/viewport dependency.

#### Scenario: Session remains the only required prop

- **WHEN** a Host renders `<EditorSurface session={session} />` without optional callbacks, focus, visibility, namespace, class, or commit props
- **THEN** the Surface mounts one root element and renders the editor with `session` and `session.host` as the provider values
- **AND** no implicit session, Host, editor core, or module-level singleton is created

#### Scenario: Session mount receives the real Surface root

- **WHEN** the Surface commits its root element to the DOM
- **THEN** it calls `session.mount({ target })` exactly once for that mount generation with that root element as `target`
- **AND** it stores the synchronous `EditorSessionRootHandle` rather than creating another React root inside the target

#### Scenario: Container ownership does not become viewport ownership

- **WHEN** a Host mounts the Surface inside a bounded container smaller than the viewport
- **THEN** the Surface root and `EditorRoot` fill that container
- **AND** no Surface runtime module adds `h-screen`, `w-screen`, `100vh`, `100vw`, `window.innerWidth`, `window.innerHeight`, or a body/html sizing mutation

#### Scenario: Two Surface instances retain explicit ownership

- **WHEN** two different sessions are rendered in two Surface containers in one document
- **THEN** each tree reads only its own session, Host, focus scope, lifecycle handle, and optional commit binding
- **AND** neither Surface's root events or lifecycle callbacks operate on the other Surface

### Requirement: Runtime focus scope enforces the frozen matrix

The Surface runtime SHALL implement the existing `passive` / `focused` / `full` matrix at its root container. Surface-added keyboard, pointer, and wheel ownership MUST be attached to the root only; the Surface MUST NOT add an input listener to `window` or `document`, inject a global focus-lock style, or call pointer capture. The controlled `focusMode` prop SHALL remain the source of truth.

#### Scenario: Passive runtime leaves Host input unclaimed

- **WHEN** the effective focus mode is `passive`
- **THEN** the root has `tabIndex=-1`, no editor shortcut listener is installed, pointer events are neither prevented nor stopped by the Surface, and wheel default/propagation remain available to the Host
- **AND** a primary pointer may call `onFocusModeChange("focused")` only as an advisory request without changing the effective mode locally

#### Scenario: Focused runtime scopes editor input to the root

- **WHEN** the effective focus mode is `focused` and focus is on the root or one of its descendants
- **THEN** the root has `tabIndex=0`, editor shortcuts are handled by a listener on that root, inside pointer propagation is contained after descendant handlers, and inside wheel default is prevented without affecting events outside the root
- **AND** clicking otherwise non-focusable Surface background focuses the root without scrolling or stealing focus from an interactive descendant

#### Scenario: Focused shortcuts require focus inside the Surface

- **WHEN** a focused-mode Surface exists but active focus is outside its root
- **THEN** an editor shortcut dispatched outside the root is not handled by that Surface
- **AND** focusing inside the root makes the same shortcut available without installing a document listener

#### Scenario: Full runtime cycles dynamic tab stops locally

- **WHEN** the effective focus mode is `full` and Tab or Shift+Tab reaches the first or last currently eligible descendant
- **THEN** focus cycles to the opposite eligible descendant, or to the root when none exists
- **AND** disabled, hidden, inert, disconnected, and negative-tabindex descendants are excluded without a cached global focus list

#### Scenario: Controlled mode changes replace listener ownership

- **WHEN** the Host changes one Surface from passive to focused to full and back to passive
- **THEN** each prior mode's Surface-added listeners are removed before the new matrix is active
- **AND** `onFocusModeChange` requests never mutate the prop or another Surface's mode

#### Scenario: Multiple focused Surfaces do not share shortcuts

- **WHEN** two focused/full Surfaces are mounted and focus moves from one root to the other
- **THEN** only the root containing active focus handles each shortcut, pointer, wheel, or Tab event
- **AND** unmounting either root removes every listener owned by that Surface without changing the other

### Requirement: Surface lifecycle execution is deterministic under races

The Surface SHALL execute the frozen lifecycle mapping with a generation-aware controller. It SHALL suppress stale readiness and visibility work after unmount or session replacement, SHALL serialize/coalesce visibility requests per mounted Surface, and SHALL call `session.unmount()` exactly once for each successfully started mount generation. It MUST delegate suspension and resumption only to `session.suspend()` and `session.resume()` and MUST NOT call `session.dispose()` automatically.

#### Scenario: Ready publishes only for the live generation

- **WHEN** `session.mount()` returns a handle whose `ready` later resolves while the same Surface generation is still mounted
- **THEN** `onReady` is called exactly once after readiness resolves
- **AND** no ready signal is published before that promise settles

#### Scenario: Unmount before ready suppresses stale publication

- **WHEN** the Surface unmounts or replaces its session before the old handle's `ready` resolves or rejects
- **THEN** the old generation calls `session.unmount()` once and never calls its stale `onReady`
- **AND** later settlement cannot mutate Surface-local state, schedule a visibility transition, or act on the replacement session

#### Scenario: Hidden visibility delegates to the existing drain path

- **WHEN** the latest live visibility becomes `hidden`
- **THEN** the Surface calls `session.suspend()` once for that effective transition
- **AND** observed preview/decoder activity drains through the existing S02 session resource path with no Surface-owned drain, manager pause, timer cancellation, or decoder cleanup

#### Scenario: Visible visibility delegates to resume

- **WHEN** the latest live visibility changes from hidden to `visible`
- **THEN** the Surface calls `session.resume()` once after the prior Surface visibility transition settles
- **AND** the Surface does not directly reopen resource admission or reacquire preview/decoder work

#### Scenario: Rapid visibility updates converge on the latest live value

- **WHEN** hidden/visible props change repeatedly while earlier suspend/resume promises are pending
- **THEN** the controller serializes the calls, coalesces redundant requested values, and rechecks the live generation before dispatching each call
- **AND** a stale completion cannot issue a follow-up transition or publish a callback after unmount

#### Scenario: React cleanup remains reversible and Host disposal remains permanent

- **WHEN** a mounted Surface is removed and the same non-disposed session is later rendered again, including a Strict-Mode-shaped setup/cleanup/setup sequence
- **THEN** cleanup invokes idempotent `session.unmount()` and the later mount receives a new live root handle
- **AND** the Surface never calls `session.dispose()`; permanent disposal remains the owning Host's decision

#### Scenario: Lifecycle failures are attributable

- **WHEN** mount readiness, suspend, resume, or unmount rejects for the live generation
- **THEN** the Surface reports the error through `onError` at most once for that failed operation
- **AND** it neither reports success for that operation nor retries by creating another lifecycle or resource mechanism

### Requirement: R1 binds the opaque commit slot to T0 without widening either contract

The implementation SHALL provide a private adapter from R0's unchanged `SurfaceCommitBinding` to T0's frozen `TransactionApply`/`TransactionBatch`/`TransactionResult` types. Both production Host Surface bridges SHALL bind that adapter to the canonical `SessionOpenCutTransactions` already owned by the session's `EditorCore`. The adapter MUST NOT open another engine, expose provider-private types, invent a generic command payload, or wrap T3's already routed UI command in a second apply.

#### Scenario: One valid T0 batch reaches the supplied apply seam once

- **WHEN** a Surface-local consumer commits an opaque edit that is structurally a valid T0 `TransactionBatch`
- **THEN** the adapter calls the supplied `TransactionApply.apply` exactly once with that batch
- **AND** it observes the resulting promise without changing R0's public `void` return type

#### Scenario: Invalid opaque input fails before apply

- **WHEN** the opaque commit slot receives null, a scalar, an empty/malformed operations value, or another value that is not a T0 batch
- **THEN** the adapter reports a structured Surface error without calling transaction apply
- **AND** it does not reinterpret the value as an OpenCut command, donor edit, no-op transaction, or provider-private payload

#### Scenario: Transaction rejection is reported once

- **WHEN** the canonical transaction apply rejects a valid Surface batch
- **THEN** the adapter reports that asynchronous error through the current Surface error callback exactly once
- **AND** it creates no second apply, legacy save, revision, watcher notification, or fallback engine

#### Scenario: Both Hosts reuse the session-owned facade

- **WHEN** the Next or Vite session bridge constructs its default Surface binding
- **THEN** it adapts `editorForSession(session).transactions`, the same ordered facade used by routed UI commands and automation
- **AND** project switching or Host disposal retires that facade through existing `EditorCore` ownership rather than Surface cleanup

#### Scenario: Public Surface types remain opaque and Host-neutral

- **WHEN** the public Surface type graph and barrel are inspected
- **THEN** `SurfaceCommitBinding` still exposes only `commit({ edit: unknown }): void` and no transaction contract type is re-exported from Surface props
- **AND** no OpenCut schema, command class, `EditorCore`, `SessionOpenCutTransactions`, Zustand store, IndexedDB name, OPFS path, or generic command escape hatch appears in a public Surface signature

#### Scenario: Existing routed UI work is not double-committed

- **WHEN** a command or accepted pointer interaction already routes through T3's canonical transaction path inside `EditorCore`
- **THEN** mounting the Host's Surface commit binding does not intercept or re-submit that work
- **AND** the established result remains one engine apply, one durable save, one revision, one watcher notification, and one history publication

### Requirement: Next and Vite Hosts mount the same public Surface

Both production Hosts SHALL replace direct `EditorRoot` composition for the editor view with the public `EditorSurface` through a session-bound bridge. They SHALL preserve their existing session creator/disposer, project-loading behavior, Host-owned chrome and product-shell siblings. The Vite emitted graph MUST remain free of Next runtime and product-shell modules.

#### Scenario: Next retains Host-owned page behavior

- **WHEN** the Next editor route renders a loaded project
- **THEN** its route/navigation Host, viewport wrapper, mobile gate, C4 probe, and changelog notification remain outside the Surface while `EditorRoot` renders inside it
- **AND** the Surface module imports no Next router, page, auth, or changelog module

#### Scenario: Vite retains bounded Host chrome

- **WHEN** the Vite Host renders a loaded project in its bordered `HostChrome` container
- **THEN** the same public Surface fills that bounded container, the project picker remains outside the Surface editor view, and real editor interactions remain available
- **AND** the production module graph contains no Next runtime, app-router, site, auth, changelog, or content-collections module

#### Scenario: Default public mode and production Host mode remain distinct

- **WHEN** an arbitrary Host omits `focusMode`
- **THEN** the public Surface remains passive by default
- **AND WHEN** the production Next and Vite editor roots mount their normal editing view
- **THEN** each Host explicitly selects focused behavior and shortcuts work only after focus enters that Surface

#### Scenario: Both Host parity behavior remains unchanged

- **WHEN** the established create/import/place/drag/trim/split/snap/scrub/play/save/reload scenario is run with shortcuts focused inside each Host's Surface
- **THEN** every interaction and persistence assertion passes on Next and Vite
- **AND** the normalized Host comparison introduces no semantic difference attributable to R1

### Requirement: R1 verification preserves embedding boundaries

The R1 change SHALL add mechanical and executable evidence that its runtime wiring preserves public boundaries, Host layout/styles, session/resource ownership, and the existing type/spec baselines. A check that scans no file or a test path that executes no assertion MUST fail rather than report a pass.

#### Scenario: Surface boundary check has negative and converse controls

- **WHEN** the Surface boundary check runs normally and with its negative-control mode
- **THEN** it scans tracked and uncommitted public Surface/runtime modules, rejects deliberate public provider-type leaks, viewport ownership, Next imports, and Surface-added document/window input listeners, and catches every targeted violation
- **AND** converse fixtures prove allowed T0 imports in the private adapter, container listeners, and Host-owned viewport wrappers do not fire indiscriminately

#### Scenario: Mounting causes no outside style or viewport delta

- **WHEN** each Host snapshots html, body, Host chrome, and sentinel elements after stylesheets load and then mounts, focuses, hides, shows, and unmounts the Surface
- **THEN** computed styles and bounds outside the supplied container have zero R1-attributable delta and the bounded Surface never expands to the viewport
- **AND** this evidence is reported as R1 mount behavior, not as completion of R2's CSS-variable or portal-isolation work

#### Scenario: Session resource and disposal evidence remains green

- **WHEN** each Host runs repeated create/mount/hide/show/unmount/dispose cycles through the Surface and the S02 disposal oracle
- **THEN** hidden visibility drains existing activity work, unmount releases the root, Host disposal releases every registered resource, and retained publication is zero
- **AND** no Surface-owned drain, timer registry, decoder owner, or permanent disposal path appears

#### Scenario: Type baseline does not grow

- **WHEN** `node script/check-type-baseline.mjs` runs after R1
- **THEN** the current diagnostic count is at most 3 and no diagnostic lies outside the pinned baseline
- **AND** both the Next and Vite focused type/build gates pass under their existing attribution rules

#### Scenario: All current capability specs are falsification-swept

- **WHEN** the change is reviewed against all 17 current `rasen/specs/*/spec.md` files, including numbered SHALL clauses
- **THEN** no assertion in session lifecycle, transaction automation, Host ports/services, disposal/isolation, headless, distributable, parity, persistence, WASM, provenance, reproducibility, or inherited-defect capabilities is made false
- **AND** any contradiction is recorded and fixed or returned to Direction rather than hidden by declaring only `embeddable-react-surface` modified

### Requirement: R2 scopes editor CSS to Surface-owned roots

The distributable editor stylesheet SHALL define editor design tokens, theme variants, base selectors, selection behavior, and containment only on or below a Surface-owned root. The visual root and its owned portal host SHALL carry the same `data-editor-surface` namespace and computed token set. The Surface root SHALL compute to `contain: layout style paint`, remain relative to its supplied container, and MUST NOT introduce an editor-owned selector targeting `:root`, `html`, or `body`.

#### Scenario: Default and custom namespaces own complete token sets

- **WHEN** Surfaces mount with the default namespace and with a Host-supplied custom namespace
- **THEN** each visual root and its portal host expose the complete editor token set under their own `data-editor-surface` value
- **AND** editor descendants resolve their light/dark/panel values from that owner rather than from `:root`

#### Scenario: Two Surface themes do not cross

- **WHEN** two Surfaces with different namespace/theme ancestors render in one document
- **THEN** changing one Surface's theme changes only its visual root and owned portal descendants
- **AND** the other Surface and every Host element retain their prior computed values

#### Scenario: Surface root is contained and bounded

- **WHEN** a Surface is mounted inside a container smaller than the viewport
- **THEN** its computed containment includes layout, style, and paint and its bounds remain within the supplied content box
- **AND** it does not acquire viewport dimensions or write size/style state to `html` or `body`

#### Scenario: Editor stylesheet causes zero outside delta

- **WHEN** final distributable CSS is loaded and declared Host elements are snapshotted before and after Surface mount, theme change, portal open, resize, error fallback, and unmount
- **THEN** their declared computed-style values and bounds have zero R2-attributable delta
- **AND** an injected editor `:root` token or body rule makes the mechanical or browser control fail

#### Scenario: Host-owned reset remains outside the claim

- **WHEN** a Host stylesheet independently styles its own `html` or `body`
- **THEN** the Surface checker does not classify that Host file as editor ownership
- **AND** the distributable Surface stylesheet remains free of the same selectors

### Requirement: Editor portals remain owned by their initiating Surface

Every editor-owned portal rendered beneath an `EditorSurface` SHALL resolve a private portal host belonging to that exact Surface. Portal content SHALL preserve the Surface namespace, focus ownership, and bounded paint ownership. The portal owner MUST NOT appear in the public Surface type graph, and Host/product-shell overlays outside the Surface SHALL retain Host ownership.

#### Scenario: Representative overlays mount under the Surface owner

- **WHEN** an editor dialog, menu/select, or direct drag overlay opens from a Surface control
- **THEN** the overlay DOM is a descendant of that Surface's portal host and not a direct child of `document.body`
- **AND** its computed editor tokens equal the initiating Surface's tokens

#### Scenario: Overlay focus remains local and restorable

- **WHEN** a keyboard user opens, navigates, and closes an owned overlay with Escape
- **THEN** focus enters the overlay according to its semantic primitive and returns to the invoking control
- **AND** focus never transfers to another Surface or requires a document shortcut listener

#### Scenario: Two Surfaces do not exchange portals

- **WHEN** two Surfaces open overlays in the same document
- **THEN** each portal node, namespace, callback, and focus restoration target belongs to its initiating Surface
- **AND** closing or unmounting one Surface does not remove or restyle the other's overlay

#### Scenario: Host overlays retain Host ownership

- **WHEN** a Host-owned toaster or product-shell overlay renders outside the Surface provider
- **THEN** it retains its existing Host portal destination and lifecycle
- **AND** it is not counted as an escaped editor portal

#### Scenario: Unowned editor portal is detected

- **WHEN** a deliberate editor portal bypasses the private owner and targets `document.body`
- **THEN** the portal boundary control or dual-Host DOM assertion fails
- **AND** the failure cannot be hidden by copying namespace attributes onto the body-level node

### Requirement: Both Hosts and the Surface share one React 18 runtime

The workspace SHALL resolve the Next Host, Vite Host, React Surface, and ReactDOM renderer to one exact compatible React 18 runtime and type line. The implementation MUST NOT bundle, alias, externalize, or mount an isolated React 19 or second React copy. Vite deduplication alone SHALL NOT be treated as sufficient evidence.

#### Scenario: Dependency metadata pins one React 18 line

- **WHEN** root, Web, Vite manifests and the lock resolution are inspected
- **THEN** application React, ReactDOM, and their type packages use the approved exact React 18-compatible line
- **AND** no application workspace resolves a second React or ReactDOM package root

#### Scenario: Runtime identity crosses the Host-Surface seam

- **WHEN** a Host-entry probe provides context and a Surface-imported child uses context, state, and effect in a final production build
- **THEN** both modules observe the same React runtime/dispatcher identity and the interaction updates successfully
- **AND** no React #321, invalid-hook-call, or duplicate-React console error occurs

#### Scenario: Emitted Vite graph proves singleton and exclusions

- **WHEN** the normal and Surface-evidence Vite production entries are built
- **THEN** their authoritative module graph contains exactly one application React package root and one ReactDOM package root
- **AND** all ten existing Next/app/site/auth/changelog/content-collections/desktop exclusions remain clean

#### Scenario: Duplicate React control fails closed

- **WHEN** a control manifest, graph, or runtime resolves a second React copy
- **THEN** the singleton check fails before browser evidence is accepted
- **AND** multiple modules importing the same resolved package root remain an accepted converse case

### Requirement: The public Surface seam contains render failures accessibly

`EditorSurface` SHALL contain render and commit-phase failures from its editor subtree with an internal error boundary. A caught failure SHALL invoke the latest public `onError` callback at most once and render a bounded, named `role="alert"` diagnostic inside the Surface namespace instead of leaving a blank editor. The boundary MUST NOT dump a raw stack or secret-bearing object, auto-dispose the session, invent asynchronous/event-handler coverage, or move Host recovery policy into the Surface.

#### Scenario: Child render failure shows one bounded diagnostic

- **WHEN** a deterministic descendant throws during render beneath the Surface boundary
- **THEN** the editor content is replaced by one visible alert with a heading and concise normalized message inside the Surface bounds
- **AND** `onError` receives that error once without a raw stack appearing in rendered output

#### Scenario: Host siblings and another Surface survive

- **WHEN** one of two mounted Surfaces catches a descendant render failure
- **THEN** the other Surface and Host-owned siblings remain mounted and interactive
- **AND** no session outside the failed Surface is unmounted, suspended, resumed, or disposed

#### Scenario: Strict-Mode-shaped rendering does not duplicate reports

- **WHEN** the failure path is exercised under the production Host's Strict-Mode-shaped composition
- **THEN** the same caught failure produces one attributable callback and one fallback
- **AND** it does not create a retry loop or duplicate lifecycle owner

#### Scenario: Failure outside the Surface remains Host-owned

- **WHEN** a component outside `EditorSurface` throws
- **THEN** the Surface boundary does not claim or report that error
- **AND** an outer Host boundary may handle it as defense in depth

#### Scenario: React boundary limitations are explicit

- **WHEN** an event handler or detached asynchronous callback throws outside React render/commit capture
- **THEN** R2 evidence does not report that throw as contained by the Surface boundary
- **AND** existing operation/lifecycle error routes remain responsible for their own errors

### Requirement: R2 accessibility is executable at the Surface seam

The Surface root SHALL be an accessibly named region while preserving the frozen focus-mode `tabIndex` matrix. Owned overlays and the error fallback SHALL expose correct role, name, state, keyboard navigation, and focus restoration behavior. Final Next and Vite production evidence SHALL report zero critical or serious WCAG 2 A/AA automated findings within the visual Surface root plus its owned portal host. The system MUST NOT describe this bounded evidence as whole-application WCAG conformance.

#### Scenario: Named region preserves focus modes

- **WHEN** the Surface is inspected in passive, focused, and full modes
- **THEN** it has a stable accessible region name while retaining `tabIndex=-1`, `0`, and `0` respectively
- **AND** no accessibility change installs a window/document shortcut or focus listener

#### Scenario: Owned overlay is keyboard operable

- **WHEN** a user reaches a representative trigger using only the keyboard and opens its overlay
- **THEN** the overlay has the expected role/name/state, exposes visible focus, supports its expected keyboard navigation and Escape close, and restores focus
- **AND** every focused node stays in the initiating Surface's owned roots

#### Scenario: Error fallback is announced

- **WHEN** the internal error fallback appears
- **THEN** it is exposed as a named alert with readable diagnostic text
- **AND** the Host page remains navigable without focus being moved to an unrelated control

#### Scenario: Automated scan covers visual and portal roots

- **WHEN** the final-source axe scan runs in Next and Vite
- **THEN** it scans both the visual Surface root and its owned portal host after representative content is open and reports zero critical/serious owned findings
- **AND** the run fails if either owned root is omitted, the scan executes zero rules, or an owned finding is filtered out

#### Scenario: Accessibility claim remains bounded

- **WHEN** unrelated Host/page findings or untested editor workflows exist
- **THEN** evidence records them outside the R2 ownership scope where applicable
- **AND** R2 claims only the Surface seam and exercised interactions, not complete editor or page conformance

### Requirement: Surface layout responds to bounded container resize

The Surface SHALL converge on the current supplied-container dimensions during grow, shrink, aspect-ratio, repeated-same-size, and restoration changes. Resize handling SHALL prefer container-relative CSS and MAY use a private root `ResizeObserver` only for a demonstrated descendant invalidation need. It MUST NOT listen to `window.resize`, mutate `html`/`body`, remount the session, change visibility, reacquire resources, or publish dimensions through the public Surface contract.

#### Scenario: Grow and shrink remain within Host bounds

- **WHEN** the Host changes the bounded container through compact, wide, tall, and original sizes
- **THEN** Surface, editor root, preview, and timeline converge to usable dimensions inside that content box
- **AND** no Surface paint or hit target overlaps declared outside Host sentinels

#### Scenario: Resize does not alter lifecycle ownership

- **WHEN** the full resize matrix runs on a ready Surface
- **THEN** the session/root identity and mount count remain unchanged and no suspend, resume, unmount, dispose, or resource-reacquisition call is caused by resize
- **AND** Host computed style/bounds outside the supplied container remain unchanged except for the Host's intentional container dimensions

#### Scenario: Same-size notifications do not loop

- **WHEN** an observer receives repeated entries with unchanged dimensions
- **THEN** no unbounded callback/render/animation-frame loop occurs
- **AND** the final layout and lifecycle ledger remain stable

#### Scenario: Resize cleanup is deterministic

- **WHEN** the Surface unmounts or replaces its session after resize observation starts
- **THEN** its observer and any pending coalesced callback are disconnected/cancelled
- **AND** a later stale size entry cannot mutate the old or replacement Surface

#### Scenario: Viewport-resize control is rejected

- **WHEN** a deliberate implementation adds `window.resize`, viewport dimensions, or body sizing to satisfy bounded resize
- **THEN** the Surface boundary negative control fails
- **AND** root-scoped observation remains an accepted converse case

### Requirement: Provider-private document drag continuation is owner-bounded

Existing editor interactions that require drag continuation beyond the Surface root MAY use document-level move/up/cancel listeners only through a provider-private per-Surface/session coordinator. Such listeners SHALL exist only while a live drag is active, SHALL dispatch only to the initiating owner and pointer, and SHALL be synchronously removed on finish, cancel, replacement, Surface unmount, or session replacement. No coordinator, donor controller, schema, command, store, or DOM owner type may enter the public Surface barrel, and Surface focus machinery SHALL remain root-only.

#### Scenario: Active drag alone owns temporary listeners

- **WHEN** no drag is active
- **THEN** the coordinator has no document move/up/cancel listener
- **AND WHEN** an owned drag starts
- **THEN** only the minimum paired continuation listeners are installed for that live owner/pointer

#### Scenario: Drag can finish beyond the bounded root

- **WHEN** a timeline drag/trim/scrub begins inside the Surface, moves beyond its bounds, and releases over Host chrome
- **THEN** the initiating interaction receives continuation and commits its accepted edit exactly once
- **AND** the Host control under the release is not activated and existing transaction/history/save semantics are preserved

#### Scenario: Two Surfaces isolate drag ownership

- **WHEN** two Surfaces exist and one owns an active drag
- **THEN** move/up events mutate only the initiating Surface/session
- **AND** the other Surface's controller, transaction facade, focus, and portal state remain unchanged

#### Scenario: Cancel and unmount prevent stale mutation

- **WHEN** pointer cancel, drag replacement, Surface unmount, or session replacement occurs before release
- **THEN** temporary listeners are removed synchronously and the active token is invalidated
- **AND** later document events cannot commit or mutate either the stale or replacement session

#### Scenario: Private types remain private

- **WHEN** public Surface types/barrels and the emitted declaration/import graph are inspected
- **THEN** no drag coordinator/controller, provider-private schema/command/store, portal DOM type, or document-listener handle is exposed
- **AND** the existing opaque commit and Host-neutral Surface signatures are unchanged

#### Scenario: Persistent or ownerless global drag control fails

- **WHEN** a deliberate fixture registers document drag listeners persistently, omits paired cleanup, or dispatches without owner discrimination
- **THEN** the private-drag boundary or behavioral negative control fails
- **AND** an active, paired, owner-checked private drag remains an accepted converse case

### Requirement: R2 closure is final-source, dual-Host, and boundary-preserving

R2 SHALL preserve all frozen R0/R1 public, focus, lifecycle, transaction, resource, and Host ownership requirements and SHALL prove its new behavior in final production builds of both Next and Vite. Evidence SHALL be attributable to one unchanged source/test/lockfile hash set, an owned build/server identity, explicit assertions, and hashed artifacts. The pinned type baseline SHALL remain at most 3 diagnostics with none outside the pin. Vite's authoritative emitted graph SHALL retain all ten distributable exclusions. No static declaration, single-Host run, empty scan, zero-test run, reused ambient server, or screenshot without an assertion SHALL establish closure.

#### Scenario: Final source identity encloses both Host runs

- **WHEN** R2 evidence is accepted
- **THEN** the product/check/test/lockfile hash manifest before builds equals the manifest after both browser runs and identifies the marker-bearing builds used
- **AND** each Host run verifies its explicit owned server/build marker with ambient-server reuse disabled

#### Scenario: Mechanical checks prove their own sensitivity

- **WHEN** CSS, portal, React, private-drag, Surface, transaction, and Host-port checks run
- **THEN** normal scans are non-empty and clean, every deliberate violation is caught, and every documented converse fixture is accepted
- **AND** no checker passes by excluding uncommitted R2 files or emitted final CSS/module entries

#### Scenario: Both Hosts execute the complete R2 matrix

- **WHEN** the parameterized Surface Playwright suite runs against final Vite and Next production builds
- **THEN** every CSS, portal, React identity, accessibility, error, resize, drag, lifecycle, and disposal step has a machine assertion and ledger record in both Hosts
- **AND** unexpected console errors, omitted steps, omitted Host profiles, or zero axe rules fail the run

#### Scenario: Type, build, and distributable gates remain bounded

- **WHEN** final type and build gates run
- **THEN** the pinned type check reports at most 3 diagnostics with none outside its baseline, Vite typecheck/build and marker-bearing Next build pass, and the emitted Vite graph retains all ten exclusions plus one React/ReactDOM root
- **AND** no Next/page/auth/site/changelog/content-collections/desktop module enters the distributable editor graph

#### Scenario: Existing parity and ownership remain green

- **WHEN** the established dual-Host create/import/place/drag/trim/split/snap/scrub/play/save/reload scenario and S02 disposal oracle rerun
- **THEN** every interaction/disposal assertion passes and no new semantic difference, duplicate apply/save/history publication, retained resource, or automatic Surface disposal is attributable to R2
- **AND** parity attribution begins from the authoritative R1 28/19/9 evidence rather than the stale 25/16/9 line

#### Scenario: Capability falsification and claims stop at R2

- **WHEN** all 17 canonical specs and numbered SHALL clauses are swept against the final diff
- **THEN** no lifecycle, transaction, Host, persistence, headless, WASM, provenance, reproducibility, disposal, isolation, distributable, parity, or inherited-defect assertion is made false
- **AND** evidence explicitly avoids claiming whole-application accessibility, viewport ownership, a new public API, or work deferred beyond R2

