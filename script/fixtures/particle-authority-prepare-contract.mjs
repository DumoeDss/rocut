import assert from "node:assert/strict";
import { isAbsolute, resolve } from "node:path";
import { parseParticleAuthoritySelection } from "./particle-editor-export-authority.mjs";
import { readParticleAuthoredRecipe } from "./particle-authority-authored-recipe.mjs";
export const PARTICLE_BASELINE_CONTRACT = Object.freeze({
	frameCount: 121,
	fps: Object.freeze({ numerator: 30, denominator: 1 }),
	durationTicks: 484000,
	width: 1920,
	height: 1080,
	opacity: 0.85,
});
export function parseParticleAuthorityPrepareOptions(args) {
	const required = [
		"artifacts-root",
		"creator-root",
		"authority",
		"authority-receipt",
		"bun",
		"wasm-sync",
		"sampler-dir",
		"toolchain",
		"chromium",
		"ffmpeg",
		"ffprobe",
	];
	const options = {};
	for (let i = 0; i < args.length; i += 2) {
		const name = args[i]?.slice(2),
			value = args[i + 1];
		assert.ok(
			args[i]?.startsWith("--") &&
				typeof value === "string" &&
				value.length > 0,
		);
		assert.ok(
			required.includes(name) && !Object.hasOwn(options, name),
			"Unknown or repeated compile option",
		);
		if (name === "authority") options[name] = value;
		else {
			assert.ok(isAbsolute(value));
			options[name] = resolve(value);
		}
	}
	assert.ok(
		required.every((name) => options[name]),
		"Explicit compile-only paths required",
	);
	assert.equal(parseParticleAuthoritySelection(options).kind, "new-authority");
	// Synchronous admission runs before the unchanged launcher creates output.
	options.authoredRecipe = readParticleAuthoredRecipe(
		options["creator-root"],
	).contract;
	return options;
}
export function particleClosureFiles(manifest) {
	const files = manifest.files.map(({ path, bytes, sha256 }) => ({
		path,
		byteLength: bytes,
		sha256,
	}));
	return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
export function assertParticleBaselineState({ state, source, record }) {
	assert.equal(state.revision, 2);
	assert.equal(state.clips.length, 1);
	assert.equal(state.tracks.length, 1);
	const clip = state.clips[0];
	assert.equal(clip.id, "particle-model");
	assert.equal(clip.trackId, "particle-track");
	assert.equal(clip.startTime, 0);
	assert.equal(clip.duration, 484000);
	assert.equal(clip.trimStart, 0);
	assert.equal(clip.trimEnd, 0);
	assert.equal(clip.editing.params.opacity, 0.85);
	assert.deepEqual(clip.editing.programmatic, source);
	assert.equal(source.durationFrames, 121);
	assert.equal(source.width, 320);
	assert.equal(source.height, 240);
	assert.deepEqual(source.frameRate, { numerator: 30, denominator: 1 });
	assert.deepEqual(record.data.settings.canvasSize, {
		width: 1920,
		height: 1080,
	});
	assert.deepEqual(record.data.settings.fps, { numerator: 30, denominator: 1 });
	assert.equal(record.data.metadata.duration, 484000);
	assert.deepEqual(source.build.inputProps.rotationSpeed, [0, 0, 0]);
	for (const [key, value] of Object.entries({
		scatterDistance: 0.75,
		size: 3.25,
		driftAmplitude: 0,
		scatterStartTicks: 0,
		scatterDurationTicks: 120000,
		holdDurationTicks: 120000,
		returnDurationTicks: 120000,
	}))
		assert.equal(source.build.inputProps.motion[key], value);
}
