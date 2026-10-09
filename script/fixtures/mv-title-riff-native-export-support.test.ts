import { describe, expect, test } from "bun:test";
import {
	TITLE_RIFF_EXPORT,
	TITLE_RIFF_EXPORT_CLIPS,
	titleRiffExportSampleAt,
} from "./mv-title-riff-native-export-support";

describe("titleRiff twelve-frame export schedule", () => {
	test("keeps30fps output and60fps odd-index trims distinct, with exact blank boundaries", () => {
		expect(TITLE_RIFF_EXPORT).toEqual({
			width: 1920,
			height: 1080,
			frames: 12,
			fps: 30,
			outputStep: 4000,
			sourceStep: 2000,
		});
		const frames = Array.from({ length: 12 }, (_, i) =>
			titleRiffExportSampleAt(i),
		);
		expect(frames.map((frame) => frame?.sourceIndex ?? null)).toEqual([
			null,
			107,
			229,
			413,
			415,
			null,
			163,
			165,
			293,
			295,
			null,
			null,
		]);
		expect(frames.map((frame) => frame?.clip.variant ?? null)).toEqual([
			null,
			"intro",
			"intro",
			"intro",
			"intro",
			null,
			"outro",
			"outro",
			"outro",
			"outro",
			null,
			null,
		]);
		for (const clip of TITLE_RIFF_EXPORT_CLIPS) {
			expect(clip.start).toBeGreaterThan(0);
			expect(clip.trimSourceFrame % 2).toBe(1);
			expect(clip.trimSourceFrame + clip.duration * 2).toBeLessThanOrEqual(600);
			expect(clip.start + clip.duration).toBeLessThanOrEqual(12);
		}
	});
	test("does not turn invalid timeline indices into apparently valid blanks", () => {
		for (const frame of [-1, 12, 13, 1.5, NaN, Infinity])
			expect(() => titleRiffExportSampleAt(frame)).toThrow();
		expect(titleRiffExportSampleAt(9)).toEqual(titleRiffExportSampleAt(9));
		expect(titleRiffExportSampleAt(1)?.sourceIndex).toBe(107);
	});
});
