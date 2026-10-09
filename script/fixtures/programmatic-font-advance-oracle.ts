import type { ProgrammaticResource } from "@opencut/editor-contracts";
import type {
	FontMeasurement,
	FontMetricRequest,
} from "../../packages/editor-classic/src/services/renderer/programmatic/font-metrics-contract";

export function assertFontAdvanceOracle(
	value: unknown,
	message: string,
): asserts value {
	if (!value) throw Error(message);
}

/** Measures the real font independently in a main-thread Canvas. Never imports
 * worker algorithms or derives the oracle from returned metric values.
 */
export async function inspectFontAdvanceOracle({
	bytes,
	resources,
	requests,
	actual,
	candidates,
}: {
	bytes: ArrayBuffer;
	resources: readonly ProgrammaticResource[];
	requests: readonly FontMetricRequest[];
	actual: readonly FontMeasurement[];
	candidates: readonly string[];
}) {
	const check: typeof assertFontAdvanceOracle = assertFontAdvanceOracle;
	const faces: FontFace[] = [];
	try {
		for (const resource of resources) {
			const face = new FontFace(resource.font!.family, bytes, {
				style: "normal",
				weight: "400",
				variationSettings: `"TEST" ${resource.font!.axes!.TEST}`,
			});
			await face.load();
			document.fonts.add(face);
			faces.push(face);
			check(
				face.status === "loaded" && document.fonts.has(face),
				"Oracle failed to load actual font bytes",
			);
		}
		const canvas = document.createElement("canvas"),
			ctx = canvas.getContext("2d")!;
		const configure = (family: string, size: number, spacing: number) => {
			ctx.font = `normal 400 ${size}px "${family}"`;
			ctx.textAlign = "left";
			ctx.textBaseline = "alphabetic";
			ctx.letterSpacing = `${spacing}px`;
			ctx.direction = "ltr";
			ctx.fontKerning = "auto";
			ctx.wordSpacing = "0px";
			ctx.fontStretch = "normal";
			ctx.fontVariantCaps = "normal";
			ctx.textRendering = "auto";
		};
		const expected = requests[0]!.advances!.map((a) => {
			configure("AdvanceFixture", a.fontSizePx, a.letterSpacingPx);
			return { ...a, width: ctx.measureText(a.text).width };
		});
		check(
			JSON.stringify(actual[0]!.advances) === JSON.stringify(expected),
			"Whole/prefix advances differ from independently loaded real Canvas font",
		);
		check(
			actual[0]!.advances![0]!.width === 0,
			"Empty prefix width must be exactly zero",
		);
		check(
			JSON.stringify(actual.map((a) => a.resource)) ===
				JSON.stringify(resources),
			"Measurement lost full resource identity",
		);
		const shaped = candidates.flatMap((text) => {
			configure("AdvanceFixture", 72, 0);
			const width = ctx.measureText(text).width;
			const sum = [...text].reduce(
				(n, char) => n + ctx.measureText(char).width,
				0,
			);
			return Math.abs(width - sum) > 0.01 ? [{ text, width, sum }] : [];
		});
		check(
			shaped.length > 0,
			"Real font oracle cannot distinguish forbidden per-character summation",
		);
		for (const sample of shaped)
			check(
				actual[0]!.advances!.find(
					(a) => a.text === sample.text && a.fontSizePx === 72,
				)!.width !== sample.sum,
				"Advance incorrectly summed character widths",
			);
		for (const [index, resource] of resources.entries()) {
			configure(resource.font!.family, 100, 0);
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			const expectedGlyphs = requests[index]!.glyphs.map((text) => {
				const m = ctx.measureText(text);
				return {
					text,
					left: m.actualBoundingBoxLeft,
					right: m.actualBoundingBoxRight,
					ascent: m.actualBoundingBoxAscent,
					descent: m.actualBoundingBoxDescent,
				};
			});
			check(
				JSON.stringify(actual[index]!.glyphs) ===
					JSON.stringify(expectedGlyphs),
				"Advance state leaked into legacy glyph measurements",
			);
		}
		check(
			!Object.hasOwn(actual[1]!, "advances"),
			"Legacy glyph-only response changed shape",
		);
		return { widths: actual[0]!.advances!.map((a) => a.width), shaped };
	} finally {
		for (const face of faces) document.fonts.delete(face);
	}
}
