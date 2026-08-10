## Context

S02 froze the session factory and the Host port contract. Verified at `feat/session-runtime-host-ports@be9cfc4e`:

- `createEditorSession({ host, runtimeGraphics?, runtimeGpu? })` returns an `EditorSession` with `mount` / `suspend` / `resume` / `unmount` / `dispose` / `watch` (`session/create-session.ts:82-412`). `mount({ target })` returns an `EditorSessionRootHandle` synchronously — `handle.ready` resolves asynchronously (`create-session.ts:477-485`). `suspend()` drains activity resources and pauses the owned editor; `resume()` re-enters in two phases. `dispose()` implies `unmount` and is idempotent.
- `EditorRoot` (`surface/editor-root.tsx:47-59`) fills its container (`size-full`), not the viewport. It is a layout fact, not a contract. Radix dialogs/dropdowns/toasts portal to `document.body` with fixed positioning — a known, documented deviation.
- `EditorHostContext` (`host/editor-host-context.tsx`) provides `EditorHostBase` (projectId, navigation, services, branding, links) via React context. Runtime port-bearing code receives the complete `EditorHost` through the session.
- `useEditor` (`use-editor.ts:15-59`) subscribes to nine managers (`playback`, `timeline`, `scenes`, `project`, `media`, `renderer`, `selection`, `clipboard`, `diagnostics`) via `useSyncExternalStore`. Each manager has `.subscribe()`.
- The session's `watch` is over the session snapshot only (lifecycle, graphics, migration) — there is no mutation/transaction seam (S03/T0 adds it).

E0 measured 7 host computed-style deltas and a `body` background change from the editor's unscoped Tailwind CSS variables defined at `:root`. E1 confirmed shared React 18 runs end-to-end in a packaged Host (decision A2).

**R0 authors types and contract decisions only.** No component body is wrapped, no event listener is registered, no CSS is emitted. The implementation is R1 (mount/focus/lifecycle) and R2 (CSS/React/a11y).

## Goals / Non-Goals

**Goals:**

- Freeze the public `<EditorSurface session={...} />` component type.
- Decide and record the focus-ownership mechanism (passive / focused / full) without window-level capture.
- Decide and record the CSS/theme namespace strategy that prevents the 7 E0 deltas.
- Decide and record the lifecycle binding to the S02 session (mount → render, suspend → `session.suspend()`, unmount/dispose → cleanup).
- Leave a typed seam for the Surface↔transaction commit binding (per A1=(a)), without defining transaction types.

**Non-Goals:**

- Implementing `<EditorSurface>` or wrapping `EditorRoot` — that is R1.
- Implementing the CSS namespace or proving zero deltas — that is R2.
- Defining transaction types or the commit-binding implementation — that is T0 (types) and R1 (wiring).
- Changing `editor-root.tsx`, `create-session.ts`, `editor-host.ts`, `use-editor.ts`, `ports/**`, or `commands/**`.
- Shadow DOM isolation (incompatible with Radix `document.body` portals).
- Accessibility, error-boundary, or resize coverage — those are R2's acceptance criteria.

## Decisions

### D1 — Focus modes via container-level event delegation, not window-level capture

**Decision.** Each focus mode is defined by which event listeners are active on the Surface root container (a single DOM element with `tabIndex`), not by `window.addEventListener` or focus-trap libraries that claim global state.

| Mode | `tabIndex` | Keyboard shortcuts | Wheel handling | Focus trap |
| --- | --- | --- | --- | --- |
| `passive` | `-1` (focusable, not in tab order) | inactive — host retains | default (page scroll) | no |
| `focused` | `0` (in tab order) | active — editor handles | `preventDefault` inside container (stops page scroll over timeline) | no |
| `full` | `0` | active | `preventDefault` inside container | yes — Tab/Shift+Tab cycle within container |

The Surface root is the single delegation point. Keyboard shortcuts subscribe to `keydown` on the container (not `window`). Wheel `preventDefault` is scoped to the container via `{ passive: false }` listeners attached to the container only.

**Why.** The contract forbids implicit global state. Two Surface instances sharing one `window.addEventListener` would collide. Container-level delegation naturally supports multiple instances and is testable without a full browser.

**Alternatives considered.**

- *(a) Shadow DOM* — natural event + CSS isolation, but Radix UI portals to `document.body`. Shadow DOM's event retargeting would break those portals. Rejected until the dialog/dropdown system is refactored, which is out of scope (not Now).
- *(b) `focus-trap` library with global capture* — claims window-level state; incompatible with the no-global-state contract.
- *(c) Document-level focus guard elements* — fragile, pollutes host DOM, hard to reason about with multiple instances.

### D2 — CSS namespace via `data-editor-surface` attribute scoping + CSS `contain`

**Decision.** The CSS namespace strategy has three layers, all declared as contract guarantees:

1. **Attribute-scoped variables.** All editor CSS custom properties (Tailwind's `--background`, `--foreground`, `--accent`, `--muted`, `--border`, etc.) SHALL be defined on `[data-editor-surface="<namespace>"]`, never on `:root`. The host supplies the `namespace` value; the Surface sets it as a data attribute on its root container.
2. **CSS containment.** The Surface root SHALL use `contain: layout style paint` to prevent layout, style, and paint from bleeding outward into the host.
3. **No `body` ownership.** The editor SHALL NOT set styles on `body`, `html`, or `:root`. The `bg-background` class that currently sits on `EditorRoot`'s root div stays inside the container; no equivalent leaks to `body`.

This is verifiable by the E0 method: snapshot host computed styles before mount, mount the Surface, snapshot again, diff must be empty.

**Why.** E0 measured 7 host computed-style deltas + a `body` background change because the editor's CSS defines variables at `:root` and sets `body` styles. Data-attribute scoping is compatible with Tailwind (variables are re-homed, not re-architected), doesn't require Shadow DOM, naturally namespaces per-instance (different namespaces = different themes), and is verifiable by the same measurement method.

**Alternatives considered.**

- *(a) Shadow DOM* — rejected for the same Radix-portal reason as D1.
- *(b) CSS-in-JS runtime (Emotion, styled-components)* — introduces a runtime dependency the contract should not require; Tailwind's utility classes would need full replacement.
- *(c) iframe isolation* — complete isolation but breaks accessibility (separate document context), focus management, and adds a heavyweight boundary for what is a CSS-scoping problem.
- *(d) Tailwind `prefix`* — partial: would re-prefix class names but does not address `:root` variable leaking or `body` style ownership. High rebuild cost, low coverage.

### D3 — Visibility suspension via host-controlled `visibility` prop

**Decision.** The Surface accepts a `visibility: 'visible' | 'hidden'` prop (default `'visible'`). When the host sets it to `'hidden'`, the Surface calls `session.suspend()`, which drains activity resources (preview/decoder work) through the S02 resource-drain path. When set back to `'visible'`, it calls `session.resume()`.

**Why.** The host owns the container and has semantic knowledge the Surface lacks: the editor may be behind a tab, in a minimized panel, or scrolled out of view. An `IntersectionObserver` inside the Surface would only detect viewport intersection, not tab-level visibility. The Page Visibility API is a global singleton the contract should not assume. A host-controlled prop keeps the Surface deterministic and testable.

**Alternatives considered.**

- *(a) IntersectionObserver inside the Surface* — incomplete: misses tab visibility changes.
- *(b) Page Visibility API* — global singleton; wrong for a multi-instance embeddable component.
- *(c) Host calls `session.suspend()` directly* — rejected: the spec requires the visibility-suspend binding to be owned by the Surface ("not a parallel mechanism"). If the host calls suspend directly, the Surface's internal state desynchronizes from the session's lifecycle.

### D4 — Commit-binding typed seam (A1=(a))

**Decision.** `EditorSurfaceProps` includes an optional `commitBinding?: SurfaceCommitBinding` slot. `SurfaceCommitBinding` is an opaque interface — R0 declares that the slot exists and has a typed shape, but does NOT define the transaction types it carries. R1 fills the concrete implementation against T0's frozen `read`/`apply`/`getContext`/`watch` types.

The slot's declared shape captures only what the Surface needs to know: a way to commit a user edit. It does not name `Transaction`, `Revision`, `IdempotencyKey`, or any T0 type.

**Why.** A1 ruled (a): the commit binding is consumed by R1, not frozen in R0. This preserves the `T0 ∥ R0` concurrency edge. The slot makes the commit path explicit in the frozen contract without coupling R0 to T0's output. Without the slot, R1 would have to invent the binding point — risking a design where the Surface has no typed commit path.

**Alternatives considered.**

- *(a) No slot in R0; R1 adds the binding* — rejected: makes the commit capability invisible in the frozen contract.
- *(b) Full transaction types in R0* — rejected by A1=(a); forfeits the concurrency edge and creates a circular self-dependency.

### D5 — Lifecycle binding via React effects

**Decision.** The Surface binds to the session lifecycle through React effects:

| React lifecycle | Session call | Rationale |
| --- | --- | --- |
| Mount effect (`useEffect` on mount) | `session.mount({ target })` → store `EditorSessionRootHandle`, await `handle.ready`, then `onReady` | `mount` returns synchronously; `ready` resolves async. Host gets the handle immediately. |
| `visibility` prop → `'hidden'` | `session.suspend()` | Stops preview/decoder work via S02 resource drain. |
| `visibility` prop → `'visible'` | `session.resume()` | Two-phase resume (prepare managers, then open admission). |
| Unmount cleanup | `session.unmount()` | Idempotent per S02. Retains identity and project state. |
| Permanent disposal (host-driven) | `session.dispose()` | Idempotent, implies unmount. The host owns the disposal decision — the Surface does NOT auto-dispose on unmount, because the host may re-mount the same session. |

The key distinction: **unmount is reversible** (retains identity and project state, per `session-types.ts:100-102`); **dispose is irreversible** (per `session-types.ts:103`). React component unmount maps to `session.unmount()`. Disposal is the host's decision, surfaced through a separate contract surface (`onDispose` callback or a `dispose` method on the Surface ref).

**Why.** React effects are the correct lifecycle boundary for DOM operations. The session's synchronous-handle-then-async-ready pattern (`create-session.ts:477-485`) aligns with React's effect model: the effect runs after DOM insertion, calls `mount`, and the handle is available before `ready` resolves.

**Alternatives considered.**

- *(a) Constructor-time mount* — rejected: the DOM target does not exist during construction in React.
- *(b) Auto-dispose on unmount* — rejected: the host may re-mount the same session (e.g., tab switching). Disposing on every unmount would destroy and recreate the session, losing project state.

## Risks / Trade-offs

- **Radix portals break CSS containment** → The `contain: layout style paint` on the Surface root cannot contain elements portaled to `document.body` (Radix dialogs, dropdowns, toasts). R2 must address portal styling separately (e.g., scoped portal containers or theme-variable inheritance through the portal). R0 records this as a known limitation; the contract guarantees zero host deltas for the Surface root, not for portaled overlays.
- **`data-editor-surface` attribute may conflict with host attributes** → Mitigated by the host-supplied `namespace` value, which is arbitrary. The host chooses a namespace that does not collide.
- **Focus-trap in `full` mode is imperfect without window capture** → A determined user can Tab out of the container if the host has focusable elements after it in the DOM. This is acceptable: `full` mode provides *practical* focus containment, not a hard trap. R1 may add guard elements if the acceptance test requires it.
- **`commitBinding` slot may not match T0's final types** → Mitigated by A1=(a): R1 consumes T0's frozen types. If the slot shape is incompatible, R1 adapts the binding; R0's contract is not invalidated because the slot is opaque.
