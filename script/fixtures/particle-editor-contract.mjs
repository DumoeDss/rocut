import assert from "node:assert/strict";
import { isAbsolute, resolve } from "node:path";
import { parseParticleAuthoritySelection } from "./particle-editor-export-authority.mjs";

export const frozenParticleFiles = {
	"particle-sampler-wasm.mjs":
		"205eb2eff08f10677294d38a90aedceb6b65ce52c7e4ea87760b0cbac8a86c3a",
	"opencut_wasm_bg.wasm":
		"328a2a4313812c356f28d74f27cfeaa10cad3a933e2c4f3de5ded20d8d98c221",
	"particle-sampler-worker-entry.mjs":
		"e9afc00344177d72276eb6c8ba269749e8cf27644758d9c6037a59e5f7e7dd30",
};

export function parseParticleEditorOptions(args) {
	const required = [
		"artifacts-root",
		"source-project",
		"bun",
		"wasm-sync",
		"sampler-dir",
		"toolchain",
		"chromium",
	];
	const options = {};
	for (let index = 0; index < args.length; index += 2) {
		const name = args[index]?.slice(2),
			value = args[index + 1];
		assert.ok(
			args[index]?.startsWith("--") && value,
			"Expected option/value pairs",
		);
		assert.ok(
			[
				...required,
				"mode",
				"authority",
				"authority-receipt",
				"compile-baseline-receipt",
				"ffmpeg",
				"ffprobe",
			].includes(name) && !options[name],
			"Unknown or repeated option",
		);
		if (name === "mode") {
			assert.ok(["build-only", "run"].includes(value));
			options[name] = value;
		} else if (name === "authority") {
			options[name] = value;
		} else {
			assert.ok(isAbsolute(value), `--${name} must be absolute`);
			options[name] = resolve(value);
		}
	}
	assert.ok(
		required.every((name) => options[name]),
		"Missing explicit tool or project path",
	);
	const selection = parseParticleAuthoritySelection(options);
	assert.equal(
		Boolean(options["compile-baseline-receipt"]),
		selection.kind === "new-authority",
		"New lane requires an independent baseline receipt",
	);
	assert.equal(
		Boolean(options.ffmpeg),
		selection.kind === "new-authority",
		"Only new authority uses ffmpeg closure admission",
	);
	assert.equal(
		Boolean(options.ffprobe),
		selection.kind === "new-authority",
		"Only new authority uses ffprobe closure admission",
	);
	// Running a build-only validation can never accidentally open a browser.
	options.mode ??= "build-only";
	return options;
}

export const byId = (items) =>
	[...items].sort((a, b) => a.id.localeCompare(b.id));

export function opacitySnapshot(initial, clipId, opacity) {
	const expected = structuredClone(initial);
	const clip = expected.clips.find((entry) => entry.id === clipId);
	assert.ok(
		clip?.editing?.programmatic,
		"Expected persisted programmatic clip",
	);
	clip.editing.params.opacity = opacity;
	return expected;
}

export function assertParticleSnapshot(
	actual,
	expected,
	{ revision = expected.revision } = {},
) {
	assert.deepEqual(
		byId(actual.clips),
		byId(expected.clips),
		"Complete clips must match",
	);
	assert.deepEqual(
		byId(actual.tracks),
		byId(expected.tracks),
		"Complete tracks must match",
	);
	assert.equal(
		actual.revision,
		revision,
		"Exact persisted revision must match",
	);
}

export const particleEditorContract = {
	version: 1,
	clipId: "particle-model",
	initialProjectSha256:
		"96672b702d66ea305126147ecdb10fa21f773ea12ba8e77af383b41e2216fa36",
	initialRevision: 2,
	selectionFixLineage: {
		preservedPriorUiProject:
			"C:/tmps/rocut-stylized-f6XU4z/particle-editor-59iPgF/project",
		preservedPriorUiRevision: 7,
		preservedFailedHandoff:
			"C:/tmps/rocut-stylized-f6XU4z/particle-editor-handoff-5o6aFF",
		cause:
			"Transform hook rendered the previous committed scene; new build uses current render scene while event handlers keep committed dependencies",
		rerun:
			"A new byte-copy of original C4 runs complete selection/opacity/history/reload acceptance; the prior revision-7 project and failed records are not overwritten",
	},
	initialOpacity: 0.85,
	editedOpacity: 0.55,
	frames: [0, 15, 30, 75, 120],
	reverseFrames: [120, 75, 30, 15, 0],
	randomFrames: [30, 0, 120, 15, 75],
	finalReferenceFrames: [0, 15, 30, 60, 75, 120],
	phaseBasis: {
		evidence:
			"Unchanged C4 archived source.build.inputProps; selected before rerun, never selected from rendered hashes",
		ticksPerFrame: 4000,
		rotationSpeed: [0, 0, 0],
		motion: {
			scatterStartTicks: 0,
			scatterDurationTicks: 120000,
			holdDurationTicks: 120000,
			returnDurationTicks: 120000,
			driftAmplitude: 0,
		},
		phases: [
			{ frame: 0, ticks: 0, phase: "scatter start / restored" },
			{ frame: 15, ticks: 60000, phase: "scatter midpoint" },
			{ frame: 30, ticks: 120000, phase: "scatter end / hold start" },
			{ frame: 75, ticks: 300000, phase: "return midpoint" },
			{ frame: 120, ticks: 480000, phase: "after return / restored" },
		],
		previousHarnessFailure:
			"TZdwog sampled only endpoints/hold: frames 0/90/120 restored and 30/60 fully scattered. Its >=3-hash assertion was unsupported; failure evidence remains retained. The >=3-state requirement is unchanged.",
	},
	history:
		"Real UI edit, attached-session undo/redo/undo/redo; final edited state retained",
	determinism:
		"Exact PNG hash equality at fixed visible canvas bounds; no tolerance relaxation",
	scope:
		"Real production editor UI, complete clips/tracks/revision persistence and visible preview; not export",
	parameterUi:
		"Particle-specific parameter UI is absent; Three build source panel omits ProgrammaticBuildEditor",
	hostParameterRevision:
		"Not exercised here. A parameter change must compile and replace the complete source, not mutate inputProps or masquerade as local history",
};
