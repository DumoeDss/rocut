import { initializeGpu, disposeGpu } from "opencut-wasm";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { cancelPendingRenderFrames } from "../../packages/editor-classic/src/services/renderer/cancel-tree";
import type { FlameReference } from "./mv-flame-oracle-contract";
import { createFlameOracle } from "./mv-flame-oracle";
import { flameCases } from "./mv-flame-cases";
import { flameSource, flameSample, flameAnalysis } from "./mv-flame-source";
import { flameOracleAssets } from "./mv-flame-oracle-assets";
import { flameNativeAsset } from "./mv-flame-native-assets";
import {
	FLAME_EXPORT,
	FLAME_EXPORT_CLIPS,
	FLAME_EXPORT_BLANKS,
	flameExportSample,
} from "./mv-flame-export-support";
import { flameExportScene } from "./mv-flame-export-scene";
import { emberPngBase64 as pngBase64 } from "./mv-ember-diagnostics";
import { check, difference, pixels } from "./mv-afterimage-capture";

export async function exportFlame({
	reference,
	writePng,
	advance,
	onProgress,
}: {
	reference: FlameReference;
	writePng: (index: number, base64: string) => Promise<void>;
	advance: (message: string) => void;
	onProgress?: (state: {
		gpuCompleted: number;
		lastGpuFrame: number | null;
		encoderFrame: number | null;
	}) => void;
}) {
	const cases = flameCases(),
		images = await flameOracleAssets();
	const shots = await Promise.all(
		cases.map(async (item) => {
			const caseImages = item.assetVariant
				? [
						await flameNativeAsset({
							base: images[0]!,
							variant: item.assetVariant,
						}),
						images[1]!,
					]
				: images;
			const resources = [...caseImages, await flameAnalysis(item.song)];
			return {
				item,
				caseImages,
				resources,
				source: flameSource({
					frame: item.frame,
					song: item.song,
					resources,
					options: { vocal: item.vocal },
				}),
			};
		}),
	);
	const oracles: Awaited<ReturnType<typeof createFlameOracle>>[] = [];
	let scene: ReturnType<typeof flameExportScene> | undefined,
		renderer: CanvasRenderer | undefined;
	const gpuObservations: unknown[] = [],
		oracleFrames: unknown[] = [];
	let repeats = 0;
	try {
		for (const shot of shots)
			oracles.push(
				await createFlameOracle({
					reference,
					song: shot.item.song,
					resources: shot.caseImages,
				}),
			);
		await initializeGpu();
		scene = flameExportScene({
			sources: shots.map((shot) => shot.source),
			resources: shots.flatMap((shot) => shot.resources),
		});
		renderer = new CanvasRenderer(scene.params);
		const { width, height, frames, fps } = FLAME_EXPORT;
		const original = async ({
			index,
			save,
		}: {
			index: number;
			save: boolean;
		}) => {
			const canvas = new OffscreenCanvas(width, height),
				ctx = canvas.getContext("2d")!;
			try {
				ctx.fillStyle = "black";
				ctx.fillRect(0, 0, width, height);
				const sample = flameExportSample(index);
				if (sample) {
					const shot = shots[sample.clip.caseIndex]!;
					const expected = oracles[sample.clip.caseIndex]!.render(
						flameSample({ frame: shot.item.frame, index: sample.sourceIndex }),
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
						if (save)
							oracleFrames.push({
								frame: index,
								clip: sample.clip.id,
								sourceIndex: sample.sourceIndex,
								provenance: expected.provenance,
							});
					} finally {
						expected.canvas.width = expected.canvas.height = 1;
					}
				} else if (save) oracleFrames.push({ frame: index, blank: true });
				if (save) await writePng(index, await pngBase64(canvas));
				return ctx.getImageData(0, 0, width, height).data;
			} finally {
				canvas.width = canvas.height = 1;
			}
		};
		let prior: { caseIndex: number; pixels: Uint8ClampedArray } | undefined;
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
			const parity = difference(actual, output),
				error = difference(actual, await original({ index, save: true }));
			check(parity.max === 0, `Flame preview/output mismatch ${index}`);
			check(
				error.max <= 2 && error.mae < 0.025,
				`Flame1080p original/export mismatch ${index}: ${JSON.stringify(error)}`,
			);
			const sample = flameExportSample(index);
			let repeat;
			if (sample?.sourceIndex === 120) {
				if (prior?.caseIndex === sample.clip.caseIndex) {
					repeat = difference(prior.pixels, actual);
					check(
						repeat.max === 0,
						`Flame export nondeterministic case ${sample.clip.caseIndex}`,
					);
					repeats++;
					prior = undefined;
				} else prior = { caseIndex: sample.clip.caseIndex, pixels: actual };
			}
			gpuObservations.push({
				frame: index,
				parity,
				error,
				...(repeat ? { repeat } : {}),
			});
			onProgress?.({
				gpuCompleted: gpuObservations.length,
				lastGpuFrame: index,
				encoderFrame: null,
			});
		}
		check(repeats === 16, "Flame export must prove all sixteen exact repeats");
		advance("export/SceneExporter-public-VP9");
		const exporter = new SceneExporter({
			...scene.params,
			format: "webm",
			quality: "very_high",
			videoChroma: "444",
			videoQuantizer: 0,
		});
		exporter.on("progress", (value) => {
			if (!Number.isFinite(value) || value < 0 || value > 1)
				throw Error("Invalid SceneExporter progress");
			const encoderFrame = Math.min(frames, Math.floor(value * frames));
			advance(`export/frame/${encoderFrame}`);
			onProgress?.({
				gpuCompleted: gpuObservations.length,
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
		check(bytes && bytes.byteLength > 0, "Flame export produced no video");
		advance(`export/encoded-binary/${bytes.byteLength}`);
		return {
			passed: true,
			bytes,
			exportSize: { width, height },
			fps,
			frameCount: frames,
			sourceFrames: 160,
			gpuObservations,
			oracleFrames,
			clips: FLAME_EXPORT_CLIPS,
			blankFrames: FLAME_EXPORT_BLANKS,
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
		for (const oracle of oracles) oracle.dispose();
	}
}
