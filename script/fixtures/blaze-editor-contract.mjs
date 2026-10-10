export const blazeEditorContract = Object.freeze({
	width: 192,
	height: 128,
	frameRate: 30,
	ticksPerFrame: 4000,
	staticId: "blaze-static",
	animatedId: "blaze-animated",
	disabledId: "blaze-disabled",
	effectId: "template-blaze",
	quietMs: 1600,
	finalTicks: 24000,
	keyframeUiCreationTested: false,
	parameterControlsTested: "Actual Effects textboxes committed with Enter",
	historyTested:
		"Attached editor session history through supported editor-task API",
	renderingPixelCorrectnessTested: false,
	disabledPixelsTested: false,
	videoExportTested: false,
	installedPluginTested: false,
	electronTested: false,
});

export const blazeEditorChanges = Object.freeze(
	[
		{ key: "amount", label: "Amount", value: 0.9 },
		{ key: "flameOpacity", label: "Flame opacity", value: 0.55 },
		{ key: "sparkOpacity", label: "Spark opacity", value: 0.65 },
		{ key: "smokeOpacity", label: "Smoke opacity", value: 0.45 },
		{
			key: "refraction",
			label: "Heat refraction (short-side fraction)",
			value: 0.05,
		},
		{
			key: "height",
			label: "Emission height (short-side fraction)",
			value: 1.1,
		},
		{ key: "scale", label: "Noise scale (short-side fraction)", value: 0.2 },
		{ key: "speed", label: "Rise cycles per second", value: 0.75 },
		{ key: "wind", label: "Rise drift (short-side fraction)", value: 0.25 },
		{ key: "seed", label: "Seed", value: 27182 },
	].map((change) => Object.freeze(change)),
);

export const blazeEditorSeekTicks = Object.freeze([
	124000, 132000, 144000, 132000, 124000,
]);

export const blazeEditorFiles = Object.freeze([
	"script/fixtures/blaze-editor-contract.mjs",
	"script/fixtures/blaze-editor-control.mjs",
	"script/fixtures/blaze-editor-persistence.mjs",
	"script/fixtures/blaze-editor-inputs.mjs",
	"script/fixtures/blaze-editor-checks.mjs",
	"script/fixtures/blaze-editor-provenance.mjs",
	"script/fixtures/blaze-editor-lifecycle.mjs",
	"script/fixtures/blaze-editor-host.ts",
	"script/fixtures/blaze-editor-static.test.ts",
	"script/fixtures/blaze-editor-persistence.test.mjs",
	"script/probe-blaze-editor.mjs",
]);
