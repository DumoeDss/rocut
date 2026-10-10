import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [targetCache] = process.argv.slice(2);
assert(targetCache, "Expected existing private Cargo target cache");
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
	wasmDeps = join(targetCache, "wasm32-unknown-unknown/release/deps"),
	hostDeps = join(targetCache, "release/deps");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const root = await mkdtemp("C:/tmps/liquid-transport-wasm-check-");
const sourceDirectory = join(workspace, "rust/crates/editor-api/src");
const sources = [
	fileURLToPath(import.meta.url),
	join(workspace, "script/fixtures/liquid-object-transport-wasm.rs"),
	join(workspace, "rust/wasm/src/liquid_object_transport.rs"),
	join(workspace, "rust/wasm/Cargo.toml"),
	...(await readdir(sourceDirectory))
		.filter((name) => /^liquid_object_transport.*\.rs$/.test(name))
		.map((name) => join(sourceDirectory, name)),
];
const dependencies = [],
	args = [
		"--edition",
		"2024",
		"--target",
		"wasm32-unknown-unknown",
		"--crate-type",
		"rlib",
		"--emit",
		"metadata",
		"--crate-name",
		"liquid_transport_adapter_check",
		"-L",
		`dependency=${wasmDeps}`,
		"-L",
		`dependency=${hostDeps}`,
	];
for (const name of [
	"effects",
	"serde",
	"serde_json",
	"wasm_bindgen",
	"js_sys",
]) {
	const names = (await readdir(wasmDeps)).filter(
		(file) => file.startsWith(`lib${name}-`) && file.endsWith(".rlib"),
	);
	assert.equal(names.length, 1, `Ambiguous cached dependency ${name}`);
	const path = join(wasmDeps, names[0]);
	args.push("--extern", `${name}=${path}`);
	dependencies.push(path);
}
const pins = async () =>
	Promise.all(
		[...sources, ...dependencies].map(async (path) => {
			const bytes = await readFile(path);
			if (sources.includes(path))
				new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			return { path, bytes: bytes.length, sha256: digest(bytes) };
		}),
	);
const before = await pins(),
	output = join(root, "adapter.rmeta");
const manifest = new TextDecoder("utf-8", { fatal: true })
	.decode(await readFile(join(workspace, "rust/wasm/Cargo.toml")))
	.split(/^\[package\]\r?$/m)[1]
	?.split(/^\[/m)[0];
assert(manifest, "WASM package metadata missing");
const packageName = /^name\s*=\s*"([^"]+)"\r?$/m.exec(manifest)?.[1],
	packageVersion = /^version\s*=\s*"([^"]+)"\r?$/m.exec(manifest)?.[1];
assert(packageName && packageVersion, "WASM package name/version missing");
args.push("script/fixtures/liquid-object-transport-wasm.rs", "-o", output);
const executed = spawnSync("rustc", args, {
	cwd: workspace,
	windowsHide: true,
	timeout: 30000,
	env: {
		...process.env,
		CARGO_MANIFEST_DIR: join(workspace, "rust/wasm"),
		CARGO_PKG_NAME: packageName,
		CARGO_PKG_VERSION: packageVersion,
	},
});
await writeFile(
	join(root, "build.log"),
	Buffer.concat([
		executed.stdout ?? Buffer.alloc(0),
		executed.stderr ?? Buffer.alloc(0),
	]),
	{ flag: "wx" },
);
const after = await pins(),
	drift = before.filter((file, index) => file.sha256 !== after[index].sha256);
const report = {
	ok: executed.status === 0 && drift.length === 0,
	code: executed.status,
	signal: executed.signal,
	error: executed.error?.message,
	root,
	args,
	before,
	after,
	drift,
	scope:
		"Narrow real Rust policy/session and wasm-bindgen adapter wasm32 metadata check; cached compiled dependencies reused; before/after source hashes, not same-buffer snapshots, linked WASM package or runtime acceptance",
};
if (executed.status === 0)
	report.output = { path: output, sha256: digest(await readFile(output)) };
await writeFile(join(root, "evidence.json"), JSON.stringify(report, null, 2), {
	flag: "wx",
});
console.log(
	JSON.stringify({
		ok: report.ok,
		code: report.code,
		root,
		drift: drift.map((file) => file.path),
	}),
);
if (!report.ok) process.exitCode = 1;
