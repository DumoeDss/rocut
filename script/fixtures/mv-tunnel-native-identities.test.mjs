import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	TUNNEL_REQUIRED_INPUTS,
	tunnelRustIdentity,
} from "./mv-tunnel-native-identities.mjs";

function fixture() {
	const parent = mkdtempSync(join(tmpdir(), "rocut-scene-identities-"));
	const root = join(parent, "worktree"),
		directory = join(parent, "capsule");
	const paths = [
		...TUNNEL_REQUIRED_INPUTS,
		"Cargo.lock",
		"rust/crates/time/src/time.rs",
		"rust/crates/effects/src/effects.rs",
		"rust/crates/compositor/src/compositor.rs",
		"rust/wasm/src/mv_heart_owner.rs",
	];
	const entries = paths.map((path) => {
		const bytes = Buffer.from(`Immutable input ${path}\n`);
		for (const parent of [root, directory]) {
			mkdirSync(dirname(join(parent, path)), { recursive: true });
			writeFileSync(join(parent, path), bytes);
		}
		return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
	});
	const manifest = Buffer.from(JSON.stringify({ entries }));
	writeFileSync(join(directory, "source-manifest.json"), manifest);
	return {
		root,
		directory,
		manifestSha256: createHash("sha256").update(manifest).digest("hex"),
	};
}

test("native-only gate explicitly records untested compositor drift without claiming current GPU/export parity", async () => {
	const options = fixture();
	const path = "rust/crates/compositor/src/compositor.rs";
	writeFileSync(join(options.root, path), "Concurrent compositor change\n");
	await expect(tunnelRustIdentity(options)).rejects.toThrow(
		`Current source differs: ${path}`,
	);
	const result = await tunnelRustIdentity({
		...options,
		currentScope: "native-scene",
	});
	expect(result.snapshotOnlySources.map(({ path }) => path)).toEqual([
		"rust/crates/effects/src/effects.rs",
		path,
	]);
	expect(
		result.currentMatchingSources.some((entry) => entry.path === path),
	).toBe(false);
	expect(result.scope).toContain(
		"not current compositor/GPU export acceptance",
	);
});

test("scene producer, adapters, local dependencies and toolchain drift remain fatal", async () => {
	for (const path of [
		"rust/crates/editor-api/src/programmatic.rs",
		"rust/wasm/src/mv_heart_owner.rs",
		"rust/crates/time/src/time.rs",
		"rust/crates/editor-api/src/mv_recipe/tunnel.rs",
		"Cargo.lock",
	]) {
		const options = fixture();
		writeFileSync(join(options.root, path), "Changed tested input\n");
		await expect(
			tunnelRustIdentity({ ...options, currentScope: "native-scene" }),
		).rejects.toThrow(`Current source differs: ${path}`);
	}
});

test("snapshot-only inputs still cannot be tampered or hidden with an unknown scope", async () => {
	const options = fixture();
	await expect(
		tunnelRustIdentity({ ...options, currentScope: "ignore" }),
	).rejects.toThrow("Unknown current-source checkpoint scope");
	const path = "rust/crates/compositor/src/compositor.rs";
	writeFileSync(join(options.directory, path), "Tampered compiled input\n");
	await expect(
		tunnelRustIdentity({ ...options, currentScope: "native-scene" }),
	).rejects.toThrow(`Snapshot changed: ${path}`);
});

test("explicit compiled-snapshot mode proves binary inputs without any current-worktree claim", async () => {
	const options = fixture();
	writeFileSync(
		join(options.root, "rust/wasm/src/wasm.rs"),
		"Concurrent registration\n",
	);
	await expect(
		tunnelRustIdentity({ ...options, currentScope: "native-scene" }),
	).rejects.toThrow("Current source differs");
	const result = await tunnelRustIdentity({
		...options,
		currentScope: "compiled-snapshot",
	});
	expect(result.currentMatchingSources).toEqual([]);
	expect(result.snapshotOnlySources).toHaveLength(
		TUNNEL_REQUIRED_INPUTS.length + 4,
	);
	expect(result.scope).toContain(
		"no current-worktree source or release acceptance",
	);
});
