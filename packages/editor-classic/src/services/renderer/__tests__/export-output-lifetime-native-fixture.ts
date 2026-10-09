/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- CPU WebCodecs doubles implement only the surface used by the actual Mediabunny package. */
import { ExportOutputLifetime } from "../export-output-lifetime";

export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

type NativeState = {
	created: number;
	closed: number;
	encoded: number;
	queries: number;
	holdProbe: boolean;
	blockEncode: boolean;
	emitPackets: boolean;
	probe: ReturnType<typeof deferred<VideoEncoderSupport>>;
	probeEntered: ReturnType<typeof deferred<void>>;
	encodeEntered: ReturnType<typeof deferred<void>>;
	config?: VideoEncoderConfig;
	releaseBackpressure?: () => void;
};
let active: NativeState;

class CpuCanvas {
	width = 192;
	height = 128;
	getContext(): never {
		throw Error("This lifecycle fixture must not draw or use a GPU");
	}
}

class CpuFrame {
	codedWidth: number;
	codedHeight: number;
	displayWidth: number;
	displayHeight: number;
	timestamp: number;
	duration: number | null;
	format = "RGBA";
	colorSpace = {
		primaries: "bt709",
		transfer: "iec61966-2-1",
		matrix: "rgb",
		fullRange: true,
	};
	// eslint-disable-next-line opencut/prefer-object-params -- WebCodecs constructor signature.
	constructor(source: CpuCanvas | CpuFrame, init: VideoFrameInit = {}) {
		this.codedWidth =
			source instanceof CpuFrame ? source.codedWidth : source.width;
		this.codedHeight =
			source instanceof CpuFrame ? source.codedHeight : source.height;
		this.displayWidth = this.codedWidth;
		this.displayHeight = this.codedHeight;
		this.timestamp =
			init.timestamp ?? (source instanceof CpuFrame ? source.timestamp : 0);
		this.duration =
			init.duration ?? (source instanceof CpuFrame ? source.duration : null);
	}
	close() {}
	clone() {
		return new CpuFrame(this);
	}
}

class CpuChunk implements EncodedVideoChunk {
	readonly byteLength = 4;
	readonly type = "key" as const;
	readonly timestamp: number;
	readonly duration: number | null;
	constructor(frame: VideoFrame) {
		this.timestamp = frame.timestamp;
		this.duration = frame.duration;
	}
	copyTo(destination: AllowSharedBufferSource): void {
		const target = ArrayBuffer.isView(destination)
			? new Uint8Array(
					destination.buffer,
					destination.byteOffset,
					destination.byteLength,
				)
			: new Uint8Array(destination);
		target.set([0, 0, 0, 0]);
	}
}

class CpuEncoder extends EventTarget {
	private readonly context = active;
	private config!: VideoEncoderConfig;
	state = "unconfigured";
	encodeQueueSize = 0;
	static isConfigSupported(
		config: VideoEncoderConfig,
	): Promise<VideoEncoderSupport> {
		active.queries++;
		active.config = config;
		active.probeEntered.resolve();
		return active.holdProbe
			? active.probe.promise
			: Promise.resolve({ supported: true, config });
	}
	constructor(private readonly callbacks: VideoEncoderInit) {
		super();
		this.context.created++;
	}
	configure(config: VideoEncoderConfig) {
		this.config = config;
		this.state = "configured";
	}
	encode(frame: VideoFrame) {
		this.context.encoded++;
		if (this.context.emitPackets) {
			// Synthetic packet bytes only exercise muxer finalization, not decoding.
			this.callbacks.output(new CpuChunk(frame), {
				decoderConfig: {
					codec: this.config.codec,
					codedWidth: this.config.width,
					codedHeight: this.config.height,
				},
			});
		}
		if (this.context.blockEncode) {
			this.encodeQueueSize = 4;
			this.context.releaseBackpressure = () => {
				this.encodeQueueSize = 0;
				this.dispatchEvent(new Event("dequeue"));
			};
		}
		this.context.encodeEntered.resolve();
	}
	async flush() {}
	close() {
		this.state = "closed";
		this.context.closed++;
	}
}

export async function createNativeFixture({
	holdProbe = false,
	blockEncode = false,
	emitPackets = false,
}: { holdProbe?: boolean; blockEncode?: boolean; emitPackets?: boolean } = {}) {
	const state: NativeState = {
		created: 0,
		closed: 0,
		encoded: 0,
		queries: 0,
		holdProbe,
		blockEncode,
		emitPackets,
		probe: deferred<VideoEncoderSupport>(),
		probeEntered: deferred<void>(),
		encodeEntered: deferred<void>(),
	};
	active = state;
	for (const [name, value] of Object.entries({
		OffscreenCanvas: CpuCanvas,
		VideoFrame: CpuFrame,
		VideoEncoder: CpuEncoder,
		EncodedVideoChunk: CpuChunk,
	})) {
		Object.defineProperty(globalThis, name, { configurable: true, value });
	}
	// Public imports from the real installed package; no Mediabunny module mocks.
	const { Output, BufferTarget, WebMOutputFormat, CanvasSource } =
		await import("mediabunny");
	const output = new Output({
		format: new WebMOutputFormat(),
		target: new BufferTarget(),
	});
	let cancelCalls = 0;
	const lifetime = new ExportOutputLifetime({
		cancel: () => {
			cancelCalls++;
			return output.cancel();
		},
	});
	const source = new CanvasSource(
		new CpuCanvas() as unknown as OffscreenCanvas,
		{
			codec: "vp9",
			bitrate: 369000,
			fullCodecString: "vp09.01.11.08.03.01.13.01.01",
			hardwareAcceleration: "prefer-software",
			latencyMode: "quality",
			onEncodedSample: () => lifetime.markVideoInitialized(),
		},
	);
	output.addVideoTrack(source, { frameRate: 30 });
	await output.start();
	return {
		state,
		output,
		source,
		lifetime,
		cancelCalls: () => cancelCalls,
		add: () => lifetime.addVideoFrame(() => source.add(0, 1 / 30)),
		releaseProbe: (supported = true) =>
			state.probe.resolve({ supported, config: state.config }),
	};
}
