import EventEmitter from "eventemitter3";

import {
	Output,
	Mp4OutputFormat,
	WebMOutputFormat,
	BufferTarget,
	CanvasSource,
	AudioBufferSource,
	QUALITY_LOW,
	QUALITY_MEDIUM,
	QUALITY_HIGH,
	QUALITY_VERY_HIGH,
} from "mediabunny";
import type { FrameRate } from "opencut-wasm";
import { mediaTimeToSeconds } from "opencut-wasm";
import { TICKS_PER_SECOND } from "../../wasm";
import type { ResolvedMediaTimeRange } from "../../wasm";
import { frameRateToFloat } from "../../fps/utils";
import type { RootNode } from "./nodes/root-node";
import type { ExportFormat, ExportQuality } from "../../export";
import {
	CanvasRenderer,
	type RendererPublicationGuard,
	type RendererPublicationToken,
} from "./canvas-renderer";
import type { WasmCompositor } from "./compositor/wasm-compositor";
import type { VideoCache } from "../video-cache/service";
import {
	ExportCancelledError,
	waitForExportOperation,
} from "./export-cancellation";
import { resolveExportVideoOptions } from "./export-video-options";
import { resolveExportVideoBitrate } from "./export-video-bitrate";
import { cancelPendingRenderFrames } from "./cancel-tree";
import {
	assertRenderNotAborted,
	isRenderCancelledError,
} from "./compositor/render-request";

type ExportParams = {
	width: number;
	height: number;
	fps: FrameRate;
	format: ExportFormat;
	quality: ExportQuality;
	shouldIncludeAudio?: boolean;
	audioBuffer?: AudioBuffer;
	compositor: WasmCompositor;
	videoCache: VideoCache;
	publicationGuard?: RendererPublicationGuard;
};

const qualityMap = {
	low: QUALITY_LOW,
	medium: QUALITY_MEDIUM,
	high: QUALITY_HIGH,
	very_high: QUALITY_VERY_HIGH,
};

export type SceneExporterEvents = {
	progress: [progress: number];
	complete: [buffer: ArrayBuffer];
	error: [error: Error];
	cancelled: [];
};

export class SceneExporter extends EventEmitter<SceneExporterEvents> {
	private renderer: CanvasRenderer;
	private format: ExportFormat;
	private quality: ExportQuality;
	private shouldIncludeAudio: boolean;
	private audioBuffer?: AudioBuffer;
	private readonly publicationGuard?: RendererPublicationGuard;
	private readonly publicationToken: RendererPublicationToken | null;

	private isCancelled = false;
	private readonly cancellation = new AbortController();
	private exportPromise: Promise<ArrayBuffer | null> | null = null;
	private rootNode: RootNode | null = null;

	constructor({
		width,
		height,
		fps,
		format,
		quality,
		shouldIncludeAudio,
		audioBuffer,
		compositor,
		videoCache,
		publicationGuard,
	}: ExportParams) {
		super();
		this.renderer = new CanvasRenderer({
			width,
			height,
			fps,
			compositor,
			videoCache,
			publicationGuard,
		});

		this.format = format;
		this.quality = quality;
		this.shouldIncludeAudio = shouldIncludeAudio ?? false;
		this.audioBuffer = audioBuffer;
		this.publicationGuard = publicationGuard;
		this.publicationToken = publicationGuard?.capture() ?? null;
	}

	cancel(): Promise<ArrayBuffer | null> {
		this.isCancelled = true;
		this.cancellation.abort();
		cancelPendingRenderFrames(this.rootNode);
		return this.exportPromise ?? Promise.resolve(null);
	}

	export({
		rootNode,
		range,
	}: {
		rootNode: RootNode;
		range: ResolvedMediaTimeRange;
	}): Promise<ArrayBuffer | null> {
		if (!this.exportPromise) {
			this.rootNode = rootNode;
			this.exportPromise = this.runExport({ rootNode, range })
				.catch((error: unknown) => {
					// Startup (including a queued compositor acquisition) precedes the
					// output transaction, but still owns a request-scoped cancellation.
					if (isRenderCancelledError(error)) {
						this.emit("cancelled");
						return null;
					}
					throw error;
				})
				.finally(() => {
					cancelPendingRenderFrames(rootNode);
					this.rootNode = null;
				});
		}
		return this.exportPromise;
	}

	private async runExport({
		rootNode,
		range,
	}: {
		rootNode: RootNode;
		range: ResolvedMediaTimeRange;
	}): Promise<ArrayBuffer | null> {
		if (this.isCancelled) {
			this.emit("cancelled");
			return null;
		}
		this.assertPublicationCurrent();
		const fps = this.renderer.fps;
		const fpsFloat = frameRateToFloat(fps);
		const ticksPerFrame = Math.round(
			(TICKS_PER_SECOND * fps.denominator) / fps.numerator,
		);
		const frameCount = Math.floor(range.duration / ticksPerFrame);

		const outputFormat =
			this.format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat();

		const output = new Output({
			format: outputFormat,
			target: new BufferTarget(),
		});

		const outputCanvas = await this.renderer.getOutputCanvas({
			signal: this.cancellation.signal,
		});
		this.assertPublicationCurrent();
		const codec = this.format === "webm" ? "vp9" : "avc";
		const bitrate = resolveExportVideoBitrate({
			codec,
			quality: this.quality,
			frameRate: fps,
			width: outputCanvas.width,
			height: outputCanvas.height,
		});
		const videoOptions = await resolveExportVideoOptions({
			codec,
			bitrate,
			width: outputCanvas.width,
			height: outputCanvas.height,
		});
		this.assertPublicationCurrent();
		const videoSource = new CanvasSource(outputCanvas, videoOptions);

		output.addVideoTrack(videoSource, { frameRate: fpsFloat });

		let audioSource: AudioBufferSource | null = null;
		if (this.shouldIncludeAudio && this.audioBuffer) {
			let audioCodec: "aac" | "opus" = this.format === "webm" ? "opus" : "aac";

			if (audioCodec === "aac" && typeof AudioEncoder !== "undefined") {
				const { supported } = await AudioEncoder.isConfigSupported({
					codec: "mp4a.40.2",
					sampleRate: this.audioBuffer.sampleRate,
					numberOfChannels: this.audioBuffer.numberOfChannels,
					bitrate: 192000,
				});
				this.assertPublicationCurrent();
				if (!supported) audioCodec = "opus";
			}

			audioSource = new AudioBufferSource({
				codec: audioCodec,
				bitrate: qualityMap[this.quality],
				// Chromium's implicit 44.1k -> Opus resampler loses its flush tail
				// (and adds onset latency). Feed its native 48k clock explicitly.
				...(audioCodec === "opus" ? { transform: { sampleRate: 48000 } } : {}),
			});
			output.addAudioTrack(audioSource);
		}

		let outputStarted = false;
		let outputSettled = false;
		try {
			await output.start();
			outputStarted = true;
			this.assertPublicationCurrent();

			if (audioSource && this.audioBuffer) {
				const source = audioSource;
				const buffer = this.audioBuffer;
				await waitForExportOperation({
					signal: this.cancellation.signal,
					operation: () => source.add(buffer),
				});
				this.assertPublicationCurrent();
				audioSource.close();
			}

			for (let i = 0; i < frameCount; i++) {
				if (this.isCancelled) {
					await output.cancel();
					outputSettled = true;
					this.emit("cancelled");
					return null;
				}

				const outputTimeTicks = i * ticksPerFrame;
				const timelineTimeTicks = range.startTime + outputTimeTicks;
				const timeSeconds = mediaTimeToSeconds({ time: outputTimeTicks });
				await waitForExportOperation({
					signal: this.cancellation.signal,
					// Cancellation can start output.cancel promptly, while the actual
					// compositor transaction keeps owning the canvas until add settles.
					operation: () =>
						this.renderer.renderAndCapture({
							node: rootNode,
							time: timelineTimeTicks,
							signal: this.cancellation.signal,
							capture: () => {
								assertRenderNotAborted(this.cancellation.signal);
								this.assertPublicationCurrent();
								return videoSource.add(timeSeconds, 1 / fpsFloat);
							},
						}),
				});

				this.assertPublicationCurrent();
				this.emit("progress", i / frameCount);
			}

			if (this.isCancelled) {
				await output.cancel();
				outputSettled = true;
				this.emit("cancelled");
				return null;
			}

			videoSource.close();
			await output.finalize();
			outputSettled = true;
			this.assertPublicationCurrent();
			this.emit("progress", 1);

			const buffer = output.target.buffer;
			if (!buffer) {
				this.emit("error", new Error("Failed to export video"));
				return null;
			}

			this.emit("complete", buffer);
			return buffer;
		} catch (error) {
			if (outputStarted && !outputSettled) {
				try {
					await output.cancel();
				} catch (cancelError) {
					throw new AggregateError(
						[error, cancelError],
						"Export invalidation and output cancellation both failed.",
					);
				}
			}
			if (
				error instanceof ExportCancelledError ||
				isRenderCancelledError(error)
			) {
				this.emit("cancelled");
				return null;
			}
			throw error;
		}
	}

	private assertPublicationCurrent(): void {
		assertRenderNotAborted(this.cancellation.signal);
		if (!this.publicationToken) return;
		this.publicationGuard?.assertCurrent({ token: this.publicationToken });
	}
}
