import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { captureBlaze } from "./probe-blaze-artifacts.mjs";
import {
	blazeRawReference,
	blazeRawThresholds,
	validateBlazeRaw,
} from "./probe-blaze-contract.mjs";
import { blazeSha256 } from "./probe-blaze-evidence.mjs";

const params = {
	amount: 0.8,
	flameOpacity: 0.75,
	sparkOpacity: 1,
	smokeOpacity: 0.5,
	refraction: 0.065,
	height: 0.85,
	scale: 0.11,
	speed: 0.5,
	wind: 0.37,
	seed: 31415,
};
const makeRaw = () => ({
	version: 1,
	reference: blazeRawReference,
	thresholds: { ...blazeRawThresholds },
	sources: [
		{
			id: "192x128-holes",
			width: 192,
			height: 128,
			kind: "holes",
			pattern: "gradient",
			rgba: Buffer.alloc(192 * 128 * 4, 17).toString("base64"),
		},
	],
	frames: [
		{
			id: "partial case",
			sourceId: "192x128-holes",
			params: { ...params },
			ticks: 48000,
			rate: { numerator: 30, denominator: 1 },
			enabled: true,
			rgba: Buffer.alloc(192 * 128 * 4, 23).toString("base64"),
			expectedRgba: Buffer.alloc(192 * 128 * 4, 31).toString("base64"),
		},
	],
	negatives: [
		{
			name: "partial negative",
			sourceId: "192x128-holes",
			params: { ...params },
			ticks: 48000,
			rate: { numerator: 30, denominator: 1 },
			enabled: true,
			mutantRgba: Buffer.alloc(192 * 128 * 4, 101).toString("base64"),
			referenceRgba: Buffer.alloc(192 * 128 * 4, 31).toString("base64"),
		},
	],
});

test("Blaze RAW artifact gates reject changed thresholds, duplicate IDs and incomplete success", () => {
	const raw = makeRaw();
	assert.doesNotThrow(() => validateBlazeRaw(raw, false));
	assert.throws(() => validateBlazeRaw(raw));
	raw.thresholds.premultipliedRgbMaximum = 5;
	assert.throws(() => validateBlazeRaw(raw, false));
	raw.thresholds.premultipliedRgbMaximum = 4;
	raw.frames.push(raw.frames[0]);
	assert.throws(() => validateBlazeRaw(raw, false));
});

test("failed or partial runs retain source, actual, reference and negative bytes with hashes", async () => {
	const raw = makeRaw(),
		directory = await mkdtemp("C:/tmps/blaze-artifacts-test-");
	const globals = {
		__blazeFrames: raw,
		__blazeResult: { ok: false, failure: "synthetic failure" },
		__blazeProgress: { currentCase: "partial case" },
	};
	const page = {
		isClosed: () => false,
		evaluate: async (fn, payload) =>
			JSON.parse(
				JSON.stringify(
					runInNewContext(`(${fn.toString()})(payload)`, {
						...globals,
						payload,
					}),
				),
			),
	};
	const report = { captureErrors: [] };
	await captureBlaze(page, directory, report);
	assert.equal(report.rawComplete, undefined);
	assert.equal(report.captureErrors.length, 1);
	const saved = JSON.parse(
		await readFile(join(directory, "raw-frames.json"), "utf8"),
	);
	assert.equal(saved.version, 1);
	for (const [entry, expected] of [
		[saved.sources[0].file, 17],
		[saved.frames[0].actual, 23],
		[saved.frames[0].expected, 31],
		[saved.negatives[0].mutant, 101],
		[saved.negatives[0].reference, 31],
	]) {
		const bytes = await readFile(join(directory, entry.filename));
		assert.equal(bytes.length, 192 * 128 * 4);
		assert(bytes.every((value) => value === expected));
		assert.equal(entry.sha256, blazeSha256(bytes));
	}
});

test("invalid RGBA is fail-closed and cannot claim capture completion", async () => {
	const raw = makeRaw();
	raw.frames[0].rgba = "AA==";
	const directory = await mkdtemp("C:/tmps/blaze-artifacts-invalid-");
	const globals = { __blazeFrames: raw };
	const page = {
		isClosed: () => false,
		evaluate: async (fn, payload) =>
			JSON.parse(
				JSON.stringify(
					runInNewContext(`(${fn.toString()})(payload)`, {
						...globals,
						payload,
					}),
				),
			),
	};
	const report = { captureErrors: [] };
	await captureBlaze(page, directory, report);
	assert.equal(report.rawComplete, undefined);
	assert.equal(report.captureErrors.length, 1);
});
