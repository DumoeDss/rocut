import assert from "node:assert/strict";
import { test } from "node:test";
import { bubbleNativeCompilationManifest, validateBubbleNativeBuildPair } from "../probe-bubble-export.mjs";

const root = "C:/tmps/rocut-bubble-editor-receipt";
const digest = "a".repeat(64);
test("fresh receipt binds the immutable compilation manifest, not the later runtime manifest", () => {
	assert.deepEqual(bubbleNativeCompilationManifest({ root, sourceFreeze: `${root}/source-freeze.json`,
		sourceFreezeSha256: digest, manifestSha256: "b".repeat(64) }),
	{ path: `${root}/source-freeze.json`, sha256: digest });
});
test("legacy compilation receipts retain their exact existing manifest binding", () => {
	const binding = bubbleNativeCompilationManifest({ root, manifestSha256: digest });
	assert.equal(binding.sha256, digest);
	assert.equal(binding.path.replaceAll("\\", "/"), `${root}/fixture-source.json`);
});
test("partial, redirected and malformed fresh receipt bindings reject without legacy fallback", () => {
	for (const patch of [
		{ sourceFreeze: `${root}/source-freeze.json` },
		{ sourceFreezeSha256: digest },
		{ sourceFreeze: "C:/tmps/foreign/source-freeze.json", sourceFreezeSha256: digest },
		{ sourceFreeze: `${root}/fixture-source.json`, sourceFreezeSha256: digest },
		{ sourceFreeze: `${root}/source-freeze.json`, sourceFreezeSha256: "bad" },
	]) assert.throws(() => bubbleNativeCompilationManifest({ root, manifestSha256: digest, ...patch }));
});
test("script-only runtime changes remain distinct from changes to actual compilation inputs", () => {
	const files = [{ path: "rust/crates/editor-api/src/animation.rs", sha256: digest },
		{ path: "script/build-wasm.mjs", sha256: digest }, { path: "script/check-wasm-init.mjs", sha256: digest }];
	const scriptOnly = files.map(f => f.path === "script/check-wasm-init.mjs" ? { ...f, sha256: "b".repeat(64) } : f);
	assert.equal(validateBubbleNativeBuildPair({ files: scriptOnly }, { files }), 2);
	const changedRust = files.map(f => f.path.startsWith("rust/") ? { ...f, sha256: "b".repeat(64) } : f);
	assert.throws(() => validateBubbleNativeBuildPair({ files: changedRust }, { files }));
});
