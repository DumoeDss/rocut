import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { assertNativeProbeWasmIdentity } from "./native-probe-wasm-binding.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Only this run's new package directory may receive the selected sibling bytes. */
export async function stageNativeProbeWasm({ binding, runRoot }) {
	assert(
		typeof runRoot === "string" && isAbsolute(runRoot),
		"Native staging run root must be absolute",
	);
	const plain = (path) => {
		const stats = lstatSync(path, { bigint: true });
		assert(
			stats.isDirectory() && !stats.isSymbolicLink(),
			"Native staging directory redirected",
		);
		assert.equal(
			realpathSync(path).toLowerCase(),
			resolve(path).toLowerCase(),
			"Native staging parent redirected",
		);
		return { dev: stats.dev, ino: stats.ino };
	};
	assertNativeProbeWasmIdentity(binding);
	const rootIdentity = plain(runRoot);
	const modules = join(runRoot, "node_modules"),
		directory = join(modules, "opencut-wasm");
	try {
		await mkdir(modules);
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
	}
	const parentIdentity = plain(modules);
	assert.deepEqual(plain(runRoot), rootIdentity, "Native run root changed");
	await mkdir(directory);
	const packageIdentity = plain(directory);
	const assertParents = () => {
		assert.deepEqual(plain(runRoot), rootIdentity, "Native run root changed");
		assert.deepEqual(
			plain(modules),
			parentIdentity,
			"Native staging parent changed",
		);
		assert.deepEqual(
			plain(directory),
			packageIdentity,
			"Native staging package changed",
		);
	};
	assertNativeProbeWasmIdentity(binding);
	for (const item of binding.identity) {
		const bytes = await readFile(join(binding.directory, item.name));
		assert.equal(
			hash(bytes),
			item.sha256,
			"Native source changed during staging",
		);
		assertParents();
		await writeFile(join(directory, item.name), bytes, { flag: "wx" });
		assertParents();
	}
	assertNativeProbeWasmIdentity(binding);
	const staged = {
		...binding,
		directory,
		entry: join(directory, "opencut_wasm.js"),
		syncEntry: join(directory, "opencut_wasm_sync.js"),
	};
	assertNativeProbeWasmIdentity(staged);
	assertParents();
	return staged;
}
