import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { blazeContained, blazeSha256 } from "./probe-blaze-evidence.mjs";

export const blazePipelineFixtures = [
	"blaze-cases.ts",
	"blaze-cases-source.ts",
	"blaze-oracle.ts",
	"blaze-oracle-field.ts",
	"blaze-oracle-noise.ts",
	"blaze-oracle-time.ts",
	"blaze-oracle-sampling.ts",
	"blaze-browser-metrics.ts",
	"blaze-pipeline.ts",
	"blaze-pipeline.html",
	"blaze-pipeline-cases.ts",
	"blaze-pipeline-source.ts",
	"blaze-pipeline-scenes.ts",
	"blaze-pipeline-support.ts",
	"blaze-pipeline-capture.ts",
	"blaze-pipeline-export.ts",
	"blaze-pipeline-decode.ts",
	"blaze-pipeline-metrics.ts",
	"blaze-pipeline-cases.test.ts",
].map((name) => `script/fixtures/${name}`);

export async function collectBlazePipelineInputs(
	root,
	packageDirectory,
	runnerPaths,
) {
	const hash = async (directory, name) => {
		assert(
			typeof name === "string" && !name.includes(":") && !name.includes("\0"),
		);
		const path = join(directory, name);
		blazeContained(directory, path);
		blazeContained(directory, await realpath(path));
		return blazeSha256(await readFile(path));
	};
	const manifestPath = join(root, "fixture-source.json");
	blazeContained(root, await realpath(manifestPath));
	const bytes = await readFile(manifestPath),
		manifest = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(bytes),
		);
	assert(Array.isArray(manifest.files));
	const inputs = manifest.files.filter(
		(file) =>
			file.path?.startsWith("rust/") ||
			file.path?.startsWith("packages/") ||
			blazePipelineFixtures.includes(file.path),
	);
	assert.equal(new Set(inputs.map((file) => file.path)).size, inputs.length);
	for (const path of [
		...blazePipelineFixtures,
		"rust/crates/effects/src/blaze.rs",
		"rust/crates/effects/src/shaders/blaze.wgsl",
		"packages/editor-classic/src/services/renderer/scene-exporter.ts",
		"packages/editor-classic/src/services/renderer/canvas-renderer.ts",
	])
		assert(
			inputs.some((file) => file.path === path),
			`Blaze pipeline snapshot missing ${path}`,
		);
	for (const file of inputs) {
		assert(/^[0-9a-f]{64}$/.test(file.sha256));
		assert.equal(await hash(root, file.path), file.sha256, file.path);
	}
	const packageHashes = Object.fromEntries(
		await Promise.all(
			[
				"opencut_wasm.js",
				"opencut_wasm_bg.js",
				"opencut_wasm_bg.wasm",
				"opencut_wasm.d.ts",
				"package.json",
			].map(async (name) => [name, await hash(packageDirectory, name)]),
		),
	);
	const runnerInputs = Object.fromEntries(
		await Promise.all(
			runnerPaths.map(async (path) => [
				path,
				blazeSha256(await readFile(path)),
			]),
		),
	);
	return {
		snapshot: root,
		manifestSha256: blazeSha256(bytes),
		sourceCommit: manifest.sourceCommit,
		sourceWorktreeClean: manifest.sourceWorktreeClean === true,
		inputs,
		packageDirectory,
		packageHashes,
		runnerInputs,
	};
}
