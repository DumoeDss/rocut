import { expect, test } from "bun:test";
import {
	advertiseExportProtocol,
	isHostExportOptions,
} from "./host-export-protocol";

test("pane explicitly advertises wire support without claiming encoder capability", () => {
	const query = new URLSearchParams("editorTaskSurface=pane-1");
	advertiseExportProtocol(query);
	expect(Object.fromEntries(query)).toEqual({
		editorTaskSurface: "pane-1",
		exportProtocol: "3",
		exportVideoQuantizer: "true",
		exportVideoChroma: "444",
	});
});

test("pane accepts exact chroma values only and keeps every other option", () => {
	for (const quality of ["low", "medium", "high", "very_high"]) {
		const options = {
			format: "webm",
			quality,
			videoChroma: "444",
			includeAudio: false,
			range: { startTime: 4000, endTime: 28000 },
		};
		const before = structuredClone(options);
		expect(isHostExportOptions(options)).toBe(true);
		expect(options).toEqual(before);
	}
	for (const format of ["mp4", "webm"]) {
		expect(isHostExportOptions({ format, quality: "high" })).toBe(true);
		expect(
			isHostExportOptions({ format, quality: "high", videoChroma: "420" }),
		).toBe(true);
	}
	for (const videoChroma of [null, 444, "422", [], {}, ""])
		expect(
			isHostExportOptions({ format: "webm", quality: "high", videoChroma }),
		).toBe(false);
	expect(
		isHostExportOptions({ format: "mp4", quality: "high", videoChroma: "444" }),
	).toBe(false);
});

test("pane keeps explicit q0 for Rust admission instead of dropping it", () => {
	const options = {
		format: "webm",
		quality: "low",
		videoQuantizer: 0,
		videoChroma: "444",
		includeAudio: false,
	};
	expect(isHostExportOptions(options)).toBe(true);
	expect(options.videoQuantizer).toBe(0);
	for (const videoQuantizer of [64, -1, 0.5])
		expect(isHostExportOptions({ ...options, videoQuantizer })).toBe(true);
	for (const videoQuantizer of [null, "0", true, [], {}])
		expect(isHostExportOptions({ ...options, videoQuantizer })).toBe(false);
});
