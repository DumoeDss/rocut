/**
 * The resource registry implementation.
 *
 * This is the **one** module in the editor graph allowed to call the platform's
 * timer functions directly, because it is the thing that makes every other call
 * site unnecessary. `script/check-port-boundary.mjs` names it explicitly rather
 * than exempting a directory, so a second file cannot quietly inherit the
 * allowance.
 *
 * Workers, audio contexts and object URLs are **not** constructed here either —
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
import { SESSION_RESOURCE_CLASSES } from "./resources";

interface TrackedResource {
	readonly resourceId: ResourceId;
	readonly resourceClass: SessionResourceClass;
	release(): void;
	released: boolean;
	/** Set for `gpuResource` entries only; the runtime's own handle key. */
	gpuHandle?: GpuHandleId;
}

function emptyCounts(): Record<SessionResourceClass, { created: number; released: number }> {
	return {
		timer: { created: 0, released: 0 },
		worker: { created: 0, released: 0 },
		audioContext: { created: 0, released: 0 },
		objectUrl: { created: 0, released: 0 },
		gpuResource: { created: 0, released: 0 },
	};
}

/**
 * `requestAnimationFrame` is absent outside a browser — a headless run (C7) and
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
}): SessionResources & { disposeAll(): DisposalReport } {
	const { runtimeResources, runtimeGpu, nextId } = args;

	/** Acquisition order. Release walks it backwards. */
	const acquired: TrackedResource[] = [];
	const counts = emptyCounts();
	const releaseOrder: SessionResourceRef[] = [];
	/** Every GPU handle this session was told about, released or not. */
	const trackedGpuHandles = new Set<GpuHandleId>();
	let disposed = false;

	function track(args2: {
		resourceClass: SessionResourceClass;
		release: () => void;
	}): TrackedResource {
		const resourceId = nextId({ scope: `resource:${args2.resourceClass}` });
		const entry: TrackedResource = {
			resourceId,
			resourceClass: args2.resourceClass,
			release: args2.release,
			released: false,
		};
		acquired.push(entry);
		counts[args2.resourceClass].created += 1;
		return entry;
	}

	function release(entry: TrackedResource): void {
		if (entry.released) return;
		entry.released = true;
		counts[entry.resourceClass].released += 1;
		releaseOrder.push({
			resourceId: entry.resourceId,
			resourceClass: entry.resourceClass,
		});
		entry.release();
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
		const untracked = live.filter((h) => !trackedGpuHandles.has(h));
		const releasedHandles = new Set(
			acquired
				.filter((e) => e.resourceClass === "gpuResource" && e.released)
				.map((e) => e.gpuHandle)
				.filter((h): h is GpuHandleId => h !== undefined),
		);
		const leaked = live.filter((h) => releasedHandles.has(h));
		return { source, untracked, leaked };
	}

	function report(): DisposalReport {
		const per = {} as Record<SessionResourceClass, ResourceClassReport>;
		for (const cls of SESSION_RESOURCE_CLASSES) {
			per[cls] = {
				created: counts[cls].created,
				released: counts[cls].released,
			};
		}
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

	function makeTimer(args2: {
		kind: TimerHandle["kind"];
		cancel: () => void;
	}): TimerHandle {
		const entry = track({ resourceClass: "timer", release: args2.cancel });
		return {
			resourceId: entry.resourceId,
			kind: args2.kind,
			cancel: () => {
				release(entry);
			},
		};
	}

	return {
		setTimeout: ({ handler, ms }) => {
			assertLive();
			let id: ReturnType<typeof setTimeout> | null = null;
			const entry = track({
				resourceClass: "timer",
				release: () => {
					if (id !== null) clearTimeout(id);
				},
			});
			// Self-releasing: a timeout that has already fired is not a live
			// resource, and counting it as one would make every disposal report of a
			// healthy session look like a leak.
			id = setTimeout(() => {
				release(entry);
				handler();
			}, ms);
			return {
				resourceId: entry.resourceId,
				kind: "timeout",
				cancel: () => {
					release(entry);
				},
			};
		},

		setInterval: ({ handler, ms }) => {
			assertLive();
			const id = setInterval(handler, ms);
			return makeTimer({
				kind: "interval",
				cancel: () => {
					clearInterval(id);
				},
			});
		},

		requestAnimationFrame: ({ handler }) => {
			assertLive();
			const cancel = scheduleFrame(handler);
			return makeTimer({ kind: "animationFrame", cancel });
		},

		createWorker: ({ request }: { request: WorkerRequest }): WorkerHandle => {
			assertLive();
			const handle = runtimeResources.createWorker({ request });
			const entry = track({
				resourceClass: "worker",
				release: () => {
					handle.terminate();
				},
			});
			return {
				...handle,
				resourceId: entry.resourceId,
				postMessage: (a) => {
					handle.postMessage(a);
				},
				onMessage: (l) => handle.onMessage(l),
				onError: (l) => handle.onError(l),
				terminate: () => {
					release(entry);
				},
			};
		},

		createAudioContext: ({
			request,
		}: {
			request?: AudioContextRequest;
		}): AudioContextHandle => {
			assertLive();
			const handle = runtimeResources.createAudioContext({
				request: request ?? {},
			});
			const entry = track({
				resourceClass: "audioContext",
				release: () => {
					void handle.close();
				},
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
					release(entry);
				},
			};
		},

		createObjectUrl: ({ blob }): ObjectUrlHandle => {
			assertLive();
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
					release(entry);
				},
			};
		},

		trackGpuResource: ({ handle, label }): GpuResourceHandle => {
			assertLive();
			trackedGpuHandles.add(handle);
			const entry = track({
				resourceClass: "gpuResource",
				// Release goes through the runtime's own teardown, keyed by its own
				// handle — not through an opaque callback the session cannot relate
				// to anything the runtime reports.
				release: () => {
					runtimeGpu.release({ handle });
				},
			});
			entry.gpuHandle = handle;
			return {
				resourceId: entry.resourceId,
				handle,
				label,
				release: () => {
					release(entry);
				},
			};
		},

		inspect: report,

		disposeAll: () => {
			if (!disposed) {
				disposed = true;
				// Reverse acquisition order: a resource acquired later may depend on
				// one acquired earlier, never the other way round.
				for (let i = acquired.length - 1; i >= 0; i -= 1) {
					const entry = acquired[i];
					if (entry) release(entry);
				}
			}
			return report();
		},
	};
}
