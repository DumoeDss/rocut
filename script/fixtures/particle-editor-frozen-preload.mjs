import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { mock } from "bun:test";

const path = process.env.ROCUT_PARTICLE_EDITOR_WASM_SYNC;
assert.ok(
	path && isAbsolute(path),
	"Explicit frozen WASM sync module required",
);
const actual = await import(pathToFileURL(path).href);
mock.module("opencut-wasm", () => actual);
for (const owner of [
	"",
	"packages/editor-classic/",
	"packages/editor-contracts/",
	"apps/vite-example/",
	"apps/cli/",
]) {
	const installed = fileURLToPath(
		new URL(
			`../../${owner}node_modules/opencut-wasm/opencut_wasm_sync.js`,
			import.meta.url,
		),
	);
	if (existsSync(installed)) mock.module(installed, () => actual);
}
