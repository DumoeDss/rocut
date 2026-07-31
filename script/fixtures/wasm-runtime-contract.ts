import {
	WasmRuntimeGpuResourceQuery,
	WasmRuntimeGraphicsQuery,
} from "opencut-wasm";

type RuntimeGraphicsReport = {
	backend: "webgl" | "webgpu" | null;
	livePreviewLimit: number;
	unavailableReason?: string;
};

interface RuntimeGraphicsQuery {
	selectedBackend(): RuntimeGraphicsReport["backend"];
	concurrentCompositorInstances(): number;
	unavailableReason(): string;
}

interface RuntimeGpuResourceQuery {
	liveHandles(): readonly number[];
	release(input: { handle: number }): void;
}

const graphics: RuntimeGraphicsQuery = new WasmRuntimeGraphicsQuery();
const resources: RuntimeGpuResourceQuery = new WasmRuntimeGpuResourceQuery();

const backend: "webgl" | "webgpu" | null = graphics.selectedBackend();
const capacity: number = graphics.concurrentCompositorInstances();
const handles: readonly number[] = resources.liveHandles();
resources.release({ handle: handles[0] ?? 0 });

export { backend, capacity, handles };
