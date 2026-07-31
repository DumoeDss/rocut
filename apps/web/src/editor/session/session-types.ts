/**
 * The Session value and its lifecycle.
 *
 * This is the type the rest of the workstream attaches to: the Automation API
 * (S03) and the embeddable Surface (S04) both hang off it. Nothing here
 * constructs `EditorCore` or touches a manager — replacing the process-global
 * core is C2's, and this change only has to make its replacement *expressible*.
 */
import type {
	GraphicsCapabilityReport,
	ProjectId,
	SessionCapabilities,
	SessionDiagnostics,
	SessionId,
} from "@/editor/ports";
import type { MigrationProgress } from "@/editor/ports";
import type { ResolvedEditorHost } from "@/editor/host/editor-host";
import type { DisposalReport, SessionResources } from "./resources";

export type SessionState =
	| "created"
	| "mounted"
	| "suspended"
	| "disposed";

export type RootState =
	| "mounting"
	| "mounted"
	| "unmounting"
	| "unmounted";

/**
 * What `mount` returns — **synchronously**.
 *
 * Mounting awaits GPU initialisation, which is exactly the slow path
 * `runtime-asset-delivery` already requires a loading state for. If `mount`
 * returned `Promise<EditorSessionRootHandle>`, a Host whose mount never resolved
 * would hold **nothing to unmount** — a more general form of the precise gap E0
 * hit, where no root handle existed at all and true unmount could therefore
 * never be measured. Returning the handle first makes unmount callable at every
 * instant of the lifecycle, including during a mount that is still running or
 * has already failed.
 */
export interface EditorSessionRootHandle {
	readonly sessionId: SessionId;
	readonly container: Element;
	/**
	 * Resolves when the root is usable.
	 *
	 * **Rejects** if mounting failed, or if the root was unmounted before
	 * mounting completed. It must never resolve in either case: `await
	 * handle.ready` is the guard a Host puts in front of touching the mounted
	 * root, and resolving on teardown would walk it straight onto a dead root.
	 */
	readonly ready: Promise<void>;
	readonly state: RootState;
	/** Idempotent. A second call resolves without error. */
	unmount(): Promise<void>;
}

/**
 * The session's observable state.
 *
 * Deliberately not the editor's domain state: C3 owns session-scoping the
 * stores, and a snapshot type that named them here would freeze a shape C3 has
 * not designed yet. What this carries is the lifecycle a Host can already act
 * on.
 */
export interface EditorSessionSnapshot {
	readonly sessionId: SessionId;
	readonly lifecycle: SessionState;
	readonly root: RootState | null;
	readonly graphics: GraphicsCapabilityReport | null;
	readonly migration: MigrationProgress | null;
}

export interface SessionSubscription {
	unsubscribe(): void;
}

/**
 * The session's read surface.
 *
 * There is deliberately **no** member that returns a snapshot without
 * subscribing. `useEditor()` called with no selector currently subscribes with
 * `subscribeNone` (`apps/web/src/editor/use-editor.ts:19,72`), so such a
 * consumer reads once at mount and never re-renders — the mechanism that makes
 * `MigrationDialog` unable to render even now that migration genuinely runs.
 * Repairing that call site is C3's; what this change owes is that the shape
 * cannot be **re-expressed** through the session contract. Reading and
 * subscribing are one operation here, so acquiring a never-updating snapshot is
 * not something a consumer can do by accident.
 */
export interface SessionReadSurface {
	watch<T>(args: {
		select: (snapshot: EditorSessionSnapshot) => T;
		onChange: (value: T) => void;
	}): SessionSubscription;
}

/**
 * Lifecycle ordering, stated once so every operation's out-of-order behaviour is
 * part of the contract rather than of an implementation:
 *
 * - `create`   — the factory. Runs the store's migration exactly once, before
 *                any project load. Yields state `created`.
 * - `mount`    — valid from `created` or `suspended`. **Throws** from `mounted`:
 *                a session has at most one live root. Throws from `disposed`.
 * - `suspend`  — valid from `mounted`. From `suspended` it is a no-op. Retains
 *                identity and project state, which is what distinguishes it from
 *                `unmount`.
 * - `resume`   — valid from `suspended`. From `mounted` it is a no-op.
 * - `unmount`  — valid from any state. Idempotent. Releases the mounted root and
 *                leaves the session `created`.
 * - `dispose`  — valid from any state. Idempotent. **Implies unmount**: a Host is
 *                never required to sequence the two.
 */
export interface EditorSession extends SessionReadSurface {
	readonly id: SessionId;
	readonly state: SessionState;
	readonly host: ResolvedEditorHost;
	readonly resources: SessionResources;
	readonly capabilities: SessionCapabilities;
	readonly diagnostics: SessionDiagnostics;

	/** The project this session was created for. */
	readonly projectId: ProjectId;

	mount(args: { target: Element }): EditorSessionRootHandle;
	suspend(): Promise<void>;
	resume(): Promise<void>;
	unmount(): Promise<void>;
	dispose(): Promise<DisposalReport>;
}
