/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The focused transport test narrows the parsed core request to the inspected fields only. */
import { describe, expect, test } from "bun:test";
import {
	inspectScalarAnimationDomain,
	sampleScalarAnimationBatch,
	SCALAR_ANIMATION_SEMANTICS,
} from "../scalar-animation";

const core =
	(input: string): string =>
		JSON.stringify(((): Record<string, unknown> => {
			const parsed: unknown = JSON.parse(input);
			if (typeof parsed !== "object" || parsed === null) {
				throw new TypeError("test core received a non-object request.");
			}
			const request = parsed as unknown as {
				items: Array<{
					id: string;
					times?: number[];
					domain?: { start: number; end: number };
					budget?: { maxNodes: number };
				}>;
			};
			if (request.items.some((item) => item.times === undefined)) {
				return {
					version: 1,
					numericSemantics: SCALAR_ANIMATION_SEMANTICS,
					results: request.items.map((item) => ({
						id: item.id,
						status: "safe",
						domain: item.domain,
						values: { min: 0, max: 1 },
						displayed: { min: 0, max: 1 },
					})),
					budget: { maxNodes: 1, visitedNodes: 0 },
				};
			}
			return {
				version: 1,
				numericSemantics: SCALAR_ANIMATION_SEMANTICS,
				results: request.items.map((item) => ({
					id: item.id,
					status: "values",
					values: item.times!.map(() => 0.5),
				})),
			};
		})());

const channel = {
	keys: [
		{ id: "a", time: 0, value: 0, segmentToNext: "linear", tangentMode: "flat" },
		{ id: "b", time: 120000, value: 1, segmentToNext: "linear", tangentMode: "flat" },
	],
} as const;

describe("scalar animation transport", () => {
	test("samples admitted channels through the batch core", () => {
		expect(
			sampleScalarAnimationBatch({
				items: [{ id: "amount", channel, fallbackValue: 0.5, times: [0, 60000] }],
				core,
			}),
		).toEqual([[0.5, 0.5]]);
	});

	test("rejects misaligned batch results instead of coercing them", () => {
		expect(() =>
			sampleScalarAnimationBatch({
				items: [{ id: "amount", channel, fallbackValue: 0.5, times: [0] }],
				core: () =>
					JSON.stringify({
						version: 1,
						numericSemantics: SCALAR_ANIMATION_SEMANTICS,
						results: [{ id: "other", status: "values", values: [1] }],
					}),
			}),
		).toThrow();
	});

	test("reports safe domains with their enclosures", () => {
		expect(
			inspectScalarAnimationDomain({
				channel,
				fallbackValue: 0.5,
				domain: { start: 0, end: 120000 },
				bounds: { min: 0, max: 1, displayMultiplier: 1 },
				maxNodes: 1,
				core,
			}),
		).toEqual({
			status: "safe",
			domain: { start: 0, end: 120000 },
			values: { min: 0, max: 1 },
			displayed: { min: 0, max: 1 },
		});
	});

	test("keeps unresolved distinct from safe and invalid", () => {
		expect(
			inspectScalarAnimationDomain({
				channel,
				fallbackValue: 0.5,
				domain: { start: 0, end: 120000 },
				bounds: { min: 0, max: 1, displayMultiplier: 1 },
				maxNodes: 1,
				core: () =>
					JSON.stringify({
						version: 1,
						numericSemantics: SCALAR_ANIMATION_SEMANTICS,
						results: [
							{
								id: "domain-inspection",
								status: "unresolved",
								domain: { start: 0, end: 120000 },
								unprovenDomain: { start: 0, end: 120000 },
								reason: { code: "budget-exhausted", message: "budget" },
							},
						],
					}),
			}).status,
		).toBe("unresolved");
	});

	test("rejects safe reports that lack their enclosure certificates", () => {
		expect(() =>
			inspectScalarAnimationDomain({
				channel,
				fallbackValue: 0.5,
					domain: { start: 0, end: 120000 },
				bounds: { min: 0, max: 1, displayMultiplier: 1 },
				maxNodes: 1,
				core: () =>
					JSON.stringify({
						version: 1,
						numericSemantics: SCALAR_ANIMATION_SEMANTICS,
						results: [
							{
								id: "domain-inspection",
								status: "safe",
								domain: { start: 0, end: 120000 },
							},
						],
					}),
			}),
		).toThrow();
	});
});
