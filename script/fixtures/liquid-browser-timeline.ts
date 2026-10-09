import {
	liquidDifference,
	liquidExpected,
	liquidOver,
} from "./liquid-browser-oracle";
import { liquidParameters } from "./liquid-browser-cases";
import {
	liquidScene,
	liquidSceneSource,
	effect,
	hash,
	type LiquidCapture,
} from "./liquid-browser-scene";
import { revealAnimations } from "./reveal-effects-common";

export async function checkLiquidTimeline(
	capture: LiquidCapture,
	paint: (pixels: Uint8ClampedArray, slot: number) => void,
) {
	const parameters = liquidParameters(),
		source = liquidSceneSource(),
		fps = { numerator: 30, denominator: 1 };
	const baseline = await capture(liquidScene([]), 60000),
		results: unknown[] = [],
		errors: string[] = [];
	paint(baseline, 0);
	const check = (
		name: string,
		actual: Uint8ClampedArray,
		expected: Uint8ClampedArray,
		identity = false,
	) => {
		const diff = liquidDifference(actual, expected, identity ? 0 : 3, 0);
		results.push({ name, ...diff });
		if (diff.failures)
			errors.push(`${name}: ${diff.first}; ${diff.failures} failed bytes`);
	};
	const node = liquidScene([effect("liquid", parameters)]);
	const frames = new Map<number, Uint8ClampedArray>();
	for (const local of [0, 4000, 12000, 24000, 28000, 60000]) {
		const actual = await capture(node, local),
			expected = liquidExpected(source, 640, 360, parameters, local, fps);
		check(
			`scene independent oracle t${local}`,
			actual,
			liquidOver(expected.pixels, [32, 48, 64]),
		);
		frames.set(local, actual);
		if ([4000, 12000, 24000].includes(local))
			paint(actual, [4000, 12000, 24000].indexOf(local) + 1);
	}
	for (const local of [60000, 12000, 28000, 0, 24000])
		check(
			`scene seek t${local}`,
			await capture(node, local),
			frames.get(local)!,
			true,
		);
	check("scene final freeze", frames.get(60000)!, frames.get(28000)!, true);
	for (const options of [{ preview: true }, { trim: 0 }, { restored: true }])
		check(
			`scene ${JSON.stringify(options)}`,
			await capture(
				liquidScene([effect("liquid", parameters)], options),
				24000,
			),
			frames.get(24000)!,
			true,
		);
	check(
		"scene amount zero",
		await capture(
			liquidScene([effect("liquid", { ...parameters, amount: 0 })]),
			24000,
		),
		baseline,
		true,
	);
	const animatedValues: Record<string, [number, number]> = {
		amount: [0.25, 0.75],
		refraction: [0.125, 0.25],
		dyeOpacity: [0.25, 0.75],
		colorR: [0.125, 0.875],
		colorG: [0.75, 0.25],
		colorB: [1, 0.25],
	};
	const animated = liquidScene([effect("liquid", parameters)], {
		animations: revealAnimations(animatedValues),
	});
	for (const local of [0, 12000, 24000]) {
		const params = {
			...parameters,
			...Object.fromEntries(
				Object.entries(animatedValues).map(([key, values]) => [
					key,
					values[0] + ((values[1] - values[0]) * local) / 24000,
				]),
			),
		};
		const actual = await capture(animated, local),
			expected = liquidExpected(source, 640, 360, params, local, fps);
		check(
			`six optical keyframes t${local}`,
			actual,
			liquidOver(expected.pixels, [32, 48, 64]),
		);
		check(
			`keyframes versus static t${local}`,
			actual,
			await capture(liquidScene([effect("liquid", params)]), local),
			true,
		);
		if (local === 24000) paint(actual, 4);
	}
	const black = await capture(
		liquidScene([effect("liquid", parameters)], { background: "#000000" }),
		24000,
	);
	const white = await capture(
		liquidScene([effect("liquid", parameters)], { background: "#ffffff" }),
		24000,
	);
	const alphaExpected = liquidExpected(
		source,
		640,
		360,
		parameters,
		24000,
		fps,
	).pixels;
	check("scene alpha over black", black, liquidOver(alphaExpected, [0, 0, 0]));
	check(
		"scene alpha over white",
		white,
		liquidOver(alphaExpected, [255, 255, 255]),
	);
	paint(black, 5);
	let alphaError = 0,
		transparent = 0,
		partial = 0;
	for (let i = 0; i < black.length; i += 4) {
		const alpha = 1 - (white[i] - black[i]) / 255;
		alphaError = Math.max(
			alphaError,
			Math.abs(alpha - alphaExpected[i + 3] / 255),
		);
		if (alphaExpected[i + 3] === 0) transparent++;
		else if (alphaExpected[i + 3] < 255) partial++;
	}
	results.push({
		name: "scene inferred alpha",
		alphaError,
		transparent,
		partial,
	});
	if (alphaError > 2 / 255 + 1e-12 || transparent < 1000 || partial < 1000)
		errors.push(`Scene alpha failed: ${alphaError}/${transparent}/${partial}`);
	return {
		ok: errors.length === 0,
		results,
		errors,
		baseline,
		source,
		parameters,
		baselineHash: await hash(baseline),
	};
}
