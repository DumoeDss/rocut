/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- isolated native encoder and renderer doubles exercise cancellation ownership without a GPU. */
import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { VideoEncodingConfig, VideoSample } from "mediabunny";
import type { WasmCompositor } from "../compositor/wasm-compositor";
import type { VideoCache } from "../../video-cache/service";
import type { RootNode } from "../nodes/root-node";
import type { MediaTime } from "../../../wasm/media-time";
import { ExportCancelledError } from "../export-cancellation";

if (process.env.ROCUT_EXPORT_CANCEL_ISOLATED !== "1") {
	test("export cancellation integration runs with isolated native mocks", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: { ...process.env, ROCUT_EXPORT_CANCEL_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0) throw Error(result.stderr.toString());
	});
} else {
	let blocked = true,
		lockHeld = false,
		added = 0,
		cancelledOutputs = 0,
		finalizedOutputs = 0;
	let audioBlocked = false;
	let policyProvidesChroma = true;
	let deferVideoInitialization = false;
	let cleanupBlocked = false;
	let releaseOutputCancel!: () => void;
	let releaseVideoAdd!: () => void;
	let renderDrain: Promise<void> = Promise.resolve();
	let softwareSupported = true,
		capabilityError = false;
	const encoderOptions: unknown[] = [];
	const bitrateRequests: unknown[] = [];
	const audioOptions: unknown[] = [];
	let policyProvidesQuantizer = true;
	let blockQuantizerClose = false;
	const quantizerTimings: unknown[] = [];
	const quantizerLifecycle: string[] = [];
	const quantizerValues: number[] = [];
	mock.module("../export-vp9-quantizer-source", () => ({
		ExportVp9QuantizerSource: class {
			source = { close() {} };
			private readonly signal?: AbortSignal;
			constructor({ options }: { options: { signal?: AbortSignal; quantizer: number } }) {
				this.signal = options.signal;
				quantizerValues.push(options.quantizer);
			}
			async initialize() {
				quantizerLifecycle.push("initialize");
			}
			async add({ timing }: { timing: unknown }) {
				quantizerTimings.push(timing);
			}
			async close() {
				quantizerLifecycle.push("close");
				if (blockQuantizerClose)
					await new Promise<void>((_, reject) =>
						this.signal?.addEventListener(
							"abort",
							() => reject(new ExportCancelledError()),
							{ once: true },
						),
					);
			}
			cancel() {
				quantizerLifecycle.push("cancel");
			}
		},
	}));
	class FakeOutput {
		target = { buffer: new ArrayBuffer(4) };
		addVideoTrack() {}
		addAudioTrack() {}
		async start() {}
		async cancel() {
			cancelledOutputs++;
			if (cleanupBlocked)
				await new Promise<void>((resolve) => {
					releaseOutputCancel = resolve;
				});
		}
		async finalize() {
			quantizerLifecycle.push("finalize");
			finalizedOutputs++;
		}
	}
	mock.module("mediabunny", () => ({
		canEncodeVideo: async () => {
			if (capabilityError) throw Error("capability unavailable");
			return softwareSupported;
		},
		Output: FakeOutput,
		Mp4OutputFormat: class {},
		WebMOutputFormat: class {},
		BufferTarget: class {},
		CanvasSource: class {
			private readonly onEncodedSample?: VideoEncodingConfig["onEncodedSample"];
			// eslint-disable-next-line opencut/prefer-object-params -- matches the third-party CanvasSource constructor used by production.
			constructor(_canvas: unknown, options: VideoEncodingConfig) {
				const { onEncodedSample, ...encoding } = options;
				this.onEncodedSample = onEncodedSample;
				encoderOptions.push(encoding);
			}
			add() {
				added++;
				if (!deferVideoInitialization)
					this.onEncodedSample?.({} as VideoSample);
				return blocked
					? new Promise<void>((resolve) => {
							releaseVideoAdd = () => {
								if (deferVideoInitialization)
									this.onEncodedSample?.({} as VideoSample);
								resolve();
							};
						})
					: Promise.resolve();
			}
			close() {}
		},
		AudioBufferSource: class {
			constructor(options: unknown) {
				audioOptions.push(options);
			}
			add() {
				added++;
				return audioBlocked ? new Promise<void>(() => {}) : Promise.resolve();
			}
			close() {}
		},
		QUALITY_LOW: 1,
		QUALITY_MEDIUM: 2,
		QUALITY_HIGH: 3,
		QUALITY_VERY_HIGH: 4,
	}));
	mock.module("opencut-wasm", () => ({
		mediaTimeToSeconds: ({ time }: { time: number }) => time / 120000,
		resolveVideoExportJson: (request: string) => {
			const input = JSON.parse(request) as {
				codec?: string;
				quality?: string;
				format?: string;
				videoChroma?: string;
				videoQuantizer?: number;
			};
			bitrateRequests.push(input);
			const defaultQuantizer = input.codec === "vp9" && input.format === "webm" &&
				input.quality === "very_high" && input.videoChroma !== "444";
			if ((input.videoQuantizer !== undefined || defaultQuantizer) && policyProvidesQuantizer)
				return JSON.stringify({
					kind: "vp9Quantizer",
					bitrate: 6_000_000,
					quantizer: input.videoQuantizer ?? 8,
					...(defaultQuantizer ? { default: true } : {}),
					keyFrameIntervalFrames: 2,
					nativeConfig: {
						codec: defaultQuantizer
							? "vp09.00.41.08.01.01.13.01.01"
							: "vp09.01.41.08.03.01.13.01.01",
						width: 1920,
						height: 1080,
						displayWidth: 1920,
						displayHeight: 1080,
						bitrate: 6_000_000,
						framerate: 30,
						alpha: "discard",
						bitrateMode: "quantizer",
						latencyMode: "quality",
						hardwareAcceleration: "prefer-software",
					},
				});
			return JSON.stringify({
				bitrate: 6_000_000,
				...(input.videoChroma === "444" && policyProvidesChroma
					? { fullCodecString: "vp09.01.41.08.03.01.13.01.01" }
					: {}),
			});
		},
	}));
	mock.module("../../../wasm", () => ({ TICKS_PER_SECOND: 120000 }));
	mock.module("../../../fps/utils", () => ({ frameRateToFloat: () => 30 }));
	mock.module("../canvas-renderer", () => ({
		CanvasRenderer: class {
			rasterResidencyDomain = { closeTree() {} };
			async retireTree() {}
			fps = { numerator: 30, denominator: 1 };
			async getOutputCanvas() {
				return { width: 1920, height: 1080 };
			}
			async renderAndCapture({ capture }: { capture: () => Promise<void> }) {
				if (lockHeld) throw Error("previous export retained the render lock");
				lockHeld = true;
				let releaseDrain!: () => void;
				renderDrain = new Promise<void>((resolve) => {
					releaseDrain = resolve;
				});
				try {
					await capture();
				} finally {
					lockHeld = false;
					releaseDrain();
				}
			}
		},
	}));
	const { SceneExporter } = await import("../scene-exporter");
	function exporter(audio = false) {
		return new SceneExporter({
			width: 1920,
			height: 1080,
			fps: { numerator: 30, denominator: 1 },
			format: "mp4",
			quality: "high",
			compositor: {} as WasmCompositor,
			videoCache: {} as VideoCache,
			shouldIncludeAudio: audio,
			audioBuffer: audio
				? ({ sampleRate: 48000, numberOfChannels: 1 } as AudioBuffer)
				: undefined,
		});
	}
	const options = {
		rootNode: {} as RootNode,
		range: {
			startTime: 0 as MediaTime,
			endTime: 8000 as MediaTime,
			duration: 8000 as MediaTime,
		},
	};
	function highChromaExporter() {
		return new SceneExporter({
			width: 1920,
			height: 1080,
			fps: { numerator: 30, denominator: 1 },
			format: "webm",
			quality: "very_high",
			videoChroma: "444",
			compositor: {} as WasmCompositor,
			videoCache: {} as VideoCache,
		});
	}
	function quantizerExporter() {
		return new SceneExporter({
			width: 1920,
			height: 1080,
			fps: { numerator: 30, denominator: 1 },
			format: "webm",
			quality: "very_high",
			videoChroma: "444",
			videoQuantizer: 0,
			compositor: {} as WasmCompositor,
			videoCache: {} as VideoCache,
		});
	}
	test("cancel returns promptly while the compositor drains the actual encoder before reuse", async () => {
		const first = exporter();
		let events = 0;
		first.on("cancelled", () => events++);
		const run = first.export(options);
		while (added === 0) await Promise.resolve();
		expect(lockHeld).toBe(true);
		const cancellation = first.cancel();
		expect(
			await Promise.race([cancellation, Bun.sleep(100).then(() => "timeout")]),
		).toBeNull();
		expect(await run).toBeNull();
		expect(events).toBe(1);
		expect(cancelledOutputs).toBe(1);
		let drained = false;
		const observedDrain = renderDrain.then(() => {
			drained = true;
		});
		await Bun.sleep(0);
		// output.cancel has been called, but native completion is still held.
		expect(lockHeld).toBe(true);
		expect(drained).toBe(false);
		releaseVideoAdd();
		await observedDrain;
		expect(lockHeld).toBe(false);
		blocked = false;
		expect(await exporter().export(options)).toBeInstanceOf(ArrayBuffer);
		expect(encoderOptions.at(-1)).toEqual({
			codec: "avc",
			bitrate: 6_000_000,
			hardwareAcceleration: "prefer-software",
		});
		expect(finalizedOutputs).toBe(1);
		expect(bitrateRequests.at(-1)).toEqual({
			codec: "avc",
			format: "mp4",
			quality: "high",
			width: 1920,
			height: 1080,
			frameRate: { numerator: 30, denominator: 1 },
		});
	});
	test("cancel also breaks a stalled audio add", async () => {
		audioBlocked = true;
		added = 0;
		const next = exporter(true);
		const run = next.export(options);
		while (added === 0) await Promise.resolve();
		expect(
			await Promise.race([next.cancel(), Bun.sleep(100).then(() => "timeout")]),
		).toBeNull();
		expect(await run).toBeNull();
		expect(cancelledOutputs).toBe(2);
		expect(audioOptions.at(-1)).toEqual({ codec: "aac", bitrate: 3 });
	});
	test("unsupported or failed optional software probes preserve prior codec and quality", async () => {
		const { resolveExportVideoOptions } =
			await import("../export-video-options");
		const params = {
			codec: "avc" as const,
			bitrate: 8_000_000,
			width: 1920,
			height: 1080,
		};
		softwareSupported = false;
		expect(await resolveExportVideoOptions(params)).toEqual({
			codec: "avc",
			bitrate: 8_000_000,
		});
		capabilityError = true;
		expect(await resolveExportVideoOptions(params)).toEqual({
			codec: "avc",
			bitrate: 8_000_000,
		});
	});
	test("high-chroma uses its Rust plan without falling back to the optional compatibility probe", async () => {
		const original = Object.getOwnPropertyDescriptor(
			globalThis,
			"VideoEncoder",
		);
		const seen: VideoEncoderConfig[] = [];
		Object.defineProperty(globalThis, "VideoEncoder", {
			configurable: true,
			value: {
				isConfigSupported: async (config: VideoEncoderConfig) => {
					seen.push(config);
					return { supported: true, config };
				},
			},
		});
		try {
			blocked = false;
			capabilityError = true;
			expect(await highChromaExporter().export(options)).toBeInstanceOf(
				ArrayBuffer,
			);
			expect(seen).toHaveLength(1);
			expect(seen[0]?.framerate).toBe(30);
			expect(seen[0]?.codec).toBe("vp09.01.41.08.03.01.13.01.01");
			expect(encoderOptions.at(-1)).toEqual({
				codec: "vp9",
				bitrate: 6_000_000,
				fullCodecString: "vp09.01.41.08.03.01.13.01.01",
				hardwareAcceleration: "prefer-software",
			});
			expect(bitrateRequests.at(-1)).toMatchObject({
				videoChroma: "444",
				quality: "very_high",
			});
		} finally {
			if (original) Object.defineProperty(globalThis, "VideoEncoder", original);
			else Reflect.deleteProperty(globalThis, "VideoEncoder");
		}
	});
	test("old WASM policy cannot silently discard a high-chroma export request", async () => {
		const before = encoderOptions.length;
		policyProvidesChroma = false;
		try {
			await expect(highChromaExporter().export(options)).rejects.toThrow(
				"4:4:4 codec plan",
			);
			expect(encoderOptions).toHaveLength(before);
		} finally {
			policyProvidesChroma = true;
		}
	});
	test("cancelling a pending high-chroma query settles startup once and ignores late support", async () => {
		const original = Object.getOwnPropertyDescriptor(
			globalThis,
			"VideoEncoder",
		);
		let release!: () => void;
		let started!: () => void;
		const queryStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		Object.defineProperty(globalThis, "VideoEncoder", {
			configurable: true,
			value: {
				isConfigSupported: (config: VideoEncoderConfig) =>
					new Promise<VideoEncoderSupport>((resolve) => {
						release = () => resolve({ supported: true, config });
						started();
					}),
			},
		});
		try {
			const before = encoderOptions.length;
			const beforeFinalized = finalizedOutputs;
			const next = highChromaExporter();
			let cancelled = 0,
				completed = 0;
			next.on("cancelled", () => cancelled++);
			next.on("complete", () => completed++);
			const pending = next.export(options);
			await queryStarted;
			expect(await next.cancel()).toBeNull();
			expect(await next.cancel()).toBeNull();
			expect(await pending).toBeNull();
			release();
			await Bun.sleep(0);
			expect(cancelled).toBe(1);
			expect(completed).toBe(0);
			expect(finalizedOutputs).toBe(beforeFinalized);
			expect(encoderOptions).toHaveLength(before);
		} finally {
			if (original) Object.defineProperty(globalThis, "VideoEncoder", original);
			else Reflect.deleteProperty(globalThis, "VideoEncoder");
		}
	});
	test("first initialization cancellation returns promptly but retains the capture lock through delayed cleanup", async () => {
		blocked = true;
		deferVideoInitialization = true;
		cleanupBlocked = true;
		const beforeAdded = added;
		const beforeCancelled = cancelledOutputs;
		const beforeFinalized = finalizedOutputs;
		const next = exporter();
		let events = 0;
		next.on("cancelled", () => events++);
		const run = next.export(options);
		while (added === beforeAdded) await Promise.resolve();
		expect(
			await Promise.race([next.cancel(), Bun.sleep(100).then(() => "timeout")]),
		).toBeNull();
		expect(await next.cancel()).toBeNull();
		expect(await run).toBeNull();
		expect(events).toBe(1);
		expect(cancelledOutputs).toBe(beforeCancelled);
		expect(lockHeld).toBe(true);
		releaseVideoAdd();
		while (cancelledOutputs === beforeCancelled) await Promise.resolve();
		expect(lockHeld).toBe(true);
		releaseOutputCancel();
		await renderDrain;
		expect(lockHeld).toBe(false);
		expect(cancelledOutputs).toBe(beforeCancelled + 1);
		expect(finalizedOutputs).toBe(beforeFinalized);
		blocked = false;
		deferVideoInitialization = false;
		cleanupBlocked = false;
	});
	test("explicit quantizer executes Rust cadence and awaits native close before finalize", async () => {
		const beforeCanvas = encoderOptions.length;
		quantizerTimings.length = 0;
		quantizerLifecycle.length = 0;
		const extended = {
			...options,
			range: {
				startTime: 0 as MediaTime,
				endTime: 16000 as MediaTime,
				duration: 16000 as MediaTime,
			},
		};
		expect(await quantizerExporter().export(extended)).toBeInstanceOf(
			ArrayBuffer,
		);
		expect(encoderOptions.length).toBe(beforeCanvas);
		expect(quantizerTimings).toEqual(
			[0, 1, 2, 3].map((i) => ({
				timestamp: i / 30,
				duration: 1 / 30,
				keyFrame: i % 2 === 0,
			})),
		);
		expect(quantizerLifecycle).toEqual(["initialize", "close", "finalize"]);
		expect(bitrateRequests.at(-1)).toMatchObject({
			format: "webm",
			videoQuantizer: 0,
			videoChroma: "444",
		});
	});
	test("default WebM very-high exports send format without an explicit quantizer", async () => {
		const wasBlocked = blocked;
		blocked = false;
		try {
			for (const videoChroma of [undefined, "420"] as const) {
				const beforeCanvas = encoderOptions.length;
				quantizerLifecycle.length = 0;
				quantizerValues.length = 0;
				const next = new SceneExporter({
					width: 1920,
					height: 1080,
					fps: { numerator: 30, denominator: 1 },
					format: "webm",
					quality: "very_high",
					...(videoChroma === undefined ? {} : { videoChroma }),
					compositor: {} as WasmCompositor,
					videoCache: {} as VideoCache,
				});
				expect(await next.export(options)).toBeInstanceOf(ArrayBuffer);
				expect(bitrateRequests.at(-1)).toMatchObject({
					codec: "vp9", quality: "very_high", format: "webm",
				});
				expect(bitrateRequests.at(-1)).not.toHaveProperty("videoQuantizer");
				expect(quantizerValues).toEqual([8]);
				expect(quantizerLifecycle).toEqual(["initialize", "close", "finalize"]);
				expect(encoderOptions.length).toBe(beforeCanvas);
			}
		} finally {
			blocked = wasBlocked;
		}
	});
	test("an old Rust response cannot silently omit the explicit quantizer", async () => {
		policyProvidesQuantizer = false;
		try {
			await expect(quantizerExporter().export(options)).rejects.toThrow(
				"requested VP9 quantizer plan",
			);
		} finally {
			policyProvidesQuantizer = true;
		}
	});
	test("cancel while native close is pending aborts the adapter and cancels Output without finalizing", async () => {
		blockQuantizerClose = true;
		quantizerLifecycle.length = 0;
		const beforeCancelled = cancelledOutputs,
			beforeFinalized = finalizedOutputs;
		const next = quantizerExporter();
		const run = next.export(options);
		while (!quantizerLifecycle.includes("close")) await Promise.resolve();
		await next.cancel();
		expect(await run).toBeNull();
		expect(cancelledOutputs).toBe(beforeCancelled + 1);
		expect(finalizedOutputs).toBe(beforeFinalized);
		expect(quantizerLifecycle.at(-1)).toBe("cancel");
		blockQuantizerClose = false;
	});
}
