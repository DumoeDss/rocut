import { initializeGpu, disposeGpu } from "opencut-wasm";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { cancelPendingRenderFrames } from "../../packages/editor-classic/src/services/renderer/cancel-tree";
import type { InkReference } from "./mv-ink-contract";
import { inkCases } from "./mv-ink-cases";
import { createInkImage } from "./mv-ink-assets";
import { createInkOracle } from "./mv-ink-oracle";
import { inkDigest } from "./mv-ink-oracle-realm";
import { inkResource, inkNativeSource } from "./mv-ink-native-source";
import { inkSample } from "./mv-ink-source";
import {
	INK_EXPORT,
	INK_EXPORT_BLANKS,
	INK_EXPORT_CLIPS,
	inkExportSample,
} from "./mv-ink-export-support";
import { inkExportScene } from "./mv-ink-export-scene";
import { emberPngBase64 as pngBase64 } from "./mv-ember-diagnostics";
import { check, difference, pixels } from "./mv-afterimage-capture";
type Progress = {
	gpuCompleted: number;
	lastGpuFrame: number | null;
	encoderFrame: number | null;
};
export async function exportInk({
	reference,
	writePng,
	advance,
	onProgress,
}: {
	reference: InkReference;
	writePng: (frame: number, base64: string) => Promise<void>;
	advance: (message: string) => void;
	onProgress: (state: Progress) => void;
}) {
	const shots = await Promise.all(
		inkCases().map(async (item) => {
			const image = await createInkImage({ variant: item.assetVariant }),
				resources = [inkResource(image)];
			return {
				item,
				image,
				resources,
				source: inkNativeSource({
					frame: item.frame,
					song: item.song,
					resources,
				}),
			};
		}),
	);
	let oracle: Awaited<ReturnType<typeof createInkOracle>> | undefined,
		oracleCase = -1;
	let scene: ReturnType<typeof inkExportScene> | undefined,
		renderer: CanvasRenderer | undefined;
	const gpuObservations: unknown[] = [],
		oracleFrames: unknown[] = [];
	const hashes = new Map<number, string>();
	let repeats = 0;
	const { width, height, frames, fps } = INK_EXPORT;
	try {
		await initializeGpu();
		scene = inkExportScene({
			sources: shots.map((shot) => shot.source),
			resources: shots.flatMap((shot) => shot.resources),
		});
		renderer = new CanvasRenderer(scene.params);
		for (let index = 0; index < frames; index++) {
			advance(`export/preview-output-original/${index}`);
			const actual = await renderer.renderAndCapture({
				node: scene.preview,
				time: scene.time(index),
				capture: (image) => pixels(image, width, height),
			});
			const output = await renderer.renderAndCapture({
				node: scene.output,
				time: scene.time(index),
				capture: (image) => pixels(image, width, height),
			});
			const parity = difference(actual, output);
			check(parity.max === 0, `Ink preview/output mismatch ${index}`);
			const canvas = new OffscreenCanvas(width, height),
				ctx = canvas.getContext("2d");
			check(ctx, "Ink original output context missing");
			try {
				ctx.fillStyle = "black";
				ctx.fillRect(0, 0, width, height);
				const sample = inkExportSample(index);
				if (sample) {
					const { caseIndex } = sample.clip,
						shot = shots[caseIndex]!;
					if (oracleCase !== caseIndex) {
						oracle?.dispose();
						hashes.clear();
						oracle = await createInkOracle({
							reference,
							song: shot.item.song,
							images: [shot.image],
						});
						oracleCase = caseIndex;
					}
					check(oracle, "Ink oracle missing");
					const expected = oracle.render(
						inkSample({ frame: shot.item.frame, index: sample.sourceIndex }),
					);
					try {
						ctx.putImageData(
							new ImageData(
								new Uint8ClampedArray(expected.pixels),
								width,
								height,
							),
							0,
							0,
						);
						oracleFrames.push({
							frame: index,
							clip: sample.clip.id,
							sourceIndex: sample.sourceIndex,
							provenance: expected.provenance,
						});
					} finally {
						expected.canvas.width = expected.canvas.height = 1;
					}
					const hash = await inkDigest(actual.slice().buffer),
						old = hashes.get(sample.sourceIndex);
					if (old) {
						check(hash === old, `Ink export nondeterministic ${index}`);
						repeats++;
					} else hashes.set(sample.sourceIndex, hash);
				} else oracleFrames.push({ frame: index, blank: true });
				const error = difference(
					actual,
					ctx.getImageData(0, 0, width, height).data,
				);
				check(
					error.max <= 2 && error.mae < 0.025,
					`Ink original/GPU mismatch ${index}: ${JSON.stringify(error)}`,
				);
				await writePng(index, await pngBase64(canvas));
				gpuObservations.push({ frame: index, parity, error });
			} finally {
				canvas.width = canvas.height = 1;
			}
			onProgress({
				gpuCompleted: index + 1,
				lastGpuFrame: index,
				encoderFrame: null,
			});
		}
		check(
			repeats === 48,
			"Ink export must retain all48 exact reverse/repeat-source checks",
		);
		advance("export/SceneExporter-public-VP9");
		const exporter = new SceneExporter({
			...scene.params,
			format: "webm",
			quality: "very_high",
			videoChroma: "444",
			videoQuantizer: 0,
		});
		exporter.on("progress", (value) => {
			check(
				Number.isFinite(value) && value >= 0 && value <= 1,
				"Invalid Ink encoder progress",
			);
			const encoderFrame = Math.min(frames, Math.floor(value * frames));
			advance(`export/frame/${encoderFrame}`);
			onProgress({
				gpuCompleted: frames,
				lastGpuFrame: frames - 1,
				encoderFrame,
			});
		});
		const bytes = await exporter.export({
			rootNode: scene.output,
			range: {
				startTime: scene.time(0),
				endTime: scene.time(frames),
				duration: scene.time(frames),
			},
		});
		check(
			bytes && bytes.byteLength > 0,
			"Ink exporter produced no encoded video",
		);
		return {
			passed: true,
			bytes,
			exportSize: { width, height },
			fps,
			frameCount: frames,
			sourceFrames: 408,
			gpuObservations,
			oracleFrames,
			clips: INK_EXPORT_CLIPS,
			blankFrames: INK_EXPORT_BLANKS,
			repeats,
			videoChroma: "444",
			videoQuantizer: 0,
			exportTested: true,
			independentDecodeTested: false,
			thresholds: { maxChannelAtMost: 2, maeLessThan: 0.025, repeatMax: 0 },
		};
	} finally {
		if (scene) {
			cancelPendingRenderFrames(scene.preview);
			cancelPendingRenderFrames(scene.output);
			scene.compositor.dispose();
			await scene.videoCache.dispose();
		}
		if (renderer) renderer.canvas.width = renderer.canvas.height = 1;
		disposeGpu();
		oracle?.dispose();
	}
}
