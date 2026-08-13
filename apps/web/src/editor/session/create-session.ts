/**
 * The session factory.
 *
 * **Scope fence, stated in the code because reviewers will look for it.** This
 * factory constructs the session's *lifecycle, resources, capabilities,
 * diagnostics and migration ownership*. It does **not** construct `EditorCore`,
 * touch a manager, a command, a store or a service, and it is called from
 * nothing in the running editor. Replacing the process-global core is C2's;
 * session-scoping the editor's own state is C3's. What this change owes is that
 * their replacement is *expressible* —and that it is expressible without a
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
} from "@opencut/editor-ports";
import {
	deriveGraphicsReport,
	UNIMPLEMENTED_RUNTIME_GPU,
	UNIMPLEMENTED_RUNTIME_GRAPHICS,
} from "@opencut/editor-ports";
import {
	createOwnedSessionEditor,
	releaseEditorForSession,
} from "@/editor/runtime/session-core-owner";
import type { EditorHost, ResolvedEditorHost } from "@opencut/editor-ports/host";
import { resolveEditorHost } from "@opencut/editor-ports/host";
import type { DisposalReport } from "./resources";
import { createSessionResources } from "./session-resources";
import {
	bindEditorSessionStores,
	releaseEditorSessionStores,
} from "@/editor/runtime/session-stores";
import { releaseInteractionCancellers } from "@/editor/cancel-interaction";
import type {
	EditorSession,
	EditorSessionRootHandle,
	EditorSessionSnapshot,
	RootState,
	SessionState,
} from "./session-types";
import { runStoreMigrationOnce } from "./migration-gate";

export { MigrationFailedError } from "./migration-gate";

function isDisposalReport(value: unknown): value is DisposalReport {
	if (typeof value !== "object" || value === null) return false;
	return (
		"timer" in value &&
		"worker" in value &&
		"audioContext" in value &&
		"objectUrl" in value &&
		"gpuResource" in value &&
		"releaseOrder" in value &&
		"gpuReconciliation" in value
	);
}

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
	let admissionOpen = true;
	let transitionTail: Promise<void> = Promise.resolve();

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

	await runStoreMigrationOnce({
		host,
		diagnostics,
		onProgress: (p) => {
			migration = p;
			notify();
		},
	});
	let editor: ReturnType<typeof createOwnedSessionEditor> | null = null;
	let disposalRun: Promise<DisposalReport> | null = null;
	let suspensionRun: Promise<void> | null = null;
	let suspendRequested = false;
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
		if (!admissionOpen || state === "disposed") {
			throw new Error(
				`Cannot ${operation} a disposed session (${id}). Create a new session instead.`,
			);
		}
	}

	function isTransitionClosed(): boolean {
		return !admissionOpen || state === "disposed";
	}

	function enqueueTransition<T>(operation: () => Promise<T> | T): Promise<T> {
		const run = transitionTail.then(operation, operation);
		transitionTail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	/**
	 * Called when a root finishes unmounting, however that was triggered —by
	 * `session.unmount()`, by `dispose()`, or by a Host calling `unmount()` on
	 * the handle it holds. The handle route is the one that matters: a Host
	 * racing an unmount against a route change holds only the handle, and the
	 * session must still land in a defined state.
	 */
	function onRootUnmounted(): void {
		root = null;
		// A suspended session stays suspended when its retained root is removed.
		// `resume()` then returns it to `created`; reopening here would publish the
		// new generation before the core managers have completed their resume phase.
		if (state === "mounted") {
			state = "created";
		}
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
			// A retained root may be attached during a suspended dwell, but attaching
			// it must not publish a mounted/live session while activity admission is
			// still closed. `resume()` performs the manager-ready phase and then
			// publishes `mounted` once the retained root is safe to use.
			if (state !== "suspended" && !suspendRequested) {
				state = "mounted";
			}
			notify();
			return created.handle;
		},

		suspend: () => {
			assertNotDisposed("suspend");
			if (state === "suspended") return Promise.resolve();
			if (suspensionRun) return suspensionRun;
			// Identity and project state are retained —that is what distinguishes
			// suspend from unmount, which releases the mounted root.
			// Close the acquisition/publication gate synchronously before any
			// asynchronous owner is asked to pause.
			resources.beginActivitySuspend();
			suspendRequested = true;
			const run = enqueueTransition(async () => {
				if (isTransitionClosed()) return;
				const results = await Promise.allSettled([
					Promise.resolve().then(() => ownedEditor().suspend()),
					Promise.resolve().then(() => resources.drainActivityResources()),
				]);
				const errors = results.flatMap((result) =>
					result.status === "rejected" ? [result.reason] : [],
				);
				if (errors.length === 1) throw errors[0];
				if (errors.length > 1) {
					throw new AggregateError(
						errors,
						"Failed to suspend editor session activity.",
					);
				}
				if (isTransitionClosed()) return;
				state = "suspended";
				notify();
			}).finally(() => {
				suspendRequested = false;
				if (suspensionRun === run) suspensionRun = null;
			});
			suspensionRun = run;
			return run;
		},

		resume: () => {
			assertNotDisposed("resume");
			if (state !== "suspended" && !suspendRequested) {
				return Promise.resolve();
			}
			return enqueueTransition(async () => {
				if (isTransitionClosed()) return;
				if (state !== "suspended") return;
				// The first core phase prepares managers without acquisition. Admission
				// opens only before the second phase, which may lazily reacquire work.
				try {
					await ownedEditor().prepareActivityResume();
					if (isTransitionClosed()) return;
					resources.prepareActivityResume();
					await ownedEditor().resume();
					if (isTransitionClosed()) return;
					resources.publishActivityResume();
				} catch (error) {
					// A failed resume must not leave a suspended session admitting
					// activity. Dispose/unmount may have advanced the state while Core
					// was awaiting, in which case its synchronous gate already wins.
					resources.beginActivitySuspend();
					try {
						await resources.drainActivityResources();
					} catch (drainError) {
						throw new AggregateError(
							[error, drainError],
							"Failed to resume and requiesce editor session activity.",
						);
					}
					throw error;
				}
				state = root ? "mounted" : "created";
				notify();
			});
		},

		unmount: async () => {
			await unmountRoot();
		},

		dispose: (): Promise<DisposalReport> => {
			if (disposalRun) return disposalRun;
			// Publish one promise before the first await. Concurrent callers therefore
			// join the same teardown instead of both crossing the unmount boundary.
			admissionOpen = false;
			state = "disposed";
			resources.beginActivitySuspend();
			notify();
			disposalRun = enqueueTransition(async () => {
				const errors: unknown[] = [];
				let report: DisposalReport | null = null;
				const attempt = async (operation: () => void | Promise<void>) => {
					try {
						await operation();
					} catch (error) {
						errors.push(error);
					}
				};
				// Close all publication routes before the first asynchronous owner can
				// settle. The transition state above is already synchronously visible.
				await attempt(() => ownedEditor().dispose());
				await attempt(() => releaseInteractionCancellers(session));
				await attempt(() => releaseEditorSessionStores(session));
				// Disposal implies unmount: a Host is never required to sequence them.
				await attempt(unmountRoot);
				try {
					report = await resources.disposeAll();
				} catch (error) {
					errors.push(error);
					const attached =
						typeof error === "object" && error !== null && "report" in error
							? error.report
							: undefined;
					report = isDisposalReport(attached) ? attached : resources.inspect();
				}
				await attempt(() => releaseEditorForSession(session));
				changeListeners.clear();
				eventListeners.clear();
				if (errors.length === 1) throw errors[0];
				if (errors.length > 1) {
					throw Object.assign(
						new AggregateError(errors, "Failed to dispose editor session."),
						{ report },
					);
				}
				return report ?? resources.inspect();
			});
			return disposalRun;
		},

		watch: ({ select, onChange }) => {
			// Read and subscribe are one operation. There is no form that returns a
			// snapshot without subscribing —see `SessionReadSurface`.
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

	try {
		bindEditorSessionStores({ session });
		editor = createOwnedSessionEditor({ session });
	} catch (error) {
		releaseEditorSessionStores(session);
		throw error;
	}
	return session;
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
