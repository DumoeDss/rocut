import { EncodedPacket, EncodedVideoPacketSource } from "mediabunny";
import type {
	Vp9QuantizerPlatform,
	Vp9QuantizerSourceOptions,
} from "../export-vp9-quantizer-platform";

export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

export const config: VideoEncoderConfig = {
	codec: "vp09.00.10.08",
	width: 16,
	height: 16,
	alpha: "discard",
	bitrateMode: "quantizer",
	latencyMode: "quality",
};

export function fakeVp9() {
	let callbacks!: VideoEncoderInit;
	let dequeue: (() => void) | undefined;
	const submitted: {
		timestamp: number;
		duration?: number;
		options?: VideoEncoderEncodeOptions & { vp9?: { quantizer: number } };
	}[] = [];
	const packets: {
		packet: EncodedPacket;
		metadata?: EncodedVideoChunkMetadata;
	}[] = [];
	const control = {
		created: 0,
		framesClosed: 0,
		sourceClosed: 0,
		encoderClosed: 0,
		frameCloseError: undefined as Error | undefined,
		encodeError: undefined as Error | undefined,
		probe: async (): Promise<VideoEncoderSupport> => ({
			supported: true,
			config,
		}),
		flush: async () => {},
		write: async () => {},
	};
	const encoder = {
		state: "configured" as CodecState,
		encodeQueueSize: 0,
		configure: () => {},
		encode: (...[frame, options]: Parameters<VideoEncoder["encode"]>) => {
			if (control.encodeError) throw control.encodeError;
			submitted.push({
				timestamp: frame.timestamp,
				duration: frame.duration ?? undefined,
				options,
			});
		},
		flush: () => control.flush(),
		close: () => {
			control.encoderClosed++;
			encoder.state = "closed";
		},
		addEventListener: (
			...[_event, listener]: [string, EventListenerOrEventListenerObject]
		) => {
			dequeue = () => {
				const event = new Event("dequeue");
				if (typeof listener === "function") listener(event);
				else listener.handleEvent(event);
			};
		},
		removeEventListener: () => {
			dequeue = undefined;
		},
	};
	const platform: Vp9QuantizerPlatform = {
		isConfigSupported: () => control.probe(),
		createEncoder: (init) => {
			control.created++;
			callbacks = init;
			return encoder;
		},
		createFrame: ({ init }) => ({
			timestamp: init.timestamp ?? 0,
			duration: init.duration ?? null,
			codedWidth: 16,
			codedHeight: 16,
			displayWidth: 16,
			displayHeight: 16,
			codedRect: null,
			visibleRect: null,
			format: null,
			colorSpace: {
				fullRange: null,
				matrix: null,
				primaries: null,
				transfer: null,
				toJSON: () => ({}),
			},
			allocationSize: () => 0,
			clone: () => {
				throw Error("unused");
			},
			copyTo: async () => [],
			close: () => {
				control.framesClosed++;
				if (control.frameCloseError) throw control.frameCloseError;
			},
		}),
		createSource: () => {
			const source = new EncodedVideoPacketSource("vp9");
			source.add = (
				...[packet, metadata]: Parameters<EncodedVideoPacketSource["add"]>
			) => {
				packets.push({ packet, metadata });
				return control.write();
			};
			source.close = () => {
				control.sourceClosed++;
			};
			return source;
		},
		packetFromChunk: (chunk) =>
			new EncodedPacket(
				new Uint8Array(chunk.byteLength),
				chunk.type,
				chunk.timestamp / 1e6,
				(chunk.duration ?? 0) / 1e6,
			),
	};
	const output = ({
		timestamp,
		metadata = {
			decoderConfig: { codec: config.codec, codedWidth: 16, codedHeight: 16 },
		},
		bytes = 4,
		type = "key",
	}: {
		timestamp: number;
		metadata?: EncodedVideoChunkMetadata;
		bytes?: number;
		type?: EncodedVideoChunkType;
	}) =>
		callbacks.output(
			{
				timestamp,
				duration: null,
				byteLength: bytes,
				type,
				copyTo: () => {},
			},
			metadata,
		);
	const error = (value: Error) =>
		callbacks.error(new DOMException(value.message));
	return {
		platform,
		control,
		encoder,
		submitted,
		packets,
		output,
		error,
		dequeue: () => dequeue?.(),
	};
}

export const canvas: OffscreenCanvas = null!;
export const timing = (
	...[timestamp = 0, keyFrame = true]: [number?, boolean?]
) => ({
	timestamp,
	duration: 1 / 30,
	keyFrame,
});
export const options = (
	extra: Partial<Vp9QuantizerSourceOptions> = {},
): Vp9QuantizerSourceOptions => ({ config, quantizer: 0, ...extra });
export async function tick() {
	for (let i = 0; i < 12; i++) await Promise.resolve();
}
