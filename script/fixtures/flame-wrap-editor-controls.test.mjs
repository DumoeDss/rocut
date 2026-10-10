import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { capture } from "./flame-wrap-editor-controls.mjs";

const observed = (rgba) => ({
	width: 1,
	height: 1,
	rgbaBase64: Buffer.from(rgba).toString("base64"),
	visibleAlphaPixels: Number(rgba[3] > 0),
});
const empty = observed([0, 0, 0, 0]);
const visible = observed([40, 80, 120, 255]);
const artifactsFor = async () => ({
	root: await mkdtemp("C:/tmps/flame-wrap-capture-poll-"),
	width: 1,
	height: 1,
	clipId: "cpu-observation-boundary",
});

// Synthetic page.evaluate observations test only the Node capture deadline and
// stability policy. They are not browser, DOM, renderer or GPU acceptance.
test("temporary empty observations recover only after nonempty stable samples", async () => {
	const artifacts = await artifactsFor();
	let calls = 0;
	const page = { evaluate: async () => (++calls <= 2 ? empty : visible) };
	const result = await capture(page, artifacts, 20000, 1, "temporary-empty", {
		timeoutMs: 2500,
	});
	assert.equal(result.emptyFrameSamples, 2);
	assert(result.stableConsecutiveSamples >= 4);
	assert(result.totalSamples >= 6);
	assert.equal(result.rgbaBase64, visible.rgbaBase64);
	assert.deepEqual(
		await readFile(
			join(artifacts.root, "flame-wrap-editor-temporary-empty.rgba"),
		),
		Buffer.from([40, 80, 120, 255]),
	);
});
test("permanently empty observations fail at the bounded deadline with counts", async () => {
	const artifacts = await artifactsFor(),
		started = Date.now();
	await assert.rejects(
		capture(
			{ evaluate: async () => empty },
			artifacts,
			20000,
			1,
			"permanent-empty",
			{ timeoutMs: 350 },
		),
		(error) => {
			assert.match(error.message, /deadline exceeded/);
			assert(error.captureObservation.emptyFrameSamples >= 3);
			assert.equal(
				error.captureObservation.emptyFrameSamples,
				error.captureObservation.totalSamples,
			);
			return true;
		},
	);
	assert(Date.now() - started < 2000);
});
test("nonempty unstable observations remain rejected rather than using the last frame", async () => {
	const artifacts = await artifactsFor();
	let calls = 0;
	await assert.rejects(
		capture(
			{ evaluate: async () => observed([++calls % 2 ? 40 : 41, 80, 120, 255]) },
			artifacts,
			20000,
			1,
			"unstable",
			{ timeoutMs: 1200 },
		),
		/deadline exceeded/,
	);
});
test("wrong project geometry fails immediately even when pixels are nonempty", async () => {
	const artifacts = await artifactsFor();
	await assert.rejects(
		capture(
			{ evaluate: async () => ({ ...visible, width: 2 }) },
			artifacts,
			20000,
			1,
			"wrong-geometry",
			{ timeoutMs: 350 },
		),
		/2 !== 1/,
	);
});
