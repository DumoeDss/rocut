import {
	WasmRuntimeGpuResourceQuery,
	WasmRuntimeGraphicsQuery,
	evaluateClipTransitions,
	type ClipTransitionsOptions,
	type ClipTransitionsEvaluation,
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

const transitions: (
	options: ClipTransitionsOptions,
) => ClipTransitionsEvaluation = evaluateClipTransitions;
const transitionResult = transitions({
	clips: [
		{
			id: "image",
			trackId: "video",
			start: 0,
			duration: 120000,
			source: { type: "image" },
		},
	],
	links: [],
	frameRate: { numerator: 30, denominator: 1 },
});
const index: number | undefined = transitionResult.accepted[0]?.linkIndex;
const progress: number | undefined =
	transitionResult.accepted[0]?.sample?.progress;
transitions({
	clips: [],
	// @ts-expect-error Incoming/outgoing references are mandatory, not free-form values.
	links: [{ durationFrames: 30 }],
	frameRate: { numerator: 30, denominator: 1 },
});

export { backend, capacity, handles, index, progress };
