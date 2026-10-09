import {
	cloudsInvalidParameters,
	cloudsParameters,
	cloudsRate,
	type CloudsParams,
	type CloudsRate,
} from "./clouds-cases";
import { cloudsTimePhase } from "./clouds-oracle-time";

export type CloudsResolution = {
	passes?: { shader: string; uniforms: Record<string, number | number[]> }[];
	error?: string;
};
export type CloudsResolve = (
	params: CloudsParams,
	localTime: number,
	rate?: CloudsRate,
) => CloudsResolution;

export function checkCloudsAdmission(
	resolve: CloudsResolve,
	check: (condition: unknown, message: string) => void,
	results: Record<string, unknown>[],
) {
	let rejections = 0;
	for (const neutral of [
		{},
		{ amount: 0 },
		{ density: 0 },
		{ refraction: 0, fogOpacity: 0 },
	])
		for (const invalid of cloudsInvalidParameters()) {
			const params = { ...cloudsParameters, ...neutral, ...invalid };
			check(
				Boolean(resolve(params, 48000).error),
				`Accepted invalid Clouds params ${JSON.stringify(params)}`,
			);
			rejections++;
		}
	for (const localTime of [
		0.5,
		Number.MAX_SAFE_INTEGER + 1,
		-Number.MAX_SAFE_INTEGER - 1,
	]) {
		check(
			Boolean(
				resolve({ ...cloudsParameters, amount: 0, speed: 0 }, localTime).error,
			),
			`Accepted invalid Clouds time ${localTime}`,
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
				resolve({ ...cloudsParameters, density: 0, speed: 0 }, 0, rate).error,
			),
			`Accepted invalid Clouds rate ${JSON.stringify(rate)}`,
		);
		rejections++;
	}
	let phases = 0;
	for (const rate of [cloudsRate, { numerator: 30000, denominator: 1001 }])
		for (const time of [
			-Number.MAX_SAFE_INTEGER,
			-4005,
			-1,
			0,
			4003,
			4004,
			2400000,
			Number.MAX_SAFE_INTEGER,
		])
			for (const speed of [0, 0.05, 0.5, 4, Number.MIN_VALUE]) {
				const resolution = resolve({ ...cloudsParameters, speed }, time, rate);
				const expected = cloudsTimePhase(time, speed, rate);
				check(
					!resolution.error &&
						resolution.passes?.length === 1 &&
						resolution.passes[0].shader === "clouds" &&
						resolution.passes[0].uniforms.phase === expected,
					`Incorrect Clouds phase at ${time}, speed ${speed}, rate ${JSON.stringify(rate)}`,
				);
				phases++;
			}
	results.push({
		name: "strict admission and independently resolved clock",
		attemptedRejections: rejections,
		phaseChecks: phases,
	});
}
