import { expect, test } from "bun:test";
import {
	FALL_EXPORT,
	FALL_EXPORT_CLIPS,
	fallExportSample,
} from "./mv-fall-export-support";
test("Fall real export uses odd60fps trims, complete30fps clips and blank half-open boundaries", () => {
	expect(FALL_EXPORT.width).toBe(1920);
	expect(FALL_EXPORT.height).toBe(1080);
	expect(FALL_EXPORT.frames).toBe(12);
	expect(FALL_EXPORT.fps).toBe(30);
	for (const frame of [0, 5, 10, 11])
		expect(fallExportSample(frame)).toBeNull();
	for (const clip of FALL_EXPORT_CLIPS) {
		expect(clip.trimSourceFrame % 2).toBe(1);
		expect(fallExportSample(clip.start)?.sourceIndex).toBe(
			clip.trimSourceFrame,
		);
		expect(fallExportSample(clip.start + 1)?.sourceIndex).toBe(
			clip.trimSourceFrame + 2,
		);
	}
	for (const frame of [-1, 12, 0.5, NaN])
		expect(() => fallExportSample(frame)).toThrow();
});
