import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { inkFileIdentity } from "./mv-ink-export-identities.mjs";
export { inkFileIdentity as tunnelFileIdentity };
export const TUNNEL_REQUIRED_INPUTS = [
	"rust/crates/editor-api/Cargo.toml",
	"rust/crates/editor-api/src/lib.rs",
	"rust/crates/editor-api/src/programmatic.rs",
	"rust/crates/editor-api/src/programmatic_tunnel_fonts.rs",
	"rust/crates/editor-api/src/mv_reference_post.rs",
	"rust/crates/editor-api/src/mv_recipe/tunnel.rs",
	"rust/crates/editor-api/src/mv_recipe/tunnel_fonts.rs",
	"rust/crates/editor-api/src/mv_recipe/tunnel_context.rs",
	"rust/crates/editor-api/src/mv_recipe/tunnel_plan.rs",
	"rust/wasm/src/tunnel_font_stack.rs",
	"rust/wasm/src/wasm.rs",
];
function nativeSceneInput(path) {
	// These raster gates call editor-api scene plans and Canvas2D primitives.
	// They do not call EffectPipeline, compositor or GPU export entry points.
	// Those binary inputs remain immutable/hash-verified, but their concurrent
	// worktree changes cannot be reported as current-source acceptance here.
	return (
		["Cargo.toml", "Cargo.lock", "rust-toolchain.toml"].includes(path) ||
		/^rust\/crates\/(editor-api|time|bridge)\//.test(path) ||
		path === "rust/wasm/Cargo.toml" ||
		/^rust\/wasm\/src\/(wasm|tunnel_font_stack|mv_heart_owner|mv_image_preprocess)\.rs$/.test(
			path,
		)
	);
}
export async function tunnelRustIdentity({
	root,
	directory,
	manifestSha256,
	currentScope = "whole-rust-workspace",
}) {
	assert.ok(isAbsolute(directory));
	assert.ok(
		["whole-rust-workspace", "native-scene", "compiled-snapshot"].includes(
			currentScope,
		),
		"Unknown current-source checkpoint scope",
	);
	const path = join(directory, "source-manifest.json");
	assert.equal((await inkFileIdentity(path)).sha256, manifestSha256);
	const manifest = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path)),
	);
	assert.ok(Array.isArray(manifest.entries) && manifest.entries.length > 0);
	const selected = [];
	const snapshotOnlySources = [];
	const paths = new Set();
	for (const entry of manifest.entries) {
		assert.ok(
			typeof entry.path === "string" &&
				!isAbsolute(entry.path) &&
				!entry.path.split(/[\\/]/).includes("..") &&
				!paths.has(entry.path),
		);
		paths.add(entry.path);
		assert.equal(
			(await inkFileIdentity(join(directory, entry.path))).sha256,
			entry.sha256,
			`Snapshot changed: ${entry.path}`,
		);
		if (
			currentScope === "compiled-snapshot"
				? false
				: currentScope === "native-scene"
					? nativeSceneInput(entry.path)
					: entry.path.startsWith("rust/")
		) {
			assert.equal(
				(await inkFileIdentity(join(root, entry.path))).sha256,
				entry.sha256,
				`Current source differs: ${entry.path}`,
			);
			selected.push(entry);
		} else if (entry.path.startsWith("rust/")) snapshotOnlySources.push(entry);
	}
	for (const required of TUNNEL_REQUIRED_INPUTS)
		assert.ok(
			paths.has(required),
			`Missing compiled Tunnel source: ${required}`,
		);
	return {
		currentScope,
		scope:
			currentScope === "compiled-snapshot"
				? "Every immutable compiled input is verified; frozen-source binary behavior only, no current-worktree source or release acceptance"
				: currentScope === "native-scene"
					? "Every immutable compiled input is verified; current-source match covers editor-api, native-scene time/bridge dependencies and adapters/toolchain. EffectPipeline/compositor/GPU modules are snapshot-only, not current compositor/GPU export acceptance"
					: "Every immutable compiled input and every current Rust source in the snapshot is verified",
		manifestSha256,
		verifiedSnapshotFiles: manifest.entries.length,
		currentMatchingSources: selected,
		snapshotOnlySources,
	};
}
