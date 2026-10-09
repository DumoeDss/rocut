import { ALL_FORMATS, BufferSource, CanvasSink, Input } from "mediabunny";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { asciiEffect, asciiThreeScene } from "./ascii-three-scene";
import type { Effect } from "../../packages/editor-classic/src/effects/types";
import {
	assertGenerator as assert,
	generatorPixels,
	generatorDetail,
} from "./generator-browser-assets";

export async function exportAsciiThree(
	source: ProgrammaticSource,
	compositor: WasmCompositor,
	capture: (
		node: ReturnType<typeof asciiThreeScene>,
		time: number,
	) => Promise<Uint8ClampedArray>,
	options: {
		effects?: Effect[];
		scene?: Parameters<typeof asciiThreeScene>[2];
	} = {},
) {
	const node = asciiThreeScene(
			source,
			options.effects ?? [asciiEffect()],
			options.scene,
		),
		startTime = 72000;
	const bytes = await new SceneExporter({
		width: source.width,
		height: source.height,
		fps: source.frameRate,
		compositor,
		videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
		format: "webm",
		quality: "very_high",
	}).export({
		rootNode: node,
		range: {
			startTime: mediaTime({ ticks: startTime }),
			endTime: mediaTime({ ticks: startTime + 24000 }),
			duration: mediaTime({ ticks: 24000 }),
		},
	});
	assert(bytes, "ASCII scene export produced no video");
	const input = new Input({
		source: new BufferSource(bytes),
		formats: ALL_FORMATS,
	});
	const errors: number[] = [],
		detail: ReturnType<typeof generatorDetail>[] = [],
		expected: Uint8ClampedArray[] = [];
	let first: Uint8ClampedArray | undefined,
		motion = 0;
	try {
		const video = await input.getPrimaryVideoTrack();
		assert(video, "No ASCII video track");
		for await (const sample of new CanvasSink(video).canvases()) {
			const reference = await capture(node, startTime + errors.length * 4000),
				actual = generatorPixels(sample.canvas, source.width, source.height);
			errors.push(
				actual.reduce(
					(sum, value, i) => sum + Math.abs(value - reference[i]),
					0,
				) / actual.length,
			);
			detail.push(generatorDetail(actual, reference));
			expected.push(reference);
			if (first)
				motion =
					actual.reduce(
						(sum, value, i) => sum + Math.abs(value - first![i]),
						0,
					) / actual.length;
			else first = actual;
		}
	} finally {
		input.dispose();
	}
	assert(
		errors.length === 6 && Math.max(...errors) < 10 && motion > 0.1,
		`ASCII video decode ${JSON.stringify({ errors, motion })}`,
	);
	assert(
		detail.every(
			(d) =>
				d.pixels > 500 &&
				d.error < 25 &&
				d.contrastRatio > 0.7 &&
				d.contrastRatio < 1.3,
		),
		`ASCII video foreground ${JSON.stringify(detail)}`,
	);
	const base64 = (chunks: Iterable<Uint8Array | Uint8ClampedArray>) => {
		let binary = "";
		for (const chunk of chunks)
			for (const byte of chunk) binary += String.fromCharCode(byte);
		return btoa(binary);
	};
	Reflect.set(
		globalThis,
		"__threeVideoBase64",
		base64([new Uint8Array(bytes)]),
	);
	Reflect.set(globalThis, "__threeExpectedBase64", base64(expected));
	return {
		width: source.width,
		height: source.height,
		fps: source.frameRate,
		frames: errors.length,
		quality: "very_high",
		errors,
		errorLimit: 10,
		detail,
		motion,
		encodedBytes: bytes.byteLength,
	};
}
