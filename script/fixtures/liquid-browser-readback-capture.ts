import * as wasm from "opencut-wasm";
import {
	liquidRate,
	liquidThresholds,
	type LiquidParams,
} from "./liquid-browser-cases";
import {
	liquidDifference,
	liquidExpected,
	liquidOver,
} from "./liquid-browser-oracle";
import { liquidRead } from "./liquid-browser-raster";
import { liquidSurfaceQuantizedReference } from "./liquid-surface-quantization";

export type Readback = (options: {
	source: OffscreenCanvas;
	width: number;
	height: number;
	passes: { shader: string; uniforms: { name: string; value: number[] }[] }[];
}) => Promise<{
	rgba: Uint8Array;
	width: number;
	height: number;
	canvas: OffscreenCanvas;
	format: "rgba8unorm" | "bgra8unorm";
	backend: "webgl" | "webgpu";
}>;

/** Checks the feature seam's lifecycle and the raw/surface pixel-space boundary. */
export function createLiquidReadbackCapture(expectedBackend: string) {
	const readback = Reflect.get(wasm, "applyEffectPassesReadback") as
		| Readback
		| undefined;
	if (typeof readback !== "function")
		throw Error("Diagnostic WASM lacks applyEffectPassesReadback");
	const raw: unknown[] = [],
		surface: unknown[] = [],
		composite: unknown[] = [],
		schedules: unknown[] = [],
		metadata: unknown[] = [],
		bypasses: string[] = [],
		errors: string[] = [];
	const record = (
		group: unknown[],
		name: string,
		actual: Uint8ClampedArray,
		expected: Uint8ClampedArray,
		rgb: number = liquidThresholds.rgb,
		alpha: number = liquidThresholds.alpha,
	) => {
		const difference = liquidDifference(actual, expected, rgb, alpha);
		group.push({ name, ...difference });
		if (difference.failures)
			errors.push(`${name}: ${difference.first}; ${difference.failures} bytes`);
	};
	const recordRaw = (
		name: string,
		actual: Uint8ClampedArray,
		expected: Uint8ClampedArray,
		rgb = 2,
		alpha = 1,
	) => record(raw, name, actual, expected, rgb, alpha);
	const capture = async (
		name: string,
		canvas: OffscreenCanvas,
		source: Uint8ClampedArray,
		params: LiquidParams,
		local: number,
		fps = liquidRate,
		identity = false,
	) => {
		const { width, height } = canvas;
		const resolved = JSON.parse(
			wasm.resolveStylizedEffectJson(
				JSON.stringify({
					effectType: "liquid",
					params,
					localTime: local,
					frameRate: fps,
				}),
			),
		);
		if (resolved.error) throw Error(resolved.error);
		let resultCanvas = canvas,
			pixels = new Uint8ClampedArray(source);
		if (resolved.passes.length === 0) {
			// A validated amount-zero bypass does not claim a GPU readback.
			bypasses.push(name);
		} else {
			const result = await readback({
				source: canvas,
				width,
				height,
				passes: resolved.passes.map(
					(pass: {
						shader: string;
						uniforms: Record<string, number | number[]>;
					}) => ({
						shader: pass.shader,
						uniforms: Object.entries(pass.uniforms).map(([name, value]) => ({
							name,
							value: Array.isArray(value) ? value : [value],
						})),
					}),
				),
			});
			if (
				result.width !== width ||
				result.height !== height ||
				!(result.rgba instanceof Uint8Array) ||
				result.rgba.length !== width * height * 4 ||
				!(result.canvas instanceof OffscreenCanvas) ||
				result.canvas.width !== width ||
				result.canvas.height !== height ||
				!["rgba8unorm", "bgra8unorm"].includes(result.format) ||
				result.backend !== expectedBackend
			)
				throw Error(`${name}: invalid raw/canvas readback contract`);
			metadata.push({
				name,
				width,
				height,
				sourceTextureFormat: result.format,
				returnedChannelOrder: "RGBA",
				backend: result.backend,
			});
			pixels = new Uint8ClampedArray(result.rgba);
			resultCanvas = result.canvas;
		}
		const expected = liquidExpected(source, width, height, params, local, fps);
		recordRaw(
			`${name} raw CPU oracle`,
			pixels,
			expected.pixels,
			identity ? 0 : 2,
			identity ? 0 : 1,
		);
		schedules.push({
			name,
			steps: expected.steps,
			eventsApplied: expected.eventsApplied,
			completedTicks: expected.completedTicks,
		});
		record(
			surface,
			`${name} surface from same raw texture`,
			liquidRead(resultCanvas, width, height),
			liquidSurfaceQuantizedReference(pixels),
		);
		const black = liquidRead(resultCanvas, width, height, "#000000"),
			white = liquidRead(resultCanvas, width, height, "#ffffff");
		for (const [color, actual, background] of [
			["black", black, [0, 0, 0]],
			["white", white, [255, 255, 255]],
		] as const)
			record(
				composite,
				`${name} over-${color}`,
				actual,
				liquidOver(expected.pixels, background),
				liquidThresholds.compositeRgb,
				0,
			);
		let maxAlphaError = 0;
		for (let i = 0; i < pixels.length; i += 4)
			for (let c = 0; c < 3; c++)
				maxAlphaError = Math.max(
					maxAlphaError,
					Math.abs(
						1 -
							(white[i + c] - black[i + c]) / 255 -
							expected.pixels[i + 3] / 255,
					),
				);
		composite.push({ name: `${name} inferred alpha`, maxAlphaError });
		if (maxAlphaError > liquidThresholds.alphaFromBackgrounds + 1e-12)
			errors.push(`${name}: inferred alpha ${maxAlphaError}`);
		return pixels;
	};
	return {
		capture,
		recordRaw,
		report: { raw, surface, composite, schedules, metadata, bypasses, errors },
	};
}
