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

test("recapture verifies immutable selection but reads current bytes without capturing unrelated new leaves", () => {
	const { parent, root } = fixture();
	const previous = join(parent, "previous");
	snapshotNativeSource({ root, destination: previous });
	const source = "rust/crates/editor-api/src/mv_recipe/tunnel.rs";
	writeFileSync(join(root, source), "// Corrected current producer\n");
	writeFileSync(
		join(root, "rust/crates/editor-api/src/mv_recipe/new-unregistered.rs"),
		"// In progress\n",
	);
	const destination = join(parent, "recaptured");
	snapshotNativeSource({ root, destination, selectionSnapshot: previous });
	const manifest = JSON.parse(
		readFileSync(join(destination, "source-manifest.json"), "utf8"),
	);
	expect(readFileSync(join(destination, source), "utf8")).toBe(
		"// Corrected current producer\n",
	);
	expect(
		manifest.entries.some(({ path }) => path.endsWith("new-unregistered.rs")),
	).toBe(false);
	expect(manifest.selectionSnapshot.directory).toBe(previous);
	expect(manifest.scope).toContain("not a whole-current-worktree checkpoint");
	writeFileSync(join(previous, source), "// Tampered historical capsule\n");
	expect(() =>
		snapshotNativeSource({
			root,
			destination: join(parent, "bad"),
			selectionSnapshot: previous,
		}),
	).toThrow("Selection snapshot bytes changed");
});

test("recapture admits only explicit new compilation inputs without rewriting the old capsule", () => {
	const { parent, root } = fixture();
	const previous = join(parent, "previous");
	snapshotNativeSource({ root, destination: previous });
	const extra = "rust/crates/editor-api/src/mv_recipe/renderer_bridge.rs";
	writeFileSync(join(root, extra), "// New registered dependency\n");
	const result = snapshotNativeSource({
		root,
		destination: join(parent, "expanded"),
		selectionSnapshot: previous,
		additionalPaths: [extra],
	});
	const manifest = JSON.parse(
		readFileSync(join(result.source, "source-manifest.json"), "utf8"),
	);
	expect(manifest.selectionSnapshot.additionalPaths).toEqual([extra]);
	expect(readFileSync(join(result.source, extra), "utf8")).toBe(
		"// New registered dependency\n",
	);
	expect(
		JSON.parse(
			readFileSync(join(previous, "source-manifest.json"), "utf8"),
		).entries.some(({ path }) => path === extra),
	).toBe(false);
	for (const invalid of [
		"../outside.rs",
		"rust/../outside.rs",
		"rust/wasm/pkg/../../outside.rs",
		"rust//outside.rs",
		"rust/./outside.rs",
		"C:/outside.rs",
		"rust/secrets.txt",
		"rust/crates/editor-api/src/mv_recipe/tunnel.rs",
	])
		expect(() =>
			snapshotNativeSource({
				root,
				destination: join(parent, "rejected"),
				selectionSnapshot: previous,
				additionalPaths: [invalid],
			}),
		).toThrow("unique relative Rust compilation input");
	expect(() =>
		snapshotNativeSource({
			root,
			destination: join(parent, "missing"),
			selectionSnapshot: previous,
			additionalPaths: ["rust/missing.rs"],
		}),
	).toThrow();
});
