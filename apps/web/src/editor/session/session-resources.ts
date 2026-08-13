/**
 * The resource registry implementation.
 *
 * This is the **one** module in the editor graph allowed to call the platform's
 * timer functions directly, because it is the thing that makes every other call
 * site unnecessary. `script/check-port-boundary.mjs` names it explicitly rather
 * than exempting a directory, so a second file cannot quietly inherit the
 * allowance.
 *
 * Workers, audio contexts and object URLs are **not** constructed here either 鈥?
 * they are delegated to the Host's `RuntimeResourceHost`, because who constructs
 * them is an origin decision that belongs to whoever owns the origin. This
 * registry's job is that nothing comes into existence unobserved.
 */
import type {
	AudioContextHandle,
	AudioContextRequest,
	GpuHandleId,
	GpuReconciliation,
	ObjectUrlHandle,
	ResourceId,
	RuntimeGpuResourceQuery,
	RuntimeResourceHost,
	WorkerHandle,
	WorkerRequest,
} from "@/editor/ports";

/**
 * Runtime handles are process-global, while reconciliation is per session.
 * This narrow ownership index prevents session A from reporting session B's
 * legitimate live handle as A's untracked leak. Handles with no owner remain
 * visible as untracked, preserving the acquisition-blindness check for C6.
 */
const claimedGpuHandles = new Map<GpuHandleId, object>();
import { isUnimplementedGpuRuntime } from "@/editor/ports";
import type {
	DisposalReport,
	GpuResourceHandle,
	ResourceClassReport,
	SessionResourceClass,
	SessionResourceRef,
	SessionResources,
	TimerHandle,
} from "./resources";

interface TrackedResource {
	readonly resourceId: ResourceId;
	readonly resourceClass: SessionResourceClass;
	release(): void | Promise<void>;
	/** Once set, a terminal operation will never be invoked again. */
	releaseStarted: boolean;
	released: boolean;
	releaseError?: unknown;
	releasePromise?: Promise<void>;
	/** Set for `gpuResource` entries only; the runtime's own handle key. */
	gpuHandle?: GpuHandleId;
}

/**
 * Internal lifecycle controls used by the owning session.  These methods are
 * deliberately separate from `SessionResources`: callers can acquire and
 * release resources through the public surface, while only the session can
 * close the activity gate during a suspended dwell.
 */
export interface SessionResourceLifecycle {
	setActivityAdmission(admitted: boolean): void;
	beginActivitySuspend(): void;
	drainActivityResources(): Promise<void>;
	prepareActivityResume(): void;
	publishActivityResume(): void;
	subscribeActivityLifecycle(listener: {
		onSuspend?: (args: { generation: number }) => void;
		onResume?: (args: { generation: number }) => void;
	}): () => void;
	isActivityAdmitted(): boolean;
	getActivityGeneration(): number;
	assertActivityGeneration(args: { generation: number }): void;
}

export class SessionActivityGenerationError extends Error {
	readonly expectedGeneration: number;
	readonly actualGeneration: number;

	constructor({
		expectedGeneration,
		actualGeneration,
	}: {
		expectedGeneration: number;
		actualGeneration: number;
	}) {
		super(
			`Session activity generation ${expectedGeneration} is stale because the session was suspended, replaced, or disposed; the live generation is ${actualGeneration}.`,
		);
		this.name = "SessionActivityGenerationError";
		this.expectedGeneration = expectedGeneration;
		this.actualGeneration = actualGeneration;
	}
}

export class SessionResourceReleaseError extends Error {
	readonly resourceClass: SessionResourceClass;
	readonly resourceId: ResourceId;
	readonly cause: unknown;

	constructor({
		resourceClass,
		resourceId,
		cause,
	}: {
		resourceClass: SessionResourceClass;
		resourceId: ResourceId;
		cause: unknown;
	}) {
		super(`Failed to release ${resourceClass} resource ${resourceId}.`, {
			cause,
		});
		this.name = "SessionResourceReleaseError";
		this.resourceClass = resourceClass;
		this.resourceId = resourceId;
		this.cause = cause;
	}
}

function emptyCounts(): Record<
	SessionResourceClass,
	{ created: number; released: number }
> {
	return {
		timer: { created: 0, released: 0 },
		worker: { created: 0, released: 0 },
		audioContext: { created: 0, released: 0 },
		objectUrl: { created: 0, released: 0 },
		gpuResource: { created: 0, released: 0 },
	};
}

/**
 * `requestAnimationFrame` is absent outside a browser 鈥?a headless run (C7) and
 * the test runner both lack it. Falling back to a timer keeps the registry's
 * accounting identical in both environments, which is what the disposal evidence
 * depends on; the frame callback's timing fidelity is not what is under test
 * here.
 */
function scheduleFrame(handler: (time: number) => void): () => void {
	const raf = globalThis.requestAnimationFrame;
	if (typeof raf === "function") {
		const id = raf(handler);
		return () => {
			globalThis.cancelAnimationFrame(id);
		};
	}
	const id = setTimeout(() => {
		handler(Date.now());
	}, 16);
	return () => {
		clearTimeout(id);
	};
}

export function createSessionResources(args: {
	runtimeResources: RuntimeResourceHost;
	runtimeGpu: RuntimeGpuResourceQuery;
	nextId: (args: { scope: string }) => string;
}): SessionResources &
	SessionResourceLifecycle & {
		disposeAll(): Promise<DisposalReport>;
	} {
	const { runtimeResources, runtimeGpu, nextId } = args;

	/** Acquisition order. Release walks it backwards. */
	const acquired: TrackedResource[] = [];
	const counts = emptyCounts();
	const releaseOrder: SessionResourceRef[] = [];
	/** Every GPU handle this session was told about, released or not. */
	const trackedGpuHandles = new Set<GpuHandleId>();
	const gpuOwner = {};
	let disposed = false;
	let activityAdmitted = true;
	let activityGeneration = 0;
	const activityLifecycleListeners = new Set<{
		onSuspend?: (args: { generation: number }) => void;
		onResume?: (args: { generation: number }) => void;
	}>();
	const pendingActivityListenerErrors: unknown[] = [];

	function track(args2: {
		resourceClass: SessionResourceClass;
		release: () => void | Promise<void>;
	}): TrackedResource {
		const resourceId = nextId({ scope: `resource:${args2.resourceClass}` });
		const entry: TrackedResource = {
			resourceId,
			resourceClass: args2.resourceClass,
			release: args2.release,
			releaseStarted: false,
			released: false,
		};
		acquired.push(entry);
		counts[args2.resourceClass].created += 1;
		return entry;
	}

	async function release(entry: TrackedResource): Promise<void> {
		if (entry.released) return;
		if (entry.releasePromise) return entry.releasePromise;
		entry.releaseStarted = true;
		entry.releasePromise = (async () => {
			try {
				await entry.release();
				entry.released = true;
				counts[entry.resourceClass].released += 1;
				releaseOrder.push({
					resourceId: entry.resourceId,
					resourceClass: entry.resourceClass,
				});
			} catch (cause) {
				const error = new SessionResourceReleaseError({
					resourceClass: entry.resourceClass,
					resourceId: entry.resourceId,
					cause,
				});
				entry.releaseError = error;
				throw error;
			}
		})();
		return entry.releasePromise;
	}

	function throwReleaseErrors({
		errors,
		message,
	}: {
		errors: unknown[];
		message: string;
	}): void {
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) throw new AggregateError(errors, message);
	}

	async function drainEntries({
		activityOnly,
	}: {
		activityOnly: boolean;
	}): Promise<void> {
		const errors: unknown[] = [];
		for (let index = acquired.length - 1; index >= 0; index -= 1) {
			const entry = acquired[index];
			if (!entry) continue;
			if (
				activityOnly &&
				entry.resourceClass !== "timer" &&
				entry.resourceClass !== "worker"
			) {
				continue;
			}
			try {
				await release(entry);
			} catch (error) {
				errors.push(error);
			}
		}
		throwReleaseErrors({
			errors,
			message: activityOnly
				? "Failed to suspend session activity resources."
				: "Failed to dispose session resources.",
		});
	}

	/**
	 * Compare the registry against what the runtime still holds.
	 *
	 * This is the only thing that makes the GPU class measurable, because the
	 * session is not in its acquisition path. `untracked` catches a forgotten
	 * `trackGpuResource`; `leaked` catches a teardown that did not take.
	 */
	function reconcileGpu(): GpuReconciliation {
		const source = isUnimplementedGpuRuntime(runtimeGpu)
			? ("unimplemented" as const)
			: ("runtime" as const);
		const live = runtimeGpu.liveHandles();
		const releasedHandles = new Set(
			acquired
				.filter((e) => e.resourceClass === "gpuResource" && e.released)
				.map((e) => e.gpuHandle)
				.filter((h): h is GpuHandleId => h !== undefined),
		);
		const untracked = live.filter(
			(h) => !claimedGpuHandles.has(h) && !releasedHandles.has(h),
		);
		const leaked = live.filter((h) => releasedHandles.has(h));
		return { source, untracked, leaked };
	}

	function report(): DisposalReport {
		const per = {
			timer: {
				created: counts.timer.created,
				released: counts.timer.released,
			},
			worker: {
				created: counts.worker.created,
				released: counts.worker.released,
			},
			audioContext: {
				created: counts.audioContext.created,
				released: counts.audioContext.released,
			},
			objectUrl: {
				created: counts.objectUrl.created,
				released: counts.objectUrl.released,
			},
			gpuResource: {
				created: counts.gpuResource.created,
				released: counts.gpuResource.released,
			},
		} satisfies Record<SessionResourceClass, ResourceClassReport>;
		return {
			timer: per.timer,
			worker: per.worker,
			audioContext: per.audioContext,
			objectUrl: per.objectUrl,
			gpuResource: per.gpuResource,
			releaseOrder: [...releaseOrder],
			gpuReconciliation: reconcileGpu(),
		};
	}

	function assertLive(): void {
		if (disposed) {
			throw new Error(
				"This session's resources have been disposed; acquiring a new one would " +
					"create a resource nothing will ever release.",
			);
		}
	}

	function assertActivityLive(): void {
		assertLive();
		if (!activityAdmitted) {
			throw new Error(
				"Session activity admission is closed while suspended; resume the session " +
					"before acquiring or publishing activity.",
			);
		}
	}

	function isActivityGenerationCurrent(generation: number): boolean {
		return activityAdmitted && !disposed && generation === activityGeneration;
	}

	function assertActivityGeneration(generation: number): void {
		if (generation !== activityGeneration) {
			throw new SessionActivityGenerationError({
				expectedGeneration: generation,
				actualGeneration: activityGeneration,
			});
		}
		assertActivityLive();
	}

	function beginActivitySuspend(): void {
		if (!activityAdmitted) return;
		activityAdmitted = false;
		activityGeneration += 1;
		for (const listener of activityLifecycleListeners) {
			try {
				listener.onSuspend?.({ generation: activityGeneration });
			} catch (error) {
				pendingActivityListenerErrors.push(error);
			}
		}
		// Timer and Worker terminators are invoked synchronously by `release`; the
		// returned drain lets the session await accounting and any attributed error.
		void drainEntries({ activityOnly: true }).catch(() => {});
	}

	function prepareActivityResume(): void {
		assertLive();
		activityAdmitted = true;
	}

	function publishActivityResume(): void {
		assertActivityLive();
		const errors: unknown[] = [];
		for (const listener of activityLifecycleListeners) {
			try {
				listener.onResume?.({ generation: activityGeneration });
			} catch (error) {
				errors.push(error);
			}
		}
		throwReleaseErrors({
			errors,
			message: "Failed to publish resumed session activity.",
		});
	}

	async function drainActivityResources(): Promise<void> {
		const errors = pendingActivityListenerErrors.splice(0);
		try {
			await drainEntries({ activityOnly: true });
		} catch (error) {
			errors.push(error);
		}
		throwReleaseErrors({
			errors,
			message: "Failed to suspend session activity.",
		});
	}

	function makeTimer(args2: {
		kind: TimerHandle["kind"];
		cancel: () => void;
	}): TimerHandle {
		const entry = track({ resourceClass: "timer", release: args2.cancel });
		return {
			resourceId: entry.resourceId,
			kind: args2.kind,
			cancel: () => {
				void release(entry).catch(() => {});
			},
		};
	}

	return {
		setActivityAdmission: (admitted: boolean) => {
			if (admitted) {
				if (activityAdmitted) return;
				prepareActivityResume();
				publishActivityResume();
				return;
			}
			beginActivitySuspend();
		},
		beginActivitySuspend,
		drainActivityResources,
		prepareActivityResume,
		publishActivityResume,
		subscribeActivityLifecycle: (listener) => {
			activityLifecycleListeners.add(listener);
			return () => {
				activityLifecycleListeners.delete(listener);
			};
		},
		isActivityAdmitted: () => activityAdmitted && !disposed,
		getActivityGeneration: () => activityGeneration,
		assertActivityGeneration: ({ generation }) => {
			assertActivityGeneration(generation);
		},

		setTimeout: ({ handler, ms }) => {
			assertActivityLive();
			const generation = activityGeneration;
			let id: ReturnType<typeof setTimeout> | null = null;
			let active = true;
			const entry = track({
				resourceClass: "timer",
				release: () => {
					active = false;
					if (id !== null) clearTimeout(id);
				},
			});
			// Self-releasing: a timeout that has already fired is not a live
			// resource, and counting it as one would make every disposal report of a
			// healthy session look like a leak.
			id = setTimeout(() => {
				if (!active) return;
				active = false;
				void release(entry).catch(() => {});
				if (!isActivityGenerationCurrent(generation)) return;
				handler();
			}, ms);
			return {
				resourceId: entry.resourceId,
				kind: "timeout",
				cancel: () => {
					void release(entry).catch(() => {});
				},
			};
		},

		setInterval: ({ handler, ms }) => {
			assertActivityLive();
			const generation = activityGeneration;
			let active = true;
			const id = setInterval(() => {
				if (!active) return;
				if (!isActivityGenerationCurrent(generation)) return;
				handler();
			}, ms);
			return makeTimer({
				kind: "interval",
				cancel: () => {
					active = false;
					clearInterval(id);
				},
			});
		},

		requestAnimationFrame: ({ handler }) => {
			assertActivityLive();
			const generation = activityGeneration;
			let cancel = () => {};
			let active = true;
			const entry = track({
				resourceClass: "timer",
				release: () => {
					active = false;
					cancel();
				},
			});
			cancel = scheduleFrame((time) => {
				if (!active) return;
				active = false;
				void release(entry).catch(() => {});
				if (!isActivityGenerationCurrent(generation)) return;
				handler(time);
			});
			return {
				resourceId: entry.resourceId,
				kind: "animationFrame",
				cancel: () => {
					void release(entry).catch(() => {});
				},
			};
		},

		createWorker: ({ request }: { request: WorkerRequest }): WorkerHandle => {
			assertActivityLive();
			const generation = activityGeneration;
			const handle = runtimeResources.createWorker({ request });
			const listenerReleases = new Set<() => void>();
			const releaseListeners = () => {
				for (const unsubscribe of [...listenerReleases]) unsubscribe();
			};
			const subscribe = <Event>({
				register,
				listener,
			}: {
				register: (listener: (event: Event) => void) => () => void;
				listener: (event: Event) => void;
			}) => {
				const releaseHostListener = register((event) => {
					if (!isActivityGenerationCurrent(generation)) return;
					listener(event);
				});
				let active = true;
				const unsubscribe = () => {
					if (!active) return;
					active = false;
					listenerReleases.delete(unsubscribe);
					releaseHostListener();
				};
				listenerReleases.add(unsubscribe);
				return unsubscribe;
			};
			const entry = track({
				resourceClass: "worker",
				release: () => {
					try {
						releaseListeners();
					} finally {
						handle.terminate();
					}
				},
			});
			return {
				...handle,
				resourceId: entry.resourceId,
				postMessage: (a) => {
					if (!isActivityGenerationCurrent(generation)) return;
					handle.postMessage(a);
				},
				onMessage: (listener) =>
					subscribe({ register: handle.onMessage.bind(handle), listener }),
				onError: (listener) =>
					subscribe({ register: handle.onError.bind(handle), listener }),
				terminate: () => {
					void release(entry).catch(() => {});
				},
			};
		},

		createAudioContext: ({
			request,
		}: {
			request?: AudioContextRequest;
		}): AudioContextHandle => {
			assertActivityLive();
			const handle = runtimeResources.createAudioContext({
				request: request ?? {},
			});
			const entry = track({
				resourceClass: "audioContext",
				release: () => handle.close(),
			});
			return {
				get state() {
					return handle.state;
				},
				get context() {
					return handle.context;
				},
				sampleRate: handle.sampleRate,
				resourceId: entry.resourceId,
				close: async () => {
					await release(entry);
				},
			};
		},

		createObjectUrl: ({ blob }): ObjectUrlHandle => {
			assertActivityLive();
			const handle = runtimeResources.createObjectUrl({ blob });
			const entry = track({
				resourceClass: "objectUrl",
				release: () => {
					handle.revoke();
				},
			});
			return {
				resourceId: entry.resourceId,
				url: handle.url,
				revoke: () => {
					void release(entry).catch(() => {});
				},
			};
		},

		trackGpuResource: ({ handle, label }): GpuResourceHandle => {
			assertActivityLive();
			const claimedBy = claimedGpuHandles.get(handle);
			if (claimedBy && claimedBy !== gpuOwner) {
				throw new Error(
					`GPU handle ${handle} is already owned by another session.`,
				);
			}
			trackedGpuHandles.add(handle);
			claimedGpuHandles.set(handle, gpuOwner);
			const entry = track({
				resourceClass: "gpuResource",
				// Release goes through the runtime's own teardown, keyed by its own
				// handle 鈥?not through an opaque callback the session cannot relate
				// to anything the runtime reports.
				release: () => {
					try {
						runtimeGpu.release({ handle });
					} finally {
						if (claimedGpuHandles.get(handle) === gpuOwner) {
							claimedGpuHandles.delete(handle);
						}
					}
				},
			});
			entry.gpuHandle = handle;
			return {
				resourceId: entry.resourceId,
				handle,
				label,
				release: () => {
					void release(entry).catch(() => {});
				},
			};
		},

		inspect: report,

		disposeAll: (() => {
			let disposal: Promise<DisposalReport> | null = null;
			return (): Promise<DisposalReport> => {
				if (disposal) return disposal;
				beginActivitySuspend();
				disposed = true;
				activityAdmitted = false;
				disposal = (async () => {
					let drainError: unknown;
					try {
						await drainEntries({ activityOnly: false });
					} catch (error) {
						drainError = error;
					}
					const finalReport = report();
					if (drainError !== undefined) {
						const attributed =
							drainError instanceof Error
								? drainError
								: new Error(String(drainError));
						throw Object.assign(attributed, { report: finalReport });
					}
					return finalReport;
				})();
				return disposal;
			};
		})(),
	};
}
