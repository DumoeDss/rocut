import { disposeGpu, initializeGpu } from "opencut-wasm";
import { registerDefaultEffects } from "../../packages/editor-classic/src/effects";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import {
	assert,
	effect,
	hash,
	spatialParams,
	spatialPixels,
	spatialScene,
} from "./spatial-probe-scene";
import { exportSpatial } from "./spatial-export-probe";

export async function runMagnifyProbe() {
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
	const pulse = {
		"effects.filter.params.pulse": {
			keys: [
				[0, 0],
				[8000, 1],
				[20000, 0],
			].map(([time, value], index) => ({
				id: `pulse-${index}`,
				time: mediaTime({ ticks: time }),
				value,
				segmentToNext: "linear" as const,
				tangentMode: "auto" as const,
			})),
		},
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
		const optics = {
			zoom: 2,
			centerX: 0.5,
			centerY: 0.5,
			radius: 0.4,
			feather: 0.15,
			refraction: 0.3,
			dispersion: 0.03,
		};
		const magnifier = effect("magnify", {
			...optics,
			hud: 0.8,
			pulse: 0,
			lineWidth: 1.5,
		});
		const lens = await capture(spatialScene([effect("lens", optics)]));
		assert(
			(await hash(
				await capture(
					spatialScene([effect("magnify", { ...optics, hud: 0, pulse: 0 })]),
				),
			)) === (await hash(lens)),
			"Magnify/lens optical sampling mismatch",
		);
		stamp(lens, 1);
		const moving = spatialScene([magnifier], {
			animate: true,
			animations: pulse,
		});
		const before = await capture(moving, 0);
		const peak = await capture(moving, 8000);
		const after = await capture(moving, 20000);
		stamp(before, 2);
		stamp(peak, 3);
		stamp(after, 4);
		for (const [actual, centerX, centerY, pulseValue] of [
			[before, 0.2, 0.35, 0],
			[peak, 0.4, 0.45, 1],
			[after, 0.7, 0.6, 0],
		] as const) {
			const expected = await capture(
				spatialScene([
					effect("magnify", {
						...magnifier.params,
						centerX,
						centerY,
						pulse: pulseValue,
					}),
				]),
			);
			assert(
				(await hash(actual)) === (await hash(expected)),
				`Magnify trajectory did not reach ${centerX},${centerY}`,
			);
		}
		const peakHash = await hash(peak);
		assert(
			peakHash !== baseHash &&
				peakHash !== (await hash(before)) &&
				peakHash !== (await hash(after)),
			"Magnify impulse trajectory is static",
		);
		assert(
			(await hash(await capture(moving, 8000))) === peakHash,
			"Magnify reverse seek",
		);
		const noPulse = await capture(
			spatialScene([magnifier], { animate: true }),
			8000,
		);
		assert(
			(await hash(noPulse)) !== peakHash,
			"Pulse animation did not affect pixels",
		);
		const noHud = await capture(
			spatialScene([effect("magnify", { ...magnifier.params, hud: 0 })], {
				animate: true,
				animations: pulse,
			}),
			8000,
		);
		assert((await hash(noHud)) !== peakHash, "HUD did not affect pixels");
		stamp(noHud, 5);
		const middle = await capture(moving, 12000);
		for (let y = 0; y < 360; y++)
			for (let x = 0; x < 640; x++) {
				if ((x + 0.5 - 320) ** 2 + (y + 0.5 - 180) ** 2 < 144 ** 2) continue;
				const i = (y * 640 + x) * 4;
				assert(
					[0, 1, 2, 3].every((c) => middle[i + c] === baseline[i + c]),
					`Magnify escaped circle ${x},${y}`,
				);
			}
		for (const extra of [{ preview: true }, { trim: 0, restored: true }]) {
			const node = spatialScene([magnifier], {
				animate: true,
				animations: pulse,
				...extra,
			});
			assert(
				(await hash(await capture(node, 8000))) === peakHash,
				"Magnify preview/trim/roundtrip",
			);
		}
		assert(
			(await hash(
				await capture(
					spatialScene([effect("magnify", { amount: 0, pulse: 1 })]),
				),
			)) === baseHash,
			"Magnify zero amount",
		);
		Reflect.set(globalThis, "__stylizedSheet", sheet.toDataURL("image/png"));
		const video = await exportSpatial(params, moving, capture, baseline);
		return {
			ok: true,
			captures,
			peakHash,
			video,
			checks: [
				"shared lens optics",
				"native HUD pixel difference",
				"explicit pulse keyframe pixel difference",
				"moving center matches independently specified positions",
				"reverse seek",
				"outside circle identity",
				"preview parity",
				"trim and JSON roundtrip",
				"zero amount",
				"production WebM encode/decode",
			],
		};
	} finally {
		params.compositor.dispose();
		disposeGpu();
	}
}
