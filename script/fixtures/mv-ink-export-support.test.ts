import { expect, test } from "bun:test";
import {
	INK_EXPORT,
	INK_EXPORT_BLANKS,
	INK_EXPORT_CLIPS,
	inkExportSample,
} from "./mv-ink-export-support";
import { inkCases } from "./mv-ink-cases";
test("421-frame export retains all408original visits plus13blank handles and every source trim", () => {
	expect(INK_EXPORT_CLIPS.length).toBe(408);
	expect(INK_EXPORT.frames).toBe(421);
	const seen = new Set<number>();
	let visits = 0,
		repeats = 0;
	for (let frame = 0; frame < INK_EXPORT.frames; frame++) {
		const sample = inkExportSample(frame);
		if (!sample) {
			expect(INK_EXPORT_BLANKS).toContain(frame);
			continue;
		}
		const item = inkCases()[sample.clip.caseIndex]!;
		expect(sample.clip.start).toBe(frame);
		expect(sample.sourceIndex).toBe(item.indices[visits % 34]);
		expect(sample.sourceIndex).toBeLessThan(360);
		if (visits % 34 === 0) seen.clear();
		if (seen.has(sample.sourceIndex)) repeats++;
		else seen.add(sample.sourceIndex);
		visits++;
	}
	expect(visits).toBe(408);
	expect(repeats).toBe(48);
	for (const frame of [-1, 421, NaN, 0.5])
		expect(() => inkExportSample(frame)).toThrow();
});
