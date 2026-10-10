import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const digest = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
export const highChromaUiInputs = Object.freeze([
	"script/probe-high-chroma-ui.mjs",
	"script/fixtures/high-chroma-ui-contract.mjs",
	"script/fixtures/high-chroma-ui-inputs.mjs",
	"script/fixtures/high-chroma-ui-host.ts",
	"script/fixtures/high-chroma-ui-checks.mjs",
	"script/fixtures/high-chroma-ui-decode.mjs",
	"script/fixtures/high-chroma-ui-persistence.mjs",
	"script/browser-probe-toolchain.mjs",
	"script/fixtures/local-wasm-preload.mjs",
	"script/fixtures/clouds-editor-build.mjs",
	"script/fixtures/clouds-editor-lifecycle.mjs",
	"script/fixtures/droplets-editor-scene.ts",
	"script/fixtures/droplets-cases.ts",
	"script/fixtures/stylized-fusion-checks.mjs",
	"script/fixtures/stylized-fusion-visuals.mjs",
]);

export async function validateHighChromaUiInputs(root, launcherRoot) {
	const manifestBytes = await readFile(join(root, "fixture-source.json"));
	const manifest = JSON.parse(manifestBytes);
	for (const file of manifest.files)
		assert.equal(
			digest(await readFile(join(root, file.path))),
			file.sha256,
			`Unsynchronized source: ${file.path}`,
		);
	for (const path of highChromaUiInputs) {
		const frozen = manifest.files.find((file) => file.path === path);
		assert(frozen, `Missing launcher input: ${path}`);
		assert.equal(
			digest(await readFile(join(launcherRoot, path))),
			frozen.sha256,
			`Launcher source differs: ${path}`,
		);
	}
	return {
		manifest,
		manifestBytes,
		wasmSha256: digest(
			await readFile(join(root, "rust/wasm/pkg/opencut_wasm_bg.wasm")),
		),
	};
}
