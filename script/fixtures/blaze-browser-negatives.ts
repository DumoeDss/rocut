import {
	blazeModes,
	blazeParameters,
	blazeRate,
	type BlazeParams,
} from "./blaze-cases";
import {
	blazeContext,
	blazeExpected,
	blazePixelField,
	blazeSample,
} from "./blaze-oracle";
import {
	blazeStraightBytes,
	type BlazePremultipliedPixel,
} from "./blaze-oracle-sampling";
import {
	blazeActivePixels,
	blazeRawThresholds,
	compareBlazeRaw,
} from "./blaze-browser-metrics";

type NegativeRequest = {
	source: Uint8ClampedArray;
	width: number;
	height: number;
};
type HeatMutation =
	| "verticalSign"
	| "edgeClamp"
	| "straightAlpha"
	| "heatOverlay"
	| "nearest";

function straightSample(
	{ source, width, height }: NegativeRequest,
	x: number,
	y: number,
): BlazePremultipliedPixel {
	const output = [0, 0, 0, 0],
		left = Math.floor(x),
		top = Math.floor(y);
	for (let row = 0; row < 2; row++)
		for (let column = 0; column < 2; column++) {
			const sx = left + column,
				sy = top + row;
			if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
			const weight =
				(column ? x - left : 1 - x + left) * (row ? y - top : 1 - y + top);
			for (let channel = 0; channel < 4; channel++)
				output[channel] +=
					(source[(sy * width + sx) * 4 + channel] / 255) * weight;
		}
	return [
		output[0] * output[3],
		output[1] * output[3],
		output[2] * output[3],
		output[3],
	];
}

/** Deliberately wrong samplers are built only from independent CPU primitives. */
export function blazeWrongHeat(
	request: NegativeRequest,
	mutation: HeatMutation,
) {
	const { source, width, height } = request;
	const params = { ...blazeParameters, ...blazeModes.heat, amount: 1 };
	const context = blazeContext({
		params,
		ticks: 48000,
		rate: blazeRate,
		width,
		height,
	});
	const pixels = new Uint8ClampedArray(source);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const field = blazePixelField({ context, x, y });
			if (!field.dx && !field.dy) continue;
			let sx = x + field.dx,
				sy = y + field.dy;
			if (mutation === "verticalSign") sy = y - field.dy;
			if (mutation === "edgeClamp") {
				sx = Math.min(width - 1, Math.max(0, sx));
				sy = Math.min(height - 1, Math.max(0, sy));
			}
			if (mutation === "nearest") {
				sx = Math.round(sx);
				sy = Math.round(sy);
			}
			let sample =
				mutation === "straightAlpha"
					? straightSample(request, sx, sy)
					: blazeSample({ pixels: source, width, height, x: sx, y: sy });
			if (mutation === "heatOverlay") {
				const base = blazeSample({ pixels: source, width, height, x, y });
				const coverage = Math.min(1, Math.hypot(field.dx, field.dy) / 8) * 0.25;
				sample = [
					base[0] * (1 - coverage) + coverage,
					base[1] * (1 - coverage) + 0.4 * coverage,
					base[2] * (1 - coverage),
					base[3] * (1 - coverage) + coverage,
				];
			}
			pixels.set(blazeStraightBytes(sample), (y * width + x) * 4);
		}
	return pixels;
}

export function blazeNegativeControls(
	request: NegativeRequest,
	capture?: (
		name: string,
		mutant: Uint8ClampedArray,
		reference: Uint8ClampedArray,
		params: BlazeParams,
	) => void,
) {
	const { source, width, height } = request;
	const results: Record<string, unknown>[] = [];
	const expected = (params: BlazeParams, ticks = 48000) =>
		blazeExpected({ source, width, height, params, ticks, rate: blazeRate });
	const compare = (
		name: string,
		actual: Uint8ClampedArray,
		reference: Uint8ClampedArray,
		params: BlazeParams,
	) => {
		const metrics = compareBlazeRaw(actual, reference);
		results.push({ name, rejected: !metrics.pass, ...metrics });
		capture?.(name, actual, reference, params);
	};
	for (const mode of ["flame", "sparks", "smoke", "heat", "combined"]) {
		const params = { ...blazeParameters, ...blazeModes[mode] },
			reference = expected(params).pixels;
		const activePixels = blazeActivePixels(reference, source),
			minimum =
				mode === "sparks"
					? blazeRawThresholds.minimumSparkActivePixels
					: blazeRawThresholds.minimumBroadActivePixels;
		results.push({
			name: `${mode} oracle-selected active support`,
			activePixels,
			minimum,
			rejected: activePixels >= minimum,
		});
		compare(
			`${mode} disabled or suppressed contribution`,
			source,
			reference,
			params,
		);
		compare(
			`${mode} zero output`,
			new Uint8ClampedArray(source.length),
			reference,
			params,
		);
		compare(
			`${mode} wrong seed`,
			expected({ ...params, seed: 27182 }).pixels,
			reference,
			params,
		);
		compare(
			`${mode} repeated first frame`,
			expected(params, 0).pixels,
			reference,
			params,
		);
		compare(
			`${mode} reversed wind`,
			expected({ ...params, wind: -params.wind }).pixels,
			reference,
			params,
		);
	}
	const heat = expected({ ...blazeParameters, ...blazeModes.heat, amount: 1 });
	results.push({
		name: "heat exterior input samples",
		exteriorPixels: heat.exteriorPixels,
		rejected: heat.exteriorPixels > 0,
	});
	for (const mutation of [
		"verticalSign",
		"edgeClamp",
		"straightAlpha",
		"heatOverlay",
		"nearest",
	] as const)
		compare(
			`heat ${mutation}`,
			blazeWrongHeat(request, mutation),
			heat.pixels,
			{ ...blazeParameters, ...blazeModes.heat, amount: 1 },
		);
	const combined = expected(blazeParameters).pixels,
		opaque = new Uint8ClampedArray(combined);
	for (let offset = 3; offset < opaque.length; offset += 4)
		opaque[offset] = 255;
	compare("forced opaque alpha", opaque, combined, blazeParameters);
	return results;
}
