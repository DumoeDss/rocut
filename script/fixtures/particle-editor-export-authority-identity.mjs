import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function assertParticleReceiptSamplerIdentity(
	identity,
	layout,
	runtime,
) {
	assert.ok(
		identity && typeof identity === "object" && !Array.isArray(identity),
	);
	assert.deepEqual(
		Object.keys(identity).sort(),
		[
			"version",
			"bindingVersion",
			"layout",
			"runtime",
			"files",
			"executionHash",
			"closureHash",
			"policyHash",
			"publishedPolicyHash",
			"identityHash",
		].sort(),
	);
	assert.equal(identity.version, 1);
	assert.equal(identity.bindingVersion, "inline-wasm-v1");
	assert.equal(identity.layout, layout);
	assert.deepEqual(identity.runtime, runtime);
	assert.ok(Array.isArray(identity.files));
	const roles =
		layout === "source-sync"
			? ["module", "glue", "wasm", "worker-entry"]
			: ["module", "wasm", "worker-entry"];
	assert.deepEqual(
		identity.files.map((file) => file.role),
		roles,
	);
	for (const file of identity.files) {
		assert.deepEqual(
			Object.keys(file).sort(),
			["role", "sha256", "bytes"].sort(),
		);
		assert.match(file.sha256, /^[a-f0-9]{64}$/);
		assert.ok(
			Number.isSafeInteger(file.bytes) &&
				file.bytes > 0 &&
				file.bytes <= 64 * 1024 * 1024,
		);
	}
	for (const name of [
		"executionHash",
		"closureHash",
		"policyHash",
		"publishedPolicyHash",
		"identityHash",
	])
		assert.match(identity[name], /^[a-f0-9]{64}$/);
	assert.equal(hash(JSON.stringify(identity.files)), identity.closureHash);
	const unsigned = {
		version: identity.version,
		bindingVersion: identity.bindingVersion,
		layout: identity.layout,
		runtime: identity.runtime,
		files: identity.files,
		executionHash: identity.executionHash,
		closureHash: identity.closureHash,
		publishedPolicyHash: identity.publishedPolicyHash,
		policyHash: identity.policyHash,
	};
	assert.equal(
		hash(JSON.stringify(unsigned)),
		identity.identityHash,
		"Sampler identity digest mismatch",
	);
	// Schema validation cannot substitute actual worker bootstrap/policy checks.
}
