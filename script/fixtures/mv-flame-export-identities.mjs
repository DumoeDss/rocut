import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export async function flameFileIdentity(path) {
	const stat = await lstat(path);
	assert.ok(
		stat.isFile() && !stat.isSymbolicLink(),
		"Flame export input must be an ordinary file",
	);
	const hash = createHash("sha256");
	let byteLength = 0;
	for await (const chunk of createReadStream(path)) {
		byteLength += chunk.length;
		hash.update(chunk);
	}
	const after = await lstat(path);
	assert.ok(
		after.isFile() &&
			!after.isSymbolicLink() &&
			stat.size === after.size &&
			stat.mtimeMs === after.mtimeMs &&
			byteLength === stat.size,
		"Flame export input changed while hashing",
	);
	return {
		byteLength,
		sha256: hash.digest("hex"),
	};
}

/** Bind current scene/policy code to the exact source of the tested binary. */
export async function flameRustIdentity({ root, directory, manifestSha256 }) {
	assert.ok(isAbsolute(directory), "Private Rust snapshot must be absolute");
	const path = join(directory, "source-manifest.json");
	assert.equal(
		(await flameFileIdentity(path)).sha256,
		manifestSha256,
		"Private Rust manifest differs from WASM build report",
	);
	const manifest = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path)),
	);
	assert.ok(
		Array.isArray(manifest.entries) && manifest.entries.length > 0,
		"Empty private Rust snapshot",
	);
	const selected = [];
	for (const entry of manifest.entries) {
		assert.ok(
			typeof entry.path === "string" &&
				!isAbsolute(entry.path) &&
				!entry.path.split(/[\\/]/).includes(".."),
			"Invalid private manifest path",
		);
		assert.equal(
			(await flameFileIdentity(join(directory, entry.path))).sha256,
			entry.sha256,
			`Private Rust source changed: ${entry.path}`,
		);
		if (
			/^rust\/crates\/editor-api\/(?:src\/(?:mv_|video_export)|tests\/video_export)/.test(
				entry.path,
			) ||
			[
				"rust/wasm/src/mv_image_preprocess.rs",
				"rust/wasm/src/wasm.rs",
			].includes(entry.path)
		) {
			assert.equal(
				(await flameFileIdentity(join(root, entry.path))).sha256,
				entry.sha256,
				`Current producer differs from compiled source: ${entry.path}`,
			);
			selected.push(entry);
		}
	}
	assert.ok(
		selected.some((entry) => entry.path.endsWith("mv_recipe/flame.rs")),
		"Missing compiled Flame producer",
	);
	assert.ok(
		selected.some((entry) => entry.path.endsWith("video_export/quantizer.rs")),
		"Missing compiled VP9 policy",
	);
	return {
		path,
		manifestSha256,
		verifiedSnapshotFiles: manifest.entries.length,
		currentMatchingSources: selected,
	};
}
