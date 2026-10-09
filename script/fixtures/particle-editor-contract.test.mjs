import assert from "node:assert/strict";
import test from "node:test";
import {
	assertParticleSnapshot,
	opacitySnapshot,
	parseParticleEditorOptions,
	particleEditorContract,
} from "./particle-editor-contract.mjs";

const path = process.platform === "win32" ? "C:/tmps/input" : "/tmp/input";
const args = [
	"artifacts-root",
	"source-project",
	"bun",
	"wasm-sync",
	"sampler-dir",
	"toolchain",
	"chromium",
].flatMap((key) => [`--${key}`, path]);
test("default is build-only; explicit run is required for GPU", () => {
	assert.equal(parseParticleEditorOptions(args).mode, "build-only");
	assert.equal(
		parseParticleEditorOptions([...args, "--mode", "run"]).mode,
		"run",
	);
});
test("CLI rejects missing/unknown/repeated/relative options", () => {
	for (const invalid of [
		[],
		[...args, "--mode"],
		[...args, "--unknown", path],
		[...args, "--bun", path],
		[...args, "--mode", "export"],
		args.map((value) => (value === path ? "relative" : value)),
	])
		assert.throws(() => parseParticleEditorOptions(invalid));
});
const initial = {
	revision: 2,
	clips: [
		{
			id: "particle-model",
			trackId: "particle-track",
			duration: 484000,
			editing: {
				params: { opacity: 0.85, scale: 1 },
				programmatic: {
					code: "unchanged",
					inputProps: { motion: { scatterDistance: 0.75 } },
				},
			},
		},
		{ id: "sentinel", editing: { params: { opacity: 1 } } },
	],
	tracks: [
		{ id: "particle-track", hidden: false },
		{ id: "sentinel-track", hidden: true },
	],
};
test("opacity expected state preserves full source and unrelated clips/tracks", () => {
	const changed = opacitySnapshot(initial, "particle-model", 0.55);
	assert.equal(initial.clips[0].editing.params.opacity, 0.85);
	assert.equal(changed.clips[0].editing.params.opacity, 0.55);
	assert.deepEqual(
		changed.clips[0].editing.programmatic,
		initial.clips[0].editing.programmatic,
	);
	assert.deepEqual(changed.clips[1], initial.clips[1]);
	assert.deepEqual(changed.tracks, initial.tracks);
	assert.equal(changed.clips[0].editing.params.scale, 1);
});
test("full snapshot check catches collateral source, track and revision changes", () => {
	assertParticleSnapshot(
		{
			...initial,
			clips: [...initial.clips].reverse(),
			tracks: [...initial.tracks].reverse(),
		},
		initial,
	);
	for (const mutate of [
		(value) => {
			value.clips[0].editing.programmatic.inputProps.motion.scatterDistance = 9;
		},
		(value) => {
			value.tracks[1].hidden = false;
		},
		(value) => {
			value.clips[1].editing.params.opacity = 0.1;
		},
		(value) => {
			value.revision++;
		},
	]) {
		const changed = structuredClone(initial);
		mutate(changed);
		assert.throws(() => assertParticleSnapshot(changed, initial));
	}
});
test("reverse/random samples cover exact baseline and retain edited opacity", () => {
	assert.deepEqual(
		particleEditorContract.reverseFrames,
		[...particleEditorContract.frames].reverse(),
	);
	assert.deepEqual(
		[...particleEditorContract.randomFrames].sort((a, b) => a - b),
		particleEditorContract.frames,
	);
	assert.equal(particleEditorContract.editedOpacity, 0.55);
	assert.deepEqual(
		particleEditorContract.phaseBasis.phases.map((entry) => entry.frame),
		particleEditorContract.frames,
	);
	for (const entry of particleEditorContract.phaseBasis.phases)
		assert.equal(
			entry.ticks,
			entry.frame * particleEditorContract.phaseBasis.ticksPerFrame,
		);
	assert.equal(
		particleEditorContract.frames[1] * 4000,
		particleEditorContract.phaseBasis.motion.scatterDurationTicks / 2,
	);
	assert.equal(
		particleEditorContract.frames[3] * 4000,
		particleEditorContract.phaseBasis.motion.scatterDurationTicks +
			particleEditorContract.phaseBasis.motion.holdDurationTicks +
			particleEditorContract.phaseBasis.motion.returnDurationTicks / 2,
	);
	assert.match(particleEditorContract.hostParameterRevision, /complete source/);
});
