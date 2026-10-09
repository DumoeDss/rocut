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

export async function runSpatialProbe() {
	registerDefaultEffects();
	await initializeGpu();
	const params = spatialParams(),
		renderer = new CanvasRenderer(params);
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
	const stamp = (data: Uint8ClampedArray, index: number) =>
		ctx.putImageData(
			new ImageData(new Uint8ClampedArray(data), 640, 360),
			(index % 2) * 640,
			Math.floor(index / 2) * 360,
		);
	document.body.append(sheet);
	try {
		const baseline = await capture(spatialScene([])),
			baseHash = await hash(baseline);
		stamp(baseline, 0);
		const stats = [];
		for (const [index, type] of ["lens", "ascii", "retro-dither"].entries()) {
			const fx = effect(type, {
				centerX: 0.5,
				centerY: 0.5,
				radius: 0.3,
				feather: 0,
				...(type === "lens" ? { zoom: 2 } : { local: 1 }),
			});
			const node = spatialScene([fx], { animate: true });
			const first = await capture(node, 0),
				middle = await capture(node, 12000),
				last = await capture(node, 20000);
			const middleHash = await hash(middle);
			assert(
				middleHash !== baseHash &&
					middleHash !== (await hash(first)) &&
					middleHash !== (await hash(last)),
				`${type}: trajectory no-op`,
			);
			assert(
				(await hash(await capture(node, 12000))) === middleHash,
				`${type}: reverse seek`,
			);
			for (let y = 0; y < 360; y++)
				for (let x = 0; x < 640; x++) {
					if ((x + 0.5 - 320) ** 2 + (y + 0.5 - 180) ** 2 < 108 ** 2) continue;
					const i = (y * 640 + x) * 4;
					assert(
						[0, 1, 2, 3].every((c) => middle[i + c] === baseline[i + c]),
						`${type}: changed outside region ${x},${y}`,
					);
				}
			for (const options of [
				{ animate: true, preview: true },
				{ animate: true, trim: 0, restored: true },
			])
				assert(
					(await hash(await capture(spatialScene([fx], options), 12000))) ===
						middleHash,
					`${type}: preview/trim/roundtrip`,
				);
			assert(
				(await hash(
					await capture(spatialScene([effect(type, { amount: 0 })])),
				)) === baseHash,
				`${type}: zero amount`,
			);
			stamp(middle, index + 1);
			stats.push({
				type,
				first: await hash(first),
				middle: middleHash,
				last: await hash(last),
			});
		}
		const glass = effect("lens", {
			zoom: 1.2,
			refraction: 0.8,
			dispersion: 0.08,
			radius: 0.4,
			feather: 0.15,
		});
		const glassPixels = await capture(spatialScene([glass]));
		stamp(glassPixels, 4);
		assert(
			(await hash(glassPixels)) !== stats[0].middle,
			"Glass optics did not change sampling",
		);
		const black = await capture(
			spatialScene([glass], { background: "#000000" }),
		);
		const white = await capture(
			spatialScene([glass], { background: "#ffffff" }),
		);
		let partial = 0,
			transparent = 0,
			blendError = 0;
		for (let i = 0; i < black.length; i += 4) {
			const alpha = 1 - (white[i] - black[i]) / 255;
			if (alpha < 0.01) transparent++;
			else if (alpha < 0.99) partial++;
			for (const [c, bg] of [32, 48, 64].entries())
				blendError = Math.max(
					blendError,
					Math.abs(black[i + c] + (1 - alpha) * bg - glassPixels[i + c]),
				);
		}
		assert(
			partial > 100 && transparent > 1000 && blendError < 2,
			`Alpha: ${JSON.stringify({ partial, transparent, blendError })}`,
		);
		const moving = spatialScene(
			[effect("lens", { ...glass.params, centerX: 0.5, centerY: 0.5 })],
			{ animate: true },
		);
		stamp(await capture(moving, 20000), 5);
		Reflect.set(globalThis, "__stylizedSheet", sheet.toDataURL("image/png"));
		const video = await exportSpatial(params, moving, capture, baseline);
		return {
			ok: true,
			captures,
			stats,
			alpha: { partial, transparent, blendError },
			video,
			checks: [
				"real input refraction/magnification/dispersion",
				"three explicit keyframe trajectories",
				"circular region/outside identity",
				"reverse seek",
				"preview/export",
				"trim/JSON roundtrip",
				"zero amount",
				"layer alpha",
				"real WebM encode/decode",
			],
		};
	} finally {
		params.compositor.dispose();
		disposeGpu();
	}
}
