/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The focused batch test narrows parsed core requests to the fields the resolver reads. */
import { describe, expect, test } from "bun:test";
import { ScalarBatchResolver } from "../scalar-batch-resolver";

const ramp = {
	keys: [
		{ id: "a", time: 0, value: 0, segmentToNext: "linear", tangentMode: "flat" },
		{ id: "b", time: 100, value: 1, segmentToNext: "linear", tangentMode: "flat" },
	],
} as const;

const constantBoundary = {
	keys: [
		{
			id: "a",
			time: 0,
			value: 1,
			segmentToNext: "bezier",
			tangentMode: "flat",
			rightHandle: { dt: 40, dv: 0 },
		},
		{
			id: "b",
			time: 100,
			value: 1,
			segmentToNext: "linear",
			tangentMode: "flat",
			leftHandle: { dt: -40, dv: 0 },
		},
	],
} as const;

describe("ScalarBatchResolver", () => {
	test("batches multiple scalar channels into one core call", () => {
		let calls = 0;
		const core = (input: string): string => {
			calls += 1;
			const request = JSON.parse(input) as { items: Array<{ id: string }> };
			return JSON.stringify({
				version: 1,
				numericSemantics: "scalar-f64-v1",
				results: request.items.map((item) => ({
					id: item.id,
					status: "values",
					values: [item.id.length],
				})),
			});
		};
		const resolver = ScalarBatchResolver.withCore({ time: 50, core });
		resolver.plan({
			animations: {
				"transform.positionX": ramp,
				"transform.positionY": ramp,
				opacity: constantBoundary,
				discrete: { keys: [{ id: "d", time: 0, value: "a" }] },
			},
			paths: [
				"transform.positionX",
				"transform.positionY",
				"opacity",
				"discrete",
				"missing",
			],
		});
		resolver.execute();
		expect(calls).toBe(1);
		expect(
			resolver.sample({ path: "transform.positionX", fallbackValue: -1 }),
		).toBe(19);
		expect(resolver.sample({ path: "opacity", fallbackValue: -1 })).toBe(7);
		expect(resolver.sample({ path: "discrete", fallbackValue: 0.5 })).toBe(0.5);
		expect(resolver.sample({ path: "missing", fallbackValue: 0.25 })).toBe(0.25);
	});

	test("rejects reads before execute and duplicate planning is idempotent", () => {
		const core = (input: string): string => {
			const request = JSON.parse(input) as { items: Array<{ id: string }> };
			return JSON.stringify({
				version: 1,
				numericSemantics: "scalar-f64-v1",
				results: request.items.map((item) => ({
					id: item.id,
					status: "values",
					values: [7],
				})),
			});
		};
		const resolver = ScalarBatchResolver.withCore({ time: 0, core });
		expect(() =>
			resolver.sample({ path: "opacity", fallbackValue: 1 }),
		).toThrow();
		resolver.plan({ animations: { opacity: ramp }, paths: ["opacity"] });
		resolver.plan({ animations: { opacity: ramp }, paths: ["opacity"] });
		resolver.execute();
		expect(resolver.sample({ path: "opacity", fallbackValue: 0 })).toBe(7);
	});

	test("empty plans resolve without touching the core", () => {
		const resolver = new ScalarBatchResolver({ time: 0 });
		resolver.plan({ animations: undefined, paths: ["opacity"] });
		resolver.execute();
		expect(resolver.sample({ path: "opacity", fallbackValue: 0.5 })).toBe(0.5);
	});
});
