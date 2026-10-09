import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
	captureClouds,
	cloudsDeadline,
	saveCloudsJson,
} from "./probe-clouds-artifacts.mjs";
import { cloudsSha256 } from "./probe-clouds-evidence.mjs";

function fixture() {
	const pixels = Buffer.alloc(192 * 128 * 4, 123).toString("base64");
	return {
		width: 192,
		height: 128,
		rate: { numerator: 30, denominator: 1 },
		params: { seed: 1 },
		source: pixels,
		frames: [48000, 52000, 56000, 60000, 64000, 68000].map((ticks) => ({
			ticks,
			rgba: pixels,
			expectedRgba: pixels,
		})),
	};
}
const pageFor = (raw) => ({
	isClosed: () => false,
	evaluate: async (_read, key) =>
		({
			__cloudsResult: { ok: true },
			__cloudsProgress: { results: [] },
			__cloudsFrames: raw,
		})[key] ?? null,
});

test("Clouds raw artifacts preserve byte counts, SHA256 and non-video scope", async () => {
	const directory = await mkdtemp("C:/tmps/clouds-artifacts-test-");
	const report = { captureErrors: [] };
	await captureClouds(pageFor(fixture()), directory, report);
	assert.deepEqual(report.captureErrors, []);
	assert.equal(report.rawFrames.kind, "raw-native-raster-not-an-encoded-video");
	for (const [name, artifact] of Object.entries(report.rawFrames.files)) {
		const bytes = await readFile(join(directory, name));
		assert.equal(
			bytes.length,
			name === "source.rgba" ? 192 * 128 * 4 : 192 * 128 * 4 * 6,
		);
		assert.equal(cloudsSha256(bytes), artifact.sha256);
		assert(bytes.every((value) => value === 123));
	}
	const persisted = JSON.parse(
		await readFile(join(directory, "raw-frames.json"), "utf8"),
	);
	assert.deepEqual(persisted, report.rawFrames);
});

for (const name of ["dimension", "rate", "count", "time", "base64", "length"])
	test(`Clouds raw artifacts reject malformed ${name}`, async () => {
		const directory = await mkdtemp("C:/tmps/clouds-artifacts-invalid-"),
			raw = fixture(),
			report = { captureErrors: [] };
		if (name === "dimension") raw.width = 191;
		if (name === "rate") raw.rate.denominator = 2;
		if (name === "count") raw.frames.pop();
		if (name === "time") raw.frames[3].ticks = 1;
		if (name === "base64") raw.frames[0].rgba = "invalid!";
		if (name === "length") raw.frames[0].expectedRgba = "AA==";
		await captureClouds(pageFor(raw), directory, report);
		assert.equal(report.rawFrames, undefined);
		assert.equal(report.captureErrors.length, 1);
		await assert.rejects(readFile(join(directory, "native.rgba")), {
			code: "ENOENT",
		});
	});

test("Clouds evidence writes are contained and never overwrite saved failures", async () => {
	const directory = await mkdtemp("C:/tmps/clouds-artifacts-write-");
	await assert.rejects(saveCloudsJson(directory, "../outside.json", {}));
	await saveCloudsJson(directory, "failure.json", { ok: false });
	await assert.rejects(
		saveCloudsJson(directory, "failure.json", { ok: true }),
		{ code: "EEXIST" },
	);
	assert.deepEqual(
		JSON.parse(await readFile(join(directory, "failure.json"), "utf8")),
		{ ok: false },
	);
});

test("Clouds capture deadlines reject stalled browser reads", async () => {
	await assert.rejects(
		cloudsDeadline(new Promise(() => {}), 5, "CPU-only stalled capture"),
		/timed out/,
	);
	assert.equal(
		await cloudsDeadline(Promise.resolve(7), 100, "immediate capture"),
		7,
	);
});
