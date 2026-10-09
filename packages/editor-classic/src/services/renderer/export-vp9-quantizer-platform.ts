import { EncodedPacket, EncodedVideoPacketSource } from "mediabunny";

export type Vp9QuantizerFrameTiming = {
	timestamp: number;
	duration: number;
	keyFrame: boolean;
};

export type Vp9QuantizerSourceOptions = {
	config: VideoEncoderConfig;
	/** Explicit caller policy; no quality label or default quantizer is inferred. */
	quantizer: number;
	maxEncodeQueueSize?: number;
	/** Reserves one slot from frame submission until its packet write settles. */
	maxPendingPackets?: number;
	/** A native output burst exceeding this hard limit fails; no packet is dropped. */
	maxPendingBytes?: number;
	signal?: AbortSignal;
};

export type Vp9QuantizerEncoder = Pick<
	VideoEncoder,
	| "state"
	| "encodeQueueSize"
	| "configure"
	| "encode"
	| "flush"
	| "close"
	| "addEventListener"
	| "removeEventListener"
>;

/** Platform seam for CPU-only lifecycle tests; production uses public APIs only. */
export type Vp9QuantizerPlatform = {
	isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport>;
	createEncoder(init: VideoEncoderInit): Vp9QuantizerEncoder;
	createFrame(options: {
		canvas: HTMLCanvasElement | OffscreenCanvas;
		init: VideoFrameInit;
	}): VideoFrame;
	createSource(): EncodedVideoPacketSource;
	packetFromChunk(chunk: EncodedVideoChunk): EncodedPacket;
};

export const browserVp9QuantizerPlatform: Vp9QuantizerPlatform = {
	isConfigSupported: (config) => {
		if (typeof VideoEncoder === "undefined")
			throw Error("Native VP9 quantizer encoding is unavailable.");
		return VideoEncoder.isConfigSupported(config);
	},
	createEncoder: (init) => new VideoEncoder(init),
	createFrame: ({ canvas, init }) => new VideoFrame(canvas, init),
	createSource: () => new EncodedVideoPacketSource("vp9"),
	packetFromChunk: (chunk) => EncodedPacket.fromEncodedChunk(chunk),
};

export function validateVp9QuantizerOptions(
	options: Vp9QuantizerSourceOptions,
) {
	const { config, quantizer } = options;
	if (!/^vp09\./.test(config.codec) || config.bitrateMode !== "quantizer")
		throw Error("An explicit VP9 quantizer encoder configuration is required.");
	if (config.alpha !== "discard")
		throw Error("VP9 quantizer export requires explicit alpha:discard.");
	if (config.latencyMode === "realtime")
		throw Error(
			"VP9 quantizer export cannot use frame-dropping realtime mode.",
		);
	if (config.scalabilityMode && config.scalabilityMode !== "L1T1")
		throw Error(
			"VP9 quantizer export currently requires a single coding layer.",
		);
	if (!Number.isInteger(quantizer) || quantizer < 0 || quantizer > 63)
		throw Error("VP9 quantizer must be an explicit integer between 0 and 63.");
	const limits = {
		maxEncodeQueueSize: options.maxEncodeQueueSize ?? 4,
		maxPendingPackets: options.maxPendingPackets ?? 16,
		maxPendingBytes: options.maxPendingBytes ?? 32 * 1024 * 1024,
	};
	for (const [name, value] of Object.entries(limits))
		if (!Number.isSafeInteger(value) || value < 1)
			throw Error(`${name} must be a positive safe integer.`);
	if (limits.maxEncodeQueueSize > limits.maxPendingPackets)
		throw Error("The encode queue cannot exceed the reserved packet slots.");
	return limits;
}

export function vp9FrameMicroseconds(timing: Vp9QuantizerFrameTiming) {
	const timestamp = Math.trunc(timing.timestamp * 1e6);
	const duration = Math.trunc(timing.duration * 1e6);
	if (
		!Number.isFinite(timing.timestamp) ||
		timing.timestamp < 0 ||
		!Number.isSafeInteger(timestamp) ||
		!Number.isFinite(timing.duration) ||
		!Number.isSafeInteger(duration) ||
		duration < 1 ||
		typeof timing.keyFrame !== "boolean"
	)
		throw Error(
			"VP9 frames require finite, non-negative time and positive duration.",
		);
	return { timestamp, duration };
}
