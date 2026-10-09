import { ALL_FORMATS, BufferSource, CanvasSink, Input } from "mediabunny";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import {
	assert,
	effect,
	pixels,
	scene,
	type makeParams,
} from "./stylized-probe-scene";

export async function exportStylized(
	params: ReturnType<typeof makeParams>,
	expected: Uint8ClampedArray,
) {
	const bytes = await new SceneExporter({
		...params,
		format: "webm",
		quality: "high",
	}).export({
		rootNode: scene([effect("vhs")]),
		range: {
			startTime: mediaTime({ ticks: 12000 }),
			endTime: mediaTime({ ticks: 36000 }),
			duration: mediaTime({ ticks: 24000 }),
		},
	});
	assert(bytes, "No exported video");
	const input = new Input({
		source: new BufferSource(bytes),
		formats: ALL_FORMATS,
	});
	let count = 0,
		meanError = 0,
		motion = 0;
	let first: Uint8ClampedArray | undefined;
	try {
		const video = await input.getPrimaryVideoTrack();
		assert(video, "No encoded video track");
		for await (const sample of new CanvasSink(video).canvases()) {
			const data = pixels(sample.canvas);
			if (!first) {
				first = data;
				meanError =
					data.reduce((sum, v, i) => sum + Math.abs(v - expected[i]), 0) /
					data.length;
			} else
				motion =
					data.reduce((sum, v, i) => sum + Math.abs(v - first![i]), 0) /
					data.length;
			count++;
		}
	} finally {
		input.dispose();
	}
	assert(
		count === 6 && meanError < 10 && motion > 0.1,
		`Encoded result: ${JSON.stringify({ count, meanError, motion })}`,
	);
	let binary = "";
	for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
	Reflect.set(globalThis, "__stylizedVideoBase64", btoa(binary));
	return {
		count,
		meanError,
		meanErrorLimit: 10,
		motion,
		bytes: bytes.byteLength,
	};
}
