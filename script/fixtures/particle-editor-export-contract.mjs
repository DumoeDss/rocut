import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
	hash,
	inside,
	plain,
	readJson,
	treeManifest,
} from "../particle-c4-export-support.mjs";
import { PROJECT_EXPORT_LIMITS } from "./particle-project-export-pixels.mjs";

// Frozen before any full-duration video is rendered. UI screenshots, never a
// separately synthesized reference scene, define the comparison mask and pixels.
export const EDITOR_EXPORT_CONTRACT = Object.freeze({
	version: 1,
	clipId: "particle-model",
	opacity: 0.55,
	width: 1920,
	height: 1080,
	frameCount: 121,
	frameRate: { numerator: 30, denominator: 1 },
	ticksPerFrame: 4000,
	durationTicks: 484000,
	durationSeconds: 121 / 30,
	frames: [0, 15, 30, 60, 75, 120],
	limits: PROJECT_EXPORT_LIMITS,
	geometry: {
		method:
			"Downsample independently decoded video to each actual visible UI PNG's measured dimensions using FFmpeg scale=width:height:flags=bilinear; never upscale UI, infer crop, search shifts, or fit geometry to video pixels",
		maximumScreenshotRoundingPixels: 2,
		maximumAspectErrorPixels: 2,
		selection:
			"Empty via ordinary UI; no visible transform handles or other overlays",
		backing:
			"Optional read-only actual UI canvas PNG; not a substitute for the mandatory visible screenshot",
	},
	coverage:
		"All 121 frames independently decoded and timestamp checked; six predeclared frame indices compared against actual final-state UI screenshots. No claim of pixel comparison for the other 115 frames.",
	thresholdRelaxationAllowed: false,
});

export function pngDimensions(bytes) {
	assert.ok(bytes.length >= 24);
	assert.deepEqual(
		[...bytes.subarray(0, 8)],
		[137, 80, 78, 71, 13, 10, 26, 10],
	);
	assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function assertUiGeometry(sample) {
	const { geometry, visible, frame, ticks } = sample;
	assert.ok(EDITOR_EXPORT_CONTRACT.frames.includes(frame));
	assert.equal(ticks, frame * EDITOR_EXPORT_CONTRACT.ticksPerFrame);
	assert.deepEqual(geometry.backing, { width: 1920, height: 1080 });
	assert.deepEqual(geometry.selection, []);
	assert.equal(geometry.css.transform, "none");
	assert.equal(Number(geometry.css.opacity), 1);
	assert.ok(["fill", "contain"].includes(geometry.css.objectFit));
	assert.ok(
		Number.isFinite(geometry.devicePixelRatio) && geometry.devicePixelRatio > 0,
	);
	for (const key of ["width", "height"])
		assert.ok(
			Number.isInteger(geometry.viewport[key]) && geometry.viewport[key] > 0,
		);
	for (const key of ["x", "y", "width", "height"])
		assert.ok(Number.isFinite(geometry.bounds[key]));
	assert.ok(geometry.bounds.x >= 0 && geometry.bounds.y >= 0);
	assert.ok(geometry.bounds.width > 0 && geometry.bounds.height > 0);
	assert.ok(
		geometry.bounds.x + geometry.bounds.width <= geometry.viewport.width + 1,
	);
	assert.ok(
		geometry.bounds.y + geometry.bounds.height <= geometry.viewport.height + 1,
	);
	for (const [key, maximum] of [
		["width", 1920],
		["height", 1080],
	]) {
		assert.ok(
			Number.isInteger(visible[key]) &&
				visible[key] > 0 &&
				visible[key] <= maximum,
			"Only actual downsampled UI geometry is admitted",
		);
		assert.ok(
			Math.abs(
				visible[key] - geometry.bounds[key] * geometry.devicePixelRatio,
			) <= 2,
			"Screenshot pixels must agree with measured UI geometry, not export-fitted values",
		);
	}
	assert.ok(
		Math.abs(visible.width - (visible.height * 16) / 9) <= 2,
		"Uncropped 16:9 canvas required",
	);
	return { width: visible.width, height: visible.height };
}

async function checkedRelativeFile(root, entry) {
	assert.ok(entry && typeof entry.file === "string" && !isAbsolute(entry.file));
	const path = resolve(root, entry.file);
	assert.ok(
		inside(root, path),
		"UI reference must remain inside its handoff directory",
	);
	await plain(path, false);
	const bytes = await readFile(path);
	assert.equal(bytes.length, entry.bytes);
	assert.equal(hash(bytes), entry.sha256);
	return { path, bytes };
}

export async function loadEditorExportHandoff(path) {
	assert.ok(isAbsolute(path) && inside("C:/tmps", path));
	await plain(path, false);
	const root = dirname(path),
		handoff = await readJson(path);
	assert.equal(handoff.exactUiSavedProject, true);
	assert.equal(handoff.hostReopened, true);
	assert.equal(handoff.opacity, EDITOR_EXPORT_CONTRACT.opacity);
	assert.ok(Number.isSafeInteger(handoff.revision) && handoff.revision > 2);
	assert.equal(handoff.final.revision, handoff.revision);
	// A read-only UI continuation keeps the original saved project in its earlier
	// artifact root; only PNG/state sidecars belong to the new handoff directory.
	assert.ok(isAbsolute(handoff.project) && inside("C:/tmps", handoff.project));
	await plain(handoff.project, true);
	const projectManifest = await treeManifest(handoff.project);
	assert.deepEqual(
		projectManifest.files,
		handoff.files,
		"Consume byte-exact final UI saved project and attachments",
	);
	const wrapper = await readJson(join(handoff.project, "project.json"));
	assert.equal(wrapper.wrapperVersion, 1);
	assert.equal(wrapper.record.schemaVersion, 32);
	assert.deepEqual(wrapper.record.data.metadata, handoff.final.metadata);
	assert.deepEqual(wrapper.record.data.settings, handoff.final.settings);
	assert.equal(wrapper.record.data.metadata.duration, 484000);
	assert.deepEqual(wrapper.record.data.settings.canvasSize, {
		width: 1920,
		height: 1080,
	});
	assert.deepEqual(
		wrapper.record.data.settings.fps,
		EDITOR_EXPORT_CONTRACT.frameRate,
	);
	assert.ok(!isAbsolute(handoff.final.fullStateFile));
	const statePath = resolve(root, handoff.final.fullStateFile);
	assert.ok(inside(root, statePath));
	await plain(statePath, false);
	const stateBytes = await readFile(statePath);
	assert.equal(hash(stateBytes), handoff.final.fullStateSha256);
	const state = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(stateBytes),
	);
	assert.equal(state.revision, handoff.revision);
	assert.equal(state.clips.length, 1);
	const clip = state.clips.find(
		(value) => value.id === EDITOR_EXPORT_CONTRACT.clipId,
	);
	assert.ok(clip?.editing?.programmatic);
	assert.equal(clip.editing.params.opacity, 0.55);
	assert.equal(clip.editing.programmatic.durationFrames, 121);
	assert.equal(
		hash(JSON.stringify(clip.editing.programmatic)),
		handoff.final.sourceSha256,
	);
	const references = handoff.previewReferences;
	assert.equal(references.version, 1);
	assert.equal(references.selectionCleared, true);
	assert.deepEqual(references.frames, EDITOR_EXPORT_CONTRACT.frames);
	assert.deepEqual(
		references.samples.map((sample) => sample.frame),
		EDITOR_EXPORT_CONTRACT.frames,
	);
	const files = [];
	for (const sample of references.samples) {
		assert.equal(sample.revision, handoff.revision);
		assertUiGeometry(sample);
		assert.deepEqual(
			sample.geometry,
			references.samples[0].geometry,
			"Fixed UI geometry and selection across all selected frames",
		);
		const visible = await checkedRelativeFile(root, sample.visible);
		assert.deepEqual(pngDimensions(visible.bytes), {
			width: sample.visible.width,
			height: sample.visible.height,
		});
		files.push({
			kind: "visible",
			frame: sample.frame,
			path: visible.path,
			sha256: sample.visible.sha256,
		});
		assert.ok(["captured", "unavailable"].includes(sample.backing.status));
		if (sample.backing.status === "captured") {
			const backing = await checkedRelativeFile(root, sample.backing);
			assert.deepEqual(pngDimensions(backing.bytes), {
				width: 1920,
				height: 1080,
			});
			files.push({
				kind: "backing",
				frame: sample.frame,
				path: backing.path,
				sha256: sample.backing.sha256,
			});
		}
	}
	return {
		handoff,
		wrapper,
		state,
		projectManifest,
		files,
		handoffSha256: hash(await readFile(path)),
		stateSha256: hash(stateBytes),
	};
}
