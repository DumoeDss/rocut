import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "./master-encoder-analysis.mjs";
import { sourceIdentities } from "./vp9-quantizer-source-identities.mjs";

const editorSources = [
	"script/probe-vp9-quantizer-editor.mjs",
	"script/fixtures/vp9-quantizer-editor-identities.mjs",
	"script/fixtures/vp9-quantizer-editor-assertions.test.mjs",
	...[
		"browser.mjs",
		"browser.html",
		"trace.mjs",
		"assertions.mjs",
		"io.mjs",
	].map((suffix) => `script/fixtures/vp9-quantizer-editor-${suffix}`),
	"script/fixtures/master-effects-browser-scene.ts",
	"script/native-audio-export-build.mjs",
	...[
		"scene-exporter.ts",
		"scene-builder.ts",
		"canvas-renderer.ts",
		"export-output-lifetime.ts",
		"export-video-bitrate.ts",
		"export-video-native-plan.ts",
		"export-video-options.ts",
		"export-video-chroma.ts",
		"cancel-tree.ts",
		"resolve.ts",
		"resolve-visual-state.ts",
		"compositor/frame-descriptor.ts",
		"compositor/wasm-compositor.ts",
	].map((name) => `packages/editor-classic/src/services/renderer/${name}`),
];
export async function editorIdentities({ root, policyResolver }) {
	const base = await sourceIdentities({ root, policyResolver });
	return [
		...base,
		...(await Promise.all(
			editorSources.map(async (path) => ({
				path,
				sha256: sha256(await readFile(join(root, path))),
			})),
		)),
	];
}
export async function wasmIdentities(wasm) {
	return Promise.all(
		["opencut_wasm.js", "opencut_wasm_bg.wasm"].map(async (path) => ({
			path: join(wasm, path),
			sha256: sha256(await readFile(join(wasm, path))),
		})),
	);
}
export async function bundleIdentities(directory, prefix = "") {
	const records = [];
	for (const entry of await readdir(join(directory, prefix), {
		withFileTypes: true,
	})) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory())
			records.push(...(await bundleIdentities(directory, path)));
		else if (entry.isFile())
			records.push({
				path,
				sha256: sha256(await readFile(join(directory, path))),
			});
		else throw Error(`Unexpected non-regular bundle input: ${path}`);
	}
	return records.sort((left, right) => left.path.localeCompare(right.path));
}
export async function snapshotIdentity(directory, expectedSha256) {
	const path = join(directory, "source-manifest.json");
	const bytes = await readFile(path),
		digest = sha256(bytes);
	assert.equal(
		digest,
		expectedSha256.toLowerCase(),
		"Unexpected private Rust source manifest",
	);
	const manifest = JSON.parse(bytes.toString("utf8"));
	for (const entry of manifest.entries)
		assert.equal(
			sha256(await readFile(join(directory, entry.path))),
			entry.sha256,
			`Private Rust snapshot changed: ${entry.path}`,
		);
	return {
		path,
		sha256: digest,
		verifiedFiles: manifest.entries.length,
		videoExportSources: manifest.entries.filter(
			(entry) =>
				entry.path.includes("video_export") ||
				entry.path.endsWith("vp9-quantizer-policy.rs"),
		),
	};
}
