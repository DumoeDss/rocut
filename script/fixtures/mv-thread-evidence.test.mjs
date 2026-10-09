import assert from "node:assert/strict";
import test from "node:test";
import { assertThreadEvidenceStable } from "./mv-thread-evidence.mjs";

test("Thread identity comparison accepts an unchanged independent snapshot", () => {
	const before = {
		directory: "private",
		files: { "a.wasm": { byteLength: 2, sha256: "a".repeat(64) } },
	};
	assert.doesNotThrow(() =>
		assertThreadEvidenceStable(before, structuredClone(before), "artifact"),
	);
});
test("Thread artifact hash, size, glue and served inventory mutations cannot retain acceptance", () => {
	const before = {
		files: {
			"a.wasm": { byteLength: 2, sha256: "a".repeat(64) },
			"glue.js": { byteLength: 3, sha256: "b".repeat(64) },
		},
	};
	for (const mutate of [
		(v) => {
			v.files["a.wasm"].sha256 = "c".repeat(64);
		},
		(v) => {
			v.files["a.wasm"].byteLength++;
		},
		(v) => {
			delete v.files["glue.js"];
		},
		(v) => {
			v.files["extra.js"] = { byteLength: 0, sha256: "d".repeat(64) };
		},
	]) {
		const after = structuredClone(before);
		mutate(after);
		assert.throws(
			() => assertThreadEvidenceStable(before, after, "artifact"),
			/changed while Thread acceptance/,
		);
	}
});
test("Thread original script digest and script order are both bound", () => {
	const before = [
		{ id: "util", sha256: "a".repeat(64) },
		{ id: "dark", sha256: "b".repeat(64) },
	];
	assert.throws(() =>
		assertThreadEvidenceStable(before, [...before].reverse(), "reference"),
	);
	const after = structuredClone(before);
	after[1].sha256 = "c".repeat(64);
	assert.throws(() => assertThreadEvidenceStable(before, after, "reference"));
});
