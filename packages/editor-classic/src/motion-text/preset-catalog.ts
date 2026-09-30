import type { MotionTextPresetGroup } from "@opencut/editor-contracts";

import { MOTION_TEXT_RENDERER_SUPPORT } from "../services/renderer/motion-text/support-manifest";

export const MOTION_TEXT_PRESET_GROUPS = [
	"style",
	"layout",
	"enter",
	"hold",
	"exit",
	"decor",
	"treat",
	"bg",
	"cam",
	"fx",
	"trans",
] as const satisfies readonly MotionTextPresetGroup[];

const ROCUT_NATIVE_ALIASES = new Set([
	"style:base",
	"enter:fade",
	"exit:fade",
	"bg:transparent",
	"cam:static",
]);

export interface MotionTextPresetCatalogEntry {
	readonly key: `${MotionTextPresetGroup}:${string}`;
	readonly group: MotionTextPresetGroup;
	readonly id: string;
	readonly name: string;
	readonly searchText: string;
}

function humanizePresetId(id: string): string {
	return id
		.replace(/^hr(?=[A-Z])/u, "Horror ")
		.replace(/^kn(?=[A-Z])/u, "Kinetic ")
		.replace(/^ty(?=[A-Z])/u, "Type ")
		.replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
		.replace(/([A-Z])([A-Z][a-z])/gu, "$1 $2")
		.replaceAll("_", " ")
		.replace(/^./u, (character) => character.toUpperCase());
}

export const JIZURA_PRESET_CATALOG: readonly MotionTextPresetCatalogEntry[] =
	Object.freeze(
		MOTION_TEXT_RENDERER_SUPPORT.filter(
			(entry) => !ROCUT_NATIVE_ALIASES.has(`${entry.group}:${entry.id}`),
		).map((entry) => {
			const name = humanizePresetId(entry.id);
			return Object.freeze({
				key: `${entry.group}:${entry.id}`,
				group: entry.group,
				id: entry.id,
				name,
				searchText: `${entry.group} ${entry.id} ${name}`.toLocaleLowerCase(),
			}) satisfies MotionTextPresetCatalogEntry;
		}),
	);

export function filterMotionTextPresetCatalog({
	group,
	query,
}: {
	readonly group: MotionTextPresetGroup | "all";
	readonly query: string;
}): readonly MotionTextPresetCatalogEntry[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	return JIZURA_PRESET_CATALOG.filter(
		(entry) =>
			(group === "all" || entry.group === group) &&
			(normalizedQuery.length === 0 ||
				entry.searchText.includes(normalizedQuery)),
	);
}
