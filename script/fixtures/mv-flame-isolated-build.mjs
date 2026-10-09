import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertToolchain } from "../wasm-toolchain.mjs";

// Only immutable producer snapshots and explicit owner files are combined.
// No shared target, dependency installation, tree swap or installed plugin write.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [baseline, flameManifestPath, privateTarget] = process.argv.slice(2);
for (const path of [baseline, flameManifestPath, privateTarget])
	assert.ok(
		typeof path === "string" && isAbsolute(path),
		"Supply three absolute private paths",
	);
assert.equal(process.argv.length, 5);
assert.notEqual(resolve(privateTarget), resolve(root, "rust/target"));
assertToolchain();
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const contained = (directory, name) => {
	assert.ok(
		!isAbsolute(name) &&
			!name.includes("\\") &&
			!name.split("/").includes(".."),
	);
	const path = resolve(directory, name),
		rel = relative(directory, path);
	assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel));
	return path;
};
const file = (path) => {
	const stat = lstatSync(path);
	assert.ok(
		stat.isFile() && !stat.isSymbolicLink(),
		"Snapshot source must be an ordinary file",
	);
	return readFileSync(path);
};
const flameManifestBytes = file(flameManifestPath);
assert.equal(
	sha(flameManifestBytes),
	"03f6bb90584a0e9c112af96f1ac2d930a45f71739a5b5d949638a4e9af2020a7",
);
const flameManifest = JSON.parse(
	new TextDecoder("utf-8", { fatal: true }).decode(flameManifestBytes),
);
for (const input of flameManifest.files)
	assert.equal(
		sha(file(contained(baseline, input.path))),
		input.sha256.toLowerCase(),
		`Flame snapshot changed: ${input.path}`,
	);

const overlays = [
	[
		"rust/wasm/src/mv_image_preprocess.rs",
		"f77db9c15b2d41b3ccd785c518c4834e887d8075790a44b7239ab52d478ac5a1",
	],
	[
		"rust/wasm/src/wasm.rs",
		"2236a2045987662926e8ed0697d12d8a502c087b8b69fdcfb4b02a45d8d162a6",
	],
	[
		"rust/crates/editor-api/src/video_export.rs",
		"24f106c81d581f0f48095af0409e1b6ac39dd426b1b0a113d289c2ec11cbcf60",
	],
	[
		"rust/crates/editor-api/src/video_export/quantizer.rs",
		"2ed2ece440fab8a5e22e7d3a3487698354e1d797f21fc5756808f7e135b976f8",
	],
	[
		"rust/crates/editor-api/src/video_export/vp9.rs",
		"a06c00b9ea0b918133039768158564be473309ccb861704325e127897ece0ec1",
	],
	[
		"rust/crates/editor-api/tests/video_export.rs",
		"8f4d78c40026bce7235f81dea6a56732b84d1305812dba8fb5f1b8451850b63d",
	],
	[
		"rust/crates/editor-api/examples/vp9-quantizer-policy.rs",
		"48444f719897828bd9e932e7cdaa0004eae8b565b1ee6b9075aa5413bc48d0f5",
	],
];
const names = [
	"Cargo.toml",
	"Cargo.lock",
	"rust-toolchain.toml",
	...execFileSync(
		"rg",
		[
			"--files",
			"rust",
			"apps",
			"-g",
			"!rust/wasm/pkg/**",
			"-g",
			"!rust/target/**",
		],
		{ cwd: baseline, encoding: "utf8", windowsHide: true },
	)
		.trim()
		.split(/\r?\n/)
		.map((path) => path.replaceAll("\\", "/")),
];
const entries = new Map(
	names.map((path) => [
		path,
		{ path, origin: baseline, sha256: sha(file(contained(baseline, path))) },
	]),
);
for (const [path, expected] of overlays) {
	assert.equal(
		sha(file(contained(root, path))),
		expected,
		`Owner source changed: ${path}`,
	);
	entries.set(path, { path, origin: root, sha256: expected });
}
const artifact = mkdtempSync(join(tmpdir(), "rocut-flame-integrated-"));
const source = join(artifact, "source"),
	output = join(artifact, "wasm");
for (const input of entries.values()) {
	const from = contained(input.origin, input.path),
		to = contained(source, input.path);
	mkdirSync(dirname(to), { recursive: true });
	copyFileSync(from, to);
	assert.equal(sha(file(from)), input.sha256, "Input changed during snapshot");
	assert.equal(sha(file(to)), input.sha256, "Snapshot copy mismatch");
}
const sourceManifest = {
	version: 1,
	baseline,
	source,
	sourceRoot: root,
	scope:
		"Frozen Flame producer baseline plus explicit WASM owner and VP9 export overlays; excludes unrelated current-worktree library/animation overlays",
	flameManifest: { path: flameManifestPath, sha256: sha(flameManifestBytes) },
	entries: [...entries.values()],
};
const manifestBytes = Buffer.from(JSON.stringify(sourceManifest, null, 2));
writeFileSync(join(source, "source-manifest.json"), manifestBytes, {
	flag: "wx",
});
const check = () => {
	for (const input of entries.values())
		assert.equal(
			sha(file(contained(source, input.path))),
			input.sha256,
			"Private source changed during build",
		);
};
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
console.log(
	JSON.stringify({
		artifact,
		source,
		output,
		privateTarget,
		files: entries.size,
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
	wasmSha256:
		result.status === 0
			? sha(file(join(output, "opencut_wasm_bg.wasm")))
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
