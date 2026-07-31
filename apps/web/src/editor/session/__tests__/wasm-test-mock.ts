import { mock } from "bun:test";

const TICKS_PER_SECOND = 120_000;
let nextCompositorHandle = 1;
const liveCompositorHandles = new Set<number>();
const compositorCanvases = new Map<
	number,
	{
		style: Record<string, string>;
		width: number;
		height: number;
		handle: number;
		content: string;
	}
>();
const queuedCompositorHandles: number[] = [];
const compositorRenderCalls: Array<{
	handle: number;
	width: number;
	height: number;
}> = [];
const compositorOperations: Array<{
	kind: "create" | "resize" | "render" | "capture";
	handle: number;
	width: number;
	height: number;
}> = [];
const canvasCaptures: Array<{
	handle: number;
	width: number;
	height: number;
	content: string;
	operationIndex: number;
}> = [];
let heldCanvasCapture:
	| {
			entered: () => void;
			wait: Promise<void>;
	  }
	| undefined;
let graphicsFreeCalls = 0;
let gpuFreeCalls = 0;
const graphicsFreeErrors: unknown[] = [];
const gpuFreeErrors: unknown[] = [];

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
	canvasCaptures() {
		return [...canvasCaptures];
	},
	holdNextCanvasCapture() {
		let markEntered!: () => void;
		const entered = new Promise<void>((resolve) => {
			markEntered = resolve;
		});
		let release!: () => void;
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		heldCanvasCapture = { entered: markEntered, wait };
		return { entered, release };
	},
	queueRuntimeWrapperFreeErrors({
		graphics,
		gpu,
	}: {
		graphics?: unknown;
		gpu?: unknown;
	}) {
		if (graphics !== undefined) graphicsFreeErrors.push(graphics);
		if (gpu !== undefined) gpuFreeErrors.push(gpu);
	},
	runtimeWrapperFreeCalls() {
		return { graphics: graphicsFreeCalls, gpu: gpuFreeCalls };
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
	constructor(
		private readonly canvas: {
			width: number;
			height: number;
			handle: number;
			content: string;
		},
	) {}
	async add() {
		const capture = {
			handle: this.canvas.handle,
			width: this.canvas.width,
			height: this.canvas.height,
			content: this.canvas.content,
			operationIndex: compositorOperations.length,
		};
		canvasCaptures.push(capture);
		compositorOperations.push({
			kind: "capture",
			handle: capture.handle,
			width: capture.width,
			height: capture.height,
		});
		const held = heldCanvasCapture;
		heldCanvasCapture = undefined;
		held?.entered();
		await held?.wait;
	}
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
	free() {
		graphicsFreeCalls += 1;
		const error = graphicsFreeErrors.shift();
		if (error !== undefined) throw error;
	}
}

class MockRuntimeGpuQuery {
	liveHandles() {
		return [...liveCompositorHandles];
	}
	release({ handle }: { handle: number }) {
		liveCompositorHandles.delete(handle);
		compositorCanvases.delete(handle);
	}
	free() {
		gpuFreeCalls += 1;
		const error = gpuFreeErrors.shift();
		if (error !== undefined) throw error;
	}
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
		compositorCanvases.set(handle, {
			style: {},
			width,
			height,
			handle,
			content: "unrendered",
		});
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
	// eslint-disable-next-line opencut/prefer-object-params -- mirrors the positional wasm-bindgen API
	renderFrameForHandle: (
		handle: number,
		frame: { width: number; height: number },
	) => {
		const canvas = compositorCanvases.get(handle);
		if (canvas) {
			canvas.content = `handle:${handle}:frame:${compositorRenderCalls.length + 1}`;
		}
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
