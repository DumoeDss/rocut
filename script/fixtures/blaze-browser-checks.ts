import {
	blazeDefaults,
	blazeParameters,
	blazeRanges,
	blazeRate,
	type BlazeParams,
	type BlazeRate,
} from "./blaze-cases";
import { blazePhase } from "./blaze-oracle-time";

export type BlazeResolution = {
	passes?: { shader: string; uniforms: Record<string, number | number[]> }[];
	error?: string;
};
export type BlazeResolve = (
	params: Record<string, unknown>,
	ticks: number,
	rate?: BlazeRate,
) => BlazeResolution;

export function checkBlazeAdmission(
	resolve: BlazeResolve,
	check: (condition: unknown, message: string) => void,
	results: Record<string, unknown>[],
) {
	let rejections = 0,
		phases = 0;
	const invalid: Record<string, unknown>[] = [
		{ seed: 1.5 },
		{ unknown: 1 },
		{ enabled: false },
		{ flameOpacity: "1" },
		{ smokeOpacity: null },
		{ amount: Number.NaN },
		{ wind: Number.POSITIVE_INFINITY },
	];
	for (const [key, [minimum, maximum]] of Object.entries(blazeRanges))
		invalid.push({ [key]: minimum - 0.001 }, { [key]: maximum + 0.001 });
	for (const neutral of [
		{},
		{ amount: 0 },
		{ flameOpacity: 0, sparkOpacity: 0, smokeOpacity: 0, refraction: 0 },
	])
		for (const changes of invalid) {
			check(
				Boolean(
					resolve({ ...blazeParameters, ...neutral, ...changes }, 48000).error,
				),
				`Accepted invalid Blaze parameters ${JSON.stringify({ neutral, changes })}`,
			);
			rejections++;
		}
	for (const ticks of [
		0.5,
		Number.MAX_SAFE_INTEGER + 1,
		-Number.MAX_SAFE_INTEGER - 1,
	]) {
		check(
			Boolean(
				resolve({ ...blazeParameters, amount: 0, speed: 0 }, ticks).error,
			),
			`Accepted invalid Blaze ticks ${ticks}`,
		);
		rejections++;
	}
	for (const rate of [
		{ numerator: 0, denominator: 1 },
		{ numerator: 7, denominator: 1 },
		{ numerator: 30, denominator: 0 },
		{ numerator: 120001, denominator: 1 },
		{ numerator: 30, denominator: 1002 },
	]) {
		check(
			Boolean(
				resolve({ ...blazeParameters, amount: 0, speed: 0 }, 0, rate).error,
			),
			`Accepted invalid Blaze rate ${JSON.stringify(rate)}`,
		);
		rejections++;
	}
	const defaults = resolve({}, 48000),
		explicit = resolve(blazeDefaults, 48000);
	check(
		!defaults.error && JSON.stringify(defaults) === JSON.stringify(explicit),
		"Blaze omitted defaults differ",
	);
	for (const rate of [blazeRate, { numerator: 30000, denominator: 1001 }])
		for (const ticks of [
			-Number.MAX_SAFE_INTEGER,
			-4005,
			-1,
			0,
			4003,
			4004,
			2400000,
			Number.MAX_SAFE_INTEGER,
		])
			for (const speed of [0, 0.05, 0.4, 0.5, 4, Number.MIN_VALUE]) {
				const resolved = resolve({ ...blazeParameters, speed }, ticks, rate);
				const expected = blazePhase({ ticks, speed, rate });
				check(
					!resolved.error &&
						resolved.passes?.length === 1 &&
						resolved.passes[0].shader === "blaze" &&
						resolved.passes[0].uniforms.phase === expected,
					`Blaze phase mismatch ticks=${ticks} speed=${speed} rate=${JSON.stringify(rate)}`,
				);
				phases++;
			}
	results.push({
		name: "strict admission before neutral elision and exact clock",
		rejections,
		phases,
		defaultsCompared: true,
	});
}

export const blazeVariants: Record<keyof BlazeParams, number> = {
	amount: 0.35,
	flameOpacity: 0.2,
	sparkOpacity: 0.2,
	smokeOpacity: 0.9,
	refraction: 0.02,
	height: 0.45,
	scale: 0.27,
	speed: 0.7,
	wind: -0.5,
	seed: 27182,
};
