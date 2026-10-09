import type { ElementAnimations } from "../../packages/editor-classic/src/animation/types";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { assert, effect, hash, spatialScene } from "./spatial-probe-scene";

export type RevealCapture = (
	node: ReturnType<typeof spatialScene>,
	local?: number,
) => Promise<Uint8ClampedArray>;
export interface RevealReferences {
	baseline: Uint8ClampedArray;
	black: Uint8ClampedArray;
	white: Uint8ClampedArray;
}
export function revealAnimations(
	values: Record<string, [number, number]>,
): ElementAnimations {
	return Object.fromEntries(
		Object.entries(values).map(([key, endpoints]) => [
			`effects.filter.params.${key}`,
			{
				keys: endpoints.map((value, index) => ({
					id: `${key}-${index}`,
					time: mediaTime({ ticks: index * 24000 }),
					value,
					segmentToNext: "linear",
					tangentMode: "auto",
				})),
			},
		]),
	);
}
export async function checkRevealTimeline(
	capture: RevealCapture,
	type: string,
	params: Record<string, number>,
	values: Record<string, [number, number]>,
) {
	const animations = revealAnimations(values);
	const node = spatialScene([effect(type, params)], { animations });
	const expectedHashes = new Map<number, string>();
	for (const time of [0, 12000, 24000]) {
		const overrides = Object.fromEntries(
			Object.entries(values).map(([key, [start, end]]) => [
				key,
				start + (end - start) * (time / 24000),
			]),
		);
		const expected = await capture(
			spatialScene([effect(type, { ...params, ...overrides })]),
			time,
		);
		const actual = await capture(node, time);
		const digest = await hash(expected);
		assert(
			(await hash(actual)) === digest,
			`${type} keyframes did not match explicitly specified midpoint/endpoints`,
		);
		expectedHashes.set(time, digest);
	}
	assert(
		new Set(expectedHashes.values()).size === 3,
		`${type} authored timeline is static`,
	);
	for (const time of [12000, 0, 24000, 12000])
		assert(
			(await hash(await capture(node, time))) === expectedHashes.get(time),
			`${type} reverse/repeat seek at ${time}`,
		);
	for (const option of [{ trim: 0 }, { restored: true }, { preview: true }])
		assert(
			(await hash(
				await capture(
					spatialScene([effect(type, params)], { animations, ...option }),
					12000,
				),
			)) === expectedHashes.get(12000),
			`${type} trim/JSON/preview parity ${JSON.stringify(option)}`,
		);
	return Object.fromEntries(expectedHashes);
}

export function changedPixels(
	a: Uint8ClampedArray,
	b: Uint8ClampedArray,
	threshold = 3,
) {
	let count = 0;
	for (let i = 0; i < a.length; i += 4)
		if ([0, 1, 2].some((c) => Math.abs(a[i + c] - b[i + c]) > threshold))
			count++;
	return count;
}

export async function revealAlpha(
	capture: RevealCapture,
	type: string,
	params: Record<string, number>,
	references: RevealReferences,
	expected: "preserve" | "bounded" | "half",
) {
	const fx = effect(type, params);
	const black = await capture(spatialScene([fx], { background: "#000000" }));
	const white = await capture(spatialScene([fx], { background: "#ffffff" }));
	let maximum = 0,
		holes = 0,
		partial = 0;
	for (let i = 0; i < black.length; i += 4) {
		const source = 255 - (references.white[i] - references.black[i]);
		const actual = 255 - (white[i] - black[i]);
		if (source === 0) {
			holes++;
			assert(
				[0, 1, 2].every((c) => black[i + c] === 0 && white[i + c] === 255),
				`${type} filled a transparent source hole`,
			);
		}
		if (actual > 1 && actual < 254) partial++;
		const error =
			expected === "bounded"
				? Math.max(0, actual - source)
				: Math.abs(actual - source * (expected === "half" ? 0.5 : 1));
		maximum = Math.max(maximum, error);
	}
	assert(
		maximum <= 2 && holes > 1000,
		`${type} alpha ${expected}: ${JSON.stringify({ maximum, holes, partial })}`,
	);
	return { expected, maximum, holes, partial };
}
