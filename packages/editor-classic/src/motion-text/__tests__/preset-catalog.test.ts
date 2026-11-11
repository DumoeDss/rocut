import { describe, expect, test } from "bun:test";

import {
	filterMotionTextPresetCatalog,
	JIZURA_PRESET_CATALOG,
} from "../preset-catalog";
import {
	MOTION_TEXT_MAX_ACTIVE_PREVIEWS,
	resolveMotionTextPresetVirtualWindow,
} from "../preset-virtualization";

describe("JIZURA motion-text preset catalog", () => {
	test("derives all 1744 drawable presets without Rocut-native aliases", () => {
		expect(JIZURA_PRESET_CATALOG).toHaveLength(1744);
		expect(new Set(JIZURA_PRESET_CATALOG.map((entry) => entry.key)).size).toBe(
			1744,
		);
		expect(JIZURA_PRESET_CATALOG.some((entry) => entry.key === "style:base")).toBe(
			false,
		);
		expect(
			JIZURA_PRESET_CATALOG.some((entry) => entry.key === "layout:huge"),
		).toBe(true);
	});

	test("filters by stable ids, display names, and preset groups", () => {
		expect(
			filterMotionTextPresetCatalog({ group: "trans", query: "wipe" }).every(
				(entry) => entry.group === "trans" && /wipe/iu.test(entry.name),
			),
		).toBe(true);
		expect(
			filterMotionTextPresetCatalog({ group: "all", query: "kinetic" }).some(
				(entry) => entry.id.startsWith("kn"),
			),
		).toBe(true);
	});
});

describe("motion-text preset catalog virtualization", () => {
	test("mounts a bounded window and activates no more than four previews", () => {
		const first = resolveMotionTextPresetVirtualWindow({
			itemCount: 1744,
			scrollTop: 0,
			viewportHeight: 396,
		});
		const later = resolveMotionTextPresetVirtualWindow({
			itemCount: 1744,
			scrollTop: 13_200,
			viewportHeight: 396,
		});

		expect(first.totalHeight).toBe(115_104);
		expect(first.endIndex - first.startIndex).toBeLessThanOrEqual(10);
		expect(first.activeIndexes.size).toBe(MOTION_TEXT_MAX_ACTIVE_PREVIEWS);
		expect(later.startIndex).toBeGreaterThan(first.startIndex);
		expect(later.activeIndexes.size).toBeLessThanOrEqual(
			MOTION_TEXT_MAX_ACTIVE_PREVIEWS,
		);
	});
});
