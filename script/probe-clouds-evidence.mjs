import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

export const cloudsSha256 = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
export function cloudsContained(root, target, allowRoot = false) {
	const path = relative(root, target);
	assert(
		(allowRoot || path) && !path.startsWith("..") && !isAbsolute(path),
		`Path escapes Clouds root: ${target}`,
	);
}
export function cloudsScratch(path) {
	assert(
		/^c:[/\\]tmps(?:[/\\]|$)/i.test(path),
		"Clouds probe requires isolated C:/tmps paths",
	);
}
const fixtureNames = [
	"clouds-cases.ts",
	"clouds-oracle.ts",
	"clouds-oracle-time.ts",
	"clouds-oracle-noise.ts",
	"clouds-oracle.test.ts",
	"clouds-oracle-time.test.ts",
	"clouds-browser-checks.ts",
	"clouds-browser-support.ts",
	"clouds-browser-probe.ts",
	"clouds-browser-probe.html",
].map((name) => `script/fixtures/${name}`);
const pipelineNames = [
	"clouds-pipeline.ts",
	"clouds-pipeline.html",
	"clouds-pipeline-capture.ts",
	"clouds-pipeline-cases.test.ts",
	"clouds-pipeline-cases.ts",
	"clouds-pipeline-checks.ts",
	"clouds-pipeline-decode.ts",
	"clouds-pipeline-export.ts",
	"clouds-pipeline-metrics.ts",
	"clouds-pipeline-publish.ts",
	"clouds-pipeline-scenes.ts",
	"clouds-pipeline-source.ts",
	"clouds-pipeline-support.ts",
].map((name) => `script/fixtures/${name}`);
const packageNames = [
	"opencut_wasm.js",
	"opencut_wasm_bg.js",
	"opencut_wasm_bg.wasm",
	"opencut_wasm.d.ts",
	"package.json",
];
export function cloudsInputFixtureNames(mode = "raster") {
	assert(["raster", "pipeline"].includes(mode), "Unknown Clouds probe mode");
	return mode === "pipeline"
		? [...fixtureNames, ...pipelineNames]
		: [...fixtureNames];
}
async function hashContained(root, name) {
	assert(
		typeof name === "string" && !name.includes(":") && !name.includes("\0"),
		"Invalid Clouds manifest path",
	);
	const path = join(root, name);
	cloudsContained(root, path);
	cloudsContained(root, await realpath(path));
	return cloudsSha256(await readFile(path));
}
export async function collectCloudsInputs(
	root,
	packageDirectory,
	runnerPaths,
	mode = "raster",
) {
	assert(["raster", "pipeline"].includes(mode), "Unknown Clouds probe mode");
	const manifestPath = join(root, "fixture-source.json");
	cloudsContained(root, await realpath(manifestPath));
	const bytes = await readFile(manifestPath);
	const manifest = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(bytes),
	);
	assert(
		Array.isArray(manifest.files),
		"Clouds snapshot manifest missing files",
	);
	const inputs = manifest.files.filter(
		(file) =>
			file.path?.startsWith("rust/") ||
			fixtureNames.includes(file.path) ||
			(mode === "pipeline" &&
				(pipelineNames.includes(file.path) ||
					file.path?.startsWith("packages/"))),
	);
	assert.equal(
		new Set(inputs.map((file) => file.path)).size,
		inputs.length,
		"Duplicate Clouds manifest input",
	);
	for (const path of fixtureNames)
		assert(
			inputs.some((file) => file.path === path),
			`Snapshot missing ${path}`,
		);
	if (mode === "pipeline") {
		for (const path of pipelineNames)
			assert(
				inputs.some((file) => file.path === path),
				`Snapshot missing ${path}`,
			);
		for (const path of [
			"packages/editor-classic/src/services/renderer/canvas-renderer.ts",
			"packages/editor-classic/src/services/renderer/scene-exporter.ts",
			"packages/editor-classic/src/services/renderer/compositor/wasm-compositor.ts",
		])
			assert(
				inputs.some((file) => file.path === path),
				`Snapshot missing production ${path}`,
			);
	}
	for (const path of [
		"rust/crates/effects/src/clouds.rs",
		"rust/crates/effects/src/shaders/clouds.wgsl",
	])
		assert(
			inputs.some((file) => file.path === path),
			`Snapshot missing ${path}`,
		);
	for (const file of inputs) {
		assert(
			/^[0-9a-f]{64}$/.test(file.sha256),
			`Invalid Clouds input hash: ${file.path}`,
		);
		assert.equal(await hashContained(root, file.path), file.sha256, file.path);
	}
	const packageHashes = Object.fromEntries(
		await Promise.all(
			packageNames.map(async (name) => [
				name,
				await hashContained(packageDirectory, name),
			]),
		),
	);
	const runnerInputs = Object.fromEntries(
		await Promise.all(
			runnerPaths.map(async (path) => [
				path,
				cloudsSha256(await readFile(path)),
			]),
		),
	);
	return {
		snapshot: root,
		manifestSha256: cloudsSha256(bytes),
		sourceCommit: manifest.sourceCommit,
		sourceWorktreeClean: manifest.sourceWorktreeClean === true,
		inputs,
		packageDirectory,
		packageHashes,
		runnerInputs,
	};
}
export async function verifyCloudsInputs(frozen) {
	const failures = [];
	const check = async (label, read, expected) => {
		try {
			assert.equal(await read(), expected, label);
		} catch (error) {
			failures.push({ label, error: String(error) });
		}
	};
	await check(
		"fixture-source.json",
		() => hashContained(frozen.snapshot, "fixture-source.json"),
		frozen.manifestSha256,
	);
	for (const file of frozen.inputs)
		await check(
			file.path,
			() => hashContained(frozen.snapshot, file.path),
			file.sha256,
		);
	for (const [name, hash] of Object.entries(frozen.packageHashes))
		await check(
			`WASM/${name}`,
			() => hashContained(frozen.packageDirectory, name),
			hash,
		);
	for (const [path, hash] of Object.entries(frozen.runnerInputs))
		await check(path, async () => cloudsSha256(await readFile(path)), hash);
	return {
		ok: failures.length === 0,
		inputs: frozen.inputs.length,
		packageFiles: packageNames.length,
		runnerFiles: Object.keys(frozen.runnerInputs).length,
		failures,
	};
}
