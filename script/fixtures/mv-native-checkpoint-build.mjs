#!/usr/bin/env node
/**
 * Builds a self-consistent "compiled source checkpoint + WASM + verification" triple
 * from the CURRENT worktree, for native-scene browser probes (night/tunnel/train)
 * that require ROCUT_TEST_RUST_SOURCE + a verification.json-carrying WASM directory.
 *
 * This is a re-establishment of the private acceptance environment helper
 * (mv-flame-isolated-build.mjs), generalized: instead of a frozen baseline plus
 * pinned overlays it snapshots the current rust/ tree, which is exactly what
 * "current WASM was built from current tree" means for the resumed agile line.
 * The probes verify current-source match themselves (tunnelRustIdentity /
 * nightCompiledCheckpoint), so a current-tree snapshot is the strongest honest input.
 *
 * Usage: node script/fixtures/mv-native-checkpoint-build.mjs --out-root <absolute>
 * Emits <out-root>/source (snapshot + source-manifest.json) and <out-root>/wasm
 * (web-target pkg + verification.json).
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertToolchain } from "../wasm-toolchain.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const flag = process.argv.indexOf("--out-root");
assert.ok(flag > 0 && process.argv.length === flag + 2, "Supply --out-root <absolute>");
const outRoot = resolve(process.argv[flag + 1]);
assert.ok(isAbsolute(outRoot) && outRoot.startsWith(tmpdir()), "--out-root must be absolute under the OS temp dir");
assert.notEqual(outRoot, resolve(root, "rust", "target"));
assertToolchain();

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const contained = (directory, name) => {
	assert.ok(!isAbsolute(name) && !name.includes("\\") && !name.split("/").includes(".."));
	const path = resolve(directory, name);
	const rel = relative(directory, path);
	assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel));
	return path;
};
const file = (path) => {
	const stat = lstatSync(path);
	assert.ok(stat.isFile() && !stat.isSymbolicLink(), "Snapshot source must be an ordinary file");
	return readFileSync(path);
};

// Root manifests + the whole rust/ workspace and cargo workspace members under
// apps/ (minus build outputs), matching what wasm-pack needs to resolve the
// workspace graph with --locked.
const names = [
	"Cargo.toml",
	"Cargo.lock",
	"rust-toolchain.toml",
	...execFileSync(
		"rg",
		["--files", "rust", "apps", "-g", "!rust/wasm/pkg/**", "-g", "!rust/target/**", "-g", "!**/node_modules/**", "-g", "!**/dist/**", "-g", "!**/.next/**"],
		{ cwd: root, encoding: "utf8", windowsHide: true },
	)
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.map((path) => path.replaceAll("\\", "/")),
];
const entries = names.map((path) => ({
	path,
	origin: root.replaceAll("\\", "/"),
	sha256: sha(file(contained(root, path))),
}));
assert.ok(new Set(names).size === names.length, "Duplicate snapshot path");

const source = join(outRoot, "source");
const output = join(outRoot, "wasm");
mkdirSync(source, { recursive: true });
for (const input of entries) {
	const from = contained(root, input.path);
	const to = contained(source, input.path);
	mkdirSync(dirname(to), { recursive: true });
	copyFileSync(from, to);
	assert.equal(sha(file(to)), input.sha256, "Snapshot copy mismatch: " + input.path);
}
const sourceManifest = {
	version: 1,
	baseline: root.replaceAll("\\", "/"),
	source,
	sourceRoot: root,
	scope:
		"Current-worktree compiled snapshot (rust workspace + root manifests) rebuilt by mv-native-checkpoint-build; the WASM in ./wasm was compiled from exactly these bytes. Not a whole-worktree or shared-install acceptance claim.",
	entries,
};
const manifestBytes = Buffer.from(JSON.stringify(sourceManifest, null, 2));
const manifestPath = join(source, "source-manifest.json");
writeFileSync(manifestPath, manifestBytes, { flag: "wx" });

const check = () => {
	for (const input of entries)
		assert.equal(sha(file(contained(source, input.path))), input.sha256, "Private source changed during build: " + input.path);
};

// Web target: single-file glue (export class MvNightOwner / resolveProgrammaticFrameTunnelJson
// live in opencut_wasm.js), which is what the browser probes grep.
const privateTarget = join(outRoot, "target");
const args = ["build", "rust/wasm", "--target", "web", "--out-dir", output, "--", "--offline", "--locked"];
const env = {
	...process.env,
	CARGO_TARGET_DIR: privateTarget,
	RUSTFLAGS: [
		[process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "/cargo"],
		[source, "/opencut"],
		["/wasm/", "/opencut/rust/wasm/"],
		["/crates/", "/opencut/rust/crates/"],
	]
		.map(([from, to]) => `--remap-path-prefix=${from.replaceAll("\\", "/")}=${to}`)
		.join(" "),
};
console.log(JSON.stringify({ outRoot, source, output, privateTarget, files: entries.length, state: "wasm-building" }));
const result = spawnSync("wasm-pack", args, { cwd: source, env, stdio: "inherit", windowsHide: true, timeout: 1800000 });
check();
mkdirSync(output, { recursive: true });
const report = {
	mode: "wasm",
	command: "wasm-pack",
	args,
	exitCode: result.status,
	error: result.error?.message,
	sourceDirectory: source,
	sourceManifestSha256: sha(manifestBytes),
	privateTarget,
	buildHelper: {
		path: relative(root, fileURLToPath(import.meta.url)).replaceAll("\\", "/"),
		sha256: sha(file(fileURLToPath(import.meta.url))),
	},
	wasmSha256: result.status === 0 ? sha(file(join(output, "opencut_wasm_bg.wasm"))) : undefined,
};
writeFileSync(join(output, "verification.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report));
if (result.error) throw result.error;
process.exit(result.status ?? 1);
