import type { ProgrammaticResource } from "@opencut/editor-contracts";
import type {
	FontBoundsMeasurement,
	FontBoundsRequest,
	FontMeasurement,
	FontMetricRequest,
} from "../../packages/editor-classic/src/services/renderer/programmatic/font-metrics-contract";
import { assertFontAdvanceOracle as check } from "./programmatic-font-advance-oracle";

function ink(
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
	text: string,
) {
	const m = ctx.measureText(text);
	return {
		left: m.actualBoundingBoxLeft,
		right: m.actualBoundingBoxRight,
		ascent: m.actualBoundingBoxAscent,
		descent: m.actualBoundingBoxDescent,
	};
}

/** Independent native oracle: no worker source or Rust layout helpers. */
export async function inspectFontBoundsOracle({
	bytes,
	resources,
	requests,
	actual,
}: {
	bytes: ArrayBuffer;
	resources: readonly ProgrammaticResource[];
	requests: readonly FontMetricRequest[];
	actual: readonly FontMeasurement[];
}) {
	const faces: FontFace[] = [];
	try {
		for (const resource of resources) {
			const face = new FontFace(resource.font!.family, bytes, {
				style: "normal",
				weight: "900",
				variationSettings: `"TEST" ${resource.font!.axes!.TEST}`,
			});
			await face.load();
			document.fonts.add(face);
			faces.push(face);
			check(
				face.status === "loaded" && document.fonts.has(face),
				"Bounds oracle failed to load actual bytes",
			);
		}
		const html = document.createElement("canvas").getContext("2d")!;
		const offscreen = new OffscreenCanvas(1, 1).getContext("2d")!;
		const native = (
			ctx: typeof html | typeof offscreen,
			family: string,
			b: FontBoundsRequest,
		): FontBoundsMeasurement => {
			ctx.font = `normal 900 ${b.fontSizePx}px "${family}"`;
			ctx.textAlign = b.align;
			ctx.textBaseline = b.baseline;
			ctx.letterSpacing = `${b.letterSpacingPx}px`;
			ctx.direction = "ltr";
			ctx.fontKerning = "auto";
			ctx.wordSpacing = "0px";
			ctx.fontStretch = "normal";
			ctx.fontVariantCaps = "normal";
			ctx.textRendering = "auto";
			return { ...b, ...ink(ctx, b.text) };
		};
		const expected = requests[0]!.bounds!.map((b) =>
			native(html, resources[0]!.font!.family, b),
		);
		const workerExpected = requests[0]!.bounds!.map((b) =>
			native(offscreen, resources[0]!.font!.family, b),
		);
		check(
			JSON.stringify(actual[0]!.bounds) === JSON.stringify(expected),
			"Bounds differ from independently loaded HTMLCanvas font",
		);
		check(
			JSON.stringify(actual[0]!.bounds) === JSON.stringify(workerExpected),
			"Bounds differ from independently loaded OffscreenCanvas font",
		);
		check(
			JSON.stringify(actual.map((m) => m.resource)) ===
				JSON.stringify(resources),
			"Bounds lost complete font/axis identity",
		);
		for (const [index, resource] of resources.entries()) {
			const expectedGlyphs = requests[index]!.glyphs.map((text) => {
				const b = native(html, resource.font!.family, {
					version: 1,
					text,
					fontSizePx: 100,
					letterSpacingPx: 0,
					align: "center",
					baseline: "middle",
				});
				return {
					text,
					left: b.left,
					right: b.right,
					ascent: b.ascent,
					descent: b.descent,
				};
			});
			check(
				JSON.stringify(actual[index]!.glyphs) ===
					JSON.stringify(expectedGlyphs),
				"Bounds state leaked into legacy glyph measurements",
			);
		}
		check(
			!Object.hasOwn(actual[1]!, "bounds"),
			"Legacy glyph-only response gained bounds",
		);
		const title = expected.find(
			(b) =>
				b.text === "残" &&
				b.fontSizePx === 1000 &&
				b.align === "left" &&
				b.baseline === "alphabetic",
		)!;
		const legacy = actual[0]!.glyphs.find((g) => g.text === "残")!;
		const scaledLegacy = {
			left: legacy.left * 10,
			right: legacy.right * 10,
			ascent: legacy.ascent * 10,
			descent: legacy.descent * 10,
		};
		const fields = ["left", "right", "ascent", "descent"] as const;
		check(
			fields.some((key) => title[key] !== scaledLegacy[key]),
			"Native oracle did not expose forbidden legacy 100px scaling",
		);
		const different = (a: FontBoundsMeasurement, b: FontBoundsMeasurement) =>
			fields.some((key) => a[key] !== b[key]);
		const base = expected.find(
			(b) =>
				b.text === "AV残" &&
				b.align === "left" &&
				b.baseline === "alphabetic" &&
				b.letterSpacingPx === 0,
		)!;
		const aligned = expected.find(
			(b) =>
				b.text === "AV残" &&
				b.align === "right" &&
				b.baseline === "alphabetic" &&
				b.letterSpacingPx === 0,
		)!;
		const baseline = expected.find(
			(b) =>
				b.text === "AV残" &&
				b.align === "left" &&
				b.baseline === "middle" &&
				b.letterSpacingPx === 0,
		)!;
		const tracked = expected.find(
			(b) => b.text === "AV残" && b.letterSpacingPx === 12.3,
		)!;
		check(
			different(base, aligned),
			"Native oracle cannot detect ignored alignment",
		);
		check(
			different(base, baseline),
			"Native oracle cannot detect ignored baseline",
		);
		check(
			different(base, tracked),
			"Native oracle cannot detect ignored tracking",
		);
		return {
			bounds: actual[0]!.bounds!,
			scaledLegacy,
			exactTitle: title,
			negativeControls: [
				"legacy-100px-times-ten",
				"ignored-alignment",
				"ignored-baseline",
				"ignored-tracking",
			],
		};
	} finally {
		for (const face of faces) document.fonts.delete(face);
	}
}
