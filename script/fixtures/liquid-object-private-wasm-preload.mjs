import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mock } from "bun:test";

// Routing to a real built module in this test process only, never a behavior double.
const directory = process.env.ROCUT_TEST_LIQUID_WASM_DIR;
const expected = process.env.ROCUT_TEST_LIQUID_WASM_SHA256;
assert(
	directory && isAbsolute(directory) && /^[a-f0-9]{64}$/.test(expected ?? ""),
);
const hash = () =>
	createHash("sha256")
		.update(readFileSync(join(directory, "opencut_wasm_bg.wasm")))
		.digest("hex");
assert.equal(hash(), expected);
const actual = await import(
	pathToFileURL(join(directory, "opencut_wasm_sync.js")).href
);
assert.equal(typeof actual.LiquidObjectTransportOwner, "function");
assert.equal(typeof actual.liquidObjectTransportPolicyJson, "function");
assert.equal(hash(), expected);
mock.module("opencut-wasm", () => actual);
const routed = [];
for (const owner of [
	"",
	"packages/editor-classic/",
	"packages/editor-contracts/",
	"apps/vite-example/",
	"apps/cli/",
]) {
	for (const entry of ["opencut_wasm.js", "opencut_wasm_sync.js"]) {
		const path = fileURLToPath(
			new URL(
				`../../${owner}node_modules/opencut-wasm/${entry}`,
				import.meta.url,
			),
		);
		if (!existsSync(path)) continue;
		mock.module(path, () => actual);
		routed.push(path);
	}
}
console.log(
	JSON.stringify({
		wasm: expected,
		routing: "isolated-real-sync-module",
		routed,
	}),
);
