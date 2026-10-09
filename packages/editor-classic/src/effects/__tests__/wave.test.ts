import { expect, test } from "bun:test";
import { registerDefaultEffects } from "../index";
import { resolveEffectPassGroups } from "../../services/renderer/resolve-visual-state";
import { mediaTime } from "../../wasm/media-time";

registerDefaultEffects();
const params = {
	amount: 1,
	lifetime: 2,
	eventCount: 2,
	event0Time: 0,
	event0X: 0.2,
	event0Y: 0.3,
	event0Amplitude: 0.7,
	event1Time: 120000,
	event1X: 0.8,
	event1Y: 0.6,
	event1Amplitude: -0.4,
};
function at({
	localTime,
	type = "ripple",
	values = params,
}: {
	localTime: number;
	type?: string;
	values?: Record<string, number>;
}) {
	return resolveEffectPassGroups({
		effects: [{ id: "wave", type, enabled: true, params: values }],
		animations: {
			"effects.wave.params.amount": {
				keys: [0, 120000].map((ticks, i) => ({
					id: `a${i}`,
					time: mediaTime({ ticks }),
					value: i,
					segmentToNext: "linear" as const,
					tangentMode: "auto" as const,
				})),
			},
		},
		localTime,
		frameRate: { numerator: 30, denominator: 1 },
		width: 640,
		height: 360,
	}).flat();
}

test("wave events remain a vector through effect resolution and arbitrary seeking", () => {
	for (const type of ["ripple", "force-field"]) {
		const middle = at({ localTime: 60000, type });
		expect(middle[0].shader).toBe(type);
		expect(middle[0].uniforms.amount).toBeCloseTo(0.5);
		expect(middle[0].uniforms.events).toEqual([
			0.2, 0.3, 0.5, 0.7, 0.8, 0.6, -0.5, -0.4,
		]);
		expect(at({ localTime: 180000, type })[0].uniforms.events).toEqual([
			0.2, 0.3, 1.5, 0.7, 0.8, 0.6, 0.5, -0.4,
		]);
		expect(at({ localTime: 360000, type })).toEqual([]);
		expect(at({ localTime: -1, type })).toEqual([]);
		expect(at({ localTime: 0, type })).toEqual([]);
		expect(at({ localTime: 60000, type })).toEqual(middle);
	}
});

test("resolution rejects incomplete or oversized authored schedules before defaults", () => {
	const missing: Record<string, number> = { ...params };
	delete missing.event1Amplitude;
	expect(() => at({ localTime: 60000, values: missing })).toThrow(
		"event1Amplitude",
	);
	expect(() =>
		at({ localTime: 60000, values: { ...params, eventCount: 17 } }),
	).toThrow("eventCount");
	expect(() =>
		at({ localTime: 60000, values: { ...params, event0Time: 0.5 } }),
	).toThrow("event0Time");
});
