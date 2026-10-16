import assert from "node:assert/strict";

/** Exercise the shipped JSON ABI, without a renderer, files or mocked exports. */
export function runNativeExportProbe(wasm) {
	assert.equal(
		typeof wasm.resolveNativeExportJobJson,
		"function",
		"resolveNativeExportJobJson must be exported",
	);
	const resolve = (input) =>
		JSON.parse(wasm.resolveNativeExportJobJson(JSON.stringify(input)));
	const source = {
		projectId: "wasm-init-native-export",
		revision: 7,
		data: {
			scenes: [{ id: "scene", clips: [] }],
			currentSceneId: "scene",
			settings: {
				width: 1920,
				height: 1080,
				fps: { numerator: 30, denominator: 1 },
			},
			version: 2,
		},
	};
	const admitted = resolve({
		action: "admit",
		request: {
			schemaVersion: 1,
			projectId: source.projectId,
			expectedRevision: source.revision,
			idempotencyKey: "wasm-init-native-export",
			options: { format: "webm", quality: "very_high" },
		},
		source,
		jobId: "wasm-init-job",
		now: 10,
	});
	assert.equal(admitted.status, "reserved");
	assert.equal(admitted.record.phase, "reserved");
	assert.match(admitted.record.sourceDigest, /^[a-f0-9]{64}$/);
	const verified = resolve({
		action: "verify",
		record: admitted.record,
		source,
	});
	assert.equal(verified.status, "verified");
	assert.deepEqual(verified.record, admitted.record);
	const invalid = JSON.parse(wasm.resolveNativeExportJobJson("{"));
	assert.equal(invalid.status, "rejected");
	assert.equal(invalid.error.code, "invalid-schema");
	return [
		"native-export-admission",
		"native-export-verification",
		"native-export-invalid-json",
	];
}
