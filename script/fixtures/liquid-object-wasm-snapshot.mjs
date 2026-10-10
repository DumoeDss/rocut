import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

export async function captureLiquidProbeFiles({ workspace, hash }) {
	const paths = [
		"script/probe-liquid-object-wasm-development.mjs",
		"script/fixtures/liquid-object-wasm-development-support.mjs",
		"script/fixtures/liquid-object-wasm-snapshot.mjs",
		"script/fixtures/liquid-object-wasm-capability-gates.mjs",
		"script/fixtures/liquid-object-wasm-owner-gates.mjs",
		"script/fixtures/liquid-object-worker-wasm-acceptance.mjs",
	];
	return Promise.all(
		paths.map(async (path) => ({
			path,
			sha256: hash(await readFile(join(workspace, path))),
		})),
	);
}

export async function freezeLiquidWasmSource({
	workspace,
	snapshot,
	cache,
	files,
	hash,
	save,
}) {
	const sourcePaths = async () => [
		...(await files(join(workspace, "rust/crates"))),
		...(await files(join(workspace, "rust/wasm"))),
		...(await files(join(workspace, "apps/desktop/src"))),
		join(workspace, "apps/desktop/Cargo.toml"),
		...[
			"Cargo.toml",
			"Cargo.lock",
			"rust-toolchain.toml",
			"script/build-wasm.mjs",
			"script/wasm-toolchain.mjs",
			"script/wasm-package-directory.mjs",
		].map((name) => join(workspace, name)),
	];
	const paths = await sourcePaths();
	assert(paths.length <= 2000, "Snapshot file count bound");
	let total = 0;
	const sourceBefore = [];
	for (const path of paths.sort()) {
		assert(!(await lstat(path)).isSymbolicLink());
		const bytes = await readFile(path);
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		total += bytes.length;
		assert(total <= 64 * 1024 ** 2, "Snapshot byte bound");
		const name = relative(workspace, path),
			stored = join(snapshot, name);
		await mkdir(dirname(stored), { recursive: true });
		await writeFile(stored, bytes, { flag: "wx" });
		assert.equal(hash(await readFile(stored)), hash(bytes));
		sourceBefore.push({
			path: name,
			bytes: bytes.length,
			sha256: hash(bytes),
		});
	}
	const sourceBytes = total;
	await save("source-before.json", sourceBefore);
	const tools = await import(
		pathToFileURL(join(snapshot, "script/wasm-toolchain.mjs")).href
	);
	const toolchain = tools.inspectToolchain();
	assert(toolchain.ok, "Frozen pinned toolchain must pass before build");
	assert(
		(await lstat(resolve(cache))).isDirectory(),
		"Authorized target cache must already exist",
	);
	return { sourceBefore, sourceBytes, toolchain, sourcePaths };
}
