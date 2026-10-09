import type { ProgrammaticResource } from "@opencut/editor-contracts";
import type { MvTypeCard } from "../../../../packages/editor-contracts/src/mv-type-card";
import { typeCardSource } from "../../../../script/fixtures/mv-type-card-source";
import { typeCardSettings } from "./type-card-persistence-fixture";
import { invalidTypeCardFlickerCases } from "./type-card-persistence-invalid-flicker";

export interface InvalidTypeCardCase {
	name: string;
	source: unknown;
	overflowLiteral?: "1e400" | "-1e400";
}
export const TYPE_CARD_OVERFLOW_MARKER = "__TYPE_CARD_NONFINITE__";

export function invalidTypeCardCases(
	resources: readonly ProgrammaticResource[],
): InvalidTypeCardCase[] {
	const { quiet, flicker } = typeCardSettings();
	const q = (patch: Record<string, unknown>) =>
		typeCardSource(resources, { ...quiet, ...patch } as MvTypeCard);
	const f = (patch: Record<string, unknown>) =>
		typeCardSource(resources, { ...flicker, ...patch } as MvTypeCard);
	const qSource = q({}),
		fSource = f({});
	const mainGlyph = quiet.glyphs[0]!;
	const invalid: [string, unknown][] = [
		["unknown main font", q({ font: "missing-font" })],
		[
			"unknown subtitle font",
			q({ subtitle: { ...quiet.subtitle, font: "missing-font" } }),
		],
		[
			"unknown Morse font",
			f({
				morse: {
					...flicker.morse,
					label: { ...flicker.morse.label, font: "missing-font" },
				},
			}),
		],
		["quiet no glyphs", q({ glyphs: [] })],
		[
			"quiet too many glyphs",
			q({ glyphs: Array.from({ length: 129 }, () => mainGlyph) }),
		],
		["glyph empty text", q({ glyphs: [{ ...mainGlyph, text: "" }] })],
		["glyph multiple scalars", q({ glyphs: [{ ...mainGlyph, text: "AB" }] })],
		["glyph control character", q({ glyphs: [{ ...mainGlyph, text: "\n" }] })],
		[
			"glyph unpaired surrogate",
			q({ glyphs: [{ ...mainGlyph, text: "\ud800" }] }),
		],
		["glyph malformed object", q({ glyphs: ["A"] })],
		["missing opticalScale", q({ glyphs: [{ text: "A" }] })],
		[
			"opticalScale below bound",
			q({ glyphs: [{ ...mainGlyph, opticalScale: 0.09 }] }),
		],
		[
			"opticalScale above bound",
			q({ glyphs: [{ ...mainGlyph, opticalScale: 2.01 }] }),
		],
		[
			"opticalScale null",
			q({ glyphs: [{ ...mainGlyph, opticalScale: null }] }),
		],
		["fontSize zero", q({ fontSize: 0 })],
		["fontSize above bound", q({ fontSize: 2.01 })],
		["center outside bounds", q({ center: [3.01, 0.5] })],
		["bad orientation", q({ orientation: "diagonal" })],
		["negative gap", q({ gap: -0.01 })],
		["negative lead", q({ lead: -0.01 })],
		["excessive stagger", q({ stagger: 2.01 })],
		["zero fade", q({ fade: 0 })],
		["invalid color channel", q({ color: [1.01, 0, 0, 1] })],
		["negative grain", q({ grain: -0.01 })],
		["grain above one", f({ grain: 1.01 })],
		["wrong quiet field type", q({ lead: "0.1" })],
		["missing required rule (not explicit null)", q({ rule: undefined })],
		[
			"missing required subtitle (not explicit null)",
			q({ subtitle: undefined }),
		],
		["unknown quiet setting", q({ hiddenDefault: true })],
		[
			"unknown glyph setting",
			q({ glyphs: [{ ...mainGlyph, advanceWidth: 100 }] }),
		],
		["rule zero width", q({ rule: { ...quiet.rule, width: 0 } })],
		[
			"subtitle control character",
			q({ subtitle: { ...quiet.subtitle, text: "bad\nline" } }),
		],
		[
			"subtitle tracking out of range",
			q({ subtitle: { ...quiet.subtitle, tracking: 0.21 } }),
		],
		["unknown mode", q({ mode: "automatic" })],
		["wrong mode schema", q({ mode: "flicker" })],
		...invalidTypeCardFlickerCases(flicker, f),
		["author settings fontMetrics injection", q({ fontMetrics: [] })],
		[
			"author glyph fontMetrics injection",
			q({
				glyphs: [
					{
						...mainGlyph,
						fontMetrics: { left: 1, right: 1, top: 1, bottom: 1 },
					},
				],
			}),
		],
		["author source fontMetrics injection", { ...qSource, fontMetrics: [] }],
		[
			"author recipe fontMetrics injection",
			{ ...qSource, recipe: { ...qSource.recipe!, fontMetrics: [] } },
		],
		[
			"unsupported recipe version",
			{ ...qSource, recipe: { ...qSource.recipe!, version: 2 } },
		],
	];
	for (const [id, source] of [
		["mincho", qSource],
		["dela", fSource],
		["dot", fSource],
	] as const) {
		invalid.push([
			`missing declared ${id} font`,
			{
				...source,
				resources: resources.filter((resource) => resource.id !== id),
			},
		]);
		const resource = resources.find((item) => item.id === id)!;
		const { font: _font, ...base } = resource;
		invalid.push([
			`${id} bound to a nonfont resource`,
			{
				...source,
				resources: resources.map((item) =>
					item.id === id
						? { ...base, kind: "image", mimeType: "image/png" }
						: item,
				),
			},
		]);
	}
	for (const [name, patch] of [
		["author scene fontMetrics injection", { fontMetrics: [] }],
		[
			"fractional scene span",
			{ span: { startFrame: 0.5, durationFrames: 100 } },
		],
		[
			"scene span past source",
			{ span: { startFrame: 200, durationFrames: 100 } },
		],
	] as const)
		invalid.push([
			name,
			{
				...qSource,
				recipe: {
					...qSource.recipe!,
					nodes: qSource.recipe!.nodes.map((node) => ({
						...node,
						scene: { ...node.scene, ...patch },
					})),
				},
			},
		]);
	return [
		...invalid.map(([name, source]) => ({ name, source })),
		{
			name: "positive nonfinite fontSize via JSON exponent",
			source: q({ fontSize: TYPE_CARD_OVERFLOW_MARKER }),
			overflowLiteral: "1e400",
		},
		{
			name: "negative nonfinite beat via JSON exponent",
			source: f({
				beats: { kind: "manual", songTicks: [TYPE_CARD_OVERFLOW_MARKER] },
			}),
			overflowLiteral: "-1e400",
		},
	];
}
