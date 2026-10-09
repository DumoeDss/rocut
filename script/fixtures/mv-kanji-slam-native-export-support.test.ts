import { expect, test } from "bun:test";
import {
	KANJI_SLAM_EXPORT,
	KANJI_SLAM_EXPORT_CLIPS,
	kanjiSlamExportSampleAt,
} from "./mv-kanji-slam-native-export-support";

test("kanji export keeps all three variants, odd60fps trims and half-open30fps blank boundaries", () => {
	expect(KANJI_SLAM_EXPORT).toEqual({
		width: 1920,
		height: 1080,
		frames: 12,
		fps: 30,
		outputStep: 4000,
		sourceStep: 2000,
	});
	const samples = Array.from({ length: 12 }, (_, index) =>
		kanjiSlamExportSampleAt(index),
	);
	expect(samples.map((s) => s?.sourceIndex ?? null)).toEqual([
		null,
		47,
		49,
		31,
		33,
		null,
		97,
		99,
		131,
		133,
		null,
		null,
	]);
	expect(samples.map((s) => s?.clip.variant ?? null)).toEqual([
		null,
		"default",
		"default",
		"night",
		"night",
		null,
		"hand",
		"hand",
		"default",
		"default",
		null,
		null,
	]);
	for (const clip of KANJI_SLAM_EXPORT_CLIPS) {
		expect(clip.start).toBeGreaterThan(0);
		expect(clip.trimSourceFrame % 2).toBe(1);
		expect(clip.trimSourceFrame + clip.duration * 2).toBeLessThanOrEqual(240);
		expect(clip.start + clip.duration).toBeLessThanOrEqual(12);
	}
});
test("invalid timeline samples cannot masquerade as valid empty frames", () => {
	for (const frame of [-1, 12, 13, 1.5, NaN, Infinity])
		expect(() => kanjiSlamExportSampleAt(frame)).toThrow();
	expect(kanjiSlamExportSampleAt(1)).toEqual(kanjiSlamExportSampleAt(1));
});
