import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (bytes) =>
	JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
export async function inspectInkObjectInputs({
	pkg,
	creator,
	threeToolchain,
	workspace,
}) {
	for (const path of [pkg, creator, threeToolchain, workspace])
		assert(isAbsolute(path));
	const files = [];
	const read = async (path) => {
		const bytes = await readFile(path);
		files.push({ path, bytes: bytes.length, sha256: sha(bytes) });
		return bytes;
	};
	const versions = {
		three: "0.185.1",
		"@elftia/three-assets": "0.1.1",
		"@noble/hashes": "2.0.1",
		esbuild: "0.27.3",
	};
	const lock = json(await read(join(threeToolchain, "package-lock.json")));
	for (const [name, version] of Object.entries(versions)) {
		const manifest = json(
			await read(join(threeToolchain, "node_modules", name, "package.json")),
		);
		assert.equal(manifest.name, name);
		assert.equal(manifest.version, version);
		assert.equal(lock.packages[`node_modules/${name}`].version, version);
	}
	await read(creator);
	await read(join(creator, "..", "ink-object-scene.ts"));
	for (const path of [
		"apps/cli/src/programmatic/engines/three-driver.ts",
		"apps/cli/src/programmatic/engines/three-assets-driver.ts",
		"rust/crates/editor-api/src/ink_object_params.rs",
		"rust/wasm/src/wasm.rs",
	])
		await read(join(workspace, path));
	const gluePath = join(pkg, "opencut_wasm_bg.js");
	const glue = new TextDecoder("utf-8", { fatal: true }).decode(
		await read(gluePath),
	);
	await read(join(pkg, "opencut_wasm_sync.js"));
	await read(join(pkg, "opencut_wasm_bg.wasm"));
	await read(join(pkg, "package.json"));
	const ready = /export function resolveInkObjectParamsJson\(/.test(glue);
	return {
		ok: ready,
		status: ready ? "ready-for-wasm-host-probe" : "pending-wasm-export",
		requiredExport: "resolveInkObjectParamsJson",
		pkg,
		creator,
		threeToolchain,
		versions,
		files,
		buildPreparation: {
			command: "node",
			args: [
				"script/build-wasm.mjs",
				"--out-dir",
				"C:/tmps/REQUIRED-NEW-PRIVATE-DIRECTORY/pkg",
				"--no-opt",
				"--",
				"--locked",
				"--offline",
			],
			executed: false,
		},
		scope:
			"Read-only exact inputs; no resolver substitute, dependency installation, WASM rebuild, browser or GPU. Missing actual WASM export is pending, not acceptance.",
	};
}
export async function loadInkObjectWasm(pkg) {
	assert(isAbsolute(pkg));
	const module = await import(
		pathToFileURL(join(pkg, "opencut_wasm_sync.js")).href
	);
	assert.equal(
		typeof module.resolveInkObjectParamsJson,
		"function",
		"Explicit private WASM missing Ink resolver; no fallback permitted",
	);
	return module;
}
export function checkInkObjectWasm(module) {
	const resolve = module.resolveInkObjectParamsJson;
	assert.equal(typeof resolve, "function");
	const valid = JSON.parse(
		resolve(
			JSON.stringify({
				version: 1,
				contourWidth: 4,
				inkDensity: 0.123456789012345,
				paperTexture: 0.125,
			}),
		),
	);
	assert.equal(valid.ok, true);
	assert.equal(valid.params.contourWidth, 4);
	assert.equal(valid.params.inkDensity, 0.123456789012345);
	const rejected = [];
	for (const input of [
		'{"version":1,"contourWidth":999}',
		'{"version":1,"inkDensity":1e999}',
		'{"version":1,"frameTime":0}',
		'{"version":1,"inkDensity":0,"inkDensity":1}',
	]) {
		const response = JSON.parse(resolve(input));
		assert.equal(response.ok, false);
		assert(response.error && typeof response.error.path === "string");
		rejected.push(response);
	}
	return {
		ok: true,
		valid,
		rejected,
		resolverCalls: 5,
		scope:
			"Actual explicitly loaded WASM parameter resolver only; not scene render or GPU",
	};
}
