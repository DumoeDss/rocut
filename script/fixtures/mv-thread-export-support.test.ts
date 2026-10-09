import { expect, test } from "bun:test";
import {
	THREAD_EXPORT,
	THREAD_EXPORT_CLIPS,
	threadExportSample,
} from "./mv-thread-export-support";
test("Thread real export uses odd60fps trims, complete30fps clips and blank half-open boundaries", () => {
	expect(THREAD_EXPORT.width).toBe(1920);
	expect(THREAD_EXPORT.height).toBe(1080);
	expect(THREAD_EXPORT.frames).toBe(12);
	expect(THREAD_EXPORT.fps).toBe(30);
	for (const frame of [0, 5, 10, 11])
		expect(threadExportSample(frame)).toBeNull();
	for (const clip of THREAD_EXPORT_CLIPS) {
		expect(clip.trimSourceFrame % 2).toBe(1);
		expect(threadExportSample(clip.start)?.sourceIndex).toBe(
			clip.trimSourceFrame,
		);
		expect(threadExportSample(clip.start + 1)?.sourceIndex).toBe(
			clip.trimSourceFrame + 2,
		);
	}
	for (const frame of [-1, 12, 0.5, NaN])
		expect(() => threadExportSample(frame)).toThrow();
});
