import { disposeCompositor, disposeGpu, initializeGpu } from "opencut-wasm";
import type { AssetResolver } from "@opencut/editor-ports";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import {
	isProgrammaticResource,
	type ProgrammaticSource,
	type ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type {
	SceneTracks,
	GraphicElement,
} from "../../packages/editor-classic/src/timeline/types";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { check } from "./image-sequence-browser-assets";
import {
	SEQUENCE_EXPORT,
	expectedSequenceOrdinal,
	expectedSequencePixels,
	sequencePixelDifference,
	captureSequencePixels,
} from "./image-sequence-export-reference";

interface Assets {
	source: ProgrammaticSource;
	blobs?: ReadonlyMap<string, Blob>;
	/** Only needed by the memory fixture when its map omits the manifest body. */
	sequence?: ResolvedProgrammaticResource;
}

/** Exactly twelve encoded frames: six correct and six genuine wrong-trim frames.
 * The caller must independently decode both returned artifacts with FFmpeg.
 */
export async function exportImageSequence(
	assets: Assets,
	providerOverride?: ProgrammaticFrameProvider,
) {
	const { width, height, fps, frames, step, trim, wrongTrim } = SEQUENCE_EXPORT;
	const source = assets.source;
	check(
		source.width === width && source.height === height,
		"Unexpected sequence source geometry",
	);
	check(
		source.frameRate.numerator === fps.numerator &&
			source.frameRate.denominator === fps.denominator,
		"Unexpected source frame rate",
	);
	const ticks = (value: number) => mediaTime({ ticks: value });
	const blobs = new Map(assets.blobs);
	if (assets.sequence)
		blobs.set(
			assets.sequence.resource.attachmentKey,
			new Blob([assets.sequence.body], {
				type: assets.sequence.resource.mimeType,
			}),
		);
	const resourceReads: { id: string; kind: string }[] = [];
	const provider: ProgrammaticFrameProvider = {
		renderPng: async () => {
			throw Error("Unexpected HTML rasterizer in sequence export");
		},
		loadResource: async (request) => {
			request.signal.throwIfAborted();
			check(
				isProgrammaticResource(request.resource),
				"Invalid sequence export resource request",
			);
			resourceReads.push({
				id: request.resource.id,
				kind: request.resource.kind,
			});
			if (providerOverride) {
				check(
					providerOverride.loadResource,
					"Sequence export provider cannot load resources",
				);
				return providerOverride.loadResource(request);
			}
			const blob = blobs.get(request.resource.attachmentKey);
			check(blob, `Missing sequence export dependency: ${request.resource.id}`);
			return blob;
		},
	};
	const scene = (isPreview: boolean, trimTicks: number = trim) => {
		const element: GraphicElement = {
			id: "sequence-clip",
			name: "Fractionally trimmed image sequence",
			type: "graphic",
			definitionId: "programmatic",
			params: {},
			programmatic: source,
			startTime: ticks(step),
			duration: ticks(4 * step),
			trimStart: ticks(trimTicks),
			trimEnd: ticks(source.durationFrames * step - trimTicks - 4 * step),
		};
		const tracks: SceneTracks = {
			main: {
				id: "main",
				name: "Main",
				type: "video",
				elements: [],
				hidden: false,
				muted: false,
			},
			audio: [],
			overlay: [
				{
					id: "sequence",
					name: "Sequence",
					type: "graphic",
					hidden: false,
					elements: [element],
				},
			],
		};
		return buildScene({
			tracks,
			mediaAssets: [],
			duration: ticks(frames * step),
			canvasSize: { width, height },
			background: { type: "color", color: "#000000" },
			isPreview,
			programmaticFrames: provider,
			assetResolver: {} as AssetResolver,
		});
	};
	await initializeGpu();
	const compositor = new WasmCompositor({
		trackGpuResource: ({
			handle,
			label,
		}: {
			handle: number;
			label: string;
		}) => ({
			handle,
			label,
			resourceId: `image-sequence-export:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	const params = {
		width,
		height,
		fps,
		compositor,
		videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
	};
	try {
		const preview = scene(true),
			output = scene(false),
			wrong = scene(false, wrongTrim);
		const renderer = new CanvasRenderer(params),
			observations = [];
		for (const frame of [4, 1, 0, 5, 3, 2, 1]) {
			const capture = (node: typeof preview) =>
				renderer.renderAndCapture({
					node,
					time: ticks(frame * step),
					capture: captureSequencePixels,
				});
			const a = await capture(preview),
				b = await capture(output);
			check(
				sequencePixelDifference(a, b).max === 0,
				`Preview/export sequence mismatch at ${frame}`,
			);
			const error = sequencePixelDifference(
				a,
				expectedSequencePixels(frame, trim),
			);
			check(
				error.max <= 2,
				`Independent sequence GPU pixels differ at ${frame}: ${JSON.stringify(error)}`,
			);
			observations.push({
				frame,
				ordinal: expectedSequenceOrdinal(frame, trim),
				error,
			});
		}
		const wrongTrimPreviewRejectedFrames: number[] = [];
		for (let frame = 0; frame < frames; frame++) {
			const actual = await renderer.renderAndCapture({
				node: wrong,
				time: ticks(frame * step),
				capture: captureSequencePixels,
			});
			const selfError = sequencePixelDifference(
				actual,
				expectedSequencePixels(frame, wrongTrim),
			);
			check(
				selfError.max <= 2,
				`Wrong-trim render is not its declared negative control at ${frame}`,
			);
			if (
				sequencePixelDifference(actual, expectedSequencePixels(frame, trim))
					.max > 2
			)
				wrongTrimPreviewRejectedFrames.push(frame);
		}
		check(
			JSON.stringify(wrongTrimPreviewRejectedFrames) === "[1,2,3,4]",
			"Raw-pixel gate did not reject every wrong active frame",
		);
		const encode = async (rootNode: typeof output) => {
			const bytes = await new SceneExporter({
				...params,
				format: "webm",
				quality: "very_high",
			}).export({
				rootNode,
				range: {
					startTime: ticks(0),
					endTime: ticks(frames * step),
					duration: ticks(frames * step),
				},
			});
			check(bytes, "SceneExporter produced no sequence artifact");
			return [...new Uint8Array(bytes)];
		};
		const bytes = await encode(output),
			wrongTrimBytes = await encode(wrong);
		check(
			document.querySelectorAll("iframe").length === 0,
			"Sequence export sandbox leaked",
		);
		return {
			bytes,
			wrongTrimBytes,
			observations,
			previewExportExact: true,
			wrongTrimPreviewRejectedFrames,
			resourceReads,
			providerMode: providerOverride ? "override" : "fixture-memory",
			timing: SEQUENCE_EXPORT,
			scope: {
				gpuSceneExporterTested: true,
				ffmpegDecodeTested: false,
				hostImportTested: false,
				installedElectronTested: false,
			},
		};
	} finally {
		compositor.dispose();
		disposeGpu();
	}
}
