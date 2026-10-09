import type { LiquidOracleConfig, LiquidOracleEvent } from "./liquid-oracle";

export type LiquidParams = Record<string, number>;
export type LiquidRate = { numerator: number; denominator: number };
export const liquidRate: LiquidRate = { numerator: 120, denominator: 1 };
export const liquidConfig: LiquidOracleConfig = {
	columns: 12,
	rows: 8,
	viscosity: 0.0078125,
	velocityDamping: 0.5,
	dyeDissipation: 0.25,
	pressureIterations: 40,
	diffusionIterations: 8,
	vorticity: 1.5,
};
export const liquidEvents: LiquidOracleEvent[] = [
	{
		atTicks: 0,
		center: [0.5, 0.5],
		radius: 0.375,
		velocity: [2, -1],
		dye: 0.75,
	},
	{
		atTicks: 8000,
		center: [0.25, 0.75],
		radius: 0.25,
		velocity: [-1, 2],
		dye: 0.5,
	},
	{
		atTicks: 24499,
		center: [0.75, 0.25],
		radius: 0.375,
		velocity: [3, 3],
		dye: 1,
	},
];
export function liquidParameters(
	changes: LiquidParams = {},
	events = liquidEvents,
): LiquidParams {
	return {
		...liquidConfig,
		amount: 1,
		refraction: 0.25,
		dyeOpacity: 0.5,
		colorR: 0.125,
		colorG: 0.75,
		colorB: 1,
		startTicks: 2500,
		durationTicks: 24500,
		eventCount: events.length,
		...Object.fromEntries(
			events.flatMap((event, i) =>
				Object.entries({
					Time: event.atTicks,
					X: event.center[0],
					Y: event.center[1],
					Radius: event.radius,
					VelocityX: event.velocity[0],
					VelocityY: event.velocity[1],
					Dye: event.dye,
				}).map(([key, value]) => [`event${i}${key}`, value]),
			),
		),
		...changes,
	};
}
export function liquidInput(
	params: LiquidParams,
	local: number,
	fps: LiquidRate,
	width: number,
	height: number,
) {
	const step = (120000 * fps.denominator) / fps.numerator;
	if (!Number.isSafeInteger(step))
		throw Error("Oracle requires integral frame ticks");
	const sampled = Math.floor(local / step) * step;
	const events = Array.from(
		{ length: params.eventCount },
		(_, i): LiquidOracleEvent => ({
			atTicks: params[`event${i}Time`],
			center: [params[`event${i}X`], params[`event${i}Y`]],
			radius: params[`event${i}Radius`],
			velocity: [params[`event${i}VelocityX`], params[`event${i}VelocityY`]],
			dye: params[`event${i}Dye`],
		}),
	);
	return {
		config: Object.fromEntries(
			Object.keys(liquidConfig).map((key) => [key, params[key]]),
		) as unknown as LiquidOracleConfig,
		events,
		width,
		height,
		elapsedTicks: Math.max(
			0,
			Math.min(params.durationTicks, sampled - params.startTicks),
		),
	};
}
/** Integer RGBA fixture, with a source-coordinate ramp and high-frequency blue bars. */
export function liquidSource(
	width: number,
	height: number,
	holes = false,
): Uint8ClampedArray<ArrayBuffer> {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			data.set(
				[
					Math.floor((255 * x) / (width - 1)),
					Math.floor((255 * y) / (height - 1)),
					(Math.floor(x / 11) + Math.floor(y / 7)) % 2 ? 224 : 32,
					holes
						? [0, 1, 96, 255][(Math.floor(x / 11) + Math.floor(y / 9)) % 4]
						: 255,
				],
				i,
			);
			if (data[i + 3] === 0) data.set([255, 0, 255], i);
		}
	return data;
}

export const liquidThresholds = Object.freeze({
	rgb: 2,
	alpha: 1,
	identity: 0,
	compositeRgb: 3,
	alphaFromBackgrounds: 2 / 255,
	exportMeanRgba: 10,
	exportActiveRgb: 15,
	exportActivePixels: 2000,
});
