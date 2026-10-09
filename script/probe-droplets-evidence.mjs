import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

export const sha256 = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
export function assertContained(root, child, allowRoot = false) {
	const path = relative(root, child);
	assert(
		(allowRoot || path) && !path.startsWith("..") && !isAbsolute(path),
		`Path escapes root: ${child}`,
	);
}
export function assertScratch(path) {
	assert(
		/^c:[/\\]tmps(?:[/\\]|$)/i.test(path),
		"Expected an isolated path under C:/tmps",
	);
}

const fixtureNames = [
	"droplets-cases.ts",
	"droplets-oracle.ts",
	"droplets-oracle-time.ts",
	"droplets-browser-probe.ts",
	"droplets-browser-checks.ts",
	"droplets-browser-probe.html",
	"droplets-oracle.test.ts",
].map((name) => `script/fixtures/${name}`);
const packageNames = [
	"opencut_wasm.js",
	"opencut_wasm_bg.js",
	"opencut_wasm_bg.wasm",
	"opencut_wasm.d.ts",
	"package.json",
];

async function containedHash(root, name) {
	assert(
		typeof name === "string" && !name.includes(":") && !name.includes("\0"),
		"Invalid manifest filename",
	);
	const path = join(root, name);
	assertContained(root, path);
	assertContained(root, await realpath(path));
	return sha256(await readFile(path));
}

export async function collectDropletsInputs(
	root,
	packageDirectory,
	runnerPaths,
	mode = "raster",
) {
	const manifestPath = join(root, "fixture-source.json");
	assertContained(root, await realpath(manifestPath));
	const bytes = await readFile(manifestPath),
		manifest = JSON.parse(bytes);
	assert(Array.isArray(manifest.files), "Snapshot manifest files missing");
	const inputs = manifest.files.filter(
		(file) =>
			file.path?.startsWith("rust/") ||
			fixtureNames.includes(file.path) ||
			(mode === "pipeline" &&
				(file.path?.startsWith("packages/") ||
					file.path?.startsWith("script/fixtures/droplets-pipeline"))),
	);
	assert.equal(
		new Set(inputs.map((file) => file.path)).size,
		inputs.length,
		"Duplicate manifest inputs",
	);
	for (const name of fixtureNames)
		assert(
			inputs.some((file) => file.path === name),
			`Snapshot missing ${name}`,
		);
	if (mode === "pipeline") {
		for (const name of [
			"script/fixtures/droplets-pipeline.html",
			"script/fixtures/droplets-pipeline.ts",
			"script/fixtures/droplets-pipeline-cases.ts",
			"script/fixtures/droplets-pipeline-scenes.ts",
			"script/fixtures/droplets-pipeline-support.ts",
			"script/fixtures/droplets-pipeline-checks.ts",
			"script/fixtures/droplets-pipeline-export.ts",
		])
			assert(
				inputs.some((file) => file.path === name),
				`Snapshot missing ${name}`,
			);
		assert(
			inputs.some((file) => file.path.startsWith("packages/")),
			"Snapshot missing production packages",
		);
	}
	assert(
		inputs.some((file) => file.path.startsWith("rust/")),
		"Snapshot missing native sources",
	);
	for (const file of inputs) {
		assert(/^[0-9a-f]{64}$/.test(file.sha256), `Invalid hash for ${file.path}`);
		assert.equal(await containedHash(root, file.path), file.sha256, file.path);
	}
	const packageHashes = Object.fromEntries(
		await Promise.all(
			packageNames.map(async (name) => [
				name,
				await containedHash(packageDirectory, name),
			]),
		),
	);
	const runnerInputs = Object.fromEntries(
		await Promise.all(
			runnerPaths.map(async (path) => [path, sha256(await readFile(path))]),
		),
	);
	return {
		snapshot: root,
		manifestSha256: sha256(bytes),
		sourceCommit: manifest.sourceCommit,
		sourceWorktreeClean: manifest.sourceWorktreeClean === true,
		inputs,
		packageDirectory,
		packageHashes,
		runnerInputs,
	};
}

/** Run after browser shutdown even if the browser test itself failed. */
export async function verifyDropletsInputs(frozen) {
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
		() => containedHash(frozen.snapshot, "fixture-source.json"),
		frozen.manifestSha256,
	);
	for (const file of frozen.inputs)
		await check(
			file.path,
			() => containedHash(frozen.snapshot, file.path),
			file.sha256,
		);
	for (const [name, hash] of Object.entries(frozen.packageHashes))
		await check(
			`WASM/${name}`,
			() => containedHash(frozen.packageDirectory, name),
			hash,
		);
	for (const [path, hash] of Object.entries(frozen.runnerInputs))
		await check(path, async () => sha256(await readFile(path)), hash);
	return {
		ok: failures.length === 0,
		inputs: frozen.inputs.length,
		packageFiles: packageNames.length,
		runnerFiles: Object.keys(frozen.runnerInputs).length,
		failures,
	};
}
