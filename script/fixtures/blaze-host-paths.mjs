import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, win32 } from "node:path";
import { fileURLToPath } from "node:url";

export const blazeHostOwnedFiles = [
	"script/fixtures/blaze-host-contract.ts",
	"script/fixtures/blaze-host-source.ts",
	"script/fixtures/blaze-host-cases.ts",
	"script/fixtures/blaze-host-paths.mjs",
	"script/fixtures/blaze-host-checks.ts",
	"script/fixtures/blaze-host.ts",
	"script/fixtures/blaze-host-static.test.ts",
	"script/probe-blaze-host.mjs",
];

/** @param {string} target @param {string} [parent] */
export function assertBlazeHostPrivatePath(target, parent = "C:/tmps") {
	assert(
		target && win32.isAbsolute(target),
		"Expected an absolute private path",
	);
	const child = win32.relative(win32.resolve(parent), win32.resolve(target));
	assert(
		child && !child.startsWith("..") && !win32.isAbsolute(child),
		"Blaze Host paths must be strict descendants of the private parent",
	);
	return win32.resolve(target);
}

/** @param {string} target */
export async function assertBlazeHostRealPath(target) {
	assertBlazeHostPrivatePath(target);
	const canonical = await realpath(target);
	assertBlazeHostPrivatePath(canonical);
	assert.equal(
		win32.resolve(target).toLowerCase(),
		win32.resolve(canonical).toLowerCase(),
		"Private fixture path must not redirect through a junction",
	);
	return canonical;
}

/**
 * @param {{ snapshot: string, manifestSha256: string, wasmUrl: string, wasmSha256: string }} options
 */
export async function assertBlazeHostSnapshot(options) {
	const { snapshot, manifestSha256, wasmUrl, wasmSha256 } = options;
	await assertBlazeHostRealPath(snapshot);
	for (const value of [manifestSha256, wasmSha256])
		assert(
			/^[a-f0-9]{64}$/.test(value),
			"Explicit snapshot and WASM hashes required",
		);
	const hash = (/** @type {Uint8Array} */ bytes) =>
		createHash("sha256").update(bytes).digest("hex");
	const manifestPath = join(snapshot, "fixture-source.json");
	const manifestBytes = await readFile(manifestPath);
	assert.equal(
		hash(manifestBytes),
		manifestSha256,
		"Snapshot manifest changed",
	);
	const manifest = JSON.parse(manifestBytes.toString("utf8"));
	for (const required of [
		...blazeHostOwnedFiles,
		"script/fixtures/blaze-cases.ts",
		"script/fixtures/blaze-cases-source.ts",
	]) {
		const file = manifest.files.find(
			(/** @type {{path: string}} */ file) => file.path === required,
		);
		assert(file, `Snapshot manifest does not contain ${required}`);
		assertBlazeHostPrivatePath(join(snapshot, file.path), snapshot);
		assert.equal(
			hash(await readFile(join(snapshot, file.path))),
			file.sha256,
			file.path,
		);
	}
	const wasmEntry = await realpath(fileURLToPath(wasmUrl));
	assertBlazeHostPrivatePath(wasmEntry);
	const wasmPath = await realpath(
		join(dirname(wasmEntry), "opencut_wasm_bg.wasm"),
	);
	assertBlazeHostPrivatePath(wasmPath);
	assert.equal(
		hash(await readFile(wasmPath)),
		wasmSha256,
		"Unexpected WASM dependency",
	);
	return { manifestPath, manifestSha256, wasmEntry, wasmPath, wasmSha256 };
}

/** @param {string} target @param {string} parent */
export async function assertBlazeHostAbsentChild(target, parent) {
	assertBlazeHostPrivatePath(target, parent);
	await assertBlazeHostRealPath(parent);
	await assert.rejects(lstat(target), { code: "ENOENT" });
}
