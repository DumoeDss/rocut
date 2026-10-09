import { ALL_FORMATS, BufferSource, CanvasSink, Input } from "mediabunny";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import {
	assert,
	spatialPixels,
	type spatialParams,
	type spatialScene,
} from "./spatial-probe-scene";

export async function exportSpatial(
	params: ReturnType<typeof spatialParams>,
	node: ReturnType<typeof spatialScene>,
	capture: (
		node: ReturnType<typeof spatialScene>,
		local: number,
	) => Promise<Uint8ClampedArray>,
	baseline: Uint8ClampedArray,
) {
	const expected: Uint8ClampedArray[] = [];
	for (let frame = 0; frame < 6; frame++)
		expected.push(await capture(node, frame * 4000));
	const bytes = await new SceneExporter({
		...params,
		format: "webm",
		quality: "very_high",
	}).export({
		rootNode: node,
		range: {
			startTime: mediaTime({ ticks: 12000 }),
			endTime: mediaTime({ ticks: 36000 }),
			duration: mediaTime({ ticks: 24000 }),
		},
	});
	assert(bytes, "Missing spatial export");
	const input = new Input({
		source: new BufferSource(bytes),
		formats: ALL_FORMATS,
	});
	const metrics: {
		meanError: number;
		regionError: number;
		regionPixels: number;
	}[] = [];
	try {
		const track = await input.getPrimaryVideoTrack();
		assert(track, "Missing spatial video track");
		for await (const sample of new CanvasSink(track).canvases()) {
			const actual = spatialPixels(sample.canvas),
				reference = expected[metrics.length];
			assert(reference, "Too many encoded frames");
			let error = 0,
				regionError = 0,
				regionPixels = 0;
			for (let i = 0; i < actual.length; i += 4) {
				const active = [0, 1, 2].some(
					(c) => Math.abs(reference[i + c] - baseline[i + c]) > 15,
				);
				for (let c = 0; c < 4; c++)
					error += Math.abs(actual[i + c] - reference[i + c]);
				if (active) {
					regionPixels++;
					for (let c = 0; c < 3; c++)
						regionError += Math.abs(actual[i + c] - reference[i + c]);
				}
			}
			metrics.push({
				meanError: error / actual.length,
				regionError: regionError / (regionPixels * 3),
				regionPixels,
			});
		}
	} finally {
		input.dispose();
	}
	const base64 = (chunks: Iterable<Uint8Array | Uint8ClampedArray>) => {
		let binary = "";
		for (const chunk of chunks)
			for (const byte of chunk) binary += String.fromCharCode(byte);
		return btoa(binary);
	};
	Reflect.set(
		globalThis,
		"__stylizedVideoBase64",
		base64([new Uint8Array(bytes)]),
	);
	Reflect.set(globalThis, "__stylizedExpectedBase64", base64(expected));
	assert(
		metrics.length === 6 &&
			metrics.every(
				(m) => m.meanError < 10 && m.regionError < 15 && m.regionPixels > 2000,
			),
		`Spatial encoded pixels: ${JSON.stringify(metrics)}`,
	);
	return {
		width: 640,
		height: 360,
		fps: 30,
		frames: 6,
		bytes: bytes.byteLength,
		metrics,
	};
}
