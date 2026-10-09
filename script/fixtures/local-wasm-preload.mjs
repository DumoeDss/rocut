// Real built implementation, not fake behavior. Never overwrite shared dependency copies.
import { mock } from "bun:test";
import * as actual from "../../rust/wasm/pkg/opencut_wasm_sync.js";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
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
