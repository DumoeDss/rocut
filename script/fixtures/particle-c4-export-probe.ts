import {
	disposeCompositor,
	disposeGpu,
	initializeGpu,
	mediaTimeFromFrame,
} from "opencut-wasm";
import { ALL_FORMATS, BufferSource, CanvasSink, Input } from "mediabunny";
import {
	isProgrammaticSource,
	type ProgrammaticSource,
} from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { cancelPendingRenderFrames } from "../../packages/editor-classic/src/services/renderer/cancel-tree";
import {
	mediaTime,
	mediaTimeToSeconds,
	resolveMediaTimeRange,
} from "../../packages/editor-classic/src/wasm/media-time";

export const PARTICLE_SCENE_EXPORT_LIMITS = Object.freeze({
	meanRgbError: 12,
	activeMeanRgbError: 18,
	activeChannelThreshold: 8,
});

export interface ParticleSceneExportReference {
	index: number;
	timeTicks: number;
	rgba: Uint8Array;
	metrics: {
		activePixels: number;
		opaquePixels: number;
		meanRgb: number;
		previewExportEqual: true;
	};
}

export interface ParticleSceneExportResult {
	video: Uint8Array;
	mimeType: "video/webm";
	width: number;
	height: number;
	frameRate: { numerator: 30; denominator: 1 };
	frameCount: 6;
	range: { startTime: number; endTime: number; duration: number };
	references: ParticleSceneExportReference[];
	browserDecodeMetrics: {
		index: number;
		timestampSeconds: number;
		meanRgbError: number;
		activeMeanRgbError: number;
		activePixels: number;
	}[];
	previewExportEqual: true;
	limits: typeof PARTICLE_SCENE_EXPORT_LIMITS;
	scope: string;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw Error(`Particle scene export probe: ${message}`);
}

function privateApiBase(baseUrl: string): string {
	const url = new URL(baseUrl);
	assert(
		["http:", "https:"].includes(url.protocol) &&
			["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash,
		"baseUrl must be an explicit credential-free loopback API URL",
	);
	return url.href.replace(/\/$/, "");
}

function pixels(
	canvas: HTMLCanvasElement | OffscreenCanvas,
	width: number,
	height: number,
): Uint8Array {
	assert(
		canvas.width === width && canvas.height === height,
		"canvas dimensions differ from the source",
	);
	const copy = new OffscreenCanvas(width, height);
	try {
		const context = copy.getContext("2d", {
			colorSpace: "srgb",
			willReadFrequently: true,
		});
		assert(context, "no 2D readback context");
		context.drawImage(canvas, 0, 0);
		const data = context.getImageData(0, 0, width, height, {
			colorSpace: "srgb",
		});
		assert(data.colorSpace === "srgb", "readback is not sRGB");
		return new Uint8Array(
			data.data.buffer,
			data.data.byteOffset,
			data.data.byteLength,
		);
	} finally {
		copy.width = copy.height = 0;
	}
}

function referenceMetrics(
	rgba: Uint8Array,
): ParticleSceneExportReference["metrics"] {
	let activePixels = 0,
		opaquePixels = 0,
		sum = 0;
	for (let offset = 0; offset < rgba.length; offset += 4) {
		const [r, g, b, a] = rgba.subarray(offset, offset + 4);
		if (Math.max(r, g, b) > PARTICLE_SCENE_EXPORT_LIMITS.activeChannelThreshold)
			activePixels++;
		if (a === 255) opaquePixels++;
		sum += r + g + b;
	}
	assert(
		opaquePixels === rgba.length / 4,
		"black-background reference must be fully opaque",
	);
	assert(activePixels > 0, "reference has no active particle pixels");
	return {
		activePixels,
		opaquePixels,
		meanRgb: sum / ((rgba.length / 4) * 3),
		previewExportEqual: true,
	};
}

function decodeMetrics(
	actual: Uint8Array,
	reference: ParticleSceneExportReference,
	timestampSeconds: number,
) {
	assert(
		actual.length === reference.rgba.length,
		"decoded RGBA byte count mismatch",
	);
	let totalError = 0,
		activeError = 0;
	for (let offset = 0; offset < actual.length; offset += 4) {
		const active =
			Math.max(
				reference.rgba[offset],
				reference.rgba[offset + 1],
				reference.rgba[offset + 2],
			) > PARTICLE_SCENE_EXPORT_LIMITS.activeChannelThreshold;
		for (let channel = 0; channel < 3; channel++) {
			const delta = Math.abs(
				actual[offset + channel] - reference.rgba[offset + channel],
			);
			totalError += delta;
			if (active) activeError += delta;
		}
	}
	const meanRgbError = totalError / ((actual.length / 4) * 3);
	const activeMeanRgbError = activeError / (reference.metrics.activePixels * 3);
	assert(
		meanRgbError <= PARTICLE_SCENE_EXPORT_LIMITS.meanRgbError &&
			activeMeanRgbError <= PARTICLE_SCENE_EXPORT_LIMITS.activeMeanRgbError,
		`browser decode exceeds predeclared limits: ${JSON.stringify({ index: reference.index, meanRgbError, activeMeanRgbError })}`,
	);
	return {
		index: reference.index,
		timestampSeconds,
		meanRgbError,
		activeMeanRgbError,
		activePixels: reference.metrics.activePixels,
	};
}

/**
 * Dedicated isolated browser page only: owns the page's GPU runtime. The Host
 * must initialize the private opencut-wasm module before importing this fixture
 * and provide POST `${baseUrl}/programmatic/frame` returning real PNG bytes from
 * the persisted project's resource store and the production Host renderer.
 *
 * This verifies only the persisted programmatic source through the real
 * CanvasRenderer -> WasmCompositor -> SceneExporter pipeline. It does not apply
 * persisted clip editing parameters (including opacity) or timeline placement,
 * and is not a full project/editor UI, audio or full-motion test. Native backend
 * identity/lifecycle must be verified separately by the outer harness.
 * Browser decode is preliminary: the caller must save video and every reference
 * RGBA buffer, then independently decode with FFmpeg using the same fixed limits.
 */
export async function runParticleSceneExportProbe(
	input: ProgrammaticSource,
	baseUrl: string,
): Promise<ParticleSceneExportResult> {
	assert(
		isProgrammaticSource(input),
		"input must be a valid programmatic source",
	);
	const source = structuredClone(input);
	assert(
		source.runtime === "html-document" &&
			source.build?.engine === "three" &&
			source.build.capabilities?.length === 1 &&
			source.build.capabilities[0] === "particle-surface-v1",
		"requires an archived Three particle source",
	);
	assert(
		source.audio === undefined,
		"this silent video probe cannot certify source audio",
	);
	assert(
		source.frameRate.numerator === 30 && source.frameRate.denominator === 1,
		"this fixture explicitly accepts only 30/1 fps",
	);
	assert(
		Number.isSafeInteger(source.durationFrames) && source.durationFrames >= 6,
		"source must contain at least six frames",
	);
	assert(
		source.width > 0 &&
			source.height > 0 &&
			source.width <= 2048 &&
			source.height <= 2048 &&
			source.width * source.height <= 640 * 360,
		"source exceeds the bounded small-video fixture dimensions",
	);
	const base = privateApiBase(baseUrl);
	const atFrame = (frame: number) => {
		const ticks = mediaTimeFromFrame({ frame, rate: source.frameRate });
		assert(
			ticks !== undefined && Number.isSafeInteger(ticks) && ticks >= 0,
			"Rust rejected a frame time",
		);
		return mediaTime({ ticks });
	};
	const duration = atFrame(source.durationFrames);
	assert(
		duration === source.durationFrames * 4000,
		"Rust duration differs from the admitted 30 fps tick grid",
	);
	const times = Array.from({ length: 6 }, (_, index) => atFrame(index));
	assert(
		times.every((time, index) => time === index * 4000),
		"Rust frame grid is not the expected exact 30 fps grid",
	);
	const range = resolveMediaTimeRange({
		range: { startTime: atFrame(0), endTime: atFrame(6) },
		timelineDuration: duration,
	});
	const tracks = {
		main: { id: "main", name: "Main", type: "video", elements: [] },
		audio: [],
		overlay: [
			{
				id: "particle",
				name: "Particle",
				type: "graphic",
				elements: [
					{
						id: "particle-source",
						name: "Particle source",
						type: "graphic",
						definitionId: "programmatic",
						params: {},
						programmatic: source,
						startTime: 0,
						duration,
						trimStart: 0,
						trimEnd: 0,
					},
				],
			},
		],
	} as unknown as SceneTracks;
	const assetResolver: AssetResolver = {
		resolve() {
			throw Error(
				"Unexpected external editor asset in the particle export fixture",
			);
		},
	};
	const scene = (isPreview: boolean) =>
		buildScene({
			programmaticFrames: createHttpProgrammaticFrames({ base }),
			tracks,
			mediaAssets: [],
			canvasSize: { width: source.width, height: source.height },
			duration,
			background: { type: "color", color: "#000000" },
			assetResolver,
			isPreview,
		});
	const nodes: ReturnType<typeof scene>[] = [];
	let compositor: WasmCompositor | undefined;
	let decodedInput: Input | undefined;
	let gpuInitialized = false;
	let result: ParticleSceneExportResult | undefined;
	let primary: unknown,
		failed = false;
	try {
		await initializeGpu();
		gpuInitialized = true;
		compositor = new WasmCompositor({
			trackGpuResource: ({ handle, label }) => {
				let released = false;
				return {
					handle,
					label,
					resourceId: `particle-export:${handle}`,
					release() {
						if (!released) {
							disposeCompositor(handle);
							released = true;
						}
					},
				};
			},
		} as SessionResources);
		const params = {
			width: source.width,
			height: source.height,
			fps: source.frameRate,
			compositor,
			videoCache: {
				getFrameAt: async () => {
					throw Error(
						"Unexpected video-cache access in a particle-only fixture",
					);
				},
			} as unknown as VideoCache,
		};
		const renderer = new CanvasRenderer(params);
		const previewNode = scene(true),
			referenceNode = scene(false),
			exportNode = scene(false);
		nodes.push(previewNode, referenceNode, exportNode);
		const capture = (canvas: HTMLCanvasElement) =>
			pixels(canvas, source.width, source.height);
		const references: ParticleSceneExportReference[] = [];
		for (let index = 0; index < times.length; index++) {
			const preview = await renderer.renderAndCapture({
				node: previewNode,
				time: times[index],
				capture,
			});
			const rgba = await renderer.renderAndCapture({
				node: referenceNode,
				time: times[index],
				capture,
			});
			assert(
				preview.length === rgba.length &&
					preview.every((byte, offset) => byte === rgba[offset]),
				`preview/export graph differs at frame ${index}`,
			);
			references.push({
				index,
				timeTicks: times[index],
				rgba,
				metrics: referenceMetrics(rgba),
			});
		}
		const encoded = await new SceneExporter({
			...params,
			format: "webm",
			quality: "very_high",
			shouldIncludeAudio: false,
		}).export({ rootNode: exportNode, range });
		assert(
			encoded &&
				encoded.byteLength > 0 &&
				encoded.byteLength <= 32 * 1024 * 1024,
			"export produced no video or exceeded the 32 MiB probe output cap",
		);
		const video = new Uint8Array(encoded);
		decodedInput = new Input({
			source: new BufferSource(video),
			formats: ALL_FORMATS,
		});
		const track = await decodedInput.getPrimaryVideoTrack();
		assert(track, "encoded video has no primary video track");
		assert(
			track.displayWidth === source.width &&
				track.displayHeight === source.height,
			"encoded video dimensions differ from the source",
		);
		const browserDecodeMetrics: ParticleSceneExportResult["browserDecodeMetrics"] =
			[];
		for await (const frame of new CanvasSink(track).canvases()) {
			const index = browserDecodeMetrics.length;
			assert(index < 6, "encoded video contains more than six frames");
			const expectedTimestamp = mediaTimeToSeconds({ time: times[index] });
			// WebM timestamps have finite container precision; allow at most 1 ms.
			assert(
				Number.isFinite(frame.timestamp) &&
					Math.abs(frame.timestamp - expectedTimestamp) <= 0.001,
				`unexpected encoded timestamp at frame ${index}`,
			);
			browserDecodeMetrics.push(
				decodeMetrics(
					pixels(frame.canvas, source.width, source.height),
					references[index],
					frame.timestamp,
				),
			);
		}
		assert(
			browserDecodeMetrics.length === 6,
			"encoded video must contain exactly six frames",
		);
		result = {
			video,
			mimeType: "video/webm",
			width: source.width,
			height: source.height,
			frameRate: { numerator: 30, denominator: 1 },
			frameCount: 6,
			range,
			references,
			browserDecodeMetrics,
			previewExportEqual: true,
			limits: PARTICLE_SCENE_EXPORT_LIMITS,
			scope:
				"Persisted programmatic source rendering/SceneExporter through the production Rocut renderer/compositor/encoder and real Host particle frames. Source-only: excludes saved clip editing parameters (including opacity), timeline placement, complete-project/attached-editor export, audio and full motion. Native backend identity/lifecycle requires outer-harness verification. Browser decode is preliminary, not independent FFmpeg acceptance.",
		};
	} catch (error) {
		primary = error;
		failed = true;
	}
	const cleanupErrors: unknown[] = [];
	for (const node of nodes)
		try {
			cancelPendingRenderFrames(node);
		} catch (error) {
			cleanupErrors.push(error);
		}
	try {
		decodedInput?.dispose();
	} catch (error) {
		cleanupErrors.push(error);
	}
	try {
		compositor?.dispose();
	} catch (error) {
		cleanupErrors.push(error);
	}
	if (gpuInitialized)
		try {
			disposeGpu();
		} catch (error) {
			cleanupErrors.push(error);
		}
	if (failed) {
		if (cleanupErrors.length)
			throw new AggregateError(
				[primary, ...cleanupErrors],
				"Particle export and cleanup failed",
				{ cause: primary },
			);
		throw primary;
	}
	if (cleanupErrors.length)
		throw new AggregateError(cleanupErrors, "Particle export cleanup failed", {
			cause: cleanupErrors[0],
		});
	return result!;
}
