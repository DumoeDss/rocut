// Real built implementation, not fake behavior. Never overwrite shared dependency copies.
import { mock } from "bun:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	resolveHtmlProbeWasmBinding,
	assertHtmlProbeWasmIdentity,
} from "../html-probe-wasm-binding.mjs";
const binding = resolveHtmlProbeWasmBinding(
	process.env.ROCUT_TEST_WASM_DIRECTORY,
);
const actual = binding
	? await import(pathToFileURL(binding.entry).href)
	: await import("../../rust/wasm/pkg/opencut_wasm_sync.js");
if (binding) {
	actual.initSync({
		module: readFileSync(join(binding.directory, "opencut_wasm_bg.wasm")),
	});
	assertHtmlProbeWasmIdentity(binding, binding.identity);
	console.log(JSON.stringify({ wasmIdentity: binding.identity }));
}
mock.module("opencut-wasm", () => actual);
for (const owner of [
	"",
	"packages/editor-classic/",
	"packages/editor-contracts/",
	"apps/vite-example/",
	"apps/cli/",
]) {
	const path = fileURLToPath(
		new URL(
			`../../${owner}node_modules/opencut-wasm/opencut_wasm_sync.js`,
			import.meta.url,
		),
	);
	if (existsSync(path)) mock.module(path, () => actual);
}
