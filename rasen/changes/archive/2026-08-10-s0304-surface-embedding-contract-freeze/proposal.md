## Why

S02 froze the session factory (`createEditorSession`) and the Host port contract, but left no embedding contract: `EditorRoot` fills its container by layout accident, not by a typed guarantee. A React Host that mounts the editor today has no way to control focus ownership, visibility suspension, or CSS containment, and E0 measured 7 host computed-style deltas plus a `body` background change from the editor's unscoped styles. This change freezes the **public Surface embedding contract** — types and decisions only — so R1 can implement the mount and R2 can prove CSS isolation against it. It authors no component body and wires nothing.

## What Changes

- **New** `EditorSurfaceProps` — the public `<EditorSurface session={...} />` component type: accepts an `EditorSession` and Host callbacks, creates no implicit global state, assumes no Next router / page / auth / `h-screen` / `w-screen` runtime.
- **New** `FocusMode` union (`passive` / `focused` / `full`) and the focus-ownership contract that scopes keyboard / pointer / wheel behaviour per mode without claiming window-level capture.
- **New** `SurfaceLifecycleBinding` — the declared mapping from Surface visibility/lifecycle events to the S02 session lifecycle (`mount` → render, `suspend` → `session.suspend()` stopping preview/decoder work, `unmount`/`dispose` → deterministic cleanup).
- **New** `CssNamespaceStrategy` type and contract documenting the scoping approach that yields zero host computed-style deltas (the 7 E0 deltas + `body` background must not reproduce in any host).
- **New** typed seam for the Surface↔transaction commit binding, left as a consumer slot (per A1=(a)): R0 declares the shape but does not define transaction types.
- **No** changes to `editor-root.tsx` body, no commands, no `ports/`, no `editor-host.ts`. No runtime wiring — R0 authors types + contract documentation only, in new files under `apps/web/src/editor/surface/embedding/**`.

## Capabilities

### New Capabilities

- `embeddable-react-surface`: The public Surface embedding contract — the `<EditorSurface>` component type, focus-mode ownership matrix, CSS/theme namespace strategy, and lifecycle binding to the `EditorSession`. Types and decisions only; no implementation or component wrapping.

### Modified Capabilities

_None._ R0 is purely additive types in new files. It consumes S02's frozen session and Host contract; it does not redefine them or alter any existing requirement.

## Impact

- **New code**: `apps/web/src/editor/surface/embedding/**` — TypeScript types and contract documentation only (no runtime logic, no JSX beyond type declarations).
- **No existing files modified**: `editor-root.tsx`, `create-session.ts`, `editor-host.ts`, `use-editor.ts`, `commands/**`, `ports/**` are all untouched. The Surface wrap is R1's job.
- **Baseline**: S02 product-line tip `feat/session-runtime-host-ports@d84d9d50` (code ship `be9cfc4e`).
- **Type baseline**: ceiling stays 3; no new errors introduced.
- **Build impact**: the new type-only module must compile under `tsc` without affecting either Host's build or parity.
- **Downstream consumers**: R1 (mount/focus/lifecycle) implements against this contract; R2 (CSS/React/a11y) proves it; T0's frozen transaction types are consumed by R1 against the typed seam R0 leaves.
