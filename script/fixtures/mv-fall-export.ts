import { initializeGpu, disposeGpu } from "opencut-wasm";
import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { cancelPendingRenderFrames } from "../../packages/editor-classic/src/services/renderer/cancel-tree";
import type { FallReference } from "./mv-fall-contract";
import { createFallOracle } from "./mv-fall-oracle";
import { fallCases } from "./mv-fall-cases";
import { fallSource, fallSample, fallAnalysis } from "./mv-fall-source";
import {
	FALL_EXPORT,
	FALL_EXPORT_CLIPS,
	fallExportSample,
} from "./mv-fall-export-support";
import { fallExportScene } from "./mv-fall-export-scene";
import { emberPngBase64 as pngBase64 } from "./mv-ember-diagnostics";
import { check, difference, pixels } from "./mv-afterimage-capture";
import { fallParity } from "./mv-fall-negatives";

export async function exportFall(
	reference: FallReference,
	character: ResolvedProgrammaticResource,
	writePng: (index: number, base64: string) => Promise<void>,
	advance: (s: string) => void,
) {
	const cases = fallCases();
	const shots = FALL_EXPORT_CLIPS.map((clip) => {
		const item = cases.find((c) => c.label === clip.label);
		check(item, "Missing Fall export case");
		return { ...clip, item };
	});
	const resources = [character, await fallAnalysis(shots[1]!.item.song)];
	const sources = shots.map(({ item }) =>
		fallSource(
			item.frame,
			item.song,
			item.song.stops ? resources : [character],
		),
	);
	const oracles: Awaited<ReturnType<typeof createFallOracle>>[] = [];
	let scene: ReturnType<typeof fallExportScene> | undefined,
		renderer: CanvasRenderer | undefined;
	const gpuObservations: unknown[] = [],
		oracleFrames: unknown[] = [];
	try {
		for (const shot of shots)
			oracles.push(
				await createFallOracle(reference, shot.item.song, character),
			);
		await initializeGpu();
		scene = fallExportScene(sources, resources);
		renderer = new CanvasRenderer(scene.params);
		const { width, height, frames, fps } = FALL_EXPORT;
		const original = async (index: number, save: boolean) => {
			const canvas = new OffscreenCanvas(width, height),
				ctx = canvas.getContext("2d")!;
			try {
				ctx.fillStyle = "black";
				ctx.fillRect(0, 0, width, height);
				const sample = fallExportSample(index);
				if (sample) {
					const i = shots.findIndex((s) => s.id === sample.clip.id),
						shot = shots[i]!;
					const expected = oracles[i]!.render(
						fallSample(shot.item.frame, sample.sourceIndex),
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
								clip: shot.id,
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
		for (let i = 0; i < frames; i++) {
			advance(`export/original/${i}`);
			await original(i, true);
		}
		for (const i of [9, 1, 4, 0, 5, 6, 11, 8, 7, 2, 3, 10, 1]) {
			advance(`export/gpu/${i}`);
			const actual = await renderer.renderAndCapture({
				node: scene.preview,
				time: scene.time(i),
				capture: (image) => pixels(image, width, height),
			});
			const exported = await renderer.renderAndCapture({
				node: scene.output,
				time: scene.time(i),
				capture: (image) => pixels(image, width, height),
			});
			const parity = difference(actual, exported),
				error = difference(actual, await original(i, false));
			gpuObservations.push({ frame: i, parity, error });
			check(parity.max === 0, `Fall GPU preview/export mismatch ${i}`);
			check(
				fallParity(error),
				`Fall GPU/original mismatch ${i}: ${JSON.stringify(error)}`,
			);
		}
		advance("export/SceneExporter");
		const bytes = await new SceneExporter({
			...scene.params,
			format: "webm",
			quality: "very_high",
		}).export({
			rootNode: scene.output,
			range: {
				startTime: scene.time(0),
				endTime: scene.time(frames),
				duration: scene.time(frames),
			},
		});
		check(bytes && bytes.byteLength > 0, "Fall export produced no video");
		return {
			bytes: [...new Uint8Array(bytes)],
			exportSize: { width, height },
			fps,
			frameCount: frames,
			gpuObservations,
			oracleFrames,
			clips: FALL_EXPORT_CLIPS,
			blankFrames: [0, 5, 10, 11],
			independentDecodeTested: false,
		};
	} finally {
		if (scene) {
			cancelPendingRenderFrames(scene.preview);
			cancelPendingRenderFrames(scene.output);
			scene.compositor.dispose();
		}
		if (renderer) renderer.canvas.width = renderer.canvas.height = 1;
		disposeGpu();
		for (const oracle of oracles) oracle.dispose();
	}
}
