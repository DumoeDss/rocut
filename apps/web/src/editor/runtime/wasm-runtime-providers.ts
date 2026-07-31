import {
	initializeGpu,
	WasmRuntimeGpuResourceQuery,
	WasmRuntimeGraphicsQuery,
} from "opencut-wasm";

import type {
	RuntimeGpuResourceQuery,
	RuntimeGraphicsQuery,
} from "@/editor/ports";

export interface PreparedWasmRuntimeProviders {
	readonly runtimeGraphics: RuntimeGraphicsQuery;
	readonly runtimeGpu: RuntimeGpuResourceQuery;
	dispose(): void;
}

/**
 * Await C0b's generation-safe/coalesced initialization and adapt its exact
 * query objects to the frozen C1 contracts. No backend or capacity value is
 * accepted from the Host.
 */
export async function prepareWasmRuntimeProviders(): Promise<PreparedWasmRuntimeProviders> {
	try {
		await initializeGpu();
	} catch {
		// A failed acquisition is still a live runtime observation. The query
		// reports backend=null/capacity=0 and carries the runtime's reason.
	}

	const graphics = new WasmRuntimeGraphicsQuery();
	const gpu = new WasmRuntimeGpuResourceQuery();
	let disposed = false;

	return {
		runtimeGraphics: {
			selectedBackend: () => graphics.selectedBackend(),
			concurrentCompositorInstances: () =>
				graphics.concurrentCompositorInstances(),
			unavailableReason: () => graphics.unavailableReason(),
		},
		runtimeGpu: {
			liveHandles: () => gpu.liveHandles(),
			release: ({ handle }) => gpu.release({ handle }),
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			graphics.free();
			gpu.free();
		},
	};
}
