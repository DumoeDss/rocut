// Read-only identity probe: imports the actual package, without mock.module.
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = realpathSync(fileURLToPath(import.meta.resolve("opencut-wasm")));
const directory = dirname(entry);
assert.equal(directory, realpathSync(process.env.ROCUT_REVISION_WASM_DIRECTORY));
const binaryPath = join(directory, "opencut_wasm_bg.wasm");
const wasmSha256 = createHash("sha256")
	.update(readFileSync(binaryPath))
	.digest("hex");
assert.equal(wasmSha256, process.env.ROCUT_REVISION_WASM_SHA256);
const actual = await import("opencut-wasm");
assert.equal(Object.keys(actual).length, 135);
console.log(JSON.stringify({
	buildRevisionWasmIdentity: {
		entry,
		binaryPath,
		wasmSha256,
		publicExports: Object.keys(actual).length,
		binding: "actual-bun-sync-package; no mocks or replacement exports",
	},
}));
