import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

export const blazeSha256 = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
export function blazeContained(root, target, allowRoot = false) {
	const path = relative(root, target);
	assert(
		(allowRoot || path) && !path.startsWith("..") && !isAbsolute(path),
		`Path escapes Blaze root: ${target}`,
	);
}
export function blazeScratch(path) {
	assert(
		/^c:[/\\]tmps(?:[/\\]|$)/i.test(path),
		"Blaze probe requires isolated C:/tmps paths",
	);
}
const fixtureNames = [
	"blaze-cases.ts",
	"blaze-cases-source.ts",
	"blaze-oracle.ts",
	"blaze-oracle-time.ts",
	"blaze-oracle-noise.ts",
	"blaze-oracle-field.ts",
	"blaze-oracle-sampling.ts",
	"blaze-oracle.test.ts",
	"blaze-oracle-time.test.ts",
	"blaze-browser-checks.ts",
	"blaze-browser-metrics.ts",
	"blaze-browser-negatives.ts",
	"blaze-browser-metrics.test.ts",
	"blaze-browser-negatives.test.ts",
	"blaze-browser-matrix.test.ts",
	"blaze-browser-support.ts",
	"blaze-browser-probe.ts",
	"blaze-browser-probe.html",
].map((name) => `script/fixtures/${name}`);
const packageNames = [
	"opencut_wasm.js",
	"opencut_wasm_bg.js",
	"opencut_wasm_bg.wasm",
	"opencut_wasm.d.ts",
	"package.json",
];
export function blazeInputFixtureNames() {
	return [...fixtureNames];
}
async function hashContained(root, name) {
	assert(
		typeof name === "string" && !name.includes(":") && !name.includes("\0"),
		"Invalid Blaze manifest path",
	);
	const path = join(root, name);
	blazeContained(root, path);
	blazeContained(root, await realpath(path));
	return blazeSha256(await readFile(path));
}
export async function collectBlazeInputs(root, packageDirectory, runnerPaths) {
	const manifestPath = join(root, "fixture-source.json");
	blazeContained(root, await realpath(manifestPath));
	const bytes = await readFile(manifestPath);
	const manifest = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(bytes),
	);
	assert(
		Array.isArray(manifest.files),
		"Blaze snapshot manifest missing files",
	);
	const inputs = manifest.files.filter(
		(file) =>
			file.path?.startsWith("rust/") || fixtureNames.includes(file.path),
	);
	assert.equal(
		new Set(inputs.map((file) => file.path)).size,
		inputs.length,
		"Duplicate Blaze manifest input",
	);
	for (const path of fixtureNames)
		assert(
			inputs.some((file) => file.path === path),
			`Snapshot missing ${path}`,
		);
	for (const path of [
		"rust/crates/effects/src/blaze.rs",
		"rust/crates/effects/src/shaders/blaze.wgsl",
	])
		assert(
			inputs.some((file) => file.path === path),
			`Snapshot missing ${path}`,
		);
	for (const file of inputs) {
		assert(
			/^[0-9a-f]{64}$/.test(file.sha256),
			`Invalid Blaze input hash: ${file.path}`,
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
export async function verifyBlazeInputs(frozen) {
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
		await check(path, async () => blazeSha256(await readFile(path)), hash);
	return {
		ok: failures.length === 0,
		inputs: frozen.inputs.length,
		packageFiles: packageNames.length,
		runnerFiles: Object.keys(frozen.runnerInputs).length,
		failures,
	};
}
