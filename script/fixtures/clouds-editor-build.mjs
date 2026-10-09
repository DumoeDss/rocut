import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { build } from "../browser-probe-toolchain.mjs";
import { deadline } from "./clouds-editor-lifecycle.mjs";

export const digest = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
export async function validateEditorInputs(root, launcherRoot) {
	const manifestBytes = await readFile(join(root, "fixture-source.json"));
	const manifest = JSON.parse(manifestBytes);
	for (const file of manifest.files)
		assert.equal(
			digest(await readFile(join(root, file.path))),
			file.sha256,
			`Unsynchronized source: ${file.path}`,
		);
	for (const path of [
		"script/probe-clouds-editor.mjs",
		"script/browser-probe-toolchain.mjs",
		"script/fixtures/clouds-editor-checks.mjs",
		"script/fixtures/clouds-editor-lifecycle.mjs",
		"script/fixtures/clouds-editor-build.mjs",
		"script/fixtures/clouds-editor-export-checks.mjs",
		"script/fixtures/clouds-editor-export-decode.mjs",
		"script/fixtures/clouds-editor-contract.ts",
		"script/fixtures/clouds-editor-scene.ts",
		"script/fixtures/clouds-editor-host.ts",
		"script/fixtures/clouds-editor-export-host.ts",
		"script/fixtures/clouds-editor-metrics.mjs",
		"script/fixtures/clouds-editor-preview.mjs",
		"script/fixtures/clouds-editor-persistence.mjs",
		"script/fixtures/clouds-pipeline-source.ts",
		"script/fixtures/stylized-fusion-checks.mjs",
		"script/fixtures/stylized-fusion-visuals.mjs",
		"script/fixtures/sweep-scroll-editor-history.mjs",
	]) {
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
export async function prepareEditorDist({
	root,
	editorDist,
	temp,
	manifest,
	wasmSha256,
	evidence,
	reuse,
}) {
	if (reuse) {
		const old = JSON.parse(
			await readFile(join(editorDist, "../../source-manifest.json"), "utf8"),
		);
		const rendererFiles = (entry) =>
			entry.files.filter(
				(file) =>
					!file.path.startsWith("script/") &&
					!file.path.startsWith("apps/cli/"),
			);
		assert.deepEqual(
			rendererFiles(old),
			rendererFiles(manifest),
			"Cached editor source differs",
		);
		evidence.reusedEditorDist = editorDist;
	} else {
		console.log(JSON.stringify({ phase: "building-private-editor" }));
		await deadline(
			build({
				root: join(root, "apps/vite-example"),
				configFile: join(root, "apps/vite-example/vite.config.ts"),
				cacheDir: join(temp, "vite-cache"),
				logLevel: "warn",
				resolve: {
					alias: {
						"opencut-wasm": join(root, "rust/wasm/pkg/opencut_wasm.js"),
					},
				},
				build: {
					outDir: editorDist,
					emptyOutDir: false,
					rollupOptions: {
						onwarn(warning, defaultHandler) {
							evidence.buildWarnings.push({
								code: warning.code,
								message: warning.message,
							});
							defaultHandler(warning);
						},
					},
				},
			}),
			240000,
			"Private editor build",
		);
	}
	const wasmFiles = (await readdir(join(editorDist, "assets"))).filter(
		(file) => file.startsWith("opencut_wasm_bg-") && file.endsWith(".wasm"),
	);
	assert.equal(wasmFiles.length, 1);
	assert.equal(
		digest(await readFile(join(editorDist, "assets", wasmFiles[0]))),
		wasmSha256,
	);
	evidence.editorDist = editorDist;
}
