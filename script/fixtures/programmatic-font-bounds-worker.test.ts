import { expect, test } from "bun:test";
import type { FontMetricRequest } from "../../packages/editor-classic/src/services/renderer/programmatic/font-metrics-contract";
import {
	boundsDescriptors,
	boundsHarness,
	boundsMetrics,
	boundsRequest,
	boundsResource,
} from "./programmatic-font-bounds-harness";

test("exact bounds measure native size/alignment/baseline and echo every key without scaling", () => {
	const h = boundsHarness();
	const requests = [
		boundsRequest(),
		boundsRequest({
			align: "center",
			baseline: "middle",
			fontSizePx: 34,
			letterSpacingPx: 1.3,
		}),
		boundsRequest({
			align: "right",
			baseline: "bottom",
			fontSizePx: 18,
			letterSpacingPx: -0.5,
		}),
		boundsRequest({ text: "", letterSpacingPx: -0 }),
	];
	const first = {
		...boundsMetrics(requests),
		glyphs: ["A"],
		advances: [{ text: "AV", fontSizePx: 22, letterSpacingPx: 4 }],
	};
	const second = { resource: boundsResource("legacy"), glyphs: ["f"] };
	const actual = h.measure(
		[first, second],
		boundsDescriptors("bounds", "legacy"),
	);
	expect(h.calls.map((c) => c.text)).toEqual([
		"A",
		"AV",
		"残",
		"残",
		"残",
		"",
		"f",
	]);
	for (const [index, request] of requests.entries()) {
		expect(h.calls[index + 2]!.state).toMatchObject({
			font: `normal 900 ${request.fontSizePx}px "bounds"`,
			textAlign: request.align,
			textBaseline: request.baseline,
			letterSpacing: `${request.letterSpacingPx}px`,
			direction: "ltr",
			fontKerning: "auto",
			wordSpacing: "0px",
			fontStretch: "normal",
			fontVariantCaps: "normal",
			textRendering: "auto",
		});
		expect(actual[0]!.bounds![index]).toEqual({
			...request,
			letterSpacingPx:
				request.letterSpacingPx === 0 ? 0 : request.letterSpacingPx,
			...(request.text === ""
				? { left: 0, right: 0, ascent: 0, descent: 0 }
				: { left: -3, right: 17, ascent: 19, descent: -2 }),
		});
	}
	expect(h.calls[6]!.state).toMatchObject({
		font: 'normal 900 100px "legacy"',
		textAlign: "center",
		textBaseline: "middle",
		letterSpacing: "0px",
	});
	expect(Object.keys(actual[1]!)).toEqual(["resource", "glyphs"]);
	expect(actual[0]!.resource).toEqual(first.resource);
	expect(h.sizes).toEqual([1, 1]);
});

test("all physical alignments and explicit Canvas baselines are independent keys", () => {
	const bounds = (["left", "center", "right"] as const).flatMap((align) =>
		(
			[
				"top",
				"hanging",
				"middle",
				"alphabetic",
				"ideographic",
				"bottom",
			] as const
		).map((baseline) => boundsRequest({ align, baseline })),
	);
	const actual = boundsHarness().measure(
		[boundsMetrics(bounds)],
		boundsDescriptors("bounds"),
	);
	expect(actual[0]!.bounds).toHaveLength(18);
	const separate = [
		boundsRequest(),
		boundsRequest({ text: "残光" }),
		boundsRequest({ fontSizePx: 999 }),
		boundsRequest({ letterSpacingPx: 1 }),
	];
	expect(
		boundsHarness().measure(
			[boundsMetrics(separate)],
			boundsDescriptors("bounds"),
		)[0]!.bounds,
	).toHaveLength(4);
});

test("bounds reject missing/extra keys, malformed scalars and ambiguous context before measurement", () => {
	const b = boundsRequest();
	const invalid: unknown[] = [
		null,
		[],
		{ ...b, width: 1 },
		{ ...b, version: 2 },
		{ ...b, version: "1" },
		...["start", "end", "LEFT", ""].map((align) => ({ ...b, align })),
		{ ...b, baseline: "auto" },
		{ ...b, text: "\ud800" },
		{ ...b, text: "\udfff" },
		{ ...b, text: null },
	];
	for (const key of Object.keys(b)) {
		const missing: Record<string, unknown> = { ...b };
		delete missing[key];
		invalid.push(missing);
	}
	for (const value of invalid) {
		const h = boundsHarness();
		expect(() =>
			h.measure(
				[{ ...boundsMetrics(), bounds: [value] } as FontMetricRequest],
				boundsDescriptors("bounds"),
			),
		).toThrow();
		expect(h.calls).toHaveLength(0);
	}
	for (const value of [null, 0, -1, 4096.01, NaN, Infinity, -Infinity])
		expect(() =>
			boundsHarness().measure(
				[boundsMetrics([{ ...b, fontSizePx: value } as typeof b])],
				boundsDescriptors("bounds"),
			),
		).toThrow();
	for (const value of [null, 4096.01, -4096.01, NaN, Infinity, -Infinity])
		expect(() =>
			boundsHarness().measure(
				[boundsMetrics([{ ...b, letterSpacingPx: value } as typeof b])],
				boundsDescriptors("bounds"),
			),
		).toThrow();
	for (const bounds of [null, {}, [b, { ...b, letterSpacingPx: -0 }]])
		expect(() =>
			boundsHarness().measure(
				[{ ...boundsMetrics(), bounds } as FontMetricRequest],
				boundsDescriptors("bounds"),
			),
		).toThrow();
});

test("bounds remain bound to complete resource and variable-axis identity", () => {
	for (const [key, value] of Object.entries({
		id: "other",
		kind: "image",
		attachmentKey: "other.ttf",
		mimeType: "font/otf",
		byteLength: 5,
		sha256: "b".repeat(64),
	})) {
		const r = boundsMetrics();
		Object.assign(r.resource, { [key]: value });
		const h = boundsHarness();
		expect(() => h.measure([r], boundsDescriptors("bounds"))).toThrow(
			"declared loaded font",
		);
		expect(h.calls).toHaveLength(0);
	}
	for (const change of [
		{ family: "other" },
		{ style: "italic" },
		{ weight: 400 },
		{ axes: { TEST: 701 } },
	]) {
		const r = boundsMetrics();
		Object.assign(r.resource.font!, change);
		expect(() =>
			boundsHarness().measure([r], boundsDescriptors("bounds")),
		).toThrow("declared loaded font");
	}
});

test("invalid native extents fail closed; signed bounds are valid but negative area is not", () => {
	for (const value of [
		NaN,
		Infinity,
		-Infinity,
		16777216.01,
		-16777216.01,
		undefined,
	])
		for (let i = 0; i < 4; i++) {
			const extents = [2, 3, 4, 5];
			extents[i] = value as number;
			const h = boundsHarness({ extents });
			expect(() =>
				h.measure([boundsMetrics()], boundsDescriptors("bounds")),
			).toThrow("Invalid measured font bounds");
			expect(h.sizes).toEqual([1, 1]);
		}
	for (const extents of [
		[-4, 3, 4, 5],
		[2, 3, 4, -5],
	])
		expect(() =>
			boundsHarness({ extents }).measure(
				[boundsMetrics()],
				boundsDescriptors("bounds"),
			),
		).toThrow("Invalid measured font bounds");
	for (const extents of [
		[-16777216, 16777216, -16777216, 16777216],
		[16777216, 16777216, 16777216, 16777216],
	])
		expect(
			boundsHarness({ extents }).measure(
				[boundsMetrics()],
				boundsDescriptors("bounds"),
			)[0]!.bounds,
		).toHaveLength(1);
	for (let i = 0; i < 4; i++) {
		const extents = [0, 0, 0, 0];
		extents[i] = Number.EPSILON;
		expect(() =>
			boundsHarness({ extents }).measure(
				[boundsMetrics([boundsRequest({ text: "" })])],
				boundsDescriptors("bounds"),
			),
		).toThrow("Invalid measured font bounds");
	}
});

test("empty strings retain native signed baseline offsets with exactly zero ink area", () => {
	// Real Chromium 151 DotGothic16 at 20px/alphabetic, captured by the titleRiff gate.
	const extents = [0, 0, 0.55999755859375, -0.55999755859375];
	const request = boundsRequest({ text: "", fontSizePx: 20 });
	const measured = boundsHarness({ extents }).measure(
		[boundsMetrics([request])],
		boundsDescriptors("bounds"),
	)[0]!.bounds![0]!;
	expect(measured).toEqual({
		...request,
		left: 0,
		right: 0,
		ascent: extents[2],
		descent: extents[3],
	});
	expect(measured.ascent + measured.descent).toBe(0);
});

test("unsupported tracking/context and native failures release the measurement surface", () => {
	for (const [options, bounds, message] of [
		[{ tracking: false }, boundsRequest({ letterSpacingPx: 1 }), "tracking"],
		[{ ignoreAlign: true }, boundsRequest(), "bounds context"],
		[{ throws: true }, boundsRequest(), "bounds fixture failure"],
	] as const) {
		const h = boundsHarness(options);
		expect(() =>
			h.measure([boundsMetrics([bounds])], boundsDescriptors("bounds")),
		).toThrow(message);
		expect(h.sizes).toEqual([1, 1]);
	}
	expect(() =>
		boundsHarness({ context: false }).measure(
			[boundsMetrics()],
			boundsDescriptors("bounds"),
		),
	).toThrow("Canvas2D");
	expect(
		boundsHarness({ tracking: false }).measure(
			[boundsMetrics()],
			boundsDescriptors("bounds"),
		),
	).toHaveLength(1);
});
