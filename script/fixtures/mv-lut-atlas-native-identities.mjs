import assert from "node:assert/strict";
import { readFile, lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createHash } from "node:crypto";
export const LUT_FROZEN_RUST = [
	"rust/crates/editor-api/src/mv_lut_atlas.rs",
	"rust/crates/editor-api/src/mv_lut_atlas_layout.rs",
	"rust/crates/editor-api/src/mv_lut_atlas_bridge.rs",
	"rust/crates/editor-api/src/mv_lut_atlas_transport.rs",
	"rust/wasm/src/mv_lut_atlas.rs",
];
async function identity(path) {
	const info = await lstat(path);
	assert.ok(
		info.isFile() && !info.isSymbolicLink(),
		"Ordinary checkpoint source required",
	);
	const bytes = await readFile(path);
	return {
		sha256: createHash("sha256").update(bytes).digest("hex"),
		byteLength: bytes.length,
	};
}
/** Full immutable compiled snapshot, plus ONLY the explicitly frozen LUT
 * production leaves compared with current sources. Ongoing shared registrations
 * and unrelated worktree additions are deliberately not a whole-worktree gate. */
export async function lutCompiledCheckpoint({
	root,
	directory,
	manifestSha256,
}) {
	assert.ok(isAbsolute(root) && isAbsolute(directory));
	const path = join(directory, "source-manifest.json");
	assert.equal((await identity(path)).sha256, manifestSha256);
	const manifest = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path)),
	);
	assert.ok(Array.isArray(manifest.entries) && manifest.entries.length > 0);
	const paths = new Set(),
		currentFrozenSources = [];
	for (const entry of manifest.entries) {
		assert.ok(
			typeof entry.path === "string" &&
				!isAbsolute(entry.path) &&
				!entry.path
					.split(/[\\/]/)
					.some((p) => p === ".." || p === "." || p === "") &&
				!paths.has(entry.path),
		);
		paths.add(entry.path);
		assert.equal(
			(await identity(join(directory, entry.path))).sha256,
			entry.sha256,
			"Compiled snapshot changed: " + entry.path,
		);
		if (LUT_FROZEN_RUST.includes(entry.path)) {
			assert.equal(
				(await identity(join(root, entry.path))).sha256,
				entry.sha256,
				"Frozen LUT compiled input changed: " + entry.path,
			);
			currentFrozenSources.push(entry);
		}
	}
	for (const required of [
		...LUT_FROZEN_RUST,
		"rust/crates/editor-api/src/lib.rs",
		"rust/wasm/src/wasm.rs",
	])
		assert.ok(
			paths.has(required),
			"LUT compiled checkpoint input missing: " + required,
		);
	return {
		manifestSha256,
		verifiedCompiledSnapshotFiles: manifest.entries.length,
		currentFrozenSources,
		scope:
			"Entire hash-pinned compiled snapshot + five current frozen LUT Rust production inputs only; not current shared registry/whole-worktree green",
	};
}
