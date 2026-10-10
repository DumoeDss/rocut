export const blazeEditorExportThresholds = Object.freeze({
	meanRgba: 10,
	activeRgb: 15,
	minimumActivePixels: 64,
	timestampSeconds: 0.0011,
});
export const blazeEditorExportFrameTicks = Object.freeze([
	4000, 8000, 12000, 16000, 20000, 24000,
]);
export const blazeEditorExportSegments = Object.freeze(
	[
		{ id: "static", clipId: "blaze-static", offset: 0, enabled: true },
		{ id: "animated", clipId: "blaze-animated", offset: 120000, enabled: true },
		{
			id: "disabled",
			clipId: "blaze-disabled",
			offset: 240000,
			enabled: false,
		},
	].map((segment) =>
		Object.freeze({
			...segment,
			startTime: segment.offset + 4000,
			endTime: segment.offset + 28000,
			frames: 6,
		}),
	),
);
export const blazeEditorExportJobs = Object.freeze(
	["default", "444"].flatMap((chroma) =>
		blazeEditorExportSegments.map((segment) =>
			Object.freeze({
				...segment,
				chroma,
				jobKey: `${chroma}-${segment.id}`,
				options: Object.freeze({
					format: "webm",
					quality: "very_high",
					includeAudio: false,
					...(chroma === "444" ? { videoChroma: "444" } : {}),
					range: Object.freeze({
						startTime: segment.startTime,
						endTime: segment.endTime,
					}),
				}),
			}),
		),
	),
);

export const blazeEditorExportFiles = Object.freeze([
	"script/fixtures/blaze-editor-export-contract.mjs",
	"script/fixtures/blaze-editor-export-source.mjs",
	"script/fixtures/blaze-editor-export-reference.ts",
	"script/fixtures/blaze-editor-export-preflight.ts",
	"script/fixtures/blaze-editor-export-canonical.mjs",
	"script/fixtures/blaze-editor-export-expected.ts",
	"script/fixtures/blaze-editor-export-persistence.mjs",
	"script/fixtures/blaze-editor-export-jobs.mjs",
	"script/fixtures/blaze-editor-export-decode.mjs",
	"script/fixtures/blaze-editor-export-checks.mjs",
	"script/fixtures/blaze-editor-export-provenance.mjs",
	"script/fixtures/blaze-editor-export-browser.mjs",
	"script/fixtures/blaze-editor-export-static.test.ts",
	"script/probe-blaze-editor-export.mjs",
]);
