## ADDED Requirements

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
