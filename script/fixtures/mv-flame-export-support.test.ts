import { expect, test } from "bun:test";
import { flameCases } from "./mv-flame-cases";
import { flameSample, flameSource } from "./mv-flame-source";
import {
	FLAME_EXPORT,
	FLAME_EXPORT_BLANKS,
	FLAME_EXPORT_CLIPS,
	flameExportSample,
} from "./mv-flame-export-support";

test("Flame export preserves all 160 authored whole-song samples at true1080p60fps, plus five explicit blanks", () => {
	expect(FLAME_EXPORT_CLIPS).toHaveLength(160);
	expect(new Set(FLAME_EXPORT_CLIPS.map((c) => c.start)).size).toBe(160);
	expect(FLAME_EXPORT).toEqual({
		width: 1920,
		height: 1080,
		frames: 165,
		fps: 60,
		outputStep: 2000,
		sourceStep: 2000,
	});
	const cases = flameCases();
	for (const [caseIndex, item] of cases.entries()) {
		const source = flameSource({
			frame: item.frame,
			song: item.song,
			resources: [],
			options: { vocal: item.vocal },
		});
		expect(source.durationFrames).toBe(240);
		expect(source.recipe!.songStartSeconds).toBe(item.frame.shotStart);
		const clips = FLAME_EXPORT_CLIPS.filter((c) => c.caseIndex === caseIndex);
		expect(clips.map((c) => c.trimSourceFrame)).toEqual([...item.indices]);
		for (const clip of clips) {
			const sample = flameExportSample(clip.start)!;
			expect(sample.sourceIndex).toBe(clip.trimSourceFrame);
			expect(clip.trimSourceFrame + clip.duration).toBeLessThanOrEqual(
				source.durationFrames,
			);
			expect(
				flameSample({ frame: item.frame, index: sample.sourceIndex }).time,
			).toBe(
				(Math.round(item.frame.shotStart * 120000) +
					sample.sourceIndex * 2000) /
					120000,
			);
		}
	}
	expect(
		Array.from({ length: 165 }, (_, i) => i).filter(
			(i) => !flameExportSample(i),
		),
	).toEqual([...FLAME_EXPORT_BLANKS]);
});
