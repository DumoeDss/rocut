import {
	AudioBufferSource,
	BufferTarget,
	CanvasSource,
	EncodedVideoPacketSource,
	Output,
	WebMOutputFormat,
} from "mediabunny";
import { ExportVp9QuantizerSource } from "../../packages/editor-classic/src/services/renderer/export-vp9-quantizer-source.ts";
import { browserVp9QuantizerPlatform } from "../../packages/editor-classic/src/services/renderer/export-vp9-quantizer-platform.ts";
import { decodeContainer } from "./vp9-quantizer-source-decode.mjs";

async function bounded(operation) {
	let timer;
	try {
		return await Promise.race([
			operation,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(Error("VP9 adapter operation exceeded 30 seconds")),
					30000,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
function draw(canvas, frame) {
	const rgba = Uint8ClampedArray.from(frame.bytes);
	for (let index = 0; index < rgba.length; index += 4)
		[rgba[index], rgba[index + 2]] = [rgba[index + 2], rgba[index]];
	canvas
		.getContext("2d", { colorSpace: "srgb" })
		.putImageData(
			new ImageData(rgba, frame.codedWidth, frame.codedHeight),
			0,
			0,
		);
}
function frameCapture(frame) {
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
function serializableMetadata(metadata) {
	if (!metadata) return undefined;
	const copy = structuredClone(metadata);
	if (copy.decoderConfig?.description)
		copy.decoderConfig.description = [
			...new Uint8Array(copy.decoderConfig.description),
		];
	return copy;
}
export async function runAdapterCase({ testCase, audio, cancel = false }) {
	const config = testCase.config;
	const canvas = new OffscreenCanvas(config.width, config.height);
	const target = new BufferTarget();
	const output = new Output({ target, format: new WebMOutputFormat() });
	const captures = [],
		packetWrites = [],
		actualEncodeOptions = [],
		lifecycle = [];
	let actualConfigure,
		nativeEncodeQueuePeak = 0,
		pendingMuxWritePeak = 0,
		pendingWrites = 0,
		flushCount = 0;
	let adapter,
		video,
		outputSettled = false;
	const platform = {
		...browserVp9QuantizerPlatform,
		createSource: () => {
			const source = new EncodedVideoPacketSource("vp9");
			const add = source.add.bind(source);
			source.add = async (packet, metadata) => {
				packetWrites.push({
					timestamp: packet.timestamp,
					duration: packet.duration,
					type: packet.type,
					bytes: [...packet.data],
					metadata: serializableMetadata(metadata),
				});
				pendingWrites++;
				pendingMuxWritePeak = Math.max(pendingMuxWritePeak, pendingWrites);
				try {
					await add(packet, metadata);
				} finally {
					pendingWrites--;
				}
			};
			return source;
		},
		createFrame: (args) => {
			const frame = browserVp9QuantizerPlatform.createFrame(args);
			captures.push(frameCapture(frame));
			return frame;
		},
		createEncoder: (init) => {
			const encoder = new VideoEncoder(init);
			return {
				get state() {
					return encoder.state;
				},
				get encodeQueueSize() {
					return encoder.encodeQueueSize;
				},
				configure: (value) => {
					actualConfigure = structuredClone(value);
					encoder.configure(value);
				},
				encode: (frame, options) => {
					actualEncodeOptions.push({
						timestamp: frame.timestamp,
						options: structuredClone(options),
					});
					encoder.encode(frame, options);
					nativeEncodeQueuePeak = Math.max(
						nativeEncodeQueuePeak,
						encoder.encodeQueueSize,
					);
				},
				flush: () => {
					flushCount++;
					return encoder.flush();
				},
				close: () => encoder.close(),
				addEventListener: (...args) => encoder.addEventListener(...args),
				removeEventListener: (...args) => encoder.removeEventListener(...args),
			};
		},
	};
	if (testCase.adapter) {
		adapter = new ExportVp9QuantizerSource({
			options: {
				config,
				quantizer: testCase.quantizer,
				maxEncodeQueueSize: 1,
				maxPendingPackets: 2,
				maxPendingBytes: 32 * 1024 * 1024,
			},
			platform,
		});
		video = adapter.source;
	} else {
		video = new CanvasSource(canvas, {
			codec: "vp9",
			bitrate: config.bitrate,
			fullCodecString: config.codec,
			hardwareAcceleration: config.hardwareAcceleration,
			onEncoderConfig: (value) => {
				actualConfigure = structuredClone(value);
			},
			onEncodedSample: (sample) => {
				const frame = sample.toVideoFrame();
				try {
					captures.push(frameCapture(frame));
				} finally {
					frame.close();
				}
			},
			onEncodedPacket: (packet, metadata) => {
				packetWrites.push({
					timestamp: packet.timestamp,
					duration: packet.duration,
					type: packet.type,
					bytes: [...packet.data],
					metadata: serializableMetadata(metadata),
				});
			},
		});
	}
	output.addVideoTrack(video, { frameRate: 30 });
	const audioSource = new AudioBufferSource({
		codec: "opus",
		bitrate: audio.bitrate,
		transform: { sampleRate: audio.sampleRate },
	});
	output.addAudioTrack(audioSource);
	try {
		await bounded(output.start());
		lifecycle.push("output.start");
		const buffer = new AudioBuffer({
			numberOfChannels: audio.channels,
			length: audio.samples.length,
			sampleRate: audio.sampleRate,
		});
		buffer.copyToChannel(Float32Array.from(audio.samples), 0);
		await bounded(audioSource.add(buffer));
		audioSource.close();
		lifecycle.push("audio.add/close");
		for (const [index, frame] of testCase.frames.entries()) {
			draw(canvas, frame);
			const timing = {
				timestamp: index / 30,
				duration: 1 / 30,
				keyFrame: frame.options.keyFrame,
			};
			if (adapter) await bounded(adapter.add({ canvas, timing }));
			else
				await bounded(
					video.add(timing.timestamp, timing.duration, frame.options),
				);
			lifecycle.push("video.add");
			if (cancel) break;
		}
		if (cancel) {
			adapter.cancel();
			lifecycle.push("adapter.cancel");
			let closeError;
			try {
				await bounded(adapter.close());
			} catch (error) {
				closeError = { name: error.name, message: error.message };
			}
			await bounded(output.cancel());
			outputSettled = true;
			lifecycle.push("output.cancel");
			return {
				cancelled: true,
				closeError,
				lifecycle,
				frames: await bounded(Promise.all(captures)),
				bufferPublished: target.buffer !== null,
			};
		}
		if (adapter) {
			await bounded(adapter.close());
			lifecycle.push("adapter.close");
		} else {
			video.close();
			lifecycle.push("canvas.close");
		}
		await bounded(output.finalize());
		outputSettled = true;
		lifecycle.push("output.finalize");
		const bytes = new Uint8Array(target.buffer);
		const decoded = await bounded(decodeContainer(bytes));
		return {
			actualConfigure,
			actualEncodeOptions,
			frames: await bounded(Promise.all(captures)),
			packetWrites,
			nativeEncodeQueuePeak,
			pendingMuxWritePeak,
			flushCount,
			lifecycle,
			webm: [...bytes],
			...decoded,
		};
	} finally {
		if (!outputSettled) {
			adapter?.cancel();
			await bounded(output.cancel());
		}
	}
}
