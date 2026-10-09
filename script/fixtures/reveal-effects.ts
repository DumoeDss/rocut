import { disposeGpu, initializeGpu } from "opencut-wasm";
import { registerDefaultEffects } from "../../packages/editor-classic/src/effects";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import {
	assert,
	effect,
	spatialParams,
	spatialPixels,
	spatialScene,
} from "./spatial-probe-scene";
import { exportSpatial } from "./spatial-export-probe";
import { revealAnimations, type RevealCapture } from "./reveal-effects-common";
import { checkLaser } from "./reveal-effects-laser";
import { checkDecrypt } from "./reveal-effects-decrypt";

export async function runRevealProbe() {
	registerDefaultEffects();
	await initializeGpu();
	const params = spatialParams(),
		renderer = new CanvasRenderer(params);
	let captures = 0;
	const capture: RevealCapture = (node, local = 0) => {
		captures++;
		return renderer.renderAndCapture({
			node,
			time: local + 12000,
			capture: spatialPixels,
		});
	};
	try {
		const baseline = await capture(spatialScene([]));
		const references = {
			baseline,
			black: await capture(spatialScene([], { background: "#000000" })),
			white: await capture(spatialScene([], { background: "#ffffff" })),
		};
		const laser = await checkLaser(capture, references);
		const decrypt = await checkDecrypt(capture, references);
		const sheet = document.createElement("canvas");
		sheet.width = 1280;
		sheet.height = 1080;
		const ctx = sheet.getContext("2d")!;
		[baseline, ...laser.pixels, ...decrypt.pixels].forEach((pixels, index) =>
			ctx.putImageData(
				new ImageData(new Uint8ClampedArray(pixels), 640, 360),
				(index % 2) * 640,
				Math.floor(index / 2) * 360,
			),
		);
		document.body.append(sheet);
		const sheetData = sheet.toDataURL("image/png");
		const variants = [];
		const configurations = [
			{
				type: "laser",
				controls: {
					amount: 1,
					progress: 0.65,
					direction: 0,
					width: 0.025,
					feather: 0.25,
					glow: 0.7,
				},
				values: { progress: [0.65, 0.95] as [number, number] },
			},
			{
				type: "decrypt-reveal",
				controls: {
					amount: 1,
					progress: 0.2,
					cellSize: 16,
					seed: 1,
					centerX: 0.5,
					centerY: 0.5,
					radius: 2,
					feather: 0,
				},
				values: { progress: [0.2, 0.8] as [number, number] },
			},
		];
		for (const { type, controls, values } of configurations) {
			const node = spatialScene([effect(type, controls)], {
				animations: revealAnimations(values),
			});
			Reflect.deleteProperty(globalThis, "__stylizedVideoBase64");
			Reflect.deleteProperty(globalThis, "__stylizedExpectedBase64");
			let video;
			try {
				video = await exportSpatial(params, node, capture, baseline);
			} finally {
				const bytes = Reflect.get(globalThis, "__stylizedVideoBase64"),
					expected = Reflect.get(globalThis, "__stylizedExpectedBase64");
				if (typeof bytes === "string" && typeof expected === "string") {
					variants.push({
						name: type,
						video: bytes,
						expected,
						sheet: sheetData,
						evidence: video,
					});
					Reflect.set(globalThis, "__revealMedia", variants);
				}
			}
			assert(video, `${type} export artifacts missing`);
		}
		Reflect.set(globalThis, "__revealMedia", variants);
		return {
			ok: true,
			captures,
			laser: laser.evidence,
			decrypt: decrypt.evidence,
			exports: variants.map(({ name, evidence }) => ({ name, ...evidence })),
			checks: [
				"Laser exact four-direction mask against nonuniform input",
				"Laser transparent/identity endpoints and hidden-side glow exclusion",
				"Decrypt ink/palette/5x7 cell geometry",
				"Decrypt original-inside/characters-outside moving-region oracle",
				"Decrypt independent per-cell reveal rather than global fade",
				"source alpha and zero amount",
				"explicit keyframe endpoints/midpoint",
				"arbitrary/reverse seek",
				"trim/JSON/preview parity",
				"two six-frame production WebM exports",
			],
		};
	} finally {
		params.compositor.dispose();
		disposeGpu();
	}
}
