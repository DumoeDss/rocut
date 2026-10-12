import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { throwParticleEditorFailure } from "./particle-editor-launcher-failure.mjs";

const redact = (value) =>
	String(value).replaceAll("private-token", "[redacted]");

test("a full evidence disk preserves the primary error without leaking its capability", async () => {
	const reported = [];
	const failure = Error("build failed: private-token");
	const evidence = {
		status: "failed",
		primaryFailure: { error: String(failure), stack: failure.stack },
	};
	await assert.rejects(
		throwParticleEditorFailure({
			root: "fixture",
			evidence,
			failure,
			redact,
			report: (line) => reported.push(line),
			persist: async () => {
				throw Object.assign(Error("no space left on device"), {
					code: "ENOSPC",
				});
			},
		}),
		(error) => {
			assert.ok(error instanceof AggregateError);
			assert.match(error.errors[0].message, /build failed: \[redacted\]/);
			assert.match(error.errors[1].message, /no space left/);
			assert.equal(
				JSON.stringify(error.errors.map(String)).includes("private-token"),
				false,
			);
			assert.doesNotMatch(error.message, /retained redacted evidence/);
			return true;
		},
	);
	assert.equal(reported.length, 1);
	assert.equal(reported[0].includes("private-token"), false);
	assert.match(JSON.parse(reported[0]).primaryFailure.error, /build failed/);
});

test("a saved failure receipt still fails the probe and preserves caller evidence", async () => {
	const evidence = { status: "failed" };
	const failure = Error("original failure");
	const calls = [];
	await assert.rejects(
		throwParticleEditorFailure({
			root: "fixture",
			evidence,
			failure,
			redact,
			report() {},
			persist: async (...args) => calls.push(args),
		}),
		/retained redacted evidence/,
	);
	assert.deepEqual(calls, [[join("fixture", "evidence.json"), evidence]]);
});
