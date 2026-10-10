import assert from "node:assert/strict";
import test from "node:test";
import { canvasImportMatrix, canvasImportBrowserContract, canvasImportNormalSamples } from "./canvas-import-browser-contract.mjs";
import { matchesCanvasImportRejection, cropCanvasImportRgba, injectCanvasImportReadError, canvasImportRejectAndRecover } from "./canvas-import-browser-support.mjs";
import { makeBubbleSource } from "./bubble-cases.mjs";
import { renderBubbleOracle } from "./bubble-oracle.mjs";
import { compareBubbleRgba, assessBubbleNative } from "./bubble-metrics.mjs";

test("frozen three-caller matrix includes both dimension axes and fallback errors", () => {
	assert.equal(canvasImportMatrix.length, 24); assert.equal(new Set(canvasImportMatrix.map((item) => item.key)).size, 24);
	assert.equal(canvasImportNormalSamples.length, 9);
	for (const caller of ["effects", "masks", "upload"]) assert.equal(canvasImportMatrix.filter((item) => item.caller === caller).length, 8);
	assert(canvasImportBrowserContract.notCovered.includes("wgpu external-copy exceptions"));
});
test("canonical crop takes top-left rectangle row-by-row", () => {
	const source = Uint8Array.from({ length: 3 * 2 * 4 }, (_, index) => index);
	assert.deepEqual(cropCanvasImportRgba(source, 3, 2, 2), Uint8Array.from([...source.slice(0, 8), ...source.slice(12, 20)]));
	assert.throws(() => cropCanvasImportRgba(source, 3, 4, 2));
	assert.throws(() => cropCanvasImportRgba(source, 3, 1, 3));
});
test("exact error matching distinguishes earlier effects preflight from import", () => {
	for (const input of canvasImportMatrix.filter((item) => !item.originalJsError)) {
		const earlier = input.caller === "effects" && (input.id.startsWith("zero-") || input.id.startsWith("device-"));
		const expected = earlier ? `Invalid output dimensions: ${input.width}x${input.height}; each dimension must be in 1..=8192 (device max_texture_dimension_2d)` : input.error;
		assert(matchesCanvasImportRejection(input, expected));
		assert(!matchesCanvasImportRejection(input, `panic: ${expected}`));
		assert(!matchesCanvasImportRejection(input, "already borrowed: BorrowMutError"));
	}
});
test("CPU descriptor model preserves error identity and restores before recovery", async () => {
	const nativeError = new DOMException("native empty rectangle", "IndexSizeError"), prototype = {}, target = Object.create(prototype);
	Object.defineProperty(prototype, "getImageData", { configurable: true, writable: true, value(...args) { if (!args[2] || !args[3]) throw nativeError; return "pixels"; } });
	const descriptor = Object.getOwnPropertyDescriptor(prototype, "getImageData"); let recovered = 0, restarted = 0;
	const result = await canvasImportRejectAndRecover({ prepare: () => injectCanvasImportReadError(prototype, target),
		attempt: () => target.getImageData(0, 0, 1, 1), match: (error, state) => error === nativeError && error === state.originalError,
		recover: () => { assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, "getImageData"), descriptor); assert.equal(target.getImageData(0, 0, 1, 1), "pixels"); recovered++; return { ok: true }; },
		restart: () => { restarted++; return { ok: true }; } });
	assert(result.ok && result.originalJsErrorIdentity && result.prototypeRestored); assert.equal(recovered, 1); assert.equal(restarted, 1);
});
test("CPU fault model cannot accept an unexpected rejection or failed recovery", async () => {
	let restarts = 0;
	const result = await canvasImportRejectAndRecover({ attempt: () => { throw Error("unexpected"); }, match: () => false,
		recover: () => { throw Error("poisoned"); }, restart: () => { restarts++; return { ok: true }; } });
	assert(!result.ok && result.rejected && !result.matched && result.recoveryError); assert.equal(restarts, 1);
});
test("frozen oracle samples discriminate channel-order and alpha corruption", () => {
	let swappedRejected = 0, alphaRejected = 0;
	for (const sample of canvasImportNormalSamples) {
		const expected = renderBubbleOracle(sample, makeBubbleSource(sample.sourceSpec, sample.width, sample.height)).rgba;
		const swapped = expected.slice(), alpha = expected.slice();
		for (let offset = 0; offset < expected.length; offset += 4) {
			swapped[offset] = expected[offset + 2]; swapped[offset + 2] = expected[offset];
			alpha[offset + 3] = expected[offset + 3] > 127 ? 0 : 255;
		}
		if (!assessBubbleNative(compareBubbleRgba(swapped, expected)).ok) swappedRejected++;
		if (!assessBubbleNative(compareBubbleRgba(alpha, expected)).ok) alphaRejected++;
	}
	assert(swappedRejected > 0, "Normal matrix is insensitive to RGBA/BGRA corruption");
	assert.equal(alphaRejected, canvasImportNormalSamples.length);
});
