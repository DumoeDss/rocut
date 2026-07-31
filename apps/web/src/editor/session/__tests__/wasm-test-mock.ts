import { mock } from "bun:test";

const TICKS_PER_SECOND = 120_000;
let nextCompositorHandle = 1;
const liveCompositorHandles = new Set<number>();
const compositorCanvases = new Map<
	number,
	{ style: Record<string, string>; width: number; height: number }
>();
const queuedCompositorHandles: number[] = [];
const compositorRenderCalls: Array<{
	handle: number;
	width: number;
	height: number;
}> = [];
const compositorOperations: Array<{
	kind: "create" | "resize" | "render";
	handle: number;
	width: number;
	height: number;
}> = [];

export const wasmTestControl = {
	queueCompositorHandle(handle: number) {
		queuedCompositorHandles.push(handle);
	},
	liveHandles() {
		return [...liveCompositorHandles];
	},
	renderCalls() {
		return [...compositorRenderCalls];
	},
	operations() {
		return [...compositorOperations];
	},
};

class MockBufferTarget {
	buffer: ArrayBuffer | null = null;
}

class MockOutput {
	constructor(
		public readonly options: {
			target: MockBufferTarget;
		},
	) {}
	get target() {
		return this.options.target;
	}
	addVideoTrack() {}
	addAudioTrack() {}
	async start() {}
	async cancel() {}
	async finalize() {
		this.target.buffer = new ArrayBuffer(8);
	}
}

class MockCanvasSource {
	async add() {}
	close() {}
}

class MockAudioBufferSource {
	async add() {}
	close() {}
}

class MockMediaInput {}
class MockMediaSource {}
class MockMediaSink {}

mock.module("mediabunny", () => ({
	Output: MockOutput,
	Mp4OutputFormat: class {},
	WebMOutputFormat: class {},
	BufferTarget: MockBufferTarget,
	CanvasSource: MockCanvasSource,
	AudioBufferSource: MockAudioBufferSource,
	Input: MockMediaInput,
	BlobSource: MockMediaSource,
	AudioBufferSink: MockMediaSink,
	CanvasSink: MockMediaSink,
	VideoSampleSink: MockMediaSink,
	ALL_FORMATS: [],
	QUALITY_LOW: 1,
	QUALITY_MEDIUM: 2,
	QUALITY_HIGH: 3,
	QUALITY_VERY_HIGH: 4,
}));

class MockRuntimeGraphicsQuery {
	selectedBackend() {
		return "webgpu" as const;
	}
	concurrentCompositorInstances() {
		return 2;
	}
	unavailableReason() {
		return "";
	}
	free() {}
}

class MockRuntimeGpuQuery {
	liveHandles() {
		return [...liveCompositorHandles];
	}
	release({ handle }: { handle: number }) {
		liveCompositorHandles.delete(handle);
		compositorCanvases.delete(handle);
	}
	free() {}
}

mock.module("opencut-wasm", () => ({
	TICKS_PER_SECOND: () => TICKS_PER_SECOND,
	applyEffectPasses: () => {},
	applyMaskFeather: () => {},
	// eslint-disable-next-line opencut/prefer-object-params -- mirrors the positional wasm-bindgen API
	createCompositor: (width: number, height: number) => {
		const handle = queuedCompositorHandles.shift() ?? nextCompositorHandle++;
		if (handle === 0) return 0;
		liveCompositorHandles.add(handle);
		compositorCanvases.set(handle, { style: {}, width, height });
		compositorOperations.push({ kind: "create", handle, width, height });
		return handle;
	},
	disposeCompositor: (handle: number) => {
		liveCompositorHandles.delete(handle);
		compositorCanvases.delete(handle);
	},
	formatTimecode: ({ time }: { time: number }) => String(time),
	getCompositorCanvas: () => null,
	getCompositorCanvasForHandle: (handle: number) =>
		compositorCanvases.get(handle) ?? null,
	getLastFrameProfile: () => null,
	initCompositor: () => {},
	initializeGpu: async () => false,
	lastFrameTime: ({ duration }: { duration: number }) => duration,
	mediaTimeFromSeconds: ({ seconds }: { seconds: number }) =>
		Math.round(seconds * TICKS_PER_SECOND),
	mediaTimeToSeconds: ({ time }: { time: number }) => time / TICKS_PER_SECOND,
	parseTimecode: () => null,
	releaseTexture: () => {},
	releaseTextureForHandle: () => {},
	renderFrame: () => {},
	renderFrameForHandle: (
		handle: number,
		frame: { width: number; height: number },
	) => {
		compositorRenderCalls.push({
			handle,
			width: frame.width,
			height: frame.height,
		});
		compositorOperations.push({
			kind: "render",
			handle,
			width: frame.width,
			height: frame.height,
		});
	},
	resizeCompositor: () => {},
	// eslint-disable-next-line opencut/prefer-object-params -- mirrors the positional wasm-bindgen API
	resizeCompositorForHandle: (
		handle: number,
		width: number,
		height: number,
	) => {
		const canvas = compositorCanvases.get(handle);
		if (canvas) {
			canvas.width = width;
			canvas.height = height;
		}
		compositorOperations.push({ kind: "resize", handle, width, height });
	},
	roundToFrame: ({ time }: { time: number }) => Math.round(time),
	snappedSeekTime: ({ time }: { time: number }) => time,
	uploadTexture: () => {},
	uploadTextureForHandle: () => {},
	WasmRuntimeGraphicsQuery: MockRuntimeGraphicsQuery,
	WasmRuntimeGpuResourceQuery: MockRuntimeGpuQuery,
}));
