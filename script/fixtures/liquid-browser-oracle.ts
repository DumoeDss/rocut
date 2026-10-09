import { liquidPhysics, type LiquidOracleControl } from "./liquid-oracle";
import {
	liquidInput,
	type LiquidParams,
	type LiquidRate,
} from "./liquid-browser-cases";

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const byte = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
export function liquidSample(
	input: Uint8ClampedArray,
	w: number,
	h: number,
	x: number,
	y: number,
) {
	const ix = Math.floor(x - 0.5),
		iy = Math.floor(y - 0.5),
		fx = x - 0.5 - ix,
		fy = y - 0.5 - iy;
	const tap = (px: number, py: number, c: number) => {
		if (px < 0 || py < 0 || px >= w || py >= h) return 0;
		const i = (py * w + px) * 4,
			alpha = input[i + 3] / 255;
		return c === 3 ? alpha : (input[i + c] / 255) * alpha;
	};
	// Affine differences preserve constant alpha at the inclusive half-unorm cutoff.
	return [0, 1, 2, 3].map((c) =>
		mix(
			mix(tap(ix, iy, c), tap(ix + 1, iy, c), fx),
			mix(tap(ix, iy + 1, c), tap(ix + 1, iy + 1, c), fx),
			fy,
		),
	);
}
export function liquidExpected(
	input: Uint8ClampedArray,
	width: number,
	height: number,
	params: LiquidParams,
	local: number,
	fps: LiquidRate,
	control?: LiquidOracleControl,
) {
	const physical = liquidPhysics({
		...liquidInput(params, local, fps, width, height),
		control,
	});
	const { columns: nx, rows: ny } = physical.grid,
		{ u, v, dye } = physical.state;
	const cells = Array.from({ length: nx * ny }, (_, i) => {
		const x = i % nx,
			y = Math.floor(i / nx);
		return [
			(u[y * (nx + 1) + x] + u[y * (nx + 1) + x + 1]) / 2,
			(v[y * nx + x] + v[(y + 1) * nx + x]) / 2,
			dye[i],
		];
	});
	const cell = (x: number, y: number, c: number) =>
		cells[
			Math.max(0, Math.min(ny - 1, y)) * nx + Math.max(0, Math.min(nx - 1, x))
		][c];
	const output = new Uint8ClampedArray(input.length),
		amount = params.amount;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const index = (y * width + x) * 4,
				gx = ((x + 0.5) / width) * nx - 0.5,
				gy = ((y + 0.5) / height) * ny - 0.5;
			const ix = Math.floor(gx),
				iy = Math.floor(gy),
				fx = gx - ix,
				fy = gy - iy;
			const flow = [0, 1, 2].map((c) =>
				mix(
					mix(cell(ix, iy, c), cell(ix + 1, iy, c), fx),
					mix(cell(ix, iy + 1, c), cell(ix + 1, iy + 1, c), fx),
					fy,
				),
			);
			if (amount === 0 || flow.every((value) => value === 0)) {
				output.set(input.subarray(index, index + 4), index);
				continue;
			}
			const displacement =
				(params.refraction * Math.min(width, height)) /
				(1 + Math.hypot(flow[0], flow[1]));
			const sample = liquidSample(
				input,
				width,
				height,
				x + 0.5 + flow[0] * displacement,
				y + 0.5 + flow[1] * displacement,
			);
			const dyeMix = (1 - Math.exp(-flow[2])) * params.dyeOpacity;
			const alpha =
				((1 - amount) * input[index + 3]) / 255 + amount * sample[3];
			if (alpha <= 0.5 / 255) continue;
			[params.colorR, params.colorG, params.colorB].forEach((color, c) => {
				const base = (input[index + c] * input[index + 3]) / (255 * 255);
				const dyed = (1 - dyeMix) * sample[c] + dyeMix * color * sample[3];
				output[index + c] = byte(((1 - amount) * base + amount * dyed) / alpha);
			});
			output[index + 3] = byte(alpha);
		}
	return {
		pixels: output,
		steps: physical.steps,
		eventsApplied: physical.eventsApplied,
		completedTicks: physical.completedTicks,
	};
}
export function liquidOver(input: Uint8ClampedArray, color: readonly number[]) {
	return Uint8ClampedArray.from(input, (value, i) =>
		i % 4 === 3
			? 255
			: Math.round(
					(value * input[i - (i % 4) + 3]) / 255 +
						color[i % 4] * (1 - input[i - (i % 4) + 3] / 255),
				),
	);
}
export function liquidDifference(
	actual: Uint8ClampedArray,
	expected: Uint8ClampedArray,
	rgb = 2,
	alpha = 1,
) {
	if (actual.length !== expected.length)
		throw Error("Liquid pixel length mismatch");
	let maxRgb = 0,
		maxAlpha = 0,
		failures = 0,
		changed = 0,
		first = "";
	let opaqueFailures = 0;
	let firstPixel:
		| { index: number; actual: number[]; expected: number[] }
		| undefined;
	for (let i = 0; i < actual.length; i++) {
		const error = Math.abs(actual[i] - expected[i]);
		if (i % 4 === 3) maxAlpha = Math.max(maxAlpha, error);
		else maxRgb = Math.max(maxRgb, error);
		if (error) changed++;
		if (error > (i % 4 === 3 ? alpha : rgb)) {
			failures++;
			const pixel = i - (i % 4);
			if (expected[pixel + 3] === 255) opaqueFailures++;
			firstPixel ??= {
				index: pixel / 4,
				actual: Array.from(actual.slice(pixel, pixel + 4)),
				expected: Array.from(expected.slice(pixel, pixel + 4)),
			};
			first ||= `byte ${i}: ${actual[i]} vs ${expected[i]}`;
		}
	}
	return {
		maxRgb,
		maxAlpha,
		failures,
		opaqueFailures,
		changed,
		first,
		firstPixel,
	};
}
