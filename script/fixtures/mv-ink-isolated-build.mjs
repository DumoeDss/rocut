import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertToolchain } from "../wasm-toolchain.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [source, output, privateTarget] = process.argv.slice(2);
assert.equal(process.argv.length, 5);
for (const path of [source, output, privateTarget])
	assert.ok(
		typeof path === "string" && isAbsolute(path),
		"Supply three absolute private paths",
	);
assert.notEqual(resolve(source), root, "Never build the shared worktree");
assert.notEqual(resolve(privateTarget), resolve(root, "rust/target"));
assert.notEqual(resolve(output), resolve(root, "rust/wasm/pkg"));
assert.ok(
	lstatSync(source).isDirectory() && !lstatSync(source).isSymbolicLink(),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytes = (path) => {
	const stat = lstatSync(path);
	assert.ok(
		stat.isFile() && !stat.isSymbolicLink(),
		"Expected ordinary source file",
	);
	return readFileSync(path);
};
const manifestPath = join(source, "source-manifest.json");
const manifestBytes = bytes(manifestPath);
const manifest = JSON.parse(
	new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
);
assert.ok(Array.isArray(manifest.entries) && manifest.entries.length > 0);
assert.ok(
	manifest.entries.some(({ path }) => path.endsWith("mv_recipe/ink.rs")),
);
const check = () => {
	assert.equal(
		hash(bytes(manifestPath)),
		hash(manifestBytes),
		"Manifest changed during build",
	);
	for (const entry of manifest.entries) {
		assert.ok(
			typeof entry.path === "string" &&
				!isAbsolute(entry.path) &&
				!entry.path.split(/[\\/]/).includes(".."),
		);
		assert.equal(
			hash(bytes(join(source, entry.path))),
			entry.sha256,
			`Private source changed: ${entry.path}`,
		);
	}
};
check();
assertToolchain();
// Fresh output only; never replace a prior verified package or its report.
mkdirSync(output);
const args = [
	"build",
	"rust/wasm",
	"--target",
	"web",
	"--out-dir",
	output,
	"--",
	"--offline",
	"--locked",
];
const env = {
	...process.env,
	CARGO_TARGET_DIR: privateTarget,
	RUSTFLAGS: [
		[process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "/cargo"],
		[source, "/opencut"],
		["/wasm/", "/opencut/rust/wasm/"],
		["/crates/", "/opencut/rust/crates/"],
	]
		.map(
			([from, to]) => `--remap-path-prefix=${from.replaceAll("\\", "/")}=${to}`,
		)
		.join(" "),
};
const helper = fileURLToPath(import.meta.url);
const helperSha256 = hash(bytes(helper));
console.log(
	JSON.stringify({
		source,
		output,
		privateTarget,
		files: manifest.entries.length,
		state: "wasm-building",
	}),
);
const result = spawnSync("wasm-pack", args, {
	cwd: source,
	env,
	stdio: "inherit",
	windowsHide: true,
	timeout: 600000,
});
check();
assert.equal(
	hash(bytes(helper)),
	helperSha256,
	"Build helper changed during run",
);
const report = {
	mode: "wasm",
	command: "wasm-pack",
	args,
	exitCode: result.status,
	error: result.error?.message,
	sourceDirectory: source,
	sourceManifestSha256: hash(manifestBytes),
	privateTarget,
	buildHelper: {
		path: relative(root, helper).replaceAll("\\", "/"),
		sha256: helperSha256,
	},
	wasmSha256:
		result.status === 0
			? hash(bytes(join(output, "opencut_wasm_bg.wasm")))
			: undefined,
};
writeFileSync(
	join(output, "verification.json"),
	JSON.stringify(report, null, 2),
	{ flag: "wx" },
);
console.log(JSON.stringify(report));
if (result.error) throw result.error;
process.exit(result.status ?? 1);
