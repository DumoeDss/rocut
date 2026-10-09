import { expect, test } from "bun:test";
import {
	boundsDescriptors,
	boundsHarness,
	boundsMetrics,
	boundsRequest,
} from "./programmatic-font-bounds-harness";

test("bounds budgets aggregate items and scalar text across fonts independently of legacy facts", () => {
	const h = boundsHarness();
	const items = Array.from({ length: 1024 }, (_, i) =>
		boundsRequest({ fontSizePx: i + 1 }),
	);
	expect(
		h.measure([boundsMetrics(items)], boundsDescriptors("bounds"))[0]!.bounds,
	).toHaveLength(1024);
	expect(() =>
		h.measure(
			[boundsMetrics(items), boundsMetrics(undefined, "next")],
			boundsDescriptors("bounds", "next"),
		),
	).toThrow("global item budget");
	const text = "😀".repeat(1024);
	const scalars = Array.from({ length: 64 }, (_, i) =>
		boundsRequest({ text, fontSizePx: i + 1 }),
	);
	expect(
		h.measure([boundsMetrics(scalars)], boundsDescriptors("bounds"))[0]!.bounds,
	).toHaveLength(64);
	expect(() =>
		h.measure(
			[boundsMetrics(scalars), boundsMetrics(undefined, "next")],
			boundsDescriptors("bounds", "next"),
		),
	).toThrow("global text budget");
	expect(() =>
		h.measure(
			[boundsMetrics([boundsRequest({ text: "😀".repeat(1025) })])],
			boundsDescriptors("bounds"),
		),
	).toThrow("text budget");
	const request = {
		...boundsMetrics(scalars),
		advances: scalars.map(({ text, fontSizePx, letterSpacingPx }) => ({
			text,
			fontSizePx,
			letterSpacingPx,
		})),
	};
	expect(
		h.measure([request], boundsDescriptors("bounds"))[0]!.advances,
	).toHaveLength(64);
	for (const letterSpacingPx of [-4096, 4096])
		expect(
			h.measure(
				[boundsMetrics([boundsRequest({ fontSizePx: 4096, letterSpacingPx })])],
				boundsDescriptors("bounds"),
			)[0]!.bounds,
		).toHaveLength(1);
});

test("bounds-only and explicit empty optional sets preserve existing transport semantics", () => {
	const h = boundsHarness();
	expect(h.measure([], boundsDescriptors())).toEqual([]);
	expect(
		h.measure(
			[{ ...boundsMetrics(), advances: [] }],
			boundsDescriptors("bounds"),
		)[0]!.bounds,
	).toHaveLength(1);
	const legacy = { ...boundsMetrics([]), glyphs: ["A"] };
	expect(
		Object.keys(h.measure([legacy], boundsDescriptors("bounds"))[0]!),
	).toEqual(["resource", "glyphs"]);
	expect(() =>
		h.measure([boundsMetrics([])], boundsDescriptors("bounds")),
	).toThrow("metric sets");
	expect(() =>
		h.measure([boundsMetrics(), boundsMetrics()], boundsDescriptors("bounds")),
	).toThrow("Duplicate requested font");
	const ids = Array.from({ length: 64 }, (_, i) => `bounds${i}`);
	const requests = ids.map((id) => boundsMetrics(undefined, id));
	expect(h.measure(requests, boundsDescriptors(...ids))).toHaveLength(64);
	expect(() =>
		h.measure(
			[...requests, boundsMetrics()],
			boundsDescriptors(...ids, "bounds"),
		),
	).toThrow("font budget");
});
