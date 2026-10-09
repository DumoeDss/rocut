import { disposeCompositor, disposeGpu, initializeGpu } from "opencut-wasm";
import {
	isProgrammaticResource,
	type ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
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
import type { createKanjiSlamReference } from "./mv-kanji-slam-reference-browser";
import type { KanjiSlamSong } from "./mv-kanji-slam-reference-contract";
import { kanjiSlamTestFrame } from "./mv-kanji-slam-reference-cases";
import {
	kanjiSlamNativeSample,
	kanjiSlamNativeSource,
} from "./mv-kanji-slam-native-source";
import { originalKanjiSlamPixels } from "./mv-kanji-slam-native-capture";
import { check, difference, pixels } from "./mv-afterimage-capture";
import { emberPngBase64 as pngBase64 } from "./mv-ember-diagnostics";
import {
	KANJI_SLAM_EXPORT,
	KANJI_SLAM_EXPORT_CLIPS,
	kanjiSlamExportSampleAt,
} from "./mv-kanji-slam-native-export-support";

export interface KanjiSlamExportProgress {
	readonly current: string;
	readonly gpuObservations?: readonly unknown[];
}

/** Real production scene/GPU/encoder path. Oracle PNGs only use unmodified
 * reference draw; a successful byte export still needs independent FFmpeg QA.
 */
export async function exportKanjiSlam(
	oracle: Awaited<ReturnType<typeof createKanjiSlamReference>>,
	song: KanjiSlamSong,
	resources: readonly ResolvedProgrammaticResource[],
	writeOraclePng: (frame: number, base64: string) => Promise<void>,
	onProgress: (event: KanjiSlamExportProgress) => void = () => {},
) {
	const { width, height, frames, fps, outputStep, sourceStep } =
		KANJI_SLAM_EXPORT;
	const outputTime = (frame: number) =>
		mediaTime({ ticks: frame * outputStep });
	const shots = KANJI_SLAM_EXPORT_CLIPS.map((clip) => {
		const input = kanjiSlamTestFrame(clip.variant, 4);
		return {
			...clip,
			input,
			source: kanjiSlamNativeSource(input, song, resources),
		};
	});
	const provider: ProgrammaticFrameProvider = {
		renderPng: async () => {
			throw Error(
				"Native kanjiSlam unexpectedly used the external HTML frame provider",
			);
		},
		loadResource: async ({ resource }) => {
			check(
				isProgrammaticResource(resource),
				"Invalid kanjiSlam export attachment identity",
			);
			const found = resources.find(
				(item) => JSON.stringify(item.resource) === JSON.stringify(resource),
			);
			check(found, "Unknown kanjiSlam export attachment");
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
				id: "kanji-slam",
				name: "kanjiSlam",
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
	const build = (isPreview: boolean) =>
		buildScene({
			tracks,
			mediaAssets: [],
			duration: outputTime(frames),
			canvasSize: { width, height },
			background: { type: "color", color: "#000000" },
			isPreview,
			assetResolver: {} as AssetResolver,
			programmaticFrames: provider,
		});
	const preview = build(true),
		output = build(false);
	await initializeGpu();
	const compositor = new WasmCompositor({
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `kanji-slam:${handle}`,
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
	const renderer = new CanvasRenderer(params);
	try {
		const oracleFrames: unknown[] = [],
			gpuObservations: unknown[] = [];
		const expectedFrame = async (index: number, save: boolean) => {
			const canvas = new OffscreenCanvas(width, height),
				ctx = canvas.getContext("2d")!;
			try {
				ctx.fillStyle = "black";
				ctx.fillRect(0, 0, width, height);
				const sampled = kanjiSlamExportSampleAt(index);
				if (sampled) {
					const shot = shots.find((item) => item.id === sampled.clip.id)!;
					const originalFrame = kanjiSlamNativeSample(
						shot.input,
						sampled.sourceIndex,
					);
					const result = await originalKanjiSlamPixels(oracle, originalFrame);
					ctx.putImageData(
						new ImageData(new Uint8ClampedArray(result.pixels), width, height),
						0,
						0,
					);
					if (save)
						oracleFrames.push({
							frame: index,
							stage: shot.id,
							variant: shot.variant,
							sourceIndex: sampled.sourceIndex,
							songSeconds: originalFrame.time,
							provenance: result.provenance,
						});
				} else if (save) oracleFrames.push({ frame: index, blank: true });
				if (save) await writeOraclePng(index, await pngBase64(canvas));
				return ctx.getImageData(0, 0, width, height).data;
			} finally {
				canvas.width = canvas.height = 1;
			}
		};
		for (let frame = 0; frame < frames; frame++) {
			onProgress({ current: `kanjiSlam/export/original/${frame}` });
			await expectedFrame(frame, true);
		}
		// Nonmonotonic requests revisit an earlier frame after another variant and
		// include every leading/interior/trailing blank plus half-open boundaries.
		for (const frame of [9, 1, 4, 0, 5, 6, 11, 8, 7, 2, 3, 10, 1]) {
			onProgress({ current: `kanjiSlam/export/gpu/${frame}`, gpuObservations });
			const actual = await renderer.renderAndCapture({
				node: preview,
				time: outputTime(frame),
				capture: (image) => pixels(image, width, height),
			});
			const exported = await renderer.renderAndCapture({
				node: output,
				time: outputTime(frame),
				capture: (image) => pixels(image, width, height),
			});
			const parity = difference(actual, exported),
				error = difference(actual, await expectedFrame(frame, false));
			gpuObservations.push({ frame, parity, error });
			check(
				parity.max === 0,
				`kanjiSlam GPU preview/export mismatch ${frame}: ${JSON.stringify(parity)}`,
			);
			check(
				error.max <= 2 && error.mae < 0.025,
				`kanjiSlam GPU/original mismatch ${frame}: ${JSON.stringify(error)}`,
			);
		}
		onProgress({ current: "kanjiSlam/export/SceneExporter", gpuObservations });
		const bytes = await new SceneExporter({
			...params,
			format: "webm",
			quality: "very_high",
		}).export({
			rootNode: output,
			range: {
				startTime: outputTime(0),
				endTime: outputTime(frames),
				duration: outputTime(frames),
			},
		});
		check(bytes, "kanjiSlam produced no encoded video");
		check(bytes.byteLength > 0, "kanjiSlam produced empty encoded video");
		return {
			bytes: [...new Uint8Array(bytes)],
			exportSize: { width, height },
			fps,
			frameCount: frames,
			oracleStorage: "per-frame-png",
			oracleFrames,
			gpuObservations,
			clips: KANJI_SLAM_EXPORT_CLIPS,
			blankFrames: [0, 5, 10, 11],
			thresholds: {
				previewExportMax: 0,
				originalMaxAtMost: 2,
				originalMaeLessThan: 0.025,
			},
			independentDecodeTested: false,
			checks: [
				"Complete kanjiSlam default/night/hand fire via real buildScene→CanvasRenderer→SceneExporter;1920×1080/30fps/12frames;60fps source odd-frame trims, nonzero placement and blank boundaries; nonmonotonic GPU preview/export/original comparison",
			],
		};
	} finally {
		cancelPendingRenderFrames(preview);
		cancelPendingRenderFrames(output);
		renderer.canvas.width = renderer.canvas.height = 1;
		compositor.dispose();
		disposeGpu();
	}
}
