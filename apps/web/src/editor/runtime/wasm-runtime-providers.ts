import {
	disposeGpu,
	initializeGpu,
	WasmRuntimeGpuResourceQuery,
	WasmRuntimeGraphicsQuery,
} from "opencut-wasm";

import type {
	RuntimeGpuResourceQuery,
	RuntimeGraphicsQuery,
} from "@opencut/editor-ports";

export interface PreparedWasmRuntimeProviders {
	readonly runtimeGraphics: RuntimeGraphicsQuery;
	readonly runtimeGpu: RuntimeGpuResourceQuery;
	dispose(): void | Promise<void>;
}

interface SharedRuntimeLease {
	readonly generation: number;
	owners: number;
	gpuDisposed: boolean;
	finalReleasePending: boolean;
}

interface ProviderReleaseState {
	graphicsReleased: boolean;
	gpuReleased: boolean;
	leaseReleased: boolean;
	finalOwner: boolean;
	disposed: boolean;
	releasePromise: Promise<void> | null;
}

let sharedLease: SharedRuntimeLease | null = null;
let generation = 0;
let transitionTail: Promise<void> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
	const run = transitionTail.then(operation, operation);
	transitionTail = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

async function acquireLease(): Promise<SharedRuntimeLease> {
	return enqueue(async () => {
		if (sharedLease?.finalReleasePending) {
			throw new Error(
				"Cannot acquire a WASM runtime owner while final teardown is pending.",
			);
		}
		if (!sharedLease) {
			// A failed initialize is an observable degraded runtime, but the query
			// wrappers remain useful and can report backend=null/capacity=0.
			try {
				await initializeGpu();
			} catch {
				// Intentionally retain the lease so its owner can inspect the reason.
			}
			sharedLease = {
				generation: ++generation,
				owners: 0,
				gpuDisposed: false,
				finalReleasePending: false,
			};
		}
		sharedLease.owners += 1;
		return sharedLease;
	});
}

async function releaseLease({
	lease,
	graphics,
	gpu,
	state,
}: {
	lease: SharedRuntimeLease;
	graphics: WasmRuntimeGraphicsQuery;
	gpu: WasmRuntimeGpuResourceQuery;
	state: ProviderReleaseState;
}): Promise<void> {
	await enqueue(async () => {
		if (!state.leaseReleased) {
			if (lease.owners <= 0 || sharedLease !== lease) return;
			const isFinalOwner = lease.owners === 1;
			if (isFinalOwner) {
				lease.finalReleasePending = true;
				if (!lease.gpuDisposed) {
					const live = gpu.liveHandles();
					if (live.length > 0) {
						throw new Error(
							`Cannot release final WASM runtime owner while GPU handles are live: ${live.join(", ")}`,
						);
					}
					// A failed shared teardown deliberately leaves both wrappers live. The
					// same owner can reconcile and retry without touching freed bindings.
					disposeGpu();
					lease.gpuDisposed = true;
				}
			}

			lease.owners -= 1;
			state.leaseReleased = true;
			state.finalOwner = isFinalOwner;
		}

		const errors: unknown[] = [];
		if (!state.graphicsReleased) {
			try {
				graphics.free();
				state.graphicsReleased = true;
			} catch (error) {
				errors.push(error);
			}
		}
		if (!state.gpuReleased) {
			try {
				gpu.free();
				state.gpuReleased = true;
			} catch (error) {
				errors.push(error);
			}
		}

		if (errors.length > 0) {
			throw errors.length === 1
				? errors[0]
				: new AggregateError(
						errors,
						"Failed to dispose WASM runtime query wrappers.",
					);
		}

		if (state.finalOwner && lease.owners === 0 && sharedLease === lease) {
			sharedLease = null;
		}
	});
}

function freeUnacquiredQueries({
	graphics,
	gpu,
	cause,
}: {
	graphics?: WasmRuntimeGraphicsQuery;
	gpu?: WasmRuntimeGpuResourceQuery;
	cause: unknown;
}): never {
	const errors = [cause];
	try {
		gpu?.free();
	} catch (error) {
		errors.push(error);
	}
	try {
		graphics?.free();
	} catch (error) {
		errors.push(error);
	}
	if (errors.length === 1) throw cause;
	throw new AggregateError(
		errors,
		"Failed to prepare or roll back WASM runtime query wrappers.",
	);
}

/**
 * Prepare two distinct query wrappers backed by one serialized process lease.
 * The public provider shape stays frozen; only the private ownership lifetime
 * changes so the final owner can invoke C0b's shared disposeGpu() surface.
 */
export async function prepareWasmRuntimeProviders(): Promise<PreparedWasmRuntimeProviders> {
	let graphics: WasmRuntimeGraphicsQuery | undefined;
	let gpu: WasmRuntimeGpuResourceQuery | undefined;
	try {
		graphics = new WasmRuntimeGraphicsQuery();
		gpu = new WasmRuntimeGpuResourceQuery();
	} catch (error) {
		freeUnacquiredQueries({ graphics, gpu, cause: error });
	}

	let lease: SharedRuntimeLease;
	try {
		lease = await acquireLease();
	} catch (error) {
		freeUnacquiredQueries({ graphics, gpu, cause: error });
	}
	// Both are assigned or the constructor/lease failure above has thrown.
	const ownedGraphics = graphics as WasmRuntimeGraphicsQuery;
	const ownedGpu = gpu as WasmRuntimeGpuResourceQuery;
	const state: ProviderReleaseState = {
		graphicsReleased: false,
		gpuReleased: false,
		leaseReleased: false,
		finalOwner: false,
		disposed: false,
		releasePromise: null,
	};

	return {
		runtimeGraphics: {
			selectedBackend: () => ownedGraphics.selectedBackend(),
			concurrentCompositorInstances: () =>
				ownedGraphics.concurrentCompositorInstances(),
			unavailableReason: () => ownedGraphics.unavailableReason(),
		},
		runtimeGpu: {
			liveHandles: () => ownedGpu.liveHandles(),
			release: ({ handle }) => ownedGpu.release({ handle }),
		},
		dispose: () => {
			if (state.disposed) return;
			if (state.releasePromise) return state.releasePromise;
			const releasePromise = releaseLease({
				lease,
				graphics: ownedGraphics,
				gpu: ownedGpu,
				state,
			}).then(() => {
				state.disposed = true;
			});
			state.releasePromise = releasePromise.finally(() => {
				state.releasePromise = null;
			});
			return state.releasePromise;
		},
	};
}
