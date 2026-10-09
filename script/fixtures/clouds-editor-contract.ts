import type { CloudsParams } from "./clouds-cases";

export const editorSize = Object.freeze({ width: 640, height: 360 });
export const editorParams: CloudsParams = Object.freeze({
	amount: 0.85,
	density: 0.75,
	scale: 0.23,
	speed: 1.25,
	windX: 0.15,
	windY: -0.2,
	refraction: 0.06,
	fogOpacity: 0.3,
	colorR: 0.2,
	colorG: 0.75,
	colorB: 0.9,
	seed: 31415,
});
export const opticalChannels = Object.freeze({
	amount: [0.7, 1],
	density: [0.55, 0.9],
	windX: [-0.5, 0.5],
	windY: [0.3, -0.3],
	refraction: [0.025, 0.07],
	fogOpacity: [0.15, 0.65],
	colorR: [0.1, 0.9],
	colorG: [0.75, 0.25],
	colorB: [0.85, 0.15],
} as const);
export const editorChanges = Object.freeze([
	{ key: "amount", label: "Amount", value: 0.95 },
	{ key: "density", label: "Density", value: 0.8 },
	{ key: "scale", label: "Cloud scale (short-side fraction)", value: 0.19 },
	{ key: "speed", label: "Morph cycles per second", value: 2 },
	{
		key: "windX",
		label: "Horizontal wind offset (short-side fraction)",
		value: -0.25,
	},
	{
		key: "windY",
		label: "Vertical wind offset (short-side fraction)",
		value: 0.35,
	},
	{
		key: "refraction",
		label: "Refraction (short-side fraction)",
		value: 0.075,
	},
	{ key: "fogOpacity", label: "Fog opacity", value: 0.55 },
	{ key: "colorR", label: "Fog red", value: 0.75 },
	{ key: "colorG", label: "Fog green", value: 0.3 },
	{ key: "colorB", label: "Fog blue", value: 0.45 },
	{ key: "seed", label: "Seed", value: 27182 },
] as const);
export const editorSampleLocalTicks = Object.freeze([4000, 12000, 24000]);
export const editorExportLocalTicks = Object.freeze([
	4000, 8000, 12000, 16000, 20000, 24000,
]);
export const editorBackground = Object.freeze([32, 48, 64]);

export function editorParamsAt(local: number): CloudsParams {
	const progress = Math.max(0, Math.min(1, local / 24000));
	return {
		...editorParams,
		...Object.fromEntries(
			Object.entries(opticalChannels).map(([key, values]) => [
				key,
				values[0] + (values[1] - values[0]) * progress,
			]),
		),
	};
}

export function finalEditorParams(): CloudsParams {
	return {
		...editorParams,
		...Object.fromEntries(editorChanges.map(({ key, value }) => [key, value])),
	};
}

export function editorRgb(pixels: Uint8ClampedArray) {
	const result = new Uint8Array((pixels.length / 4) * 3);
	for (let pixel = 0; pixel < pixels.length / 4; pixel++) {
		const alpha = pixels[pixel * 4 + 3] / 255;
		for (let channel = 0; channel < 3; channel++)
			result[pixel * 3 + channel] = Math.round(
				pixels[pixel * 4 + channel] * alpha +
					editorBackground[channel] * (1 - alpha),
			);
	}
	return result;
}
