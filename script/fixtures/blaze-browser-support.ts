import { applyEffectPasses, resolveStylizedEffectJson } from "opencut-wasm";
import { blazeRate, type BlazeParams, type BlazeRate } from "./blaze-cases";
import type { BlazeResolution } from "./blaze-browser-checks";

export function resolveBlaze(
	params: Record<string, unknown>,
	localTime: number,
	frameRate: BlazeRate = blazeRate,
): BlazeResolution {
	return JSON.parse(
		resolveStylizedEffectJson(
			JSON.stringify({ effectType: "blaze", params, localTime, frameRate }),
		),
	);
}

export function readBlaze(canvas: OffscreenCanvas) {
	const context = new OffscreenCanvas(canvas.width, canvas.height).getContext(
		"2d",
		{ willReadFrequently: true },
	)!;
	context.drawImage(canvas, 0, 0);
	return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

export function renderBlaze(
	source: OffscreenCanvas,
	params: BlazeParams,
	ticks: number,
	rate = blazeRate,
	enabled = true,
) {
	// enabled belongs to the owning stack. This is a raster bypass control, not a timeline integration assertion.
	if (!enabled) return readBlaze(source);
	const resolved = resolveBlaze(params, ticks, rate);
	if (resolved.error || !resolved.passes)
		throw Error(resolved.error ?? "Missing Blaze passes");
	if (!resolved.passes.length) return readBlaze(source);
	return readBlaze(
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

export function encodeBlaze(pixels: Uint8ClampedArray) {
	let binary = "";
	for (let offset = 0; offset < pixels.length; offset += 8192)
		binary += String.fromCharCode(...pixels.subarray(offset, offset + 8192));
	return btoa(binary);
}
