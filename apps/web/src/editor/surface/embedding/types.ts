/**
 * The Surface embedding contract — types and decisions only.
 *
 * This module freezes the public `<EditorSurface session={...} />` embedding
 * contract. It is purely additive: no component is wrapped, no listener is
 * registered, no CSS is emitted. The implementation is R1 (mount/focus/lifecycle)
 * and R2 (CSS/React/a11y).
 *
 * The contract consumes S02's frozen {@link EditorSession} and Host port
 * contract; it does not redefine them. Every type below is expressible in terms
 * of `EditorSession`, Host callbacks, and Surface-local types — no OpenCut
 * schema, command class, Zustand store, IndexedDB name, or OPFS path leaks into
 * the public Surface contract.
 */

import type { EditorSession } from "@/editor/session";
import type { EditorSessionRootHandle } from "@/editor/session/session-types";

// ---------------------------------------------------------------------------
// Focus mode
// ---------------------------------------------------------------------------

/**
 * Focus ownership modes for the Surface root container.
 *
 * Each mode is defined by which event listeners are active on the Surface root
 * container (a single DOM element with `tabIndex`), **not** by
 * `window.addEventListener` or focus-trap libraries that claim global state.
 * This naturally supports multiple Surface instances in one document.
 *
 * | Mode      | `tabIndex` | Keyboard shortcuts     | Wheel handling                    | Focus trap |
 * | --------- | ---------- | ---------------------- | --------------------------------- | ---------- |
 * | `passive` | `-1`       | inactive (host retains) | default (page scroll)            | no         |
 * | `focused` | `0`        | active (editor handles) | `preventDefault` inside container | no         |
 * | `full`    | `0`        | active                  | `preventDefault` inside container | yes (Tab cycles within container) |
 *
 * The Surface SHALL NOT claim window-level key or pointer capture in any mode.
 *
 * @see design.md D1 — Focus modes via container-level event delegation.
 */
export type FocusMode = "passive" | "focused" | "full";

// ---------------------------------------------------------------------------
// CSS namespace strategy
// ---------------------------------------------------------------------------

/**
 * The three-layer CSS isolation contract that yields zero host computed-style
 * deltas (the 7 E0 deltas + `body` background must not reproduce in any host).
 *
 * @see design.md D2 — CSS namespace via `data-editor-surface` attribute scoping + CSS `contain`.
 */
export interface CssNamespaceStrategy {
	/**
	 * The `data-editor-surface` attribute value used to scope all editor CSS
	 * custom properties.
	 *
	 * All editor CSS variables (Tailwind's `--background`, `--foreground`,
	 * `--accent`, `--muted`, `--border`, etc.) SHALL be defined on
	 * `[data-editor-surface="<namespaceAttribute>"]`, never on `:root`. The host
	 * supplies this value; the Surface sets it as a data attribute on its root
	 * container. A host element outside the Surface container does not inherit
	 * any editor CSS variable.
	 */
	readonly namespaceAttribute: string;

	/**
	 * CSS containment applied to the Surface root container.
	 *
	 * The Surface root SHALL use `contain: layout style paint` to prevent
	 * layout, style, and paint from bleeding outward into the host.
	 */
	readonly containment: "layout-style-paint";

	/**
	 * Guarantee flag: the editor SHALL NOT set styles on `body`, `html`, or
	 * `:root`.
	 *
	 * No editor CSS rule targets `body`, `html`, or `:root`. The host's `body`
	 * computed style is unchanged from before mount.
	 */
	readonly noBodyOwnership: true;
}

// ---------------------------------------------------------------------------
// Commit-binding seam (A1 = (a): opaque in R0, filled by R1 against T0)
// ---------------------------------------------------------------------------

/**
 * Opaque commit-binding slot for the Surface.
 *
 * R0 declares that the slot exists and has a typed shape, but does NOT define
 * the transaction types it carries. R1 fills the concrete implementation
 * against T0's frozen `read`/`apply`/`getContext`/`watch` types.
 *
 * The `edit` parameter is typed `unknown` deliberately — so no transaction type
 * (`Transaction`, `Revision`, `IdempotencyKey`, `Batch`, `Operation`) is named.
 * R1 replaces `unknown` with T0's frozen types.
 *
 * @see design.md D4 — Commit-binding typed seam (A1=(a)).
 */
export interface SurfaceCommitBinding {
	/**
	 * Commit a user edit through the transaction path.
	 *
	 * @param args.edit - The edit payload. `unknown` in R0; R1 narrows to T0's
	 * frozen transaction types.
	 */
	commit(args: { edit: unknown }): void;
}

// ---------------------------------------------------------------------------
// Lifecycle binding
// ---------------------------------------------------------------------------

/**
 * One lifecycle transition in the Surface↔session binding.
 */
export interface SurfaceLifecycleEntry {
	/** The React or host-driven event that triggers the transition. */
	readonly trigger: string;
	/** The `EditorSession` method called. */
	readonly sessionCall: string;
	/** Why this binding is correct. */
	readonly rationale: string;
}

/**
 * The declared mapping from Surface visibility/lifecycle events to the S02
 * `EditorSession` lifecycle.
 *
 * This is a frozen contract object, not a type parameter: it records the five
 * lifecycle decisions so R1 implements against a frozen mapping, not an ad-hoc
 * interpretation.
 *
 * Key distinction: **unmount is reversible** (retains identity and project
 * state, per `session-types.ts:100-102`); **dispose is irreversible** (per
 * `session-types.ts:102-103`). React component unmount maps to
 * `session.unmount()`. Disposal is the host's decision — the Surface does NOT
 * auto-dispose on unmount, because the host may re-mount the same session
 * (e.g., tab switching).
 *
 * @see design.md D5 — Lifecycle binding via React effects.
 */
export const SurfaceLifecycleBinding = {
	/**
	 * React mount effect → `session.mount`.
	 *
	 * `mount({ target })` returns an `EditorSessionRootHandle` synchronously
	 * (`session-types.ts:116`); `handle.ready` resolves asynchronously
	 * (`session-types.ts:47`). The Surface stores the handle and awaits `ready`
	 * before signalling `onReady`.
	 */
	mount: {
		trigger: "Mount effect (useEffect on mount)",
		sessionCall: "session.mount({ target })",
		rationale:
			"mount returns the handle synchronously; ready resolves async. " +
			"The handle is available for unmount at every instant of the lifecycle.",
	} as const satisfies SurfaceLifecycleEntry,

	/**
	 * `visibility` prop → `'hidden'` → `session.suspend`.
	 *
	 * Drains activity resources (preview/decoder work) through the S02
	 * resource-drain path (`session-types.ts:117`). No parallel suspend
	 * mechanism is invoked.
	 */
	suspend: {
		trigger: "visibility prop transitions to 'hidden'",
		sessionCall: "session.suspend()",
		rationale:
			"The host owns the container and has semantic knowledge the Surface " +
			"lacks (tab visibility, minimized panel, scroll-out). A host-controlled " +
			"prop keeps the Surface deterministic and testable.",
	} as const satisfies SurfaceLifecycleEntry,

	/**
	 * `visibility` prop → `'visible'` → `session.resume`.
	 *
	 * Two-phase resume (prepare managers, then open admission) per the S02
	 * session contract (`session-types.ts:118`).
	 */
	resume: {
		trigger: "visibility prop transitions from 'hidden' to 'visible'",
		sessionCall: "session.resume()",
		rationale:
			"Counterpart to suspend. Preview/decoder work may resume through the " +
			"S02 two-phase resume path.",
	} as const satisfies SurfaceLifecycleEntry,

	/**
	 * React unmount cleanup → `session.unmount`.
	 *
	 * Idempotent per S02 (`session-types.ts:100-102`). Retains identity and
	 * project state — the session returns to the `created` state and may be
	 * re-mounted.
	 */
	unmount: {
		trigger: "Surface component unmounts from the React tree",
		sessionCall: "session.unmount()",
		rationale:
			"Unmount is reversible: the session's identity and project state are " +
			"retained. The host may re-mount the same session (e.g., tab switching).",
	} as const satisfies SurfaceLifecycleEntry,

	/**
	 * Permanent disposal → `session.dispose` (host-driven).
	 *
	 * Irreversible; implies unmount (`session-types.ts:102-103`). The Surface
	 * does NOT auto-dispose on unmount. Disposal is the host's decision, surfaced
	 * through a separate contract surface (`onDispose` callback or a `dispose`
	 * method on the Surface ref).
	 */
	dispose: {
		trigger: "Host-driven permanent removal (not automatic on unmount)",
		sessionCall: "session.dispose()",
		rationale:
			"Dispose is irreversible and implies unmount. Auto-disposing on every " +
			"React unmount would destroy and recreate the session, losing project " +
			"state when the host intends to re-mount (e.g., tab switching).",
	} as const satisfies SurfaceLifecycleEntry,
} as const satisfies Readonly<Record<string, SurfaceLifecycleEntry>>;

// ---------------------------------------------------------------------------
// EditorSurfaceProps — the public embedding contract
// ---------------------------------------------------------------------------

/**
 * Callback fired when the Surface root is ready for interaction.
 *
 * The Surface calls `session.mount({ target })` on mount, stores the returned
 * `EditorSessionRootHandle`, and awaits `handle.ready` before invoking this
 * callback.
 */
export type OnSurfaceReady = () => void;

/**
 * The public embedding contract for `<EditorSurface session={...} />`.
 *
 * This type accepts an {@link EditorSession} and Host callbacks. It creates no
 * implicit global state. It assumes no Next router, page, auth runtime,
 * `h-screen`, `w-screen`, or any viewport-ownership assumption. The Surface
 * fills its container, not the viewport.
 *
 * The Surface does not own canonical save semantics — `EditorSession` and its
 * Host ports own persistence. No `save`, `autosave`, or `persist` method
 * appears on this type or any type it exports.
 *
 * @see spec: embeddable-react-surface
 */
export interface EditorSurfaceProps {
	/**
	 * The editor session to render. This is the only required prop.
	 *
	 * The session is created by the host via `createEditorSession` (S02). The
	 * Surface binds its lifecycle to this session; it does not create or own it.
	 */
	readonly session: EditorSession;

	/**
	 * Focus ownership mode. Defaults to `'passive'`.
	 *
	 * The host MAY drive focus mode programmatically; the Surface MAY request a
	 * mode change through {@link onFocusModeChange}. The prop is the source of
	 * truth.
	 *
	 * @see FocusMode
	 */
	readonly focusMode?: FocusMode;

	/**
	 * Callback invoked when the Surface requests a focus-mode change.
	 *
	 * The prop is the source of truth; this callback is advisory. The host
	 * decides whether to accept the request.
	 */
	readonly onFocusModeChange?: (mode: FocusMode) => void;

	/**
	 * Visibility of the Surface. Defaults to `'visible'`.
	 *
	 * When set to `'hidden'`, the Surface calls `session.suspend()`, which
	 * drains activity resources (preview/decoder work) through the S02
	 * resource-drain path. When set back to `'visible'`, it calls
	 * `session.resume()`.
	 *
	 * The host owns the container and has semantic knowledge the Surface lacks
	 * (the editor may be behind a tab, in a minimized panel, or scrolled out of
	 * view).
	 *
	 * @see SurfaceLifecycleBinding.suspend
	 * @see SurfaceLifecycleBinding.resume
	 */
	readonly visibility?: "visible" | "hidden";

	/**
	 * CSS namespace value for `data-editor-surface` attribute scoping.
	 *
	 * All editor CSS custom properties are scoped to
	 * `[data-editor-surface="<cssNamespace>"]`, never on `:root`. The host
	 * supplies this value; different namespaces allow per-instance theming.
	 * Defaults to `'default'` when omitted.
	 *
	 * @see CssNamespaceStrategy
	 */
	readonly cssNamespace?: string;

	/**
	 * Opaque commit-binding slot (A1=(a)).
	 *
	 * When provided, the Surface routes user edits through this binding. When
	 * absent, the Surface renders without commit wiring. R1 fills the concrete
	 * implementation against T0's frozen types.
	 *
	 * @see SurfaceCommitBinding
	 */
	readonly commitBinding?: SurfaceCommitBinding;

	/**
	 * Callback fired after `handle.ready` resolves on mount.
	 *
	 * @see SurfaceLifecycleBinding.mount
	 */
	readonly onReady?: OnSurfaceReady;

	/**
	 * Callback fired when the Surface encounters an unrecoverable error.
	 */
	readonly onError?: (error: Error) => void;

	/**
	 * Additional class names applied to the Surface root container.
	 *
	 * The Surface root fills its container (`size-full`); this prop allows the
	 * host to add layout classes without wrapping the Surface in an extra div.
	 */
	readonly className?: string;
}
