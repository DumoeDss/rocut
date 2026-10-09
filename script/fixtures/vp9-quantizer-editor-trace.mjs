import {
	AudioBufferSource,
	CanvasSource,
	EncodedVideoPacketSource,
	Output,
} from "mediabunny";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer.ts";
import { ExportOutputLifetime } from "../../packages/editor-classic/src/services/renderer/export-output-lifetime.ts";
import { ExportVp9QuantizerSource } from "../../packages/editor-classic/src/services/renderer/export-vp9-quantizer-source.ts";

function metadataCopy(metadata) {
	if (!metadata) return undefined;
	const copy = structuredClone(metadata);
	if (copy.decoderConfig?.description)
		copy.decoderConfig.description = [
			...new Uint8Array(copy.decoderConfig.description),
		];
	return copy;
}
function captureFrame(frame) {
	const owned = frame.clone();
	const record = {
		timestamp: owned.timestamp,
		duration: owned.duration,
		colorSpace: owned.colorSpace.toJSON(),
	};
	const bytes = new Uint8Array(owned.codedWidth * owned.codedHeight * 4);
	return owned
		.copyTo(bytes, { format: "BGRA" })
		.then(() => ({ ...record, bytes: [...bytes] }))
		.finally(() => owned.close());
}

/** Transparent observers: every call still executes the original implementation. */
export function installEditorTrace() {
	const restores = [],
		pendingFrames = [];
	const evidence = {
		lifecycle: [],
		actualEncodeOptions: [],
		nativePackets: [],
		packetWrites: [],
		sceneCaptures: [],
		nativeEncodeQueuePeak: 0,
		pendingMuxWritePeak: 0,
		flushCount: 0,
	};
	const patch = (object, name, replacement) => {
		const original = object[name];
		object[name] = replacement(original);
		restores.push(() => {
			object[name] = original;
		});
	};
	const NativeEncoder = globalThis.VideoEncoder;
	globalThis.VideoEncoder = class extends NativeEncoder {
		constructor(init) {
			super({
				...init,
				output: (chunk, metadata) => {
					const bytes = new Uint8Array(chunk.byteLength);
					chunk.copyTo(bytes);
					evidence.nativePackets.push({
						timestamp: chunk.timestamp / 1e6,
						duration: chunk.duration / 1e6,
						type: chunk.type,
						bytes: [...bytes],
						metadata: metadataCopy(metadata),
					});
					init.output(chunk, metadata);
				},
			});
		}
		configure(config) {
			evidence.actualConfigure = structuredClone(config);
			evidence.actualConfigureOwnKeys = Object.keys(config);
			evidence.actualConfigureUndefinedKeys = Object.keys(config).filter(
				(key) => config[key] === undefined,
			);
			return super.configure(config);
		}
		encode(frame, options) {
			pendingFrames.push(captureFrame(frame));
			evidence.actualEncodeOptions.push({
				timestamp: frame.timestamp,
				options: structuredClone(options),
			});
			const result = super.encode(frame, options);
			evidence.nativeEncodeQueuePeak = Math.max(
				evidence.nativeEncodeQueuePeak,
				this.encodeQueueSize,
			);
			return result;
		}
		flush() {
			evidence.flushCount++;
			evidence.lifecycle.push("encoder.flush");
			return super.flush();
		}
	};
	restores.push(() => {
		globalThis.VideoEncoder = NativeEncoder;
	});
	for (const name of ["start", "finalize", "cancel"])
		patch(
			Output.prototype,
			name,
			(original) =>
				function (...args) {
					evidence.lifecycle.push(`output.${name}`);
					return original.apply(this, args);
				},
		);
	for (const [prototype, prefix, names] of [
		[
			ExportVp9QuantizerSource.prototype,
			"adapter",
			["initialize", "add", "close", "cancel"],
		],
		[
			ExportOutputLifetime.prototype,
			"lifetime",
			["markVideoInitialized", "addVideoFrame", "cancel"],
		],
		[AudioBufferSource.prototype, "audio", ["add", "close"]],
		[CanvasSource.prototype, "canvas", ["add", "close"]],
	])
		for (const name of names)
			patch(
				prototype,
				name,
				(original) =>
					function (...args) {
						evidence.lifecycle.push(`${prefix}.${name}`);
						if (prefix === "audio" && name === "add")
							evidence.audioInput = {
								sampleRate: args[0].sampleRate,
								channels: args[0].numberOfChannels,
								samples: [...args[0].getChannelData(0)],
							};
						const result = original.apply(this, args);
						if (result instanceof Promise)
							return result.then((value) => {
								evidence.lifecycle.push(`${prefix}.${name}.resolved`);
								return value;
							});
						return result;
					},
			);
	let pendingWrites = 0;
	patch(
		EncodedVideoPacketSource.prototype,
		"add",
		(original) =>
			async function (packet, metadata) {
				evidence.packetWrites.push({
					timestamp: packet.timestamp,
					duration: packet.duration,
					type: packet.type,
					bytes: [...packet.data],
					metadata: metadataCopy(metadata),
				});
				pendingWrites++;
				evidence.pendingMuxWritePeak = Math.max(
					evidence.pendingMuxWritePeak,
					pendingWrites,
				);
				try {
					return await original.call(this, packet, metadata);
				} finally {
					pendingWrites--;
				}
			},
	);
	patch(
		CanvasRenderer.prototype,
		"renderAndCapture",
		(original) =>
			function (args) {
				return original.call(this, {
					...args,
					capture: (canvas) => {
						const copy = new OffscreenCanvas(canvas.width, canvas.height);
						const context = copy.getContext("2d", { colorSpace: "srgb" });
						context.drawImage(canvas, 0, 0);
						evidence.sceneCaptures.push({
							time: args.time,
							rgba: [
								...context.getImageData(0, 0, canvas.width, canvas.height).data,
							],
						});
						copy.width = copy.height = 1;
						return args.capture(canvas);
					},
				});
			},
	);
	return {
		evidence,
		async frames() {
			return Promise.all(pendingFrames);
		},
		restore() {
			for (const restore of restores.reverse()) restore();
		},
	};
}
