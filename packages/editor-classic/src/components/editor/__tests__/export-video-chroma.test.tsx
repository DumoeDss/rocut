import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	DEFAULT_EXPORT_OPTIONS,
	DEFAULT_VIDEO_CHROMA,
	selectedVideoChroma,
} from "../../../export/defaults";
import { ExportVideoChromaControl } from "../export-video-chroma";

test("chroma selection does not change legacy defaults or the chosen quality", () => {
	expect(DEFAULT_EXPORT_OPTIONS).toEqual({
		format: "mp4",
		quality: "high",
		includeAudio: true,
	});
	expect(DEFAULT_VIDEO_CHROMA).toBe("420");
	expect(selectedVideoChroma("420")).toEqual({});
	for (const quality of ["low", "medium", "high", "very_high"])
		expect({ format: "webm", quality, ...selectedVideoChroma("444") }).toEqual({
			format: "webm",
			quality,
			videoChroma: "444",
		});
});

test("both export surfaces share explicit high-fidelity compatibility and no-fallback guidance", () => {
	const markup = renderToStaticMarkup(
		createElement(ExportVideoChromaControl, { value: "444", onChange() {} }),
	);
	expect(markup).toContain('value="444" selected=""');
	expect(markup).toContain("High-fidelity color");
	expect(markup).toContain("may not play in all players");
	expect(markup).toContain("does not change the quality preset");
	expect(markup).toContain("no automatic 4:2:0 fallback");
	expect(markup).toContain("aria-describedby=");
});
