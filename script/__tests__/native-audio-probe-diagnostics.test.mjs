import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	nativeAudioHttpObservation,
	nativeAudioResultSummary,
	saveNativeAudioProbeFailure,
} from "../fixtures/native-audio-probe-diagnostics.mjs";

test("summary omits raw AV payloads and arbitrary authored properties", () => {
	const result = nativeAudioResultSummary({
		bytes: Array(100000).fill(255),
		pcm: [0, 1],
		frames: 6,
		worst: 1e-9,
		secret: "not-diagnostic",
	});
	assert.deepEqual(result, {
		available: true,
		frames: 6,
		worst: 1e-9,
		bytesLength: 100000,
		pcmLength: 2,
	});
	assert(JSON.stringify(result).length < 160);
});
test("absent result is explicit and error strings are bounded", () => {
	assert.deepEqual(nativeAudioResultSummary(undefined), { available: false });
	assert.equal(
		nativeAudioResultSummary({ error: "x".repeat(5000) }).error.length,
		2000,
	);
});
test("HTTP observation keeps status/path/type without credentials or query", () => {
	assert.deepEqual(
		nativeAudioHttpObservation({
			url: () =>
				"http://user:secret@127.0.0.1:55/missing.png?token=hidden#fragment",
			status: () => 404,
			request: () => ({ resourceType: () => "image" }),
		}),
		{
			status: 404,
			url: "http://127.0.0.1:55/missing.png",
			resourceType: "image",
		},
	);
});
test("failure without an output directory remains a failed diagnostic", async () => {
	const report = await saveNativeAudioProbeFailure({
		failure: "404",
		errors: ["resource failed"],
		httpFailures: [],
		result: { frames: 6 },
	});
	assert.equal(report.passed, false);
	assert.equal(report.acceptanceEvidence, false);
	assert.deepEqual(report.artifacts, []);
});
test("failed AV bytes survive with independent hashes; no success receipt", async () => {
	const directory = await mkdtemp(join(tmpdir(), "rocut-audio-failure-unit-"));
	try {
		const report = await saveNativeAudioProbeFailure({
			directory,
			failure: "console gate",
			errors: ["404"],
			httpFailures: [],
			result: { bytes: [26, 69, 223, 163], pcm: [0, 0, 128, 63], frames: 6 },
		});
		assert.equal(report.passed, false);
		assert.equal(report.artifacts.length, 2);
		assert.equal(report.artifacts[0].sha256.length, 64);
		assert.deepEqual(
			[...(await readFile(join(directory, "failed-export.webm")))],
			[26, 69, 223, 163],
		);
		const persisted = JSON.parse(
			await readFile(join(directory, "failure.json"), "utf8"),
		);
		assert.deepEqual(persisted, report);
		assert.equal(persisted.result.bytes, undefined);
		assert.deepEqual((await readdir(directory)).sort(), [
			"failed-export.webm",
			"failed-reference.f32le",
			"failure.json",
		]);
		await assert.rejects(
			saveNativeAudioProbeFailure({
				directory,
				failure: "must not overwrite",
				result: { bytes: [0] },
			}),
			{ code: "EEXIST" },
		);
	} finally {
		for (const name of [
			"failed-export.webm",
			"failed-reference.f32le",
			"failure.json",
		])
			await unlink(join(directory, name));
		await rmdir(directory);
	}
});
test("invalid byte arrays are not silently truncated into evidence", async () => {
	const directory = await mkdtemp(join(tmpdir(), "rocut-audio-invalid-unit-"));
	try {
		const report = await saveNativeAudioProbeFailure({
			directory,
			failure: "bad payload",
			result: { bytes: [256], pcm: [1.2] },
		});
		assert.deepEqual(report.artifacts, []);
		assert.deepEqual(await readdir(directory), ["failure.json"]);
	} finally {
		await unlink(join(directory, "failure.json"));
		await rmdir(directory);
	}
});
