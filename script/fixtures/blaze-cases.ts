export {
	blazeSource,
	type BlazeSourceKind,
	type BlazeSourcePattern,
} from "./blaze-cases-source";

export type BlazeRate = { numerator: number; denominator: number };
export type BlazeParams = {
	amount: number;
	flameOpacity: number;
	sparkOpacity: number;
	smokeOpacity: number;
	refraction: number;
	height: number;
	scale: number;
	speed: number;
	wind: number;
	seed: number;
};

export const blazeContract = "blaze-v1-2026-10-09";
export const blazeParamKeys = [
	"amount",
	"flameOpacity",
	"sparkOpacity",
	"smokeOpacity",
	"refraction",
	"height",
	"scale",
	"speed",
	"wind",
	"seed",
] as const;
export const blazeRate: BlazeRate = { numerator: 30, denominator: 1 };
export const blazeDefaults: BlazeParams = {
	amount: 1,
	flameOpacity: 0.8,
	sparkOpacity: 0.6,
	smokeOpacity: 0.25,
	refraction: 0.015,
	height: 0.65,
	scale: 0.15,
	speed: 0.4,
	wind: 0,
	seed: 1,
};
export const blazeParameters: BlazeParams = {
	amount: 0.8,
	flameOpacity: 0.75,
	sparkOpacity: 1,
	smokeOpacity: 0.5,
	refraction: 0.065,
	height: 0.85,
	scale: 0.11,
	speed: 0.5,
	wind: 0.37,
	seed: 31415,
};
export const blazeRanges: Record<keyof BlazeParams, readonly [number, number]> =
	{
		amount: [0, 1],
		flameOpacity: [0, 1],
		sparkOpacity: [0, 1],
		smokeOpacity: [0, 1],
		refraction: [0, 0.08],
		height: [0.1, 1.5],
		scale: [0.025, 0.5],
		speed: [0, 4],
		wind: [-1, 1],
		seed: [0, 65535],
	};
export const blazeModes: Record<string, Partial<BlazeParams>> = {
	flame: { flameOpacity: 1, sparkOpacity: 0, smokeOpacity: 0, refraction: 0 },
	sparks: { flameOpacity: 0, sparkOpacity: 1, smokeOpacity: 0, refraction: 0 },
	smoke: { flameOpacity: 0, sparkOpacity: 0, smokeOpacity: 1, refraction: 0 },
	heat: { flameOpacity: 0, sparkOpacity: 0, smokeOpacity: 0, refraction: 0.08 },
	combined: {},
	zeroContributions: {
		flameOpacity: 0,
		sparkOpacity: 0,
		smokeOpacity: 0,
		refraction: 0,
	},
};

export function blazeCases() {
	const cases = Object.entries(blazeModes).map(([id, params]) => ({
		id,
		params: { ...blazeParameters, ...params },
		ticks: 48000,
		rate: blazeRate,
		enabled: true,
	}));
	return [
		...cases,
		{
			id: "disabled",
			params: blazeParameters,
			ticks: 48000,
			rate: blazeRate,
			enabled: false,
		},
		{
			id: "zeroAmount",
			params: { ...blazeParameters, amount: 0 },
			ticks: 48000,
			rate: blazeRate,
			enabled: true,
		},
		{
			id: "otherSeed",
			params: { ...blazeParameters, seed: 27182 },
			ticks: 48000,
			rate: blazeRate,
			enabled: true,
		},
		{
			id: "negativeSeek",
			params: blazeParameters,
			ticks: -4001,
			rate: blazeRate,
			enabled: true,
		},
		{
			id: "rationalClock",
			params: blazeParameters,
			ticks: 12012,
			rate: { numerator: 30000, denominator: 1001 },
			enabled: true,
		},
		{
			id: "largeClock",
			params: blazeParameters,
			ticks: Number.MAX_SAFE_INTEGER,
			rate: blazeRate,
			enabled: true,
		},
	];
}

export const blazeSeekTicks = [
	96000, 16000, 64000, 0, 48000, 16000, -4001, 96000,
] as const;
