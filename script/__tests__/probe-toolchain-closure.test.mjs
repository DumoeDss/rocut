import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pinProbeToolchain } from "../fixtures/probe-toolchain-closure.mjs";

test("toolchain pins actual cyclic dependencies, explicit optional absence and raw drift", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "rocut-toolchain-closure-unit-"));
	const files = [],
		directories = [
			join(root, "node_modules"),
			join(root, "node_modules/a"),
			join(root, "node_modules/b"),
		];
	for (const directory of directories) await mkdir(directory);
	t.after(async () => {
		for (const file of files.toReversed()) await unlink(file);
		for (const directory of directories.toReversed()) await rmdir(directory);
		await rmdir(root);
	});
	async function file(path, value) {
		const target = join(root, path);
		assert([root, ...directories].includes(dirname(target)));
		await writeFile(target, value, { flag: "wx", encoding: "utf8" });
		files.push(target);
		return target;
	}
	const manifestPath = await file(
		"package.json",
		JSON.stringify({ name: "probe-fixture", private: true }),
	);
	await file(
		"node_modules/a/package.json",
		JSON.stringify({
			name: "a",
			version: "1.0.0",
			type: "module",
			exports: "./index.mjs",
			dependencies: { b: "1.0.0" },
			optionalDependencies: { "unavailable-optional": "1.0.0" },
		}),
	);
	await file("node_modules/a/index.mjs", "export const a=1;\n");
	await file(
		"node_modules/b/package.json",
		JSON.stringify({
			name: "b",
			version: "1.0.0",
			type: "module",
			exports: "./index.mjs",
			dependencies: { a: "1.0.0" },
		}),
	);
	const bEntry = await file(
		"node_modules/b/index.mjs",
		"export const b=1;\r\n",
	);
	const roots = [{ manifestPath, names: ["a"] }];
	const before = await pinProbeToolchain(roots);
	assert.equal(before.packageCount, 2);
	assert(
		before.resolutions.some(
			(value) =>
				value.name === "unavailable-optional" &&
				!value.available &&
				value.optional,
		),
	);
	assert.deepEqual(await pinProbeToolchain(roots), before);
	await writeFile(bEntry, "export const b=2;\n", { encoding: "utf8" });
	const after = await pinProbeToolchain(roots);
	assert.notEqual(after.manifestSha256, before.manifestSha256);
	await assert.rejects(
		pinProbeToolchain([{ manifestPath, names: ["missing-required"] }]),
		{ code: "MODULE_NOT_FOUND" },
	);
});
