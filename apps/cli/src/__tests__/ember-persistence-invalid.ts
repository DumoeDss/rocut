import type { ProgrammaticResource } from "@opencut/editor-contracts";
import type { MvEmber } from "../../../../packages/editor-contracts/src/mv-ember";
import {
	emberCase,
	emberSource,
} from "../../../../script/fixtures/mv-ember-source";
import { emberSettings } from "./ember-persistence-fixture";

export const EMBER_OVERFLOW_MARKER = "__EMBER_NONFINITE__";
export interface InvalidEmberCase {
	name: string;
	source: unknown;
	overflowLiteral?: "1e400" | "-1e400";
}

export function invalidEmberCases(
	resources: readonly ProgrammaticResource[],
): InvalidEmberCase[] {
	const { audio, breathe, ignite, collapse } = emberSettings();
	const manual = emberCase("collapse", audio, "wide.png", true);
	if (
		breathe.settings.mode !== "breathe" ||
		ignite.settings.mode !== "ignite" ||
		manual.settings.mode !== "collapse" ||
		manual.settings.keys.kind !== "manual"
	)
		throw Error("Expected typed Ember fixture");
	const source = (item: typeof breathe, patch: Record<string, unknown>) =>
		emberSource(
			{ ...item, settings: { ...item.settings, ...patch } as MvEmber },
			resources,
		);
	const b = (patch: Record<string, unknown>) => source(breathe, patch);
	const i = (patch: Record<string, unknown>) => source(ignite, patch);
	const c = (patch: Record<string, unknown>) => source(collapse, patch);
	const m = (patch: Record<string, unknown>) => source(manual, patch);
	const hud = breathe.settings.hud,
		keys = manual.settings.keys.values;
	const invalid: [string, unknown][] = [
		["unknown mode", b({ mode: "automatic" })],
		["wrong mode schema", b({ mode: "ignite" })],
		["negative grain", b({ grain: -0.01 })],
		["grain above one", i({ grain: 1.01 })],
		["null grain", c({ grain: null })],
		["missing palette", b({ palette: undefined })],
		[
			"invalid palette channel",
			b({ palette: { ...breathe.settings.palette, aura: [2, 0, 0, 1] } }),
		],
		[
			"unknown palette field",
			b({ palette: { ...breathe.settings.palette, hidden: true } }),
		],
		["unknown setting", b({ hiddenDefault: true })],
		["missing HUD font", b({ hud: { ...hud, font: "missing.ttf" } })],
		["HUD bound to image", i({ hud: { ...hud, font: "wide.png" } })],
		["empty HUD title", b({ hud: { ...hud, title: "" } })],
		["long HUD title", b({ hud: { ...hud, title: "A".repeat(97) } })],
		["control HUD title", b({ hud: { ...hud, title: "bad\nline" } })],
		["unknown HUD field", b({ hud: { ...hud, advance: 10 } })],
		[
			"HUD hour overflow",
			b({ hud: { ...hud, clock: { ...hud.clock, hour: 100 } } }),
		],
		[
			"HUD minute negative",
			b({ hud: { ...hud, clock: { ...hud.clock, minute: -1 } } }),
		],
		["HUD zero fps", b({ hud: { ...hud, clock: { ...hud.clock, fps: 0 } } })],
		[
			"HUD fractional fps",
			b({ hud: { ...hud, clock: { ...hud.clock, fps: 29.97 } } }),
		],
		[
			"HUD excessive fps",
			b({ hud: { ...hud, clock: { ...hud.clock, fps: 121 } } }),
		],
		["empty stop interval", b({ stopsTicks: [[120000, 120000]] })],
		["reversed stop interval", i({ stopsTicks: [[120001, 120000]] })],
		["negative stop tick", b({ stopsTicks: [[-1, 120000]] })],
		[
			"too many flare intervals",
			b({ flaresTicks: Array.from({ length: 33 }, () => [0, 1]) }),
		],
		["fractional flare tick", b({ flaresTicks: [[0.5, 1]] })],
		["unsafe thump tick", b({ thumpsTicks: [9007199254740992] })],
		["too many thumps", b({ thumpsTicks: Array(33).fill(0) })],
		["unordered beats", b({ beats: { kind: "manual", songTicks: [2, 1] } })],
		["duplicate beats", i({ beats: { kind: "manual", songTicks: [1, 1] } })],
		[
			"extra analysis beats field",
			b({ beats: { kind: "analysis", songTicks: [] } }),
		],
		["missing beats", b({ beats: undefined })],
		[
			"black boundary before shot",
			i({ blackFrom: { kind: "at", songTicks: 1 } }),
		],
		["unknown black boundary kind", i({ blackFrom: { kind: "automatic" } })],
		[
			"extra last beat boundary field",
			i({ blackFrom: { kind: "lastBeat", songTicks: 1200000 } }),
		],
		["null crack tick", i({ crackAtTicks: null })],
		["negative crack tick", i({ crackAtTicks: -1 })],
		["zero ring", i({ ring: 0 })],
		["ring over bound", i({ ring: 1001 })],
		["negative crack seed", i({ seed: -1 })],
		["oversize crack seed", i({ seed: 4294967296 })],
		["missing image", c({ image: "missing.png" })],
		["image bound to font", c({ image: hud.font })],
		["oversize focus", c({ focus: [4097, 0] })],
		["null focus", c({ focus: null })],
		["end before shot", c({ endTicks: 1 })],
		["missing keys", c({ keys: undefined })],
		["unknown keys kind", c({ keys: { kind: "automatic" } })],
		[
			"too few manual keys",
			m({ keys: { kind: "manual", values: keys.slice(0, 2) } }),
		],
		[
			"too many manual keys",
			m({ keys: { kind: "manual", values: Array(65).fill(keys[0]) } }),
		],
		[
			"duplicate adjacent manual keys",
			m({ keys: { kind: "manual", values: [keys[0], keys[0], keys[2]] } }),
		],
		[
			"negative key factor",
			m({
				keys: {
					kind: "manual",
					values: keys.map((key, index) =>
						index ? key : { ...key, factor: -0.1 },
					),
				},
			}),
		],
		[
			"unknown key easing",
			m({
				keys: {
					kind: "manual",
					values: keys.map((key, index) =>
						index ? key : { ...key, easing: "bounce" },
					),
				},
			}),
		],
		[
			"numeric key hit",
			m({
				keys: {
					kind: "manual",
					values: keys.map((key, index) => (index ? key : { ...key, hit: 1 })),
				},
			}),
		],
		[
			"extra key field",
			m({
				keys: {
					kind: "manual",
					values: keys.map((key, index) =>
						index ? key : { ...key, radius: 10 },
					),
				},
			}),
		],
		[
			"extra auto key field",
			c({
				keys: { kind: "analysis", beats: { kind: "analysis" }, values: [] },
			}),
		],
		["settings image facts injection", c({ imageDimensions: [] })],
		["settings font facts injection", b({ fontMetrics: [] })],
	];
	for (const item of [breathe, ignite, collapse]) {
		const base = source(item, {});
		for (const key of ["fontMetrics", "imageDimensions"])
			invalid.push(
				[`${item.label} source ${key} injection`, { ...base, [key]: [] }],
				[
					`${item.label} recipe ${key} injection`,
					{ ...base, recipe: { ...base.recipe!, [key]: [] } },
				],
			);
		invalid.push([
			`${item.label} absent analysis binding`,
			{ ...base, recipe: { ...base.recipe!, audio: undefined } },
		]);
		invalid.push([
			`${item.label} missing declared analysis`,
			{
				...base,
				resources: base.resources!.filter(
					(resource) => resource.kind !== "analysis",
				),
			},
		]);
		for (const span of [
			{ startFrame: 0, durationFrames: 0 },
			{ startFrame: 0.5, durationFrames: 2 },
			{ startFrame: 0, durationFrames: 10000 },
		])
			invalid.push([
				`${item.label} invalid span ${JSON.stringify(span)}`,
				{
					...base,
					recipe: {
						...base.recipe!,
						nodes: base.recipe!.nodes.map((node) => ({
							...node,
							scene: { ...node.scene, span },
						})),
					},
				},
			]);
	}
	return [
		...invalid.map(([name, value]) => ({ name, source: value })),
		{
			name: "positive nonfinite grain exponent",
			source: b({ grain: EMBER_OVERFLOW_MARKER }),
			overflowLiteral: "1e400",
		},
		{
			name: "negative nonfinite focus exponent",
			source: c({ focus: [EMBER_OVERFLOW_MARKER, 0] }),
			overflowLiteral: "-1e400",
		},
	];
}
