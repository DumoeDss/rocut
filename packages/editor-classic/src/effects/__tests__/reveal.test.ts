import { expect, test } from "bun:test";
import { registerDefaultEffects } from "../index";
import { resolveEffectPassGroups } from "../../services/renderer/resolve-visual-state";
import { mediaTime } from "../../wasm/media-time";

registerDefaultEffects();

function at({
	type,
	localTime,
	amount = 1,
}: {
	type: string;
	localTime: number;
	amount?: number;
}) {
	return resolveEffectPassGroups({
		effects: [
			{ id: "reveal", type, enabled: true, params: { amount, progress: 0 } },
		],
		animations: {
			"effects.reveal.params.progress": {
				keys: [0, 120000].map((ticks, i) => ({
					id: `p${i}`,
					time: mediaTime({ ticks }),
					value: i,
					segmentToNext: "linear" as const,
					tangentMode: "auto" as const,
				})),
			},
		},
		localTime,
		frameRate: { numerator: 30000, denominator: 1001 },
		width: 640,
		height: 360,
	}).flat();
}

test("reveal progress travels through the native catalog and explicit keyframes", () => {
	for (const type of ["laser", "decrypt-reveal"]) {
		const middle = at({ type, localTime: 60000 });
		expect(middle).toHaveLength(1);
		expect(middle[0].shader).toBe(type);
		expect(middle[0].uniforms.progress).toBeCloseTo(0.5);
		expect(middle[0].uniforms.frame).toBe(0);
		expect(at({ type, localTime: 120000 })[0].uniforms.progress).toBe(1);
		expect(at({ type, localTime: 0 })[0].uniforms.progress).toBe(0);
		expect(at({ type, localTime: 60000 })).toEqual(middle);
		expect(at({ type, localTime: 60000, amount: 0 })).toEqual([]);
	}
});
