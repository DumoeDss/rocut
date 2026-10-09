import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	captureCloudsPipeline,
	saveCloudsPipeline,
} from "./probe-clouds-pipeline-artifacts.mjs";
import {
	requireCloudsPipelineSuccess,
	validateCloudsMedia,
} from "./probe-clouds-contract.mjs";
import { cloudsSha256 } from "./probe-clouds-evidence.mjs";
import {
	cloudsTestEvidence,
	cloudsTestMedia,
	cloudsTestMetadata,
} from "./probe-clouds-test-support.mjs";

test("Clouds media contract rejects shifted fixtures, changed thresholds, and malformed parameters", () => {
	validateCloudsMedia(cloudsTestMetadata());
	for (const mutate of [
		(value) => {
			value.width = 384;
		},
		(value) => {
			value.frames = 5;
		},
		(value) => {
			value.thresholds.exportActiveRgb = 16;
		},
		(value) => {
			value.localTicks[0]++;
		},
		(value) => {
			value.timelineTicks[0]++;
		},
		(value) => {
			delete value.paramsPerFrame[0].seed;
		},
		(value) => {
			value.paramsPerFrame[0].seed = 0.5;
		},
		(value) => {
			value.paramsPerFrame[0].windX = Infinity;
		},
	]) {
		const value = cloudsTestMetadata();
		mutate(value);
		assert.throws(() => validateCloudsMedia(value));
	}
});
test("Clouds formal admission requires literal success and completed cleanup", () => {
	requireCloudsPipelineSuccess(cloudsTestEvidence());
	for (const mutate of [
		(value) => {
			value.ok = false;
		},
		(value) => {
			value.ok = "true";
		},
		(value) => {
			value.mode = "raster";
		},
		(value) => {
			value.checks.ok = false;
		},
		(value) => {
			value.checks.nativeHandlesGone = false;
		},
		(value) => {
			value.browserClosed = false;
		},
		(value) => {
			value.checks.cleanupErrors.push("leak");
		},
		(value) => {
			value.postRunVerification.ok = false;
		},
		(value) => {
			value.captureErrors.push("capture failed");
		},
	]) {
		const value = cloudsTestEvidence();
		mutate(value);
		assert.throws(() => requireCloudsPipelineSuccess(value));
	}
});
test("Clouds pipeline failure still preserves actual published media and diagnostics", async () => {
	const directory = await mkdtemp("C:/tmps/clouds-pipeline-capture-test-"),
		media = cloudsTestMedia();
	const report = { captureErrors: [] };
	const globals = {
		__cloudsPipeline: {
			ok: false,
			failure: "synthetic browser decoder failure",
		},
		__cloudsPipelineMedia: media,
		__cloudsPipelineDiagnostics: { stage: "decode failure", metrics: [] },
	};
	const page = {
		isClosed: () => false,
		evaluate: async (_read, key) => globals[key] ?? null,
	};
	await captureCloudsPipeline(page, directory, report);
	assert.deepEqual(report.captureErrors, []);
	assert.equal(report.checks.ok, false);
	assert.equal(report.pipelineMedia.independentDecodeVerified, false);
	for (const [key, filename] of [
		["video", "production.webm"],
		["expected", "expected.rgba"],
		["baseline", "baseline.rgba"],
	]) {
		const bytes = await readFile(join(directory, filename));
		assert.equal(cloudsSha256(bytes), report.pipelineMedia.files[key].sha256);
		assert.equal(bytes.toString("base64"), media[key]);
	}
	assert.equal(
		JSON.parse(await readFile(join(directory, "diagnostics.json"), "utf8"))
			.stage,
		"decode failure",
	);
	await assert.rejects(saveCloudsPipeline(directory, media), {
		code: "EEXIST",
	});
});
test("Clouds rejects malformed base64 and transparent codec references", async () => {
	for (const kind of ["base64", "alpha"]) {
		const directory = await mkdtemp("C:/tmps/clouds-pipeline-invalid-test-"),
			media = cloudsTestMedia();
		if (kind === "base64") media.video = "not base64!";
		else {
			const pixels = Buffer.from(media.expected, "base64");
			pixels[3] = 0;
			media.expected = pixels.toString("base64");
		}
		await assert.rejects(saveCloudsPipeline(directory, media));
		await assert.rejects(readFile(join(directory, "media.json")), {
			code: "ENOENT",
		});
	}
});
test("Formal Clouds decoder writes rejection before touching absent FFmpeg binaries", async () => {
	const directory = await mkdtemp("C:/tmps/clouds-formal-reject-test-");
	await writeFile(
		join(directory, "evidence.json"),
		JSON.stringify({ ...cloudsTestEvidence(), ok: false }),
		{ flag: "wx" },
	);
	const result = spawnSync(
		process.execPath,
		[
			fileURLToPath(new URL("./probe-clouds-decode.mjs", import.meta.url)),
			directory,
			directory,
		],
		{ windowsHide: true, encoding: "utf8", timeout: 10000 },
	);
	assert.equal(result.status, 1);
	const report = JSON.parse(
		await readFile(join(directory, "independent-decode.json"), "utf8"),
	);
	assert.equal(report.ok, false);
	assert.equal(report.accepted, false);
	assert.match(report.failure, /Requires successful Clouds pipeline evidence/);
	assert.deepEqual(report.postRunFailures, []);
	assert.equal(Object.keys(report.inputHashes).length, 1);
});
