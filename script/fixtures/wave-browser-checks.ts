import { resolveStylizedEffectJson } from "opencut-wasm";
import { assert, effect, hash, spatialScene } from "./spatial-probe-scene";
import type { WaveCapture } from "./wave-probe-oracle";

interface Impact {
	time: number;
	x: number;
	y: number;
	amplitude: number;
}

export function waveSchedule(impacts: Impact[]): Record<string, number> {
	return Object.fromEntries([
		["eventCount", impacts.length],
		...impacts.flatMap((impact, i) => [
			[`event${i}Time`, impact.time],
			[`event${i}X`, impact.x],
			[`event${i}Y`, impact.y],
			[`event${i}Amplitude`, impact.amplitude],
		]),
	]);
}

export const waveParams = {
	amount: 1,
	speed: 0.4,
	wavelength: 0.2,
	width: 0.4,
	refraction: 0.12,
	decay: 0,
	lifetime: 0.8,
	...waveSchedule([
		{ time: 0, x: 0.38, y: 0.45, amplitude: 1 },
		{ time: 8000, x: 0.64, y: 0.58, amplitude: -0.8 },
	]),
};

export async function checkWaveBudgetAndInterference(
	capture: WaveCapture,
	baseline: Uint8ClampedArray,
) {
	const impact = { time: 8000, x: 0.64, y: 0.58, amplitude: 1 };
	const draw = (params: Record<string, number>) =>
		capture(spatialScene([effect("ripple", params)]), 60000);
	const oneParams = { ...waveParams, ...waveSchedule([impact]) };
	const one = await draw(oneParams),
		oneHash = await hash(one);
	assert(oneHash !== (await hash(baseline)), "Single impact is neutral");
	const half = { ...impact, amplitude: 0.5 };
	const two = await draw({ ...waveParams, ...waveSchedule([half, half]) });
	let maximum = 0;
	for (let i = 0; i < one.length; i++)
		maximum = Math.max(maximum, Math.abs(one[i] - two[i]));
	assert(
		maximum <= 1,
		`Two half-strength impacts did not add before refraction: ${maximum}`,
	);
	const cancel = await draw({
		...waveParams,
		...waveSchedule([half, { ...half, amplitude: -0.5 }]),
	});
	assert(
		(await hash(cancel)) === (await hash(baseline)),
		"Opposite impacts did not cancel before sampling",
	);
	const impacts = Array.from({ length: 16 }, (_, i) => ({
		...impact,
		amplitude: i === 15 ? 1 : 0,
	}));
	const fullParams = { ...waveParams, ...waveSchedule(impacts) };
	assert(
		(await hash(await draw(fullParams))) === oneHash,
		"Impact slot 16 was dropped or altered",
	);
	assert(
		(await hash(await draw({ ...fullParams, eventCount: 15 }))) ===
			(await hash(baseline)),
		"Inactive tail slot was evaluated",
	);
	const resolve = (params: Record<string, number>) =>
		JSON.parse(
			resolveStylizedEffectJson(
				JSON.stringify({
					effectType: "ripple",
					params,
					localTime: 60000,
					frameRate: { numerator: 30, denominator: 1 },
				}),
			),
		) as { error?: string; passes?: { uniforms: { events: number[] } }[] };
	assert(
		resolve(fullParams).passes?.[0]?.uniforms.events.length === 64,
		"Resolved schedule budget mismatch",
	);
	const missing: Record<string, number> = { ...oneParams };
	delete missing.event0Amplitude;
	const invalid = [
		{ ...fullParams, eventCount: 17 },
		{ ...oneParams, eventCount: 1.5 },
		{ ...oneParams, event0Time: 0.5 },
		{ ...oneParams, event0Time: -1 },
		{ ...oneParams, event0Time: Number.MAX_SAFE_INTEGER + 1 },
		missing,
	];
	for (const params of invalid)
		assert(resolve(params).error, "Invalid schedule crossed browser ABI");
	return {
		maximumInterferenceError: maximum,
		capacity: 16,
		rejectedSchedules: invalid.length,
		finalSlotHash: oneHash,
	};
}

export async function checkWaveAlpha(
	capture: WaveCapture,
	reference: Uint8ClampedArray,
) {
	const fx = effect("ripple", waveParams);
	const black = await capture(
		spatialScene([fx], { background: "#000000" }),
		60000,
	);
	const white = await capture(
		spatialScene([fx], { background: "#ffffff" }),
		60000,
	);
	let partial = 0,
		transparent = 0,
		blendError = 0;
	for (let i = 0; i < black.length; i += 4) {
		const alpha = 1 - (white[i] - black[i]) / 255;
		if (alpha < 0.01) transparent++;
		else if (alpha < 0.99) partial++;
		for (const [c, bg] of [32, 48, 64].entries())
			blendError = Math.max(
				blendError,
				Math.abs(black[i + c] + (1 - alpha) * bg - reference[i + c]),
			);
	}
	assert(
		partial > 100 && transparent > 1000 && blendError < 2,
		`Wave alpha composition: ${JSON.stringify({ partial, transparent, blendError })}`,
	);
	return { partial, transparent, blendError };
}
