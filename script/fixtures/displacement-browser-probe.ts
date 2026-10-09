import { disposeGpu, initializeGpu } from "opencut-wasm";
import { registerDefaultEffects } from "../../packages/editor-classic/src/effects";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import {
	assert,
	effect,
	hash,
	spatialParams,
	spatialPixels,
	spatialScene,
} from "./spatial-probe-scene";
import { exportSpatial } from "./spatial-export-probe";

export async function runDisplacementProbe() {
	registerDefaultEffects();
	await initializeGpu();
	const params = spatialParams();
	const renderer = new CanvasRenderer(params);
	let captures = 0;
	const capture = (node: ReturnType<typeof spatialScene>, local = 0) => {
		captures++;
		return renderer.renderAndCapture({
			node,
			time: local + 12000,
			capture: spatialPixels,
		});
	};
	const sheet = document.createElement("canvas");
	sheet.width = 1280;
	sheet.height = 1080;
	const ctx = sheet.getContext("2d")!;
	const stamp = (pixels: Uint8ClampedArray, index: number) =>
		ctx.putImageData(
			new ImageData(new Uint8ClampedArray(pixels), 640, 360),
			(index % 2) * 640,
			Math.floor(index / 2) * 360,
		);
	document.body.append(sheet);
	try {
		const baseline = await capture(spatialScene([]));
		const baseHash = await hash(baseline);
		stamp(baseline, 0);
		const distorter = effect("displacement", {
			amount: 1,
			displacement: 0.075,
			cellSize: 48,
			dispersion: 0.08,
			seed: 37,
			centerX: 0.5,
			centerY: 0.5,
			radius: 0.4,
			feather: 0.15,
		});
		const moving = spatialScene([distorter], { animate: true });
		const before = await capture(moving, 0);
		const peak = await capture(moving, 8000);
		const after = await capture(moving, 20000);
		stamp(before, 1);
		stamp(peak, 2);
		stamp(after, 3);
		const checkOutside = (
			pixels: Uint8ClampedArray,
			centerX: number,
			centerY: number,
		) => {
			for (let y = 0; y < 360; y++)
				for (let x = 0; x < 640; x++) {
					if (
						(x + 0.5 - centerX * 640) ** 2 + (y + 0.5 - centerY * 360) ** 2 <
						144 ** 2
					)
						continue;
					const i = (y * 640 + x) * 4;
					assert(
						[0, 1, 2, 3].every((c) => pixels[i + c] === baseline[i + c]),
						`Displacement escaped circle ${centerX},${centerY}: ${x},${y}`,
					);
				}
		};
		for (const [actual, centerX, centerY] of [
			[before, 0.2, 0.35],
			[peak, 0.4, 0.45],
			[after, 0.7, 0.6],
		] as const) {
			const expected = await capture(
				spatialScene([
					effect("displacement", { ...distorter.params, centerX, centerY }),
				]),
			);
			assert(
				(await hash(actual)) === (await hash(expected)),
				`Displacement trajectory did not reach ${centerX},${centerY}`,
			);
			checkOutside(actual, centerX, centerY);
		}
		checkOutside(await capture(moving, 12000), 0.5, 0.5);
		const beforeHash = await hash(before);
		const peakHash = await hash(peak);
		const afterHash = await hash(after);
		assert(
			new Set([baseHash, beforeHash, peakHash, afterHash]).size === 4,
			"Displacement trajectory is static or leaves the input unchanged",
		);
		for (const [time, expectedHash] of [
			[20000, afterHash],
			[8000, peakHash],
			[0, beforeHash],
			[20000, afterHash],
		] as const)
			assert(
				(await hash(await capture(moving, time))) === expectedHash,
				`Displacement reverse seek at ${time}`,
			);
		const changedSeed = await capture(
			spatialScene(
				[effect("displacement", { ...distorter.params, seed: 38 })],
				{
					animate: true,
				},
			),
			8000,
		);
		assert(
			(await hash(changedSeed)) !== peakHash,
			"Seed did not affect pixels",
		);
		stamp(changedSeed, 4);
		const noDispersion = await capture(
			spatialScene(
				[effect("displacement", { ...distorter.params, dispersion: 0 })],
				{ animate: true },
			),
			8000,
		);
		assert(
			(await hash(noDispersion)) !== peakHash,
			"Chromatic dispersion did not affect pixels",
		);
		stamp(noDispersion, 5);
		for (const extra of [{ preview: true }, { trim: 0 }, { restored: true }]) {
			const node = spatialScene([distorter], { animate: true, ...extra });
			assert(
				(await hash(await capture(node, 8000))) === peakHash,
				`Displacement preview/trim/roundtrip: ${JSON.stringify(extra)}`,
			);
		}
		for (const neutral of [
			{ displacement: 0, dispersion: 0.1 },
			{ amount: 0 },
			{ radius: 0 },
		]) {
			const node = spatialScene(
				[effect("displacement", { ...distorter.params, ...neutral })],
				{ animate: true },
			);
			assert(
				(await hash(await capture(node, 8000))) === baseHash,
				`Displacement neutral identity: ${JSON.stringify(neutral)}`,
			);
		}
		Reflect.set(globalThis, "__stylizedSheet", sheet.toDataURL("image/png"));
		const video = await exportSpatial(params, moving, capture, baseline);
		return {
			ok: true,
			captures,
			peakHash,
			video,
			checks: [
				"moving center matches independently specified positions",
				"reverse seek",
				"outside circle identity at four trajectory points",
				"seed pixel difference",
				"chromatic dispersion pixel difference",
				"preview parity",
				"trim-independent effect trajectory",
				"JSON roundtrip",
				"zero displacement with nonzero dispersion",
				"zero amount and zero radius",
				"production WebM encode/decode with unchanged detail gates",
			],
		};
	} finally {
		params.compositor.dispose();
		disposeGpu();
	}
}
