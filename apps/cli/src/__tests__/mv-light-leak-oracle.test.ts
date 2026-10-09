import { expect, test } from "bun:test";
import * as wasm from "opencut-wasm";
import { lightLeakReference } from "../../../../script/fixtures/mv-light-leak-reference";
import { lightLeakSource } from "../../../../script/fixtures/mv-light-leak-source";

const referenceRoot = process.env.ROCUT_TEST_MV_REFERENCE;
test.skipIf(!referenceRoot)(
	"Rust light-leak geometry agrees with original seq overlay noise, two gradients and clock/seed negative controls",
	async () => {
		const reference = await lightLeakReference(referenceRoot!);
		const source = lightLeakSource();
		let cases = 0;
		for (const seed of [0, 3, 11, 2147483648, 4294967295]) {
			for (const [songStartSeconds, frame, speed, seedOffset] of [
				[0, 0, 1, 0],
				[12.25, 123, 1, 0],
				[123.5, 299, 8, 37],
				[12.25, 71, 0, 4],
				[0.25, 1, 0.125, 0],
			] as const) {
				const effect = {
					kind: "lightLeak" as const,
					amount: 0.63,
					alpha: "expand" as const,
					speed,
					seedOffset,
				};
				const spec = {
					...source,
					seed,
					recipe: {
						...source.recipe!,
						songStartSeconds,
						post: [{ stage: "composite", effects: [effect] }],
					},
				};
				const result = JSON.parse(
					wasm.resolveProgrammaticFrameJson(
						JSON.stringify({
							source: spec,
							clipStart: 0,
							clipDuration: 1201200,
							trimStart: 0,
							timelineTime: frame * 4004,
						}),
					),
				);
				expect(result.error).toBeUndefined();
				const plan = result.frame.recipePlan.post[0].effects[0].lightLeak;
				const seconds =
					((Math.round(songStartSeconds * 120000) + frame * 4004) / 120000) *
					speed;
				const effectiveSeed = (seed + seedOffset) >>> 0;
				expect(plan.seconds).toBe(seconds);
				expect(plan.seed).toBe(effectiveSeed);
				const original = reference.geometry(
					seconds,
					effect.amount,
					effectiveSeed,
					source.width,
					source.height,
				);
				expect(plan.gradients).toHaveLength(2);
				for (let i = 0; i < 2; i++) {
					const a = plan.gradients[i],
						b = original[i]!;
					expect(a.center[0]).toBeCloseTo(b.center[0]!, 10);
					expect(a.center[1]).toBeCloseTo(b.center[1]!, 10);
					expect(a.radius).toBeCloseTo(b.radius, 10);
					expect(a.stops).toEqual(b.stops);
				}
				expect(
					reference.geometry(
						seconds + 5,
						effect.amount,
						effectiveSeed,
						source.width,
						source.height,
					),
				).not.toEqual(original);
				expect(
					reference.geometry(
						seconds,
						effect.amount,
						(effectiveSeed + 1) >>> 0,
						source.width,
						source.height,
					),
				).not.toEqual(original);
				cases++;
			}
		}
		console.log(JSON.stringify({ cases, oracle: reference.provenance }));
	},
);
