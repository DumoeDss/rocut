import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createBubbleBridge, bubbleEncode, bubbleSameBytes, bubbleRejectAndRecover } from "./bubble-browser-support.mjs";

function fixture() {
	const source = { width: 2, height: 1, bytes: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8) };
	const presented = { ...source, bytes: Uint8Array.of(11, 12, 13, 14, 15, 16, 17, 18) };
	const calls = [];
	const wasm = {
		resolveStylizedEffectJson(input) { calls.push(["resolve", JSON.parse(input)]); return JSON.stringify({ passes: [{ shader: "bubble", uniforms: { amount: 1, centers: [0.5, 0.6] } }] }); },
		applyEffectPasses(options) { calls.push(["apply", options]); return presented; },
		async applyEffectPassesReadback(options) { calls.push(["readback", options]); return { rgba: new Uint8Array(source.bytes), width: 2, height: 1, canvas: presented, format: "bgra8unorm", backend: "webgl" }; },
	};
	const input = { source, params: { amount: 1 }, ticks: 4000, rate: { numerator: 30, denominator: 1 }, enabled: true, diagnostic: false, backend: "webgl" };
	return { source, presented, calls, wasm, input, bridge: createBubbleBridge(wasm, (canvas) => new Uint8Array(canvas.bytes)) };
}

test("Bubble bridge invokes real resolver payload and ordinary apply path without pretending native capture", async () => {
	const value = fixture(), output = await value.bridge.render(value.input);
	assert.deepEqual(value.calls.map(([name]) => name), ["resolve", "apply"]);
	assert.deepEqual(value.calls[0][1], { effectType: "bubble", params: { amount: 1 }, localTime: 4000, frameRate: value.input.rate });
	assert.deepEqual(value.calls[1][1].passes[0].uniforms, [{ name: "amount", value: [1] }, { name: "centers", value: [0.5, 0.6] }]);
	assert.equal(output.path, "applyEffectPasses");
	assert.equal(output.native, null);
	assert.deepEqual(output.canvas, value.presented.bytes);
});
test("Bubble diagnostic captures native and Canvas from exactly one invocation", async () => {
	const value = fixture(), output = await value.bridge.render({ ...value.input, diagnostic: true });
	assert.deepEqual(value.calls.map(([name]) => name), ["resolve", "readback"]);
	assert.deepEqual(output.native, value.source.bytes);
	assert.deepEqual(output.canvas, value.presented.bytes);
	assert.equal(output.byteOrder, "RGBA");
	assert.equal(output.format, "bgra8unorm");
	assert.equal(bubbleSameBytes(output.native, output.canvas), false);
});
test("Bubble fixture-disabled and resolver-empty paths never call GPU or claim native readback", async () => {
	const value = fixture();
	const disabled = await value.bridge.render({ ...value.input, enabled: false, diagnostic: true });
	assert.equal(disabled.path, "fixture-disabled-bypass");
	assert.equal(disabled.native, null);
	assert.deepEqual(value.calls, []);
	value.wasm.resolveStylizedEffectJson = () => JSON.stringify({ passes: [] });
	const empty = await value.bridge.render({ ...value.input, diagnostic: true });
	assert.equal(empty.path, "resolver-empty-pass");
	assert.equal(empty.native, null);
	assert.deepEqual(empty.canvas, value.source.bytes);
});
test("Bubble bridge rejects missing diagnostic surface or malformed same-call readback", async () => {
	const value = fixture();
	delete value.wasm.applyEffectPassesReadback;
	await assert.rejects(value.bridge.render({ ...value.input, diagnostic: true }), /Missing diagnostic/);
	for (const changed of [{ backend: "webgpu" }, { format: "rgba16float" }, { width: 3 }, { rgba: [1, 2] }, { canvas: { width: 1, height: 1 } }]) {
		value.wasm.applyEffectPassesReadback = async () => ({ rgba: new Uint8Array(8), width: 2, height: 1, canvas: value.presented, format: "rgba8unorm", backend: "webgl", ...changed });
		await assert.rejects(value.bridge.render({ ...value.input, diagnostic: true }), /readback shape/);
	}
});
test("Bubble resolver errors are not silently converted to identity", async () => {
	const value = fixture();
	value.wasm.resolveStylizedEffectJson = () => JSON.stringify({ error: "Invalid slot" });
	await assert.rejects(value.bridge.render(value.input), /Invalid slot/);
	assert.deepEqual(value.calls, []);
});
test("Bubble browser encoding retains all bytes including hidden color", () => {
	const bytes = Uint8Array.from({ length: 17000 }, (_, index) => index % 256);
	assert.deepEqual(new Uint8Array(Buffer.from(bubbleEncode(bytes), "base64")), bytes);
});
test("Bubble entry binds exact production APIs and does not claim Canvas acceptance as native", async () => {
	const source = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(new URL("./bubble-browser-probe.mjs", import.meta.url)));
	assert(source.includes('import * as wasm from "opencut-wasm"'));
	assert(source.includes("renderBubbleOracle(sample, canonical)"));
	assert(source.includes("nativeMetrics ? assessBubbleNative(nativeMetrics) : null"));
	assert(source.includes("nativeAssessment?.ok ?? null"));
	assert(!source.includes("assessBubbleNative(canvasMetrics)"));
	assert(source.includes("bubbleNegativesForCase(sample, canonical, expected.rgba)"));
	assert(source.includes("expectedRgba: bubbleEncode(expected.rgba)"));
});

test("Bubble work rejection requires its semantic error and attempts recovery after every failure kind", async () => {
	for (const [error, matches] of [["Invalid output dimensions: 8193x1", true], ["unreachable", false],
		["BorrowMutError", false], ["wgpu panic: Invalid output dimensions", false]]) {
		const calls = [];
		const result = await bubbleRejectAndRecover({ expectedError: "Invalid output dimensions",
			attempt: () => { calls.push("invalid"); throw Error(error); },
			recover: () => { calls.push("valid"); return { passed: true }; } });
		assert.deepEqual(calls, ["invalid", "valid"]);
		assert.equal(result.semanticMatch, matches);
		assert.equal(result.error, error);
		assert.equal(result.recovery.passed, true);
	}
	const accepted = await bubbleRejectAndRecover({ expectedError: "Invalid output dimensions",
		attempt: () => {}, recover: () => { throw Error("poisoned runtime"); } });
	assert.equal(accepted.rejected, false);
	assert.equal(accepted.semanticMatch, false);
	assert.equal(accepted.recovery, null);
	assert.equal(accepted.recoveryError, "poisoned runtime");
});

test("WASM shared effect seam propagates pure preflight errors before input import", async () => {
	const source = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(new URL("../../rust/wasm/src/effects.rs", import.meta.url)));
	const check = (text) => {
		const body = text.slice(text.indexOf("pub(crate) fn apply_effect_passes_to_texture("), text.indexOf("fn map_effect_passes("));
		const mapped = body.indexOf("let effect_passes = map_effect_passes(passes);");
		const validated = body.indexOf("validate_mapped_effect_passes(runtime, width, height, &effect_passes)?;");
		const imported = body.indexOf("let source_texture = import_canvas_texture(");
		assert(mapped >= 0 && validated > mapped && imported > validated, "Input validation must precede import");
		const preflight = text.slice(
			text.indexOf("pub(crate) fn validate_mapped_effect_passes("),
			text.indexOf("pub(crate) fn apply_mapped_effect_passes("),
		);
		assert(preflight.includes("runtime.context.device().limits().max_texture_dimension_2d"));
		assert(preflight.includes("passes: &[EffectPass]"));
		assert(preflight.includes(".map_err(|error| JsValue::from_str(&error.to_string()))"));
	};
	check(source);
		assert.throws(() => check(source.replace("validate_mapped_effect_passes(runtime", "removed_validation_silent(runtime")), /precede import/);
});
