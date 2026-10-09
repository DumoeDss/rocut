import { applyEffectPasses, resolveStylizedEffectJson } from "opencut-wasm";
import { cloudsRate, type CloudsParams, type CloudsRate } from "./clouds-cases";
import type { CloudsResolution } from "./clouds-browser-checks";

export function resolveClouds(
	params: CloudsParams,
	localTime: number,
	frameRate: CloudsRate = cloudsRate,
): CloudsResolution {
	return JSON.parse(
		resolveStylizedEffectJson(
			JSON.stringify({ effectType: "clouds", params, localTime, frameRate }),
		),
	);
}
export function readClouds(canvas: OffscreenCanvas) {
	const context = new OffscreenCanvas(canvas.width, canvas.height).getContext(
		"2d",
		{ willReadFrequently: true },
	)!;
	context.drawImage(canvas, 0, 0);
	return context.getImageData(0, 0, canvas.width, canvas.height).data;
}
export function renderClouds(
	source: OffscreenCanvas,
	params: CloudsParams,
	time: number,
	rate = cloudsRate,
) {
	const resolved = resolveClouds(params, time, rate);
	if (resolved.error || !resolved.passes)
		throw Error(resolved.error ?? "Clouds passes missing");
	if (!resolved.passes.length) return readClouds(source);
	return readClouds(
		applyEffectPasses({
			source,
			width: source.width,
			height: source.height,
			passes: resolved.passes.map((pass) => ({
				shader: pass.shader,
				uniforms: Object.entries(pass.uniforms).map(([name, value]) => ({
					name,
					value: Array.isArray(value) ? value : [value],
				})),
			})),
		}),
	);
}
export const equalClouds = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
	a.length === b.length && a.every((value, index) => value === b[index]);
export function encodeClouds(pixels: Uint8ClampedArray) {
	let binary = "";
	for (let offset = 0; offset < pixels.length; offset += 8192)
		binary += String.fromCharCode(...pixels.subarray(offset, offset + 8192));
	return btoa(binary);
}
