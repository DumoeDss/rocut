import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import type {
	MvTypeCardFlicker,
	MvTypeCardQuiet,
} from "../../../../packages/editor-contracts/src/mv-type-card";
import {
	typeCardCase,
	typeCardSource,
} from "../../../../script/fixtures/mv-type-card-source";

export { TYPE_CARD_FONTS } from "../../../../script/fixtures/mv-type-card-source";
export const TYPE_CARD_CLIPS = [
	"type-card-quiet",
	"type-card-flicker",
] as const;
export type TypeCardClip = (typeof TYPE_CARD_CLIPS)[number];
export type TypeCardSources = Record<TypeCardClip, ProgrammaticSource>;

export function typeCardSettings() {
	const quiet = typeCardCase("quiet").settings,
		flicker = typeCardCase("flicker").settings;
	if (quiet.mode !== "quiet" || flicker.mode !== "flicker")
		throw Error("Shared typeCard fixture modes changed");
	return { quiet, flicker };
}

export function initialTypeCardSources(
	resources: readonly ProgrammaticResource[],
): TypeCardSources {
	const { quiet, flicker } = typeCardSettings();
	return {
		"type-card-quiet": typeCardSource(resources, quiet),
		"type-card-flicker": typeCardSource(resources, flicker),
	};
}

/** Explicit author edits, not another implementation of the original scene math. */
export function editedTypeCardSources(
	resources: readonly ProgrammaticResource[],
): TypeCardSources {
	const { quiet, flicker } = typeCardSettings();
	const revisedQuiet: MvTypeCardQuiet = {
		...quiet,
		font: "dela",
		glyphs: [
			{ text: "X", opticalScale: 0.75 },
			{ text: "Y", opticalScale: 1.4 },
		],
		fontSize: 0.12,
		center: [0.46, 0.42],
		orientation: "vertical",
		gap: 0.2,
		lead: 0.2,
		stagger: 0.08,
		fade: 0.45,
		color: [0.2, 0.6, 0.8, 0.9],
		background: [0.02, 0.03, 0.04, 1],
		rule: {
			color: [0.8, 0.2, 0.3, 0.8],
			offset: -0.6,
			lengthScale: 0.8,
			lengthPadding: 0.04,
			width: 0.002,
			tickLength: 0.012,
		},
		subtitle: {
			font: "mincho",
			text: "revised quiet",
			position: [0.48, 0.82],
			fontSize: 0.02,
			tracking: -0.003,
			color: [0.7, 0.6, 0.5, 0.8],
		},
		grain: 0.08,
	};
	const revisedFlicker: MvTypeCardFlicker = {
		...flicker,
		font: "mincho",
		background: [0.01, 0.02, 0.03, 1],
		beats: {
			kind: "manual",
			songTicks: [1050000, 1140000, 1230000, 1320000, 1410000],
		},
		layouts: [
			{
				...flicker.layouts[0],
				parts: [{ text: "EDIT", position: [0.49, 0.51], fontSize: 0.25 }],
				hold: { kind: "pulse", seconds: 0.4 },
				glitch: 0.7,
				frame: null,
			},
			{ ...flicker.layouts[1], hold: { kind: "sustain" } },
			flicker.layouts[2],
			{
				...flicker.layouts[3],
				kickGlow: {
					center: [0.52, 0.49],
					radius: 1.1,
					color: [0.8, 0.5, 0.3, 0.75],
				},
			},
		],
		rgbColors: [
			[0.9, 0.1, 0.1, 1],
			[0.1, 0.9, 0.1, 0.8],
			[0.1, 0.1, 0.9, 1],
		],
		noiseColors: [
			[0.8, 0.2, 0.3, 0.3],
			[0.1, 0.7, 0.8, 0.4],
			[0.7, 0.7, 0.7, 0.2],
		],
		scanlineOpacity: 0.35,
		idleScanColor: [0.7, 0.6, 0.5, 0.12],
		morse: {
			...flicker.morse,
			elements: [3, 1, 3, 1],
			position: [0.48, 0.88],
			unit: 0.018,
			gap: 0.015,
			height: 0.006,
			litColor: [0.2, 0.8, 0.4, 0.8],
			unlitColor: [0.8, 0.4, 0.2, 0.2],
			label: {
				...flicker.morse.label,
				text: "TEST",
				position: [0.49, 0.94],
				fontSize: 0.022,
				tracking: 0.01,
				color: [0.8, 0.7, 0.6, 0.7],
			},
		},
		flood: {
			...flicker.flood,
			center: [0.47, 0.48],
			radiusFrom: 0.3,
			radiusTo: 2.2,
			colors: [
				[0.9, 0.8, 0.7, 1],
				[0.9, 0.7, 0.6, 0.9],
				[0.8, 0.5, 0.4, 0.7],
				[0.5, 0.2, 0.1, 0],
			],
			white: [0.9, 0.8, 0.7, 0.85],
		},
		negative: {
			text: "EDIT",
			position: [0.48, 0.51],
			fontSize: 0.45,
			color: [0.1, 0.3, 0.5, 0.4],
		},
		grain: 0.08,
	};
	const revised = (settings: MvTypeCardQuiet | MvTypeCardFlicker) => {
		const source = typeCardSource(resources, settings);
		return {
			...source,
			seed: 37,
			recipe: {
				...source.recipe!,
				songStartSeconds: 8.75,
				nodes: source.recipe!.nodes.map((node) => ({
					...node,
					scene: {
						...node.scene,
						span: { startFrame: 5, durationFrames: 225 },
					},
				})),
			},
		};
	};
	// Both original clips change their discriminated mode, not just their labels.
	return {
		"type-card-quiet": revised(revisedFlicker),
		"type-card-flicker": revised(revisedQuiet),
	};
}

export const typeCardEditing = (programmatic: unknown) => ({
	type: "graphic",
	definitionId: "programmatic",
	params: {},
	programmatic,
});
export const typeCardUpdate = (
	clipId: TypeCardClip,
	programmatic: unknown,
) => ({
	kind: "update-clip",
	clipId,
	patch: { editing: typeCardEditing(programmatic) },
});
