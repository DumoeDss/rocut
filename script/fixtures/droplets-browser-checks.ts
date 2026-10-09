import {
	dropletsInvalidParameters,
	dropletsParameters,
	type DropletsParams,
	type DropletsRate,
} from "./droplets-cases";
import { dropletsTimePhase } from "./droplets-oracle-time";
export type DropletsResolution = {
	passes?: { shader: string; uniforms: Record<string, number | number[]> }[];
	error?: string;
};
export function checkDropletsAdmission(
	resolve: (
		params: DropletsParams,
		time: number,
		rate?: DropletsRate,
	) => DropletsResolution,
	check: (condition: unknown, message: string) => void,
	results: Record<string, unknown>[],
) {
	let rejections = 0;
	for (const neutral of [{}, { amount: 0 }, { count: 0 }])
		for (const invalid of dropletsInvalidParameters()) {
			const params = { ...dropletsParameters, ...neutral, ...invalid };
			check(
				Boolean(resolve(params, 48000).error),
				`Accepted invalid params ${JSON.stringify(params)}`,
			);
			rejections++;
		}
	for (const time of [
		0.5,
		Number.MAX_SAFE_INTEGER + 1,
		-Number.MAX_SAFE_INTEGER - 1,
	]) {
		check(
			Boolean(resolve({ ...dropletsParameters, amount: 0 }, time).error),
			`Accepted invalid time ${time}`,
		);
		rejections++;
	}
	for (const rate of [
		{ numerator: 0, denominator: 1 },
		{ numerator: 29, denominator: 1 },
		{ numerator: 30, denominator: 0 },
	]) {
		check(
			Boolean(resolve({ ...dropletsParameters, count: 0 }, 0, rate).error),
			`Accepted invalid fps ${JSON.stringify(rate)}`,
		);
		rejections++;
	}
	results.push({
		name: "strict admission including neutral controls",
		attemptedRejections: rejections,
	});
	const rational = { numerator: 30000, denominator: 1001 };
	for (const time of [
		-Number.MAX_SAFE_INTEGER,
		-4005,
		-1,
		0,
		4003,
		4004,
		Number.MAX_SAFE_INTEGER,
	]) {
		for (const speed of [0, 0.35, 0.5, 4, Number.MIN_VALUE]) {
			const resolution = resolve(
				{ ...dropletsParameters, speed },
				time,
				rational,
			);
			const precise = Math.fround(dropletsTimePhase(time, speed, rational));
			const expected = precise >= 1 ? 0 : precise;
			check(
				!resolution.error &&
					resolution.passes?.[0]?.uniforms.phase === expected,
				`Incorrect bounded phase at ${time}, speed ${speed}`,
			);
		}
	}
}
