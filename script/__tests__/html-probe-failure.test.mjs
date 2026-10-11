import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { saveHtmlProbeFailure } from "../fixtures/html-probe-failure.mjs";
import { snapshotHtmlProbeSources } from "../html-probe-wasm-binding.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const sources = () =>
	snapshotHtmlProbeSources(root, ["script/fixtures/html-probe-failure.mjs"]);
async function ownedDirectory(t) {
	const directory = await mkdtemp(join(tmpdir(), "rocut-html-failure-test-"));
	const physical = await realpath(directory);
	t.after(async () => {
		assert.equal(
			await realpath(directory),
			physical,
			"Test tree redirected before cleanup",
		);
		await rm(directory, { recursive: true });
	});
	return directory;
}

test("failed HTML probe persists partial phase and bytes without success promotion", async (t) => {
	const directory = await ownedDirectory(t);
	const realm = {
		__htmlProbeStarted: true,
		__htmlProbePhase: "project-resources",
		__htmlProbeWasmIdentity: { sha256: "observed" },
		__htmlResult: {
			passed: true,
			checks: ["partial"],
			largePrivatePayload: "not-for-receipt",
		},
	};
	const result = await saveHtmlProbeFailure({
		directory,
		root,
		sourceInputs: sources(),
		resultKey: "__htmlResult",
		error: Error("watchdog at http://127.0.0.1:123/private-nonce/api"),
		browser: "153.test",
		page: {
			evaluate: async (fn, key) =>
				runInNewContext(`(${fn.toString()})(${JSON.stringify(key)})`, realm),
		},
		consolePhases: Array.from({ length: 40 }, (_, index) => `phase-${index}`),
	});
	assert.equal(result.passed, false);
	assert.equal(result.diagnosticOnly, true);
	assert.equal(result.sourceIdentityUnchanged, true);
	assert.equal(result.observation.phase, "project-resources");
	assert.equal(
		result.observation.result.passed,
		true,
		"Partial page result cannot change failed envelope",
	);
	assert.equal(result.consolePhases.length, 30);
	const encoded = await readFile(join(directory, "failure.json"), "utf8");
	assert(
		!encoded.includes("private-nonce") && !encoded.includes("not-for-receipt"),
	);
	assert.equal(JSON.parse(encoded).passed, false);
	await assert.rejects(readFile(join(directory, "evidence.json")), {
		code: "ENOENT",
	});
	await assert.rejects(
		saveHtmlProbeFailure({ directory, root, error: Error("second") }),
		{ code: "EEXIST" },
	);
	assert.equal(
		await readFile(join(directory, "failure.json"), "utf8"),
		encoded,
		"Failure evidence cannot be overwritten",
	);
});

test("snapshot timeout, unavailable page and source drift remain explicit failures", async (t) => {
	const directory = await ownedDirectory(t);
	const before = sources();
	before[0].sha256 = "0".repeat(64);
	const result = await saveHtmlProbeFailure({
		directory,
		root,
		error: Error("original failure"),
		sourceInputs: before,
		page: { evaluate: () => new Promise(() => {}) },
		snapshotTimeoutMs: 10,
	});
	assert.equal(result.failure.message, "original failure");
	assert.match(result.observationError, /snapshot timed out/);
	assert.equal(result.sourceIdentityUnchanged, false);
	assert.equal(result.passed, false);
	const unavailable = await saveHtmlProbeFailure({
		directory: await ownedDirectory(t),
		root,
		error: Error("startup failed"),
		sourceInputs: sources(),
	});
	assert.equal(unavailable.observation, undefined);
	assert.equal(unavailable.passed, false);
});
