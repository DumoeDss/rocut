import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotNativeSource } from "./mv-native-snapshot.mjs";

function fixture() {
	const parent = mkdtempSync(join(tmpdir(), "rocut-native-snapshot-fixture-"));
	const root = join(parent, "workspace");
	const files = {
		"Cargo.toml": "[workspace]\nmembers=[]\n",
		"Cargo.lock": "version = 4\n",
		"rust-toolchain.toml": "[toolchain]\nchannel='1.88.0'\n",
		"rust/crates/editor-api/src/mv_recipe/tunnel.rs": "// 原生镜头\n",
		"apps/desktop/Cargo.toml": "[package]\nname='fixture'\n",
		"rust/wasm/pkg/generated.txt": "Must not be copied",
		"rust/target/generated.txt": "Must not be copied",
	};
	for (const [name, contents] of Object.entries(files)) {
		mkdirSync(join(root, name, ".."), { recursive: true });
		writeFileSync(join(root, name), contents);
	}
	return { parent, root, files };
}

test("native snapshot preserves exact producer bytes and excludes generated artifacts", () => {
	const { parent, root, files } = fixture(),
		destination = join(parent, "source");
	const result = snapshotNativeSource({ root, destination });
	const bytes = readFileSync(join(destination, "source-manifest.json"));
	const manifest = JSON.parse(bytes.toString("utf8"));
	expect(result.sourceManifestSha256).toBe(
		createHash("sha256").update(bytes).digest("hex"),
	);
	expect(manifest.entries.map(({ path }) => path)).toEqual([
		"Cargo.lock",
		"Cargo.toml",
		"apps/desktop/Cargo.toml",
		"rust-toolchain.toml",
		"rust/crates/editor-api/src/mv_recipe/tunnel.rs",
	]);
	for (const entry of manifest.entries) {
		expect(readFileSync(join(destination, entry.path), "utf8")).toBe(
			files[entry.path],
		);
		expect(entry.sha256).toBe(
			createHash("sha256").update(files[entry.path]).digest("hex"),
		);
	}
	const source = "rust/crates/editor-api/src/mv_recipe/tunnel.rs";
	writeFileSync(join(root, source), "// Later source version\n");
	expect(readFileSync(join(destination, source), "utf8")).toBe("// 原生镜头\n");
});

test("native snapshots cannot overwrite or hide inside a worktree, including dot-dot names", () => {
	const { parent, root } = fixture();
	for (const destination of [
		root,
		join(root, "source"),
		join(root, "..pretends-outside"),
	])
		expect(() => snapshotNativeSource({ root, destination })).toThrow(
			"outside the worktree",
		);
	const destination = join(parent, "already-existing");
	mkdirSync(destination);
	writeFileSync(join(destination, "keep.txt"), "keep");
	expect(() => snapshotNativeSource({ root, destination })).toThrow(
		"already exists",
	);
	expect(readFileSync(join(destination, "keep.txt"), "utf8")).toBe("keep");
});

test("invalid UTF-8 producer source fails before copying and manifest publication", () => {
	const { parent, root } = fixture();
	writeFileSync(
		join(root, "rust/crates/editor-api/src/mv_recipe/tunnel.rs"),
		new Uint8Array([255]),
	);
	expect(() =>
		snapshotNativeSource({ root, destination: join(parent, "source") }),
	).toThrow();
});
