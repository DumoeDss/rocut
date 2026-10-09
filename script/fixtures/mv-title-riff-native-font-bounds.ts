import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { FontBoundsRequest } from "../../packages/editor-classic/src/services/renderer/programmatic/font-metrics-contract";
import { runProgrammaticSandbox } from "../../packages/editor-classic/src/services/renderer/programmatic/sandbox-runtime";
import { check } from "./mv-afterimage-capture";

/** Independent native HTML/Offscreen measureText oracle with the actual four
 * film-style fonts. Empty strings may have signed origin offsets, not ink.
 */
export async function verifyTitleRiffEmptyBounds(
	allResources: readonly ResolvedProgrammaticResource[],
) {
	const resources = allResources.filter(
		({ resource }) => resource.kind === "font",
	);
	const bounds: FontBoundsRequest[] = [];
	for (const text of ["", " "])
		for (const fontSizePx of [16, 18, 20])
			for (const align of ["left", "center", "right"] as const)
				for (const baseline of [
					"top",
					"hanging",
					"middle",
					"alphabetic",
					"ideographic",
					"bottom",
				] as const)
					bounds.push({
						version: 1,
						text,
						fontSizePx,
						letterSpacingPx: 0,
						align,
						baseline,
					});
	const requests = resources.map(({ resource }) => ({
		resource,
		glyphs: [],
		bounds,
	}));
	const source: ProgrammaticSource = {
		version: 1,
		runtime: "canvas-worker",
		code: "throw Error('Measurement executed author JS')",
		width: 32,
		height: 32,
		frameRate: { numerator: 60, denominator: 1 },
		durationFrames: 1,
		seed: 1,
		resources: resources.map(({ resource }) => resource),
	};
	const actual = await runProgrammaticSandbox({
		source,
		resources,
		operation: "measure-fonts",
		frame: {
			index: 0,
			time: 0,
			timelineTime: 0,
			sourceTime: 0,
			frameRate: source.frameRate,
			durationFrames: 1,
			seed: 1,
			fontMetricRequests: requests,
		},
	});
	const faces: FontFace[] = [],
		shifted: unknown[] = [];
	const html = document.createElement("canvas"),
		offscreen = new OffscreenCanvas(1, 1);
	html.width = html.height = 1;
	let comparisons = 0;
	try {
		for (const [index, { resource, body }] of resources.entries()) {
			const f = resource.font!;
			const face = new FontFace(f.family, body, {
				style: f.style,
				weight: String(f.weight),
			});
			await face.load();
			document.fonts.add(face);
			faces.push(face);
			check(
				actual[index]?.resource.id === resource.id,
				"Empty bound font identity mismatch",
			);
			for (const canvas of [html, offscreen]) {
				const ctx = canvas.getContext("2d")!;
				for (const [sample, b] of bounds.entries()) {
					ctx.font = `${f.style} ${f.weight} ${b.fontSizePx}px ${JSON.stringify(f.family)}`;
					ctx.textAlign = b.align;
					ctx.textBaseline = b.baseline;
					ctx.letterSpacing = "0px";
					ctx.direction = "ltr";
					ctx.fontKerning = "auto";
					ctx.wordSpacing = "0px";
					ctx.fontStretch = "normal";
					ctx.fontVariantCaps = "normal";
					ctx.textRendering = "auto";
					const m = ctx.measureText(b.text),
						value = actual[index]!.bounds![sample]!;
					const expected = [
						m.actualBoundingBoxLeft,
						m.actualBoundingBoxRight,
						m.actualBoundingBoxAscent,
						m.actualBoundingBoxDescent,
					];
					check(
						[value.left, value.right, value.ascent, value.descent].every(
							(v, i) => v === expected[i],
						),
						`Empty bounds diverged from native ${resource.id}/${b.baseline}/${b.fontSizePx}/${b.align}`,
					);
					if (b.text === "") {
						check(
							value.left + value.right === 0 &&
								value.ascent + value.descent === 0,
							"Empty text must have exactly zero ink dimensions",
						);
						if (
							expected.some((v) => v !== 0) &&
							canvas === html &&
							b.align === "left" &&
							b.baseline === "alphabetic"
						)
							shifted.push({ font: resource.id, size: b.fontSizePx, expected });
					}
					comparisons++;
				}
			}
		}
		check(
			shifted.length > 0,
			"Actual font fixtures did not expose signed empty bounds regression",
		);
		return {
			comparisons,
			fontCount: resources.length,
			requestsPerFont: bounds.length,
			allExact: true,
			shifted,
		};
	} finally {
		for (const face of faces) document.fonts.delete(face);
		html.width = html.height = offscreen.width = offscreen.height = 1;
	}
}
