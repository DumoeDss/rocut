/**
 * The session factory.
 *
 * **Scope fence, stated in the code because reviewers will look for it.** This
 * factory constructs the session's *lifecycle, resources, capabilities,
 * diagnostics and migration ownership*. It does **not** construct `EditorCore`,
 * touch a manager, a command, a store or a service, and it is called from
 * nothing in the running editor. Replacing the process-global core is C2's;
 * session-scoping the editor's own state is C3's. What this change owes is that
 * their replacement is *expressible* — and that it is expressible without a
 * process-global accessor anywhere in the signature.
 */
import type {
	GraphicsCapabilityReport,
	MigrationProgress,
	ProjectId,
	SessionCapabilities,
	SessionDiagnostics,
	SessionEvent,
	SessionId,
	RuntimeGraphicsQuery,
	RuntimeGpuResourceQuery,
} from "@/editor/ports";
import {
	deriveGraphicsReport,
	UNIMPLEMENTED_RUNTIME_GPU,
	UNIMPLEMENTED_RUNTIME_GRAPHICS,
} from "@/editor/ports";
import {
	createOwnedSessionEditor,
	releaseEditorForSession,
} from "@/editor/runtime/session-core-owner";
import type { EditorHost, ResolvedEditorHost } from "@/editor/host/editor-host";
import { resolveEditorHost } from "@/editor/host/editor-host";
import type { DisposalReport } from "./resources";
import { createSessionResources } from "./session-resources";
import type {
	EditorSession,
	EditorSessionRootHandle,
	EditorSessionSnapshot,
	RootState,
	SessionState,
} from "./session-types";

/**
 * The migration run in flight, or completed, per store.
 *
 * Migration belongs to the **store**, because only the store knows its own
 * on-disk schema version — C5's second, non-browser implementation has different
 * legacy data or none at all. The **session** invokes it, exactly once, during
 * `create` and before any project load. Session-*owned* migration was rejected:
 * a second session would re-run it against the same store, or race the first.
 *
 * It memoises the **promise**, not a "started" flag. A flag set before the await
 * lets a second concurrent `createEditorSession` on the same store return while
 * migration is still running — which violates "before any project is loaded" in
 * precisely the two-sessions-in-one-page case the Slice requires. The second
 * caller awaits the first run instead.
 *
 * A `WeakMap`, so "once" means once per store across every session that shares
 * it, and a discarded store does not keep an entry alive. A **failed** run is
 * deleted from the map, so a later attempt retries rather than being permanently
 * poisoned.
 */
const migrationRuns = new WeakMap<object, Promise<void>>();
export interface CreateEditorSessionArgs {
	host: EditorHost;
	/**
	 * The runtime graphics query. C0b supplies the real one; until then the
	 * declared-but-unimplemented placeholder is used and says so in the report.
	 */
	runtimeGraphics?: RuntimeGraphicsQuery;
	/**
	 * The runtime GPU-handle query. Same arrangement, and for the sharper reason:
	 * it is what lets disposal reconcile the registry against what the runtime
	 * actually still holds, for the one resource class the session cannot mediate
	 * acquisition of.
	 */
	runtimeGpu?: RuntimeGpuResourceQuery;
}

export async function createEditorSession(
	args: CreateEditorSessionArgs,
): Promise<EditorSession> {
	const host: ResolvedEditorHost = resolveEditorHost({ host: args.host });
	const runtimeGraphics =
		args.runtimeGraphics ?? UNIMPLEMENTED_RUNTIME_GRAPHICS;

	const id: SessionId = host.ids.next({ scope: "session" });
	const projectId: ProjectId = host.projectId;

	let state: SessionState = "created";
	let root: SessionRoot | null = null;
	let graphicsReport: GraphicsCapabilityReport | null = null;
	let migration: MigrationProgress | null = null;

	const eventListeners = new Set<(event: SessionEvent) => void>();
	const changeListeners = new Set<() => void>();

	function notify(): void {
		changeListeners.forEach((listener) => {
			listener();
		});
	}

	const diagnostics: SessionDiagnostics = {
		log: ({ record }) => {
			host.diagnostics.log({ record });
		},
		event: ({ event }) => {
			host.diagnostics.event({ sessionId: id, event });
			eventListeners.forEach((listener) => {
				listener(event);
			});
		},
		subscribe: (listener) => {
			eventListeners.add(listener);
			return () => {
				eventListeners.delete(listener);
			};
		},
	};

	const resources = createSessionResources({
		runtimeResources: host.runtimeResources,
		runtimeGpu: args.runtimeGpu ?? UNIMPLEMENTED_RUNTIME_GPU,
		nextId: host.ids.next.bind(host.ids),
	});

	const capabilities: SessionCapabilities = {
		graphics: async () => {
			if (!graphicsReport) {
				graphicsReport = deriveGraphicsReport({
					declaration: host.environment.describeGraphics(),
					runtime: runtimeGraphics,
				});
				notify();
			}
			return graphicsReport;
		},
	};

	await runMigrationOnce({
		host,
		diagnostics,
		onProgress: (p) => {
			migration = p;
			notify();
		},
	});
	let editor: ReturnType<typeof createOwnedSessionEditor> | null = null;
	let disposalRun: Promise<DisposalReport> | null = null;
	function ownedEditor(): ReturnType<typeof createOwnedSessionEditor> {
		if (!editor) {
			throw new Error(`Session ${id} has not finished creating its editor.`);
		}
		return editor;
	}

	function snapshot(): EditorSessionSnapshot {
		return {
			sessionId: id,
			lifecycle: state,
			root: root ? root.state : null,
			graphics: graphicsReport,
			migration,
		};
	}

	function assertNotDisposed(operation: string): void {
		if (state === "disposed") {
			throw new Error(
				`Cannot ${operation} a disposed session (${id}). Create a new session instead.`,
			);
		}
	}

	/**
	 * Called when a root finishes unmounting, however that was triggered — by
	 * `session.unmount()`, by `dispose()`, or by a Host calling `unmount()` on
	 * the handle it holds. The handle route is the one that matters: a Host
	 * racing an unmount against a route change holds only the handle, and the
	 * session must still land in a defined state.
	 */
	function onRootUnmounted(): void {
		root = null;
		// From `suspended` too, not only from `mounted`: mount -> suspend ->
		// unmount is reachable, and the contract says unmount leaves the session
		// `created`. Leaving it `suspended` with no root was a state the documented
		// lifecycle does not describe.
		if (state === "mounted" || state === "suspended") state = "created";
		notify();
	}

	async function unmountRoot(): Promise<void> {
		if (!root) return;
		await root.unmount();
	}

	const session: EditorSession = {
		id,
		projectId,
		host,
		resources,
		capabilities,
		diagnostics,

		get state() {
			return state;
		},

		mount: ({ target }) => {
			assertNotDisposed("mount");
			if (root) {
				throw new Error(
					`Session ${id} already has a live root. A session has at most one; ` +
						"unmount the existing root before mounting another.",
				);
			}
			const created = createRoot({
				sessionId: id,
				container: target,
				onStateChange: notify,
				onUnmounted: onRootUnmounted,
			});
			root = created;
			state = "mounted";
			notify();
			return created.handle;
		},

		suspend: async () => {
			assertNotDisposed("suspend");
			if (state === "suspended") return;
			// Identity and project state are retained — that is what distinguishes
			// suspend from unmount, which releases the mounted root.
			state = "suspended";
			ownedEditor().suspend();
			notify();
		},

		resume: async () => {
			assertNotDisposed("resume");
			if (state !== "suspended") return;
			ownedEditor().resume();
			state = root ? "mounted" : "created";
			notify();
		},

		unmount: async () => {
			await unmountRoot();
		},

		dispose: (): Promise<DisposalReport> => {
			if (disposalRun) return disposalRun;
			// Publish one promise before the first await. Concurrent callers therefore
			// join the same teardown instead of both crossing the unmount boundary.
			disposalRun = (async () => {
				// Disposal implies unmount: a Host is never required to sequence them.
				await unmountRoot();
				state = "disposed";
				ownedEditor().dispose();
				const report = resources.disposeAll();
				releaseEditorForSession(session);
				notify();
				changeListeners.clear();
				eventListeners.clear();
				return report;
			})();
			return disposalRun;
		},

		watch: ({ select, onChange }) => {
			// Read and subscribe are one operation. There is no form that returns a
			// snapshot without subscribing — see `SessionReadSurface`.
			let previous = select(snapshot());
			const listener = () => {
				const next = select(snapshot());
				if (Object.is(next, previous)) return;
				previous = next;
				onChange(next);
			};
			changeListeners.add(listener);
			onChange(previous);
			return {
				unsubscribe: () => {
					changeListeners.delete(listener);
				},
			};
		},
	};

	editor = createOwnedSessionEditor({ session });
	return session;
}

/**
 * Raised when the store's migration reported `failed`.
 *
 * Session creation **fails** rather than proceeding. Proceeding would run the
 * editor on data the store itself says is not at the version it expects, with
 * only a diagnostics event to show for it — and, because the run is memoised,
 * no later session would ever retry. Of the two acceptable contracts, refusing
 * is the one that can be relaxed later without breaking a Host; silently
 * proceeding cannot be tightened later without breaking one.
 */
export class MigrationFailedError extends Error {
	constructor(
		readonly from: number | null,
		readonly to: number,
		readonly reason: string,
	) {
		super(
			`The project store's migration failed (${from ?? "unknown"} -> ${to}): ${reason}. ` +
				"The session was not created; the editor must not run against data the store " +
				"reports as un-migrated.",
		);
		this.name = "MigrationFailedError";
	}
}

function runMigrationOnce(args: {
	host: ResolvedEditorHost;
	diagnostics: SessionDiagnostics;
	onProgress: (progress: MigrationProgress) => void;
}): Promise<void> {
	const { host, diagnostics, onProgress } = args;
	const store = host.store;
	if (!store.migrate) return Promise.resolve();

	const existing = migrationRuns.get(store);
	// The second concurrent caller awaits the first run rather than starting a
	// second one, and rather than returning before it finishes.
	if (existing) return existing;

	const run = (async () => {
		const to = store.schemaVersion;
		const from = (await store.persistedSchemaVersion?.()) ?? null;

		diagnostics.event({ event: { kind: "migration-started", from, to } });

		const outcome = await store.migrate!({
			from,
			to,
			report: (progress) => {
				onProgress(progress);
				diagnostics.event({ event: { kind: "migration-progress", progress } });
			},
		});

		if (outcome.status === "failed") {
			diagnostics.event({
				event: {
					kind: "migration-failed",
					from: outcome.from,
					to: outcome.to,
					reason: outcome.reason,
				},
			});
			throw new MigrationFailedError(outcome.from, outcome.to, outcome.reason);
		}

		diagnostics.event({
			event: {
				kind: "migration-finished",
				// From the store's own outcome, which is authoritative about what it
				// actually moved.
				from: outcome.status === "migrated" ? outcome.from : from,
				to: outcome.status === "migrated" ? outcome.to : to,
				recordsMigrated:
					outcome.status === "migrated" ? outcome.recordsMigrated : 0,
			},
		});
	})();

	migrationRuns.set(
		store,
		run.catch((error: unknown) => {
			// A failed run must not poison the store forever: drop the memo so a
			// later attempt retries. The rejection still propagates to this caller.
			migrationRuns.delete(store);
			throw error;
		}),
	);
	return migrationRuns.get(store)!;
}

interface SessionRoot {
	readonly handle: EditorSessionRootHandle;
	readonly state: RootState;
	unmount(): Promise<void>;
}

/**
 * The root handle is constructed and returned **before** mounting completes.
 * See `EditorSessionRootHandle` for why that ordering is the contract.
 */
function createRoot(args: {
	sessionId: SessionId;
	container: Element;
	onStateChange: () => void;
	onUnmounted: () => void;
}): SessionRoot {
	let state: RootState = "mounting";
	let resolveReady: () => void = () => {};
	let rejectReady: (reason: Error) => void = () => {};
	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	// A Host is not required to await `ready`, and an unmount during mounting
	// rejects it. Without this, that ordinary case would surface as an unhandled
	// rejection. The Host's own `await` still sees the rejection.
	ready.catch(() => {});

	// Nothing is rendered into the container by this change. C2 and C3 attach the
	// editor; what exists here is the handle a Host holds and the state machine
	// that makes unmount callable at every instant, including this one.
	queueMicrotask(() => {
		if (state !== "mounting") return;
		state = "mounted";
		resolveReady();
		args.onStateChange();
	});

	const doUnmount = async (): Promise<void> => {
		if (state === "unmounted" || state === "unmounting") {
			// Idempotent: a Host racing an unmount against a route change is the
			// ordinary case, not an error case.
			return;
		}
		const wasMounting = state === "mounting";
		state = "unmounting";
		args.onStateChange();
		// Unmounting during a mount that never completed must still settle `ready`,
		// or a Host awaiting it would hang forever on a root that no longer exists.
		// It settles by **rejecting**: `await handle.ready` must not fall through to
		// `attach()` on a root that is being torn down. Resolving here was the bug —
		// it made the readiness half of the synchronous-mount decision a no-op.
		if (wasMounting) {
			rejectReady(
				new Error(
					`Root for session ${args.sessionId} was unmounted before mounting completed.`,
				),
			);
		}
		state = "unmounted";
		args.onUnmounted();
	};

	const handle: EditorSessionRootHandle = {
		sessionId: args.sessionId,
		container: args.container,
		ready,
		get state() {
			return state;
		},
		unmount: doUnmount,
	};

	return {
		handle,
		get state() {
			return state;
		},
		unmount: doUnmount,
	};
}
