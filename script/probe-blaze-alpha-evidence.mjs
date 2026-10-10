import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

export const alphaHash = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
export const alphaFixtureFiles = [
	"blaze-alpha-admission.ts",
	"blaze-alpha-cases.ts",
	"blaze-alpha-model.ts",
	"blaze-alpha-model.test.ts",
	"blaze-alpha-probe.ts",
	"blaze-alpha-probe.html",
].map((name) => `script/fixtures/${name}`);
export const alphaRunnerFiles = [
	"probe-blaze-alpha.mjs",
	"probe-blaze-alpha-evidence.mjs",
	"probe-blaze-alpha-artifacts.mjs",
	"browser-probe-toolchain.mjs",
	"liquid-diagnostic-wasm.mjs",
];
export function alphaContained(root, target) {
	const path = relative(root, target);
	assert(
		path && !path.startsWith("..") && !isAbsolute(path),
		`Alpha input escapes root: ${target}`,
	);
}
export async function alphaScratch(path) {
	assert(
		isAbsolute(path) && /^c:[/\\]tmps[/\\]/i.test(path),
		"Expected absolute C:/tmps child directory",
	);
	const resolved = await realpath(path);
	assert(/^c:[/\\]tmps[/\\]/i.test(resolved));
	return resolved;
}
async function input(root, name) {
	assert(
		typeof name === "string" && !name.includes(":") && !name.includes("\0"),
	);
	const path = join(root, name);
	alphaContained(root, path);
	alphaContained(root, await realpath(path));
	const bytes = await readFile(path);
	return { path, bytes: bytes.length, sha256: alphaHash(bytes) };
}
export async function collectAlphaInputs(
	snapshot,
	packageDirectory,
	runnerDirectory,
) {
	const manifestInput = await input(snapshot, "fixture-source.json");
	const manifest = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(
			await readFile(manifestInput.path),
		),
	);
	assert(Array.isArray(manifest.files));
	const records = new Map(manifest.files.map((item) => [item.path, item]));
	assert.equal(records.size, manifest.files.length, "Duplicate snapshot paths");
	const fixtures = [];
	for (const name of alphaFixtureFiles) {
		const expected = records.get(name);
		assert(
			expected && /^[a-f0-9]{64}$/.test(expected.sha256),
			`Snapshot missing ${name}`,
		);
		const entry = await input(snapshot, name);
		assert.equal(entry.sha256, expected.sha256, `${name} changed`);
		fixtures.push(entry);
	}
	const packageFiles = await Promise.all(
		[
			"opencut_wasm.js",
			"opencut_wasm_bg.js",
			"opencut_wasm_bg.wasm",
			"opencut_wasm.d.ts",
			"package.json",
		].map((name) => input(packageDirectory, name)),
	);
	const runnerFiles = await Promise.all(
		alphaRunnerFiles.map((name) => input(runnerDirectory, name)),
	);
	return {
		snapshot,
		packageDirectory,
		manifest: manifestInput,
		fixtures,
		packageFiles,
		runnerFiles,
	};
}
export async function verifyAlphaInputs(frozen) {
	const failures = [],
		entries = [
			frozen.manifest,
			...frozen.fixtures,
			...frozen.packageFiles,
			...frozen.runnerFiles,
		];
	for (const entry of entries) {
		try {
			assert.equal(
				alphaHash(await readFile(entry.path)),
				entry.sha256,
				entry.path,
			);
		} catch (error) {
			failures.push(String(error));
		}
	}
	return { ok: failures.length === 0, files: entries.length, failures };
}
export function alphaSourceGuard(frozen) {
	const allowed = new Map(
		[...frozen.fixtures, ...frozen.packageFiles].map((entry) => [
			entry.path.replaceAll("\\", "/").toLowerCase(),
			entry.sha256,
		]),
	);
	const snapshot = frozen.snapshot.replaceAll("\\", "/").toLowerCase();
	const packageRoot = frozen.packageDirectory
		.replaceAll("\\", "/")
		.toLowerCase();
	const loaded = new Map();
	return {
		loaded,
		plugin: {
			name: "independent-alpha-input-guard",
			enforce: "pre",
			async load(id) {
				const path = id.split("?")[0].replaceAll("\\", "/"),
					key = path.toLowerCase();
				if (
					!key.startsWith(`${snapshot}/`) &&
					!key.startsWith(`${packageRoot}/`)
				)
					return null;
				assert(allowed.has(key), `Unexpected calibration dependency: ${path}`);
				const bytes = await readFile(path),
					hash = alphaHash(bytes);
				assert.equal(
					hash,
					allowed.get(key),
					`Changed calibration dependency: ${path}`,
				);
				loaded.set(path, hash);
				return null;
			},
		},
	};
}
