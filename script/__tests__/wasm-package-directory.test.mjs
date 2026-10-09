import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildWasm, emitSyncEntry } from "../build-wasm.mjs";
import { contractCompilerConfig, runContract } from "../run-wasm-api-contract.mjs";
import { CONTROLS, POSITIVE_CONTROLS } from "../wasm-api-surface-contract.mjs";
import { packageChildArguments, packageDirectoryArguments } from "../wasm-package-directory.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const privateDir = join(tmpdir(), "rocut-private route & literal", "pkg");
const shared = join(root, "rust", "wasm", "pkg");

test("default output remains shared; split/equal overrides are consumed exactly once", () => {
	assert.deepEqual(packageDirectoryArguments(["--release"], "--out-dir", root), {
		pkgDir: shared, remaining: ["--release"],
	});
	for (const args of [["--out-dir", privateDir], [`--out-dir=${privateDir}`]]) {
		const selection = packageDirectoryArguments([...args, "--release"], "--out-dir", root);
		assert.equal(selection.pkgDir, privateDir);
		assert.deepEqual(selection.remaining, ["--release"]);
	}
});

test("ambiguous, relative, missing and unsafe build output selections fail closed", () => {
	for (const args of [
		["--out-dir"], ["--out-dir="], ["--out-dir", "relative/pkg"],
		["--out-dir", privateDir, `--out-dir=${privateDir}`],
		["--out-dir", shared], ["--out-dir", root],
		["--out-dir", join(root, "node_modules", "opencut-wasm")],
	]) assert.throws(() => packageDirectoryArguments(args, "--out-dir", root));
	assert.throws(() => packageDirectoryArguments(["--pkg-dir", "relative"], "--pkg-dir", root));
	// Read-only gate children may explicitly pin the default directory too.
	assert.equal(packageDirectoryArguments(["--pkg-dir", shared], "--pkg-dir", root).pkgDir, shared);
});

test("build invokes wasm-pack and sync emission with exactly the same selected directory", () => {
	for (const args of [[], ["--out-dir", privateDir, "--release"]]) {
		let emitted, invocation;
		assert.equal(buildWasm(args, {
			assertPins() {},
			run(command, argv, options) { invocation = { command, argv, options }; return { status: 0 }; },
			emit(directory) { emitted = directory; },
		}), 0);
		assert.equal(invocation.command, "wasm-pack");
		assert.equal(invocation.options.shell, false);
		assert.equal(invocation.argv.filter((arg) => arg === "--out-dir").length, 1);
		assert.equal(invocation.argv[invocation.argv.indexOf("--out-dir") + 1], emitted);
		assert.equal(emitted, args.length ? privateDir : shared);
	}
	let emitted = false;
	assert.equal(buildWasm(["--out-dir", privateDir], {
		assertPins() {}, run() { return { status: 7 }; }, emit() { emitted = true; },
	}), 7);
	assert.equal(emitted, false);
});

test("all negative and positive child invocations retain the same package selection", () => {
	for (const control of [...Object.keys(CONTROLS), ...Object.keys(POSITIVE_CONTROLS)]) {
		const args = packageChildArguments("gate.mjs", privateDir, `--fixture-negative=${control}`);
		assert.deepEqual(args, ["gate.mjs", "--pkg-dir", privateDir, `--fixture-negative=${control}`]);
		const selected = packageDirectoryArguments(args.slice(1), "--pkg-dir", root);
		assert.equal(selected.pkgDir, privateDir);
		assert.deepEqual(selected.remaining, [`--fixture-negative=${control}`]);
	}
	const config = contractCompilerConfig(privateDir);
	assert.deepEqual(config.compilerOptions.paths, { "opencut-wasm": [join(privateDir, "opencut_wasm.d.ts")] });
	assert.equal(config.compilerOptions.strict, true);
	assert.equal(config.compilerOptions.noEmit, true);
	assert.ok(config.files.every(isAbsolute));
});

test("private gate never falls back to shared output when its directory is absent", () => {
	const absent = join(tmpdir(), `rocut-absent-${process.pid}-${Date.now()}`);
	const result = spawnSync(process.execPath, [join(root, "script", "check-wasm-api-surface.mjs"), "--pkg-dir", absent], { encoding: "utf8" });
	assert.equal(result.status, 2);
	assert.ok(result.stderr.includes(absent));
	const control = spawnSync(process.execPath, [join(root, "script", "check-wasm-api-surface.mjs"), "--pkg-dir", absent, "--negative-control"], { encoding: "utf8" });
	assert.equal(control.status, 1);
	assert.ok(control.stderr.includes(absent), "negative-control subprocess must use the private directory");
	assert.throws(() => runContract(["--pkg-dir", absent], () => assert.fail("must not run TypeScript")), /Missing package declarations/);
	const typo = spawnSync(process.execPath, [join(root, "script", "check-wasm-api-surface.mjs"), "--pkgdir", absent], { encoding: "utf8" });
	assert.equal(typo.status, 2);
	assert.match(typo.stderr, /unknown argument/);
});

test("emission and compiler routing use only isolated temporary fixture files", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "rocut-wasm-script-test-"));
	t.diagnostic(`Retained fixtures: ${directory}`);
	const pkg = join(directory, "private pkg & literal");
	mkdirSync(pkg);
	writeFileSync(join(pkg, "opencut_wasm.js"), 'export { fixtureExport, } from "./opencut_wasm_bg.js";', "utf8");
	writeFileSync(join(pkg, "package.json"), JSON.stringify({ files: ["opencut_wasm.js", "NOTICE"], sideEffects: ["./opencut_wasm_bg.js"] }), "utf8");
	writeFileSync(join(pkg, "opencut_wasm.d.ts"), "export const fixtureExport: number;", "utf8");
	for (let repeat = 0; repeat < 2; repeat++) emitSyncEntry(pkg);
	assert.match(readFileSync(join(pkg, "opencut_wasm_sync.js"), "utf8"), /export \{ fixtureExport, \} from/);
	assert.deepEqual(readFileSync(join(pkg, "NOTICE")), readFileSync(join(root, "rust", "wasm", "NOTICE")));
	const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
	for (const name of ["opencut_wasm_sync.js", "NOTICE"]) assert.equal(manifest.files.filter((value) => value === name).length, 1);
	assert.equal(manifest.exports["."].bun, "./opencut_wasm_sync.js");
	let configPath;
	assert.equal(runContract(["--pkg-dir", pkg], (command, args) => {
		assert.equal(command, process.execPath);
		assert.equal(args[1], "--project");
		configPath = args[2];
		const config = JSON.parse(readFileSync(configPath, "utf8"));
		assert.deepEqual(config, contractCompilerConfig(pkg));
		return { status: 0 };
	}), 0);
	assert.equal(existsSync(configPath), false);
	assert.equal(existsSync(dirname(configPath)), false);
	assert.equal(runContract(["--pkg-dir", pkg], (_command, args) => {
		configPath = args[2];
		return { status: 9, stderr: "mock compiler failure" };
	}), 9);
	assert.equal(existsSync(dirname(configPath)), false);
});
