import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import type { MvEmber } from "../../../../packages/editor-contracts/src/mv-ember";
import { emberAudioFacts } from "../../../../script/fixtures/mv-ember-audio";
import {
	emberCase,
	emberSource,
} from "../../../../script/fixtures/mv-ember-source";

export const EMBER_CLIPS = [
	"ember-breathe",
	"ember-ignite",
	"ember-collapse",
] as const;
export type EmberClip = (typeof EMBER_CLIPS)[number];
export type EmberSources = Record<EmberClip, ProgrammaticSource>;

export function emberSettings() {
	const audio = emberAudioFacts({ vocal: true });
	const breathe = emberCase("breathe", audio),
		ignite = emberCase("ignite", audio),
		collapse = emberCase("collapse", audio);
	if (
		breathe.settings.mode !== "breathe" ||
		ignite.settings.mode !== "ignite" ||
		collapse.settings.mode !== "collapse"
	)
		throw Error("Shared Ember fixture modes changed");
	return { audio, breathe, ignite, collapse };
}

export function initialEmberSources(
	resources: readonly ProgrammaticResource[],
): EmberSources {
	const cases = emberSettings();
	return {
		"ember-breathe": emberSource(cases.breathe, resources),
		"ember-ignite": emberSource(cases.ignite, resources),
		"ember-collapse": emberSource(cases.collapse, resources),
	};
}

/** Author edits only; this fixture does not implement any scene formula. */
export function editedEmberSources(
	resources: readonly ProgrammaticResource[],
): EmberSources {
	const { audio, breathe, ignite } = emberSettings();
	const manual = emberCase("collapse", audio, "portrait.png", true);
	if (
		breathe.settings.mode !== "breathe" ||
		ignite.settings.mode !== "ignite" ||
		manual.settings.mode !== "collapse" ||
		manual.settings.keys.kind !== "manual"
	)
		throw Error("Expected typed Ember settings");
	const colorEdits = (settings: MvEmber) => ({
		...settings.palette,
		aura: [0.03, 0.12, 0.25, 1] as const,
		glow: [0.4, 0.7, 0.9, 1] as const,
	});
	const revisedBreathe = {
		...breathe,
		settings: {
			...breathe.settings,
			palette: colorEdits(breathe.settings),
			grain: 0.02,
			beats: { kind: "analysis" as const },
			hud: {
				...breathe.settings.hud,
				title: "EDIT / Ō",
				clock: { hour: 3, minute: 5, fps: 60 },
			},
			stopsTicks: [[120000, 132000] as const],
			flaresTicks: [[168000, 216000] as const],
			thumpsTicks: [228000],
		},
	};
	const revisedIgnite = {
		...ignite,
		settings: {
			...ignite.settings,
			palette: colorEdits(ignite.settings),
			grain: 0.09,
			hud: { ...ignite.settings.hud, title: "IGNITE EDIT" },
			blackFrom: { kind: "at" as const, songTicks: 1200000 },
			crackAtTicks: 960000,
			ring: 153,
			seed: 0,
			stopsTicks: [[900000, 906000] as const],
		},
	};
	const revisedCollapse = {
		...manual,
		settings: {
			...manual.settings,
			palette: colorEdits(manual.settings),
			grain: 0.03,
			focus: [-130, 75] as const,
			endTicks: 2400000,
			keys: {
				...manual.settings.keys,
				values: manual.settings.keys.values.map((key, index) =>
					index === 3
						? { ...key, factor: 0.61, easing: "io" as const, hit: false }
						: key,
				),
			},
		},
	};
	const source = (
		item: typeof revisedBreathe | typeof revisedIgnite | typeof revisedCollapse,
	) => ({ ...emberSource(item, resources), seed: 83 });
	// Swapping actual discriminated modes additionally verifies serialization of the union.
	return {
		"ember-breathe": source(revisedIgnite),
		"ember-ignite": source(revisedBreathe),
		"ember-collapse": source(revisedCollapse),
	};
}

export const emberEditing = (programmatic: unknown) => ({
	type: "graphic",
	definitionId: "programmatic",
	params: {},
	programmatic,
});
export const emberUpdate = (clipId: EmberClip, programmatic: unknown) => ({
	kind: "update-clip",
	clipId,
	patch: { editing: emberEditing(programmatic) },
});
