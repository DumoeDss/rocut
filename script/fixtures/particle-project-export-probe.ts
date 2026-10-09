import {
	disposeCompositor,
	disposeGpu,
	initializeGpu,
	mediaTimeFromFrame,
} from "opencut-wasm";
import { ALL_FORMATS, BufferSource, CanvasSink, Input } from "mediabunny";
import { opacityCompositeMetrics } from "./particle-project-export-pixels.mjs";
import {
	admitSavedParticleProject,
	projectPixelMetrics,
	acceptsProjectPixels,
	PROJECT_EXPORT_LIMITS,
	type ProjectExportVariant,
} from "./particle-project-export-contract";
import type { AssetResolver } from "@opencut/editor-ports";
import type {
	SceneTracks,
	TimelineElement,
} from "../../packages/editor-classic/src/timeline/types";
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

export const PARTICLE_PROJECT_EXPORT_LIMITS = PROJECT_EXPORT_LIMITS;
export const particleProjectProgress: {
	phase: string;
	references: ParticleProjectExportReference[];
	negativeControls: {
		kind: string;
		index: number;
		rgba: Uint8Array;
		metrics: ReturnType<typeof projectPixelMetrics>;
		alphaComposite?: ReturnType<typeof opacityCompositeMetrics>;
	}[];
} = { phase: "admission", references: [], negativeControls: [] };

export interface ParticleProjectExportReference {
	index: number;
	timeTicks: number;
	rgba: Uint8Array;
	expectedActive: boolean;
	metrics: {
		activePixels: number;
		opaquePixels: number;
		meanRgb: number;
		previewExportEqual: true;
	};
}

export interface ParticleProjectExportResult {
	video: Uint8Array;
	mimeType: "video/webm";
	width: number;
	height: number;
	frameRate: { numerator: 30; denominator: 1 };
	frameCount: 6;
	range: { startTime: number; endTime: number; duration: number };
	references: ParticleProjectExportReference[];
	browserDecodeMetrics: {
		index: number;
		timestampSeconds: number;
		meanRgbError: number;
		activeMeanRgbError: number;
		activePixels: number;
	}[];
	negativeControls: {
		kind: string;
		index: number;
		rgba: Uint8Array;
		metrics: ReturnType<typeof projectPixelMetrics>;
		alphaComposite?: ReturnType<typeof opacityCompositeMetrics>;
		rejected: true;
	}[];
	project: {
		id: string;
		sceneId: string;
		variant: ProjectExportVariant;
		savedClip: unknown;
	};
	previewExportEqual: true;
	limits: typeof PARTICLE_PROJECT_EXPORT_LIMITS;
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
		"canvas dimensions differ from the saved project",
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
): ParticleProjectExportReference["metrics"] {
	let activePixels = 0,
		opaquePixels = 0,
		sum = 0;
	for (let offset = 0; offset < rgba.length; offset += 4) {
		const [r, g, b, a] = rgba.subarray(offset, offset + 4);
		if (
			Math.max(r, g, b) > PARTICLE_PROJECT_EXPORT_LIMITS.activeChannelThreshold
		)
			activePixels++;
		if (a === 255) opaquePixels++;
		sum += r + g + b;
	}
	assert(
		opaquePixels === rgba.length / 4,
		"black-background reference must be fully opaque",
	);

	return {
		activePixels,
		opaquePixels,
		meanRgb: sum / ((rgba.length / 4) * 3),
		previewExportEqual: true,
	};
}

function decodeMetrics(
	actual: Uint8Array,
	reference: ParticleProjectExportReference,
	timestampSeconds: number,
) {
	assert(
		actual.length === reference.rgba.length,
		"decoded RGBA byte count mismatch",
	);
	const metrics = projectPixelMetrics(actual, reference.rgba);
	assert(
		acceptsProjectPixels(metrics, reference.expectedActive),
		`browser decode exceeds predeclared limits: ${JSON.stringify({ index: reference.index, ...metrics })}`,
	);
	return {
		index: reference.index,
		timestampSeconds,
		...metrics,
	};
}

/** Dedicated private browser GPU owner. Positive scene uses actual saved tracks/settings; only negative controls modify detached tracks. */
export async function runParticleProjectExportProbe(
	input: unknown,
	baseUrl: string,
	clipId: string,
	variant: ProjectExportVariant,
): Promise<ParticleProjectExportResult> {
	const {
		project,
		scene: savedScene,
		clip,
		times: rawTimes,
		range: savedRange,
	} = admitSavedParticleProject(input, clipId, variant);
	const base = privateApiBase(baseUrl);
	const times = rawTimes.map((ticks) => mediaTime({ ticks }));
	for (const [index, time] of times.entries()) {
		assert(
			mediaTimeFromFrame({ frame: time / 4000, rate: project.settings.fps }) ===
				time,
			`Rust rejected saved timeline frame ${index}`,
		);
	}
	const duration = project.metadata.duration;
	const range = resolveMediaTimeRange({
		range: {
			startTime: mediaTime({ ticks: savedRange.startTime }),
			endTime: mediaTime({ ticks: savedRange.endTime }),
		},
		timelineDuration: duration,
	});
	assert(
		range.duration === 24000 && range.startTime === savedRange.startTime,
		"production export range clamped saved timeline",
	);
	const assetResolver: AssetResolver = {
		resolve() {
			throw Error(
				"Unexpected external editor asset in the particle export fixture",
			);
		},
	};
	const scene = (isPreview: boolean, tracks: SceneTracks = savedScene.tracks) =>
		buildScene({
			programmaticFrames: createHttpProgrammaticFrames({ base }),
			tracks,
			mediaAssets: [],
			canvasSize: {
				width: project.settings.canvasSize.width,
				height: project.settings.canvasSize.height,
			},
			duration,
			background: project.settings.background,
			assetResolver,
			isPreview,
		});
	const nodes: ReturnType<typeof scene>[] = [];
	let compositor: WasmCompositor | undefined;
	let decodedInput: Input | undefined;
	let gpuInitialized = false;
	let result: ParticleProjectExportResult | undefined;
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
			width: project.settings.canvasSize.width,
			height: project.settings.canvasSize.height,
			fps: project.settings.fps,
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
			pixels(
				canvas,
				project.settings.canvasSize.width,
				project.settings.canvasSize.height,
			);
		const references: ParticleProjectExportReference[] = [];
		particleProjectProgress.phase = "preview-and-reference";
		particleProjectProgress.references = references;
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
				expectedActive: variant === "original" || index > 0,
				metrics: referenceMetrics(rgba),
			});
		}
		const negativeControls: ParticleProjectExportResult["negativeControls"] =
			[];
		particleProjectProgress.phase = "semantic-negative-controls";
		for (const kind of variant === "original"
			? ["opacity-ignored"]
			: ["placement-ignored", "trim-ignored"]) {
			const tracks = structuredClone(savedScene.tracks);
			const wrongClip = [...tracks.overlay, tracks.main, ...tracks.audio]
				.flatMap<TimelineElement>((track) => track.elements)
				.find((element) => element.id === clipId)!;
			if (kind === "opacity-ignored")
				wrongClip.params = { ...wrongClip.params, opacity: 1 };
			else if (kind === "placement-ignored")
				wrongClip.startTime = mediaTime({ ticks: 0 });
			else wrongClip.trimStart = mediaTime({ ticks: 0 });
			const wrongNode = scene(false, tracks);
			nodes.push(wrongNode);
			const index = 3,
				rgba = await renderer.renderAndCapture({
					node: wrongNode,
					time: times[index],
					capture,
				});
			const metrics = projectPixelMetrics(rgba, references[index].rgba);
			const alphaComposite =
				kind === "opacity-ignored"
					? opacityCompositeMetrics(references[index].rgba, rgba)
					: undefined;
			particleProjectProgress.negativeControls.push({
				kind,
				index,
				rgba,
				metrics,
				alphaComposite,
			});
			if (alphaComposite)
				assert(
					alphaComposite.accepted,
					"Saved opacity must match straight-alpha over opaque black within fixed uncompressed quantization tolerances",
				);
			assert(
				!acceptsProjectPixels(metrics, true) &&
					metrics.activeMeanRgbError >=
						PROJECT_EXPORT_LIMITS.negativeMinimumActiveMeanRgbError,
				`Incorrect ${kind} rendering must fail the unchanged decoded-pixel predicate`,
			);
			negativeControls.push({
				kind,
				index,
				rgba,
				metrics,
				alphaComposite,
				rejected: true,
			});
		}
		particleProjectProgress.phase = "scene-exporter";
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
			track.displayWidth === project.settings.canvasSize.width &&
				track.displayHeight === project.settings.canvasSize.height,
			"encoded video dimensions differ from the saved project",
		);
		const browserDecodeMetrics: ParticleProjectExportResult["browserDecodeMetrics"] =
			[];
		for await (const frame of new CanvasSink(track).canvases()) {
			const index = browserDecodeMetrics.length;
			assert(index < 6, "encoded video contains more than six frames");
			const expectedTimestamp = mediaTimeToSeconds({
				time: mediaTime({ ticks: times[index] - range.startTime }),
			});
			// WebM timestamps have finite container precision; allow at most 1 ms.
			assert(
				Number.isFinite(frame.timestamp) &&
					Math.abs(frame.timestamp - expectedTimestamp) <= 0.001,
				`unexpected encoded timestamp at frame ${index}`,
			);
			browserDecodeMetrics.push(
				decodeMetrics(
					pixels(
						frame.canvas,
						project.settings.canvasSize.width,
						project.settings.canvasSize.height,
					),
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
			width: project.settings.canvasSize.width,
			height: project.settings.canvasSize.height,
			frameRate: { numerator: 30, denominator: 1 },
			frameCount: 6,
			range,
			references,
			browserDecodeMetrics,
			negativeControls,
			project: {
				id: project.metadata.id,
				sceneId: savedScene.id,
				variant,
				savedClip: clip,
			},
			previewExportEqual: true,
			limits: PARTICLE_PROJECT_EXPORT_LIMITS,
			scope:
				"Actual saved FileProjectStore project decoded with production decodeProject -> saved active SceneTracks, clip params/timing, canvas/background -> buildScene/CanvasRenderer/SceneExporter. Six-frame saved-timeline window, no attached-editor UI or audio certification. Timing fixture variant is separately saved and reopened.",
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
