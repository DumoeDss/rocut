// A-only capability probe. This does not implement policy admission or a driver.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

assert.equal(process.release.name, "node");
assert.deepEqual(process.execArgv, []);
assert.throws(
	() => createRequire(import.meta.url).resolve("opencut-wasm/sync"),
	{
		code: "MODULE_NOT_FOUND",
	},
);
const wasm = await import("./particle-sampler-wasm.mjs");
if (typeof wasm.particleTransportPolicyJson !== "function") {
	throw Error(
		"Particle policy capability unavailable: missing particleTransportPolicyJson",
	);
}
const raw = wasm.particleTransportPolicyJson();
assert.equal(typeof raw, "string");
assert.equal(raw, wasm.particleTransportPolicyJson());
const policySha256 = createHash("sha256").update(raw).digest("hex");
// Exact native snapshot accepted in phase A. This is an assertion, never a
// replacement policy or a production fallback for old WASM.
assert.equal(
	policySha256,
	"ac384e674e3f388ae11a674bd72c09786bc53cab2187cc4c3467ff0856635ba7",
);
const policy = JSON.parse(raw);
assert.equal(policy.version, 1);
assert.equal(policy.operation, "particleSurface");
assert.equal(
	policy.hostDefaults.maxFrameRetainedPayloadBytes,
	64 * 1024 * 1024,
);
const request = {
	triangles: [
		{
			position: [
				[0, 0, 0],
				[1, 0, 0],
				[0, 1, 0],
			],
			primitiveIndex: 7,
		},
	],
	count: 2,
	seed: 42,
};
const sampled = JSON.parse(
	wasm.sampleParticleSurfaceJson(JSON.stringify(request)),
);
assert.equal(sampled.ok, true);
assert.equal(sampled.samples.length, 2);
const rejected = JSON.parse(
	wasm.sampleParticleSurfaceJson(JSON.stringify({ ...request, count: 65537 })),
);
assert.equal(rejected.ok, false);
assert.equal(rejected.error.code, "sampleCount");
console.log(
	JSON.stringify({
		runtime: process.version,
		standalone: true,
		kernelSmoke: true,
		policySha256,
		policy,
	}),
);
