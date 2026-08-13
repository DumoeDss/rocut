## ADDED Requirements

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
