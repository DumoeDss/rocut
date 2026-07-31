## ADDED Requirements

### Requirement: Every editor session owns one complete nine-store registry

Each live `EditorSession` SHALL own distinct vanilla Zustand StoreApi instances for panel, editor
bootstrap, preview, timeline, sounds, stickers, keybindings, properties and assets-panel state. The
registry SHALL be created and resolved through the explicit session and SHALL NOT widen the frozen
public session-construction contract.

#### Scenario: Two sessions receive complete distinct registries

- **WHEN** sessions A and B are created simultaneously
- **THEN** each registry contains exactly the nine named stores
- **AND** no StoreApi, listener set or mutable initial-state object is shared between the registries

#### Scenario: A missing store is rejected

- **WHEN** a test fixture supplies a registry that omits or duplicates any named store
- **THEN** session binding fails with an actionable incomplete-registry error

#### Scenario: Disposed session state cannot be resolved

- **WHEN** a session is disposed and code attempts to resolve its store registry
- **THEN** resolution fails rather than returning a process default or another session's registry

### Requirement: Core and live editor state are independent across two sessions

A mutation initiated through one session SHALL affect only that session's core and live stores. The
independence proof SHALL cover project, selection, command/undo, playback/playhead, save and each of
the nine named stores rather than inferring store isolation from distinct core identity.

#### Scenario: Every named store is mutated independently

- **WHEN** session A mutates a discriminating live value in each of its nine stores
- **THEN** session B retains its own values in all nine stores
- **AND** a symmetric mutation in B does not change A

#### Scenario: Editing histories and playback are independent

- **WHEN** A and B load distinct projects and A selects, edits, undoes, seeks and plays
- **THEN** B's project, selection, undo availability, play state and playhead are unchanged

#### Scenario: Save activity is owned by the triggering session

- **WHEN** only session A makes a save-worthy edit and its debounce/flush completes
- **THEN** only A's supplied persistence/diagnostics path observes that save
- **AND** B receives no save callback or project mutation

### Requirement: Shared durable preferences do not become shared live state

Existing persistence keys and schema versions SHALL remain compatible, but each session SHALL
hydrate and maintain its own live StoreApi, transient state and async request generation. Shared
user libraries and preference substrates SHALL be distinguished from the per-session view that
reads them.

#### Scenario: Hydration produces independent live stores

- **WHEN** two sessions hydrate the same persisted panel, preview, timeline, sticker, keybinding and
  assets-panel preferences
- **THEN** both begin with compatible values but have distinct StoreApi and listener identities
- **AND** an immediate live mutation in A is not synchronously reflected in B

#### Scenario: A later session can read a durable user preference

- **WHEN** session A intentionally persists a user preference and a new session C is created later
- **THEN** C may hydrate that durable value without sharing A's live StoreApi or transient state

#### Scenario: Stale store work stays inside its session

- **WHEN** overlapping sounds or stickers requests complete out of order across two sessions
- **THEN** each completion is checked against its owning store's generation and disposal state
- **AND** it cannot overwrite the other session's results, loading flag or error

### Requirement: Editor React reads declare reactive or imperative intent

Reactive editor consumers SHALL use `useEditor(selector)`. Event-only and orchestration consumers
MAY use the deliberately named `useEditorInstance()` stable-core hook. A no-argument `useEditor()`,
`subscribeNone`, empty subscriber or equivalent non-reactive selector facade SHALL NOT exist.

#### Scenario: A selector reacts only to its session

- **WHEN** matching manager state changes in session A
- **THEN** a selector consumer under A re-renders with A's value
- **AND** the corresponding consumer under B does not re-render from A's change

#### Scenario: Imperative access remains stable

- **WHEN** an event-only consumer renders repeatedly under one session
- **THEN** `useEditorInstance()` returns that session's stable core without subscribing it to all
  manager updates

#### Scenario: Missing session fails loudly for both hooks

- **WHEN** either editor hook is used outside the session provider
- **THEN** it throws an actionable missing-session error and does not create or return a default core

#### Scenario: The forbidden access patterns are mechanically rejected

- **WHEN** the boundary check runs against direct, aliased, whitespace-varied and optional-call
  negative controls
- **THEN** every no-selector or empty-subscriber form is rejected
- **AND** selector and explicitly imperative positive controls pass

### Requirement: Mutable interaction state is session-owned and every retained singleton is classified

The interaction-canceller registry and every request generation associated with a named store SHALL
belong to one session. Remaining module-level editor/renderer state SHALL appear in a committed
ownership inventory as immutable definition data, a content-keyed cache, shared user data, or a
separately deferred resource with a falsifiable reason.

#### Scenario: Cancelling one interaction does not cancel another session

- **WHEN** both sessions register active transform, preview, mask/graph, resize, element or keyframe
  cancellers and session A requests cancellation
- **THEN** only A's registered callbacks run
- **AND** B's interaction remains active

#### Scenario: Disposal clears only the owning registry

- **WHEN** session A is disposed while B has registered cancellers
- **THEN** A's registry is empty and unreachable
- **AND** B's cancellers still run when B requests cancellation

#### Scenario: An unclassified mutable singleton fails the boundary

- **WHEN** a module-created store, default compositor, GPU readiness flag/promise or other mutable
  editor-graph singleton is introduced outside the approved ownership inventory
- **THEN** the session-state boundary check fails with the offending declaration and file

### Requirement: A session owns one explicit runtime compositor handle

Each rendering session SHALL allocate at most one nonzero C0b compositor handle, immediately track
the exact handle in its session resource registry and route all compositor operations through the
handle-keyed API. Preview, snapshot, thumbnail and export paths SHALL receive the owning session
renderer and SHALL NOT import a default compositor.

#### Scenario: Two WebGPU sessions own distinct handles

- **WHEN** two sessions allocate compositors on a runtime reporting WebGPU capacity 2
- **THEN** each session tracks one distinct nonzero handle
- **AND** the runtime live-handle query returns exactly those two handles

#### Scenario: Renderer helpers reuse their session compositor

- **WHEN** preview, snapshot, thumbnail and export work run for one session
- **THEN** they use that session's exact handle rather than allocate extra compositor capacity or
  route through handle 0

#### Scenario: Disposing a session releases only its handle

- **WHEN** session A is disposed while session B remains live
- **THEN** A's exact handle is released once and disappears from the runtime query
- **AND** B's handle and rendering remain valid

#### Scenario: The compatibility handle is absent from the production graph

- **WHEN** both Host-to-session renderer graphs and their transitive compositor calls are inspected
- **THEN** no running caller uses the no-handle/handle-0 compatibility exports

### Requirement: Renderer readiness and asynchronous completion obey session generations

WASM initialization SHALL rely on C0b's coalesced generation-safe runtime rather than a JavaScript
module readiness singleton. Host and renderer continuations SHALL check the owning lifecycle
generation so stale work cannot publish, allocate or render after replacement or disposal.

#### Scenario: Concurrent Host initialization is coalesced without shared session state

- **WHEN** two Hosts or sessions request runtime readiness concurrently
- **THEN** C0b performs one valid initialization generation
- **AND** each resulting session still receives distinct providers, state and compositor ownership

#### Scenario: Disposal during allocation leaves no leaked handle

- **WHEN** a session is disposed while compositor allocation or first render is pending
- **THEN** any returned handle is synchronously tracked then released exactly once
- **AND** no stale continuation publishes a frame or replacement handle

#### Scenario: A stale continuation cannot target a newer session

- **WHEN** Host generation A is replaced by generation B before A's async renderer work completes
- **THEN** A's continuation is rejected and cannot call B's handle or update B's visible state

### Requirement: MigrationDialog observes its owning project's live migration state

`MigrationDialog` SHALL read project migration state through a subscribed selector on the explicit
session core. Its visibility and progress SHALL update without polling and without responding to a
different session's migration.

#### Scenario: A seeded legacy migration is visible through completion

- **WHEN** session A opens seeded legacy storage and migration completion is held
- **THEN** A's dialog becomes visible with the current migration state
- **AND** completing migration updates the selector and removes the dialog

#### Scenario: Migration visibility is isolated

- **WHEN** A is migrating while session B has current storage
- **THEN** B never shows A's dialog or progress and remains usable

### Requirement: Real-browser evidence enforces honest backend-specific preview capacity

A bounded two-session browser harness SHALL ask the live runtime capability before laying out a
second preview and SHALL expose backend, capacity, handles, canvases and independent editor state.
WebGPU and WebGL evidence SHALL run as distinct asserted environments and SHALL never silently
substitute for one another.

#### Scenario: Installed Chrome proves two simultaneous WebGPU previews

- **WHEN** an explicit installed-Chrome executable is launched with
  `--enable-unsafe-webgpu --use-angle=d3d11`
- **THEN** the runtime reports backend `webgpu`, capacity 2 and two distinct live handles
- **AND** two distinct canvases show simultaneously visible frames from independent session state

#### Scenario: WebGPU fallback is not accepted

- **WHEN** the executable path is absent, a different executable launches, the required flags are
  absent, or the runtime does not report WebGPU capacity 2
- **THEN** the WebGPU job fails and cannot relabel bundled Chromium or WebGL evidence as WebGPU

#### Scenario: Bundled Chromium proves WebGL capacity one

- **WHEN** Playwright's bundled Chromium launches the WebGL job
- **THEN** the runtime reports backend `webgl` and capacity 1
- **AND** the first session owns one handle and displays a frame

#### Scenario: A second WebGL preview is explicitly rejected

- **WHEN** the harness requests a second live preview after the first WebGL preview is running
- **THEN** it receives an explicit over-capacity rejection before committing the second layout
- **AND** no second handle appears and the first preview's handle and visible frame remain intact

#### Scenario: Browser state proves session independence, not only capacity

- **WHEN** the two-preview WebGPU harness changes project visuals, selection and playhead in A
- **THEN** B's canvas, selection and playhead remain unchanged while both frames remain visible
