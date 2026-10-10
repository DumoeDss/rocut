import assert from "node:assert/strict";
import test from "node:test";
import { encodeTunnelDiagnosticChunk } from "./mv-tunnel-native-diagnostic-artifacts.mjs";

test("bounded browser base64 chunks retain exact bytes including block boundaries", () => {
	const bytes = Uint8ClampedArray.from({ length: 20000 }, (_, i) => i % 256);
	const previous = globalThis.__tunnelNativeDiagnostic;
	globalThis.__tunnelNativeDiagnostic = {
		original: { rgba: { scene: bytes } },
	};
	try {
		const request = {
			owner: "original",
			layer: "scene",
			offset: 2,
			count: 17000,
			length: bytes.length,
		};
		assert.deepEqual(
			Buffer.from(encodeTunnelDiagnosticChunk(request), "base64"),
			Buffer.from(bytes.subarray(2, 17002)),
		);
		assert.throws(
			() => encodeTunnelDiagnosticChunk({ ...request, offset: 19999 }),
			/invalid chunk/,
		);
		assert.throws(
			() => encodeTunnelDiagnosticChunk({ ...request, count: 262145 }),
			/invalid chunk/,
		);
		assert.throws(
			() => encodeTunnelDiagnosticChunk({ ...request, layer: "missing" }),
			/retained/,
		);
	} finally {
		globalThis.__tunnelNativeDiagnostic = previous;
	}
});
