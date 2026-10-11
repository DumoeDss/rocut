import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertFrozenAttemptUnchanged,
	parseUtf8Json,
	pinFrozenManifest,
	resolveFrozenPath,
	sha256,
} from "../fixtures/frozen-attempt-identity.mjs";

async function fixtureDirectory(t, prefix) {
	const root = await mkdtemp(join(tmpdir(), prefix));
	t.after(async () => {
		for (const name of ["fixture-source.json", "source.txt"]) {
			try {
				await unlink(join(root, name));
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
		}
		// Never recursively delete: unexpected entries prevent cleanup.
		await rmdir(root);
	});
	return root;
}

test("frozen paths reject parent escapes and absolute paths", () => {
	const root = process.cwd();
	assert.equal(
		resolveFrozenPath(root, "script/example.mjs"),
		join(root, "script/example.mjs"),
	);
	assert.throws(() => resolveFrozenPath(root, "../outside"));
	assert.throws(() => resolveFrozenPath(root, process.cwd()));
	assert.throws(() => resolveFrozenPath(root, ""));
});

test("raw manifest identity reports drift and mismatched HEAD without repairing files", async (t) => {
	const root = await fixtureDirectory(t, "rocut-frozen-attempt-unit-");
	const content = Buffer.from("independent source\r\n", "utf8");
	await writeFile(join(root, "source.txt"), content, { flag: "wx" });
	const manifestPath = join(root, "fixture-source.json");
	await writeFile(
		manifestPath,
		JSON.stringify({
			schema: "fixture-source/v2",
			sourceCommit: "head-a",
			files: [{ path: "source.txt", sha256: sha256(content) }],
		}),
		{ flag: "wx" },
	);
	const before = await pinFrozenManifest({
		root,
		manifestPath,
		head: "head-a",
	});
	assert.equal(before.valid, true);
	assert.deepEqual(before.drift, []);
	assert.equal(
		(await pinFrozenManifest({ root, manifestPath, head: "head-b" })).valid,
		false,
	);
	await writeFile(join(root, "source.txt"), "changed\n", { encoding: "utf8" });
	const after = await pinFrozenManifest({ root, manifestPath, head: "head-a" });
	assert.equal(after.valid, false);
	assert.deepEqual(after.drift, ["source.txt"]);
	assert.notEqual(
		after.actualFilesManifestSha256,
		before.actualFilesManifestSha256,
	);
});

test("duplicate and empty manifests cannot establish provenance", async (t) => {
	const root = await fixtureDirectory(t, "rocut-frozen-attempt-negative-");
	const manifestPath = join(root, "fixture-source.json");
	await writeFile(
		manifestPath,
		JSON.stringify({ schema: "fixture-source/v2", files: [] }),
		{ flag: "wx" },
	);
	await assert.rejects(
		pinFrozenManifest({ root, manifestPath, head: "head-a" }),
	);
	const file = { path: "missing.txt", sha256: "0".repeat(64) };
	await writeFile(
		manifestPath,
		JSON.stringify({ schema: "fixture-source/v2", files: [file, file] }),
		{ encoding: "utf8" },
	);
	await assert.rejects(
		pinFrozenManifest({ root, manifestPath, head: "head-a" }),
		/Duplicate/,
	);
});

test("unchanged checks reject invalid snapshots and tool/package drift", () => {
	const before = {
		head: "head-a",
		fixture: {
			valid: true,
			sha256: "manifest",
			actualFilesManifestSha256: "source",
		},
		extraSources: { manifestSha256: "helpers" },
		executables: { manifestSha256: "tools" },
		closures: { wasm: { manifestSha256: "package" } },
	};
	assertFrozenAttemptUnchanged(before, structuredClone(before));
	assert.throws(() =>
		assertFrozenAttemptUnchanged(before, {
			...before,
			fixture: { ...before.fixture, valid: false },
		}),
	);
	assert.throws(() =>
		assertFrozenAttemptUnchanged(before, {
			...before,
			executables: { manifestSha256: "different" },
		}),
	);
	assert.throws(() =>
		assertFrozenAttemptUnchanged(before, {
			...before,
			closures: { wasm: { manifestSha256: "different" } },
		}),
	);
	assert.throws(() =>
		assertFrozenAttemptUnchanged(before, {
			...before,
			toolchain: { manifestSha256: "new-toolchain" },
		}),
	);
	assert.throws(() => parseUtf8Json(new Uint8Array([0xff])));
});
