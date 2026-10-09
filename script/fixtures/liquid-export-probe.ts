import { ALL_FORMATS, BufferSource, CanvasSink, Input } from "mediabunny";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { liquidExpected, liquidOver } from "./liquid-browser-oracle";
import { liquidParameters } from "./liquid-browser-cases";
import {
	assert,
	effect,
	liquidScene,
	spatialPixels,
	type spatialParams,
} from "./liquid-browser-scene";

export async function exportLiquid(
	params: ReturnType<typeof spatialParams>,
	source: Uint8ClampedArray,
	baseline: Uint8ClampedArray,
) {
	const localStart = 4000,
		parameters = liquidParameters(),
		node = liquidScene([effect("liquid", parameters)]);
	const expected = Array.from({ length: 6 }, (_, frame) =>
		liquidOver(
			liquidExpected(source, 640, 360, parameters, localStart + frame * 4000, {
				numerator: 30,
				denominator: 1,
			}).pixels,
			[32, 48, 64],
		),
	);
	const bytes = await new SceneExporter({
		...params,
		format: "webm",
		quality: "very_high",
	}).export({
		rootNode: node,
		range: {
			startTime: mediaTime({ ticks: 12000 + localStart }),
			endTime: mediaTime({ ticks: 12000 + localStart + 24000 }),
			duration: mediaTime({ ticks: 24000 }),
		},
	});
	assert(bytes, "Missing Liquid export");
	const input = new Input({
		source: new BufferSource(bytes),
		formats: ALL_FORMATS,
	});
	const metrics: {
		meanError: number;
		regionError: number;
		regionPixels: number;
		timestamp: number;
	}[] = [];
	try {
		const track = await input.getPrimaryVideoTrack();
		assert(track, "Missing Liquid video track");
		for await (const sample of new CanvasSink(track).canvases()) {
			const actual = spatialPixels(sample.canvas),
				reference = expected[metrics.length];
			assert(reference, "Too many Liquid export frames");
			let error = 0,
				regionError = 0,
				regionPixels = 0;
			for (let i = 0; i < actual.length; i += 4) {
				for (let c = 0; c < 4; c++)
					error += Math.abs(actual[i + c] - reference[i + c]);
				if (
					[0, 1, 2].some(
						(c) => Math.abs(reference[i + c] - baseline[i + c]) > 15,
					)
				) {
					regionPixels++;
					for (let c = 0; c < 3; c++)
						regionError += Math.abs(actual[i + c] - reference[i + c]);
				}
			}
			metrics.push({
				meanError: error / actual.length,
				regionError: regionError / (regionPixels * 3),
				regionPixels,
				timestamp: sample.timestamp,
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
	Reflect.set(globalThis, "__liquidMedia", {
		video: base64([new Uint8Array(bytes)]),
		expected: base64(expected),
		baseline: base64([baseline]),
	});
	return {
		ok:
			metrics.length === 6 &&
			metrics.every(
				(m, i) =>
					m.meanError < 10 &&
					m.regionError < 15 &&
					m.regionPixels > 2000 &&
					Math.abs(m.timestamp - i / 30) < 0.0011,
			),
		width: 640,
		height: 360,
		fps: 30,
		frames: metrics.length,
		localStart,
		bytes: bytes.byteLength,
		metrics,
		reference:
			"independent MAC + optical CPU oracle; not captured production frames",
	};
}
