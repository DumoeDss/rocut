/** Supplemental explicit-444 export. The default-420 fixture and its failure
 * remain intact; this file only consumes the existing public exporter option. */
import { disposeCompositor, disposeGpu, initializeGpu } from "opencut-wasm";
import { isProgrammaticResource } from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { cancelPendingRenderFrames } from "../../packages/editor-classic/src/services/renderer/cancel-tree";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import type {
	TitleRiffFont,
	TitleRiffReference,
} from "./mv-title-riff-reference-contract";
import { createTitleRiffReference } from "./mv-title-riff-reference-browser";
import {
	titleRiffTestFrame,
	titleRiffTestSong,
} from "./mv-title-riff-reference-cases";
import { titleRiffTestImages } from "./mv-title-riff-reference-image-fixtures";
import {
	titleRiffNativeResources,
	titleRiffNativeSample,
	titleRiffNativeSource,
} from "./mv-title-riff-native-source";
import { originalTitleRiffPixels } from "./mv-title-riff-native-capture";
import { check, difference, pixels } from "./mv-afterimage-capture";
import { emberPngBase64 } from "./mv-ember-diagnostics";
import {
	TITLE_RIFF_EXPORT,
	TITLE_RIFF_EXPORT_CLIPS,
	titleRiffExportSampleAt,
} from "./mv-title-riff-native-export-support";

const scope = globalThis as typeof globalThis & {
	__titleRiffReference: TitleRiffReference;
	__titleRiffFonts: readonly (Omit<TitleRiffFont, "body"> & { url: string })[];
	__titleRiffChromaResult?: unknown;
	__titleRiffChromaProgress?: unknown;
	__writeTitleRiffOraclePng: (frame: number, base64: string) => Promise<void>;
};
async function run() {
	const { width, height, frames, fps, outputStep, sourceStep } =
		TITLE_RIFF_EXPORT;
	const observations: unknown[] = [],
		provenance: unknown[] = [];
	const progress = { current: "assets", observations };
	scope.__titleRiffChromaProgress = progress;
	const fonts = await Promise.all(
		scope.__titleRiffFonts.map(async ({ url, ...metadata }) => {
			const response = await fetch(url);
			check(response.ok, `Supplemental title font HTTP ${response.status}`);
			return { ...metadata, body: await response.arrayBuffer() };
		}),
	);
	const images = await titleRiffTestImages(),
		song = titleRiffTestSong();
	const resources = titleRiffNativeResources(fonts, images);
	const oracle = await createTitleRiffReference({
		reference: scope.__titleRiffReference,
		song,
		fonts,
		images,
	});
	const outputTime = (frame: number) =>
		mediaTime({ ticks: frame * outputStep });
	const shots = TITLE_RIFF_EXPORT_CLIPS.map((clip) => {
		const input = titleRiffTestFrame(clip.variant);
		return {
			...clip,
			input,
			source: titleRiffNativeSource(input, song, resources),
		};
	});
	const provider: ProgrammaticFrameProvider = {
		renderPng: async () => {
			throw Error("Supplemental native title used external HTML rendering");
		},
		loadResource: async ({ resource }) => {
			check(isProgrammaticResource(resource), "Invalid title attachment");
			const found = resources.find(
				(item) => JSON.stringify(item.resource) === JSON.stringify(resource),
			);
			check(found, "Unknown title attachment");
			return new Blob([found.body], { type: resource.mimeType });
		},
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
				id: "title-riff",
				name: "titleRiff",
				type: "graphic",
				hidden: false,
				elements: shots.map((shot) => ({
					id: shot.id,
					name: shot.id,
					type: "graphic",
					definitionId: "programmatic",
					params: {},
					programmatic: shot.source,
					startTime: outputTime(shot.start),
					duration: outputTime(shot.duration),
					trimStart: mediaTime({ ticks: shot.trimSourceFrame * sourceStep }),
					trimEnd: mediaTime({
						ticks:
							shot.source.durationFrames * sourceStep -
							shot.trimSourceFrame * sourceStep -
							shot.duration * outputStep,
					}),
				})),
			},
		],
	};
	const output = buildScene({
		tracks,
		mediaAssets: [],
		duration: outputTime(frames),
		canvasSize: { width, height },
		background: { type: "color", color: "#000000" },
		isPreview: false,
		assetResolver: {} as AssetResolver,
		programmaticFrames: provider,
	});
	let compositor: WasmCompositor | undefined,
		renderer: CanvasRenderer | undefined;
	try {
		await initializeGpu();
		compositor = new WasmCompositor({
			trackGpuResource: ({ handle, label }) => ({
				handle,
				label,
				resourceId: `title-riff-chroma:${handle}`,
				release: () => disposeCompositor(handle),
			}),
		} as SessionResources);
		const params = {
			width,
			height,
			fps: { numerator: fps, denominator: 1 },
			compositor,
			videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
		};
		renderer = new CanvasRenderer(params);
		for (let frame = 0; frame < frames; frame++) {
			progress.current = `gpu-original/${frame}`;
			const canvas = new OffscreenCanvas(width, height),
				ctx = canvas.getContext("2d")!;
			try {
				ctx.fillStyle = "black";
				ctx.fillRect(0, 0, width, height);
				const sample = titleRiffExportSampleAt(frame);
				if (sample) {
					const shot = shots.find((item) => item.id === sample.clip.id)!;
					const expected = await originalTitleRiffPixels(
						oracle,
						titleRiffNativeSample(shot.input, sample.sourceIndex),
					);
					ctx.putImageData(
						new ImageData(
							new Uint8ClampedArray(expected.pixels),
							width,
							height,
						),
						0,
						0,
					);
					provenance.push({ frame, oracle: expected.provenance });
				}
				await scope.__writeTitleRiffOraclePng(
					frame,
					await emberPngBase64(canvas),
				);
				const actual = await renderer.renderAndCapture({
					node: output,
					time: outputTime(frame),
					capture: (image) => pixels(image, width, height),
				});
				const error = difference(
					actual,
					ctx.getImageData(0, 0, width, height).data,
				);
				observations.push({ frame, error });
				check(
					error.max <= 2 && error.mae < 0.025,
					`Supplemental title GPU mismatch ${frame}`,
				);
			} finally {
				canvas.width = canvas.height = 1;
			}
		}
		progress.current = "SceneExporter/explicit-444";
		const bytes = await new SceneExporter({
			...params,
			format: "webm",
			quality: "very_high",
			videoChroma: "444",
		}).export({
			rootNode: output,
			range: {
				startTime: outputTime(0),
				endTime: outputTime(frames),
				duration: outputTime(frames),
			},
		});
		check(bytes?.byteLength, "Supplemental 444 export returned no video");
		return {
			passed: true,
			bytes: [...new Uint8Array(bytes)],
			requestedVideoChroma: "444",
			format: "webm",
			quality: "very_high",
			observations,
			provenance,
			width,
			height,
			frames,
			fps,
			clips: TITLE_RIFF_EXPORT_CLIPS,
			thresholds: { originalMaxAtMost: 2, originalMaeLessThan: 0.025 },
			independentDecodeTested: false,
			default420AcceptanceReplaced: false,
			installedElectronTested: false,
		};
	} finally {
		cancelPendingRenderFrames(output);
		if (renderer) renderer.canvas.width = renderer.canvas.height = 1;
		compositor?.dispose();
		disposeGpu();
		oracle.dispose();
	}
}
void run().then(
	(result) => {
		scope.__titleRiffChromaResult = result;
	},
	(error) => {
		scope.__titleRiffChromaResult = {
			passed: false,
			error: String(error?.stack ?? error),
			progress: scope.__titleRiffChromaProgress,
		};
	},
);
