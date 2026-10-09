import { expect, test } from "bun:test";
import type { ProgrammaticResource } from "@opencut/editor-contracts";
import type {
	FontAdvanceRequest,
	FontMeasurement,
	FontMetricRequest,
} from "../../packages/editor-classic/src/services/renderer/programmatic/font-metrics-contract";
import { FONT_METRICS_WORKER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/font-metrics-worker";

const resource = (id = "font"): ProgrammaticResource => ({
	id,
	kind: "font",
	attachmentKey: "font.ttf",
	mimeType: "font/ttf",
	byteLength: 4,
	sha256: "a".repeat(64),
	font: { family: id, style: "italic", weight: 400, axes: { TEST: 550 } },
});
const advance = (
	text: string,
	fontSizePx = 22,
	letterSpacingPx = 0,
): FontAdvanceRequest => ({ text, fontSizePx, letterSpacingPx });
const request = (id = "font"): FontMetricRequest => ({
	resource: resource(id),
	glyphs: ["A"],
	advances: [advance(""), advance("AV"), advance("😀a\u0301", 18, 1.25)],
});

function harness(
	options: { width?: number; throws?: boolean; tracking?: boolean } = {},
) {
	const calls: { text: string; state: Record<string, unknown> }[] = [];
	const sizes: number[] = [],
		faces: unknown[] = [];
	const ctx: Record<string, unknown> = {
		...(options.tracking === false ? {} : { letterSpacing: "0px" }),
		measureText(text: string) {
			calls.push({ text, state: { ...ctx } });
			if (options.throws) throw Error("fixture measurement failed");
			const widths: Record<string, number> = { "": 0, A: 11, V: 13, AV: 19 };
			return {
				width: options.width ?? widths[text] ?? 7,
				actualBoundingBoxLeft: -2,
				actualBoundingBoxRight: 5,
				actualBoundingBoxAscent: 7,
				actualBoundingBoxDescent: -1,
			};
		},
	};
	class Canvas {
		set width(n: number) {
			sizes.push(n);
		}
		set height(n: number) {
			sizes.push(n);
		}
		getContext() {
			return ctx;
		}
	}
	class Face {
		constructor(
			readonly family: string,
			readonly bytes: ArrayBuffer,
			readonly descriptors: unknown,
		) {}
		async load() {
			return this;
		}
	}
	const api = new Function(
		"OffscreenCanvas",
		"FontFace",
		"self",
		`${FONT_METRICS_WORKER_SOURCE}
		return {measure: measureProgrammaticFonts, load: loadProgrammaticFont};`,
	)(Canvas, Face, {
		fonts: {
			add(face: unknown) {
				faces.push(face);
			},
		},
	}) as {
		measure(
			r: readonly FontMetricRequest[],
			d: Map<string, ProgrammaticResource>,
		): FontMeasurement[];
		load(r: ProgrammaticResource, bytes: ArrayBuffer): Promise<void>;
	};
	return { calls, sizes, faces, ...api };
}
const descriptors = (...ids: string[]) =>
	new Map(ids.map((id) => [id, resource(id)]));

test("whole-string calls preserve complete prefixes, explicit styles and legacy glyph resets", () => {
	const h = harness(),
		first = request(),
		second = { resource: resource("second"), glyphs: ["A"] };
	const result = h.measure([first, second], descriptors("font", "second"));
	expect(h.calls.map((c) => c.text)).toEqual(["A", "", "AV", "😀a\u0301", "A"]);
	expect(result[0]!.advances?.map((a) => a.width)).toEqual([0, 19, 7]);
	expect(result[0]!.advances?.[1]!.width).not.toBe(11 + 13);
	expect(result[0]!.advances?.[2]).toEqual({ ...first.advances![2], width: 7 });
	for (const index of [0, 4]) {
		expect(h.calls[index]!.state.textAlign).toBe("center");
		expect(h.calls[index]!.state.textBaseline).toBe("middle");
		expect(h.calls[index]!.state.letterSpacing).toBe("0px");
		expect(h.calls[index]!.state.font).toContain(" 100px ");
	}
	expect(h.calls[3]!.state).toMatchObject({
		font: 'italic 400 18px "font"',
		textAlign: "left",
		textBaseline: "alphabetic",
		letterSpacing: "1.25px",
		direction: "ltr",
		fontKerning: "auto",
		wordSpacing: "0px",
	});
	expect(Object.keys(result[1]!)).toEqual(["resource", "glyphs"]);
	expect(result[1]!.glyphs[0]).toEqual({
		text: "A",
		left: -2,
		right: 5,
		ascent: 7,
		descent: -1,
	});
	expect(h.sizes).toEqual([1, 1]);
});

test("advance-only, empty and reordered axis identity retain exact requested facts", () => {
	const h = harness(),
		r = { ...request(), glyphs: [] };
	expect(h.measure([r], descriptors("font"))[0]!.advances).toHaveLength(3);
	expect(h.measure([], descriptors())).toEqual([]);
	const axes = { AAA1: 1, BBB2: 2 };
	const font = { ...resource(), font: { ...resource().font!, axes } };
	const reversed = {
		...font,
		font: { ...font.font, axes: { BBB2: 2, AAA1: 1 } },
	};
	expect(
		h.measure(
			[{ resource: font, glyphs: [], advances: [advance("")] }],
			new Map([["font", reversed]]),
		),
	).toHaveLength(1);
	const bounded = {
		...request(),
		glyphs: [],
		advances: [advance("A", 4096, 4096), advance("A", 4096, -4096)],
	};
	expect(
		harness({ width: 16777216 }).measure([bounded], descriptors("font"))[0]!
			.advances?.[0]!.width,
	).toBe(16777216);
	expect(
		harness({ width: -16777216 }).measure([bounded], descriptors("font"))[0]!
			.advances?.[0]!.width,
	).toBe(-16777216);
});

test("font loading retains owned bytes and complete static axes", async () => {
	const h = harness(),
		bytes = new ArrayBuffer(4);
	await h.load(resource(), bytes);
	expect(h.faces[0]).toMatchObject({
		family: "font",
		bytes,
		descriptors: {
			style: "italic",
			weight: "400",
			variationSettings: '"TEST" 550',
		},
	});
	await expect(h.load(resource(), new ArrayBuffer(3))).rejects.toThrow(
		"length mismatch",
	);
});

test("rejects every mismatched font identity before measurement", () => {
	const changes: [string, unknown][] = [
		["id", "other"],
		["kind", "image"],
		["attachmentKey", "other.ttf"],
		["mimeType", "font/otf"],
		["byteLength", 5],
		["sha256", "b".repeat(64)],
	];
	for (const [key, value] of changes) {
		const h = harness(),
			r = request();
		Object.assign(r.resource, { [key]: value });
		expect(() => h.measure([r], descriptors("font"))).toThrow(
			"declared loaded font",
		);
		expect(h.calls).toHaveLength(0);
	}
	for (const [key, value] of [
		["family", "Other"],
		["style", "normal"],
		["weight", 500],
		["axes", { TEST: 551 }],
		["axes", null],
	]) {
		const r = request();
		Object.assign(r.resource.font!, { [String(key)]: value });
		expect(() => harness().measure([r], descriptors("font"))).toThrow(
			"declared loaded font",
		);
	}
});

test("rejects null, unknown fields, duplicate keys and malformed Unicode", () => {
	const cases: unknown[] = [
		{ ...request(), advances: null },
		{ ...request(), glyphs: null },
		{ ...request(), glyphs: [], advances: [] },
		{ ...request(), surprise: true },
		{ ...request(), advances: [null] },
		{ ...request(), advances: [{ fontSizePx: 22, letterSpacingPx: 0 }] },
		{ ...request(), advances: [{ text: "AV", letterSpacingPx: 0 }] },
		{ ...request(), advances: [{ text: "AV", fontSizePx: 22 }] },
		{
			...request(),
			advances: [{ text: null, fontSizePx: 22, letterSpacingPx: 0 }],
		},
		{ ...request(), advances: [{ ...advance("AV"), width: 1 }] },
		{ ...request(), advances: [advance("\ud800")] },
		{ ...request(), advances: [advance("\udfff")] },
		{ ...request(), glyphs: ["\ud800"] },
		{ ...request(), glyphs: ["A", "A"] },
		{ ...request(), advances: [advance("AV", 22, 0), advance("AV", 22, -0)] },
	];
	for (const r of cases)
		expect(() =>
			harness().measure([r as FontMetricRequest], descriptors("font")),
		).toThrow();
	expect(() =>
		harness().measure([request(), request()], descriptors("font")),
	).toThrow("Duplicate");
	for (const value of [null, NaN, Infinity, -Infinity, 0, -1, 4096.01]) {
		const r = {
			...request(),
			advances: [{ ...advance("AV"), fontSizePx: value }],
		};
		expect(() =>
			harness().measure([r as FontMetricRequest], descriptors("font")),
		).toThrow();
	}
	for (const value of [null, NaN, Infinity, -Infinity, -4096.01, 4096.01]) {
		const r = {
			...request(),
			advances: [{ ...advance("AV"), letterSpacingPx: value }],
		};
		expect(() =>
			harness().measure([r as FontMetricRequest], descriptors("font")),
		).toThrow();
	}
});

test("rejects nonfinite/out-of-bound results and strictly requires zero for an empty prefix", () => {
	for (const width of [
		NaN,
		Infinity,
		-Infinity,
		16777216.01,
		-16777216.01,
		1,
		-1,
		Number.EPSILON,
	]) {
		const h = harness({ width });
		expect(() => h.measure([request()], descriptors("font"))).toThrow(
			"Invalid measured",
		);
		expect(h.sizes).toEqual([1, 1]);
	}
	const h = harness({ throws: true });
	expect(() => h.measure([request()], descriptors("font"))).toThrow(
		"fixture measurement failed",
	);
	expect(h.sizes).toEqual([1, 1]);
	expect(() =>
		harness({ tracking: false }).measure([request()], descriptors("font")),
	).toThrow("support declared font tracking");
});

test("budgets aggregate fonts/items/text and count astral scalars, not UTF-16 units", () => {
	const h = harness(),
		r = {
			...request(),
			glyphs: [],
			advances: Array.from({ length: 1024 }, (_, i) => advance("AV", i + 1)),
		};
	expect(h.measure([r], descriptors("font"))[0]!.advances).toHaveLength(1024);
	expect(() =>
		h.measure(
			[r, { ...request("other"), glyphs: [], advances: [advance("")] }],
			descriptors("font", "other"),
		),
	).toThrow("global item budget");
	const long = {
		...request(),
		glyphs: [],
		advances: Array.from({ length: 64 }, (_, i) =>
			advance("😀".repeat(1024), 22, i),
		),
	};
	expect(h.measure([long], descriptors("font"))[0]!.advances).toHaveLength(64);
	expect(() =>
		h.measure(
			[long, { ...request("other"), glyphs: [], advances: [advance("A")] }],
			descriptors("font", "other"),
		),
	).toThrow("global text budget");
	expect(() =>
		h.measure(
			[{ ...request(), advances: [advance("😀".repeat(1025))] }],
			descriptors("font"),
		),
	).toThrow("text budget");
	const glyphs = Array.from({ length: 1024 }, (_, i) =>
		String.fromCodePoint(0x4e00 + i),
	);
	expect(
		h.measure(
			[{ ...request(), glyphs, advances: r.advances }],
			descriptors("font"),
		),
	).toHaveLength(1);
	expect(() =>
		h.measure(
			[
				{ resource: resource(), glyphs },
				{ resource: resource("other"), glyphs: ["A"] },
			],
			descriptors("font", "other"),
		),
	).toThrow("global item budget");
	const ids = Array.from({ length: 64 }, (_, i) => `font${i}`),
		fonts = ids.map((id) => ({
			resource: resource(id),
			glyphs: [],
			advances: [advance("")],
		}));
	expect(h.measure(fonts, descriptors(...ids))).toHaveLength(64);
	expect(() =>
		h.measure([...fonts, request()], descriptors(...ids, "font")),
	).toThrow("font budget");
});
