#!/usr/bin/env node
// Builds one frozen, pinned binary. Browser glue derives from that exact binary;
// it never runs wasm-pack a second time or writes shared dependency packages.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { freezeLiquidWasmSource } from "./fixtures/liquid-object-wasm-snapshot.mjs";
import { createLiquidWasmProbeIO } from "./fixtures/liquid-object-wasm-development-support.mjs";
import { checkCapabilities } from "./fixtures/liquid-object-wasm-capability-gates.mjs";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Reusing an authority root always derives into a fresh directory. The legacy
// verify spelling must not rewrite a historical browser artifact or its receipt.
const deriveOnly = ["--verify-root", "--derive-root"].includes(process.argv[2]);
const verifyRoot = ["--verify-root", "--derive-root"].includes(process.argv[2]) ? process.argv[3] : undefined;
assert(process.argv.length === (verifyRoot ? 4 : 2), "Usage: acceptance-wasm-baseline.mjs [--verify-root|--derive-root <this helper's owned private root>]");
if (verifyRoot) {
	assert(isAbsolute(verifyRoot) && dirname(resolve(verifyRoot)) === resolve(tmpdir()) && basename(verifyRoot).startsWith("rocut-wasm-authority-20261011-"));
	assert.equal(await realpath(verifyRoot), resolve(verifyRoot), "No redirected verification root");
}
const root = verifyRoot ? resolve(verifyRoot) : await mkdtemp(join(tmpdir(), "rocut-wasm-authority-20261011-"));
const source = join(root, "source"), pkg = join(root, "pkg"), browserPkg = deriveOnly ? await mkdtemp(join(root, "browser-pkg-v2-")) : join(root, "browser-pkg"), target = join(root, "target");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const verificationLogs = verifyRoot ? await mkdtemp(join(root, "verify-")) : root;
const { files, manifest, run, free } = createLiquidWasmProbeIO({ root: verificationLogs });
const save = (name, value) => writeFile(join(verificationLogs, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const git = (...args) => execFileSync("git", args, { cwd: workspace, windowsHide: true });
const report = { version: 1, ok: false, started: new Date().toISOString(), root, source, pkg, browserPkg, target,
	scope: "Frozen current Rust workspace, root Cargo manifests, desktop member and pinned build scripts; one release binary, derived browser glue; not installed Electron or whole frontend acceptance",
	directoryOwnership: { root, owner: "wasm_authority 20261011", purpose: "source freeze, private cargo target, one authoritative binary and retained gate logs", retention: "Retain for unified reruns and source audit; no automatic cleanup, never remove another run's directory" },
};
if (verifyRoot) {
	const previous = JSON.parse(await readFile(join(root, "evidence.json"), "utf8"));
	assert.equal(previous.directoryOwnership?.owner, "wasm_authority 20261011");
	assert.equal(previous.root, root); assert.equal(previous.build?.code, 0);
	Object.assign(report, previous, { ok: false, verificationStarted: new Date().toISOString(), verificationLogs, browserPkg });
	if (deriveOnly) {
		report.derivativeOwnership = { directory: browserPkg, purpose: "Immutable async browser derivative v2; same authority binary, no Rust recompilation", owner: "wasm_authority 20261011", retention: "Retain alongside v1 failure receipts; no automatic removal or overwrite" };
		report.previousBrowserPackage = await manifest(join(root, "browser-pkg"));
	}
	report.priorPackageInventory = { workspace: previous.inventoryWorkspace ?? workspace, before: previous.packagesBefore, after: previous.packagesAfter, drift: previous.sharedPackageDrift };
	report.packagesBefore = await packageInventory();
	delete report.failure;
}
report.inventoryWorkspace = workspace;
report.verificationWorkspace = workspace;
report.helper = { path: relative(workspace, fileURLToPath(import.meta.url)).replaceAll("\\", "/"), sha256: hash(await readFile(fileURLToPath(import.meta.url))) };
const env = { ...process.env, CARGO_TARGET_DIR: target };
for (const key of Object.keys(env)) if (["OPENCUT_WASM_ALLOW_UNPINNED", "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "NODE_OPTIONS", "BUN_OPTIONS"].includes(key.toUpperCase())) delete env[key];
const normalized = (entry) => ({ ...entry, path: entry.path.replaceAll("\\", "/") });
const gatePaths = ["script/check-wasm-api-surface.mjs", "script/wasm-api-surface-contract.mjs", "script/run-wasm-api-contract.mjs", "script/fixtures/wasm-runtime-contract.ts", "script/check-wasm-paths.mjs", "script/fixtures/wasm-init-probe.mjs", "script/probe-transition-graph-browser.mjs", "script/fixtures/liquid-object-wasm-capability-gates.mjs", "script/wasm-package-directory.mjs", "script/check-wasm-source.mjs", "package.json", ".github/workflows/bun-ci.yml"];
const gatePins = () => Promise.all(gatePaths.map(async (path) => ({ path, sha256: hash(await readFile(join(workspace, path))) })));
async function packageInventory() {
	const owners = ["", "apps/cli", "apps/web", "apps/vite-example", "packages/editor-classic", "packages/editor-contracts"];
	const paths = ["rust/wasm/pkg", ...owners.map((owner) => join(owner, "node_modules/opencut-wasm"))];
	return Promise.all(paths.map(async (path) => {
		try { const physical = await realpath(join(workspace, path)); return { path, physical, files: await manifest(physical) }; }
		catch (error) { if (error.code === "ENOENT") return { path, absent: true }; throw error; }
	}));
}
async function sourcePins(paths) {
	return Promise.all(paths.sort().map(async (path) => { const bytes = await readFile(path); return { path: relative(workspace, path).replaceAll("\\", "/"), bytes: bytes.length, sha256: hash(bytes) }; }));
}
try {
	if (!verifyRoot) {
	report.freeBefore = await free();
	assert(report.freeBefore >= 4 * 1024 ** 3, "Need 4 GiB disk reserve before fresh private build");
	report.head = git("rev-parse", "HEAD").toString("utf8").trim();
	report.gitStatusSha256 = hash(git("status", "--porcelain=v1", "-uall"));
	report.gitTrackedDirtySha256 = hash(git("diff", "--binary", "HEAD"));
	report.packagesBefore = await packageInventory();
	await mkdir(target);
	const frozen = await freezeLiquidWasmSource({ workspace, snapshot: source, cache: target, files, hash, save });
	report.toolchain = frozen.toolchain;
	report.toolVersions = Object.fromEntries([["rustc", ["--version", "--verbose"]], ["cargo", ["--version"]], ["wasm-pack", ["--version"]], ["bun", ["--version"]]].map(([tool, args]) => [tool, execFileSync(tool, args, { cwd: source, encoding: "utf8", windowsHide: true }).trim()]));
	report.toolVersions.node = process.version;
	report.sourceBefore = frozen.sourceBefore.map(normalized);
	assert.deepEqual(await sourcePins(await frozen.sourcePaths()), report.sourceBefore, "Live source changed during freeze; do not build a mixed snapshot");
	report.sourceContentSha256 = hash(JSON.stringify(report.sourceBefore));
	const sourceManifest = { version: 1, source, sourceRoot: workspace, scope: report.scope, entries: report.sourceBefore.map((entry) => ({ ...entry, origin: workspace })), head: report.head, dirtyContentSha256: report.sourceContentSha256 };
	const sourceManifestBytes = Buffer.from(JSON.stringify(sourceManifest, null, 2) + "\n");
	await writeFile(join(source, "source-manifest.json"), sourceManifestBytes, { flag: "wx" });
	report.sourceManifestSha256 = hash(sourceManifestBytes);
	report.snapshotBefore = await manifest(source);
	await save("build-start.json", report);
	console.log(JSON.stringify({ state: "build-started", root, source, pkg, browserPkg, target, files: report.sourceBefore.length, sourceManifestSha256: report.sourceManifestSha256 }));
	report.build = await run(process.execPath, ["script/build-wasm.mjs", "--out-dir", pkg, "--", "--locked", "--offline"], source, env, "build.log");
	assert.equal(report.build.code, 0, "Pinned private release build failed; inspect retained build.log");
	assert.deepEqual(await manifest(source), report.snapshotBefore, "Frozen build inputs drifted");
	report.package = await manifest(pkg);
	report.wasmSha256 = report.package.find((entry) => entry.path === "opencut_wasm_bg.wasm").sha256;
	console.log(JSON.stringify({ state: "build-complete", root, source, pkg, wasmSha256: report.wasmSha256 }));
	} else {
		for (const directory of [source, pkg, target]) assert.equal(await realpath(directory), directory, "Owned verification directory redirected");
		assert.deepEqual(await manifest(source), report.snapshotBefore, "Previous frozen source changed");
		assert.deepEqual(await manifest(pkg), report.package, "Previous canonical binary changed");
	}
	if (!report.toolVersions) {
		report.toolVersions = Object.fromEntries([["rustc", ["--version", "--verbose"]], ["cargo", ["--version"]], ["wasm-pack", ["--version"]], ["bun", ["--version"]]].map(([tool, args]) => [tool, execFileSync(tool, args, { cwd: source, encoding: "utf8", windowsHide: true }).trim()]));
		report.toolVersions.node = process.version;
	}
	report.gateInputsBefore = await gatePins();
	report.apiSurface = await run(process.execPath, [join(workspace, "script/check-wasm-api-surface.mjs"), "--pkg-dir", pkg], workspace, env, "api-surface.log");
	report.structuralCompile = await run(process.execPath, [join(workspace, "script/run-wasm-api-contract.mjs"), "--pkg-dir", pkg], workspace, env, "structural-compile.log");
	report.paths = await run(process.execPath, [join(workspace, "script/check-wasm-paths.mjs"), "--file", join(pkg, "opencut_wasm_bg.wasm")], workspace, env, "paths.log");
	const binary = await readFile(join(pkg, "opencut_wasm_bg.wasm"));
	const text = binary.toString("latin1");
	// eslint-disable-next-line no-control-regex -- Preserve the binary path gate's control delimiters.
	report.pathAntiVacuity = { cargo: (text.match(/\/cargo[\\/][^\x00-\x1f"]{0,120}/g) ?? []).length, opencut: (text.match(/\/opencut[\\/][^\x00-\x1f"]{0,120}/g) ?? []).length, relative: (text.match(/\/(?:wasm|crates)[\\/][A-Za-z0-9._+@=-]+[\\/]/g) ?? []).length };
	assert(report.pathAntiVacuity.cargo > 0 && report.pathAntiVacuity.opencut + report.pathAntiVacuity.relative > 0, "Same path anti-vacuity threshold as canonical gate");
	const actual = await import(pathToFileURL(join(pkg, "opencut_wasm_sync.js")).href);
	report.jsExports = Object.keys(actual).sort();
	report.wasmExports = WebAssembly.Module.exports(new WebAssembly.Module(binary));
	report.wasmImports = WebAssembly.Module.imports(new WebAssembly.Module(binary));
	const originalGlue = await import(pathToFileURL(join(pkg, "opencut_wasm_bg.js")).href);
	report.glueImportBinding = report.wasmImports.map((entry) => ({ ...entry, bindingType: typeof originalGlue[entry.name] }));
	assert(report.glueImportBinding.every((entry) => entry.kind !== "function" || entry.bindingType === "function"), "An actual binary import has no generated glue function");
	const { EXPECTED, TRAMPOLINE_EXPORT } = await import("./wasm-api-surface-contract.mjs");
	const observedStable = report.wasmExports.map((entry) => `${entry.name}|${entry.kind}`).filter((entry) => !TRAMPOLINE_EXPORT.test(entry.split("|")[0]));
	const oldStable = EXPECTED.wasmExportsAsRecorded.filter((entry) => !TRAMPOLINE_EXPORT.test(entry.split("|")[0]));
	report.oldSurfaceDelta = { observedPublicJsExports: report.jsExports.length, recordedPublicJsExports: EXPECTED.wrapperExportCount, addedStableBinaryExports: observedStable.filter((entry) => !oldStable.includes(entry)), removedStableBinaryExports: oldStable.filter((entry) => !observedStable.includes(entry)), recordedSurfaceUpdated: false };
	report.frameResolver = checkCapabilities(actual);
	report.init = [];
	for (const runtime of [process.execPath, "bun"]) {
		const name = runtime === "bun" ? "bun" : "node";
		const result = await run(runtime, [join(workspace, "script/fixtures/wasm-init-probe.mjs"), `--specifier=${pathToFileURL(join(pkg, "opencut_wasm_sync.js")).href}`], workspace, env, `init-${name}.log`);
		const probe = JSON.parse((await readFile(result.log, "utf8")).trim().split(/\r?\n/).at(-1));
		assert.equal(result.code, 0); assert.equal(probe.error, null); assert.equal(probe.ticksPerSecond, 120000); assert.equal(probe.transitionGraphChecks, 14);
		report.init.push({ ...result, probe });
	}
	const negative = await run("bun", [join(workspace, "script/fixtures/wasm-init-probe.mjs"), `--specifier=${pathToFileURL(join(pkg, "opencut_wasm.js")).href}`], workspace, env, "init-bun-negative.log");
	report.initNegative = { ...negative, probe: JSON.parse((await readFile(negative.log, "utf8")).trim().split(/\r?\n/).at(-1)) };
	assert.equal(negative.code, 0); assert.match(report.initNegative.probe.error, /__wbindgen_start/);
	await mkdir(browserPkg, { recursive: Boolean(verifyRoot) });
	assert.equal(await realpath(browserPkg), browserPkg, "Owned browser output redirected");
	for (const entry of report.package) await writeFile(join(browserPkg, entry.path), await readFile(join(pkg, entry.path)), { flag: verifyRoot && !deriveOnly ? "w" : "wx" });
	// Inline generated glue with only export markers changed to keep import
	// shims private and expose exactly the canonical entry's public names.
	// The binary import module names are read from its own table, exactly as sync entry does.
	const generatedGlue = await readFile(join(pkg, "opencut_wasm_bg.js"), "utf8");
	const publicNames = new Set(report.jsExports);
	const browserGlue = generatedGlue.replace(/^export (?=(?:async )?(?:function|class|const|let|var) ([A-Za-z0-9_$]+))/gm, (marker, name) => publicNames.has(name) ? marker : "");
	const webGlue = browserGlue + `\nlet __authorityModule;\nfunction __authorityImports(module) { const imports = {}; const glue = {${Object.keys(await import(pathToFileURL(join(pkg, "opencut_wasm_bg.js")).href)).map((name) => JSON.stringify(name) + ": " + name).join(",")}}; for (const item of WebAssembly.Module.imports(module)) imports[item.module] = glue; return imports; }\nfunction __authorityStart(module, instance) { __wbg_set_wasm(instance.exports); instance.exports.__wbindgen_start(); __authorityModule = module; return instance.exports; }\nexport function initSync(input) { if (__authorityModule) return wasm; const value = input?.module ?? input; const module = value instanceof WebAssembly.Module ? value : new WebAssembly.Module(value); return __authorityStart(module, new WebAssembly.Instance(module, __authorityImports(module))); }\nexport default async function init(input) { if (__authorityModule) return wasm; let value = input?.module_or_path ?? input ?? new URL('./opencut_wasm_bg.wasm', import.meta.url); if (typeof value === 'string' || value instanceof URL || value instanceof Request) value = await fetch(value); if (value instanceof Response) value = await value.arrayBuffer(); const module = value instanceof WebAssembly.Module ? value : await WebAssembly.compile(value); const instance = await WebAssembly.instantiate(module, __authorityImports(module)); return __authorityStart(module, instance); }\n`;
	await writeFile(join(browserPkg, "opencut_wasm.js"), webGlue, "utf8");
	await writeFile(join(browserPkg, "opencut_wasm_sync.js"), `import {readFileSync} from 'node:fs';\nimport {initSync} from './opencut_wasm.js';\ninitSync({module:readFileSync(new URL('./opencut_wasm_bg.wasm',import.meta.url))});\nexport * from './opencut_wasm.js';\n`, "utf8");
	const verification = { mode: "wasm", exitCode: 0, sourceDirectory: source, sourceManifestSha256: report.sourceManifestSha256, wasmSha256: report.wasmSha256, canonicalPackage: pkg, derivation: "bundler-derived-browser-v2: one release binary, generated glue inlined with only non-public export markers changed; default init awaits compile and instantiate; no recompilation", helperSha256: hash(await readFile(fileURLToPath(import.meta.url))) };
	await writeFile(join(browserPkg, "verification.json"), JSON.stringify(verification, null, 2) + "\n", { flag: verifyRoot && !deriveOnly ? "w" : "wx" });
	report.browserPackage = await manifest(browserPkg);
	assert.equal(hash(await readFile(join(browserPkg, "opencut_wasm_bg.wasm"))), report.wasmSha256);
	const browserSync = await import(pathToFileURL(join(browserPkg, "opencut_wasm_sync.js")).href);
	assert.deepEqual(Object.keys(browserSync).filter((name) => name !== "initSync").sort(), report.jsExports);
	report.browserSyncResolver = checkCapabilities(browserSync);
	const browserAsync = await import(pathToFileURL(join(browserPkg, "opencut_wasm.js")).href + "?async-contract");
	await browserAsync.default({ module_or_path: binary });
	assert.deepEqual(Object.keys(browserAsync).filter((name) => !["initSync", "default"].includes(name)).sort(), report.jsExports);
	report.browserAsyncResolver = checkCapabilities(browserAsync);
	const forbiddenSync = await import(pathToFileURL(join(browserPkg, "opencut_wasm.js")).href + "?sync-forbidden-control");
	const originalModule = WebAssembly.Module, originalInstance = WebAssembly.Instance;
	let synchronousCalls = 0;
	try {
		const disallow = { construct() { synchronousCalls++; throw Error("Synchronous WebAssembly constructor forbidden by async control"); } };
		WebAssembly.Module = new Proxy(originalModule, disallow);
		WebAssembly.Instance = new Proxy(originalInstance, disallow);
		assert.throws(() => forbiddenSync.initSync({ module: binary }), /Synchronous WebAssembly constructor forbidden/);
		assert.equal(synchronousCalls, 1, "Control must catch an actual synchronous initializer");
		synchronousCalls = 0;
		await forbiddenSync.default({ module_or_path: binary });
		assert.equal(synchronousCalls, 0, "Default async initializer must never call synchronous constructors");
		report.asyncNonSyncControl = { passed: true, explicitSyncNegativeFired: true, defaultSyncConstructorCalls: synchronousCalls, frameCases: checkCapabilities(forbiddenSync).length };
	} finally { WebAssembly.Module = originalModule; WebAssembly.Instance = originalInstance; }
	assert.deepEqual(await manifest(pkg), report.package, "Authority package changed during gates");
	report.browserPackageAfter = await manifest(browserPkg);
	assert.deepEqual(report.browserPackageAfter, report.browserPackage, "Derived wrapper/glue/binary changed during init contracts");
	if (deriveOnly) assert.deepEqual(await manifest(join(root, "browser-pkg")), report.previousBrowserPackage, "Historical browser derivative changed");
	report.runtimeContractsPassed = true;
	report.derivedGlueContractScope = "Actual Node WebAssembly instances exercise initSync and async init against the same binary and import glue; public names match canonical plus initializer entry points; browser raster matrix remains separate";
	report.environment = { ROCUT_TEST_WASM_DIRECTORY: browserPkg, ROCUT_TEST_RUST_SOURCE: source, ROCUT_TEST_LIQUID_WASM_DIR: pkg, ROCUT_TEST_LIQUID_WASM_SHA256: report.wasmSha256 };
	assert.equal(report.structuralCompile.code, 0, "Actual structural ABI contract failed");
	assert.equal(report.paths.code, 0, "Private binary path disclosure failed");
	report.ok = true;
} catch (error) { report.failure = { name: error.name, message: error.message }; process.exitCode = 1; }
finally {
	if (report.gateInputsBefore) {
		report.gateInputsAfter = await gatePins();
		report.gatesUnchanged = JSON.stringify(report.gateInputsBefore) === JSON.stringify(report.gateInputsAfter);
		if (!report.gatesUnchanged) { report.ok = false; report.failure = { message: "Gate inputs changed during verification" }; process.exitCode = 1; }
	}
	if (report.sourceBefore) {
		report.sourceAfter = await sourcePins((await files(join(workspace, "rust/crates"))).concat(await files(join(workspace, "rust/wasm")), await files(join(workspace, "apps/desktop/src")), [join(workspace, "apps/desktop/Cargo.toml"), ...["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "script/build-wasm.mjs", "script/wasm-toolchain.mjs", "script/wasm-package-directory.mjs"].map((name) => join(workspace, name))]));
		const previous = new Map(report.sourceBefore.map((entry) => [entry.path, entry.sha256]));
		const after = new Map(report.sourceAfter.map((entry) => [entry.path, entry.sha256]));
		report.liveSourceDrift = [...new Set([...previous.keys(), ...after.keys()])].filter((path) => previous.get(path) !== after.get(path)).map((path) => ({ path, before: previous.get(path) ?? null, after: after.get(path) ?? null }));
		report.snapshotAfter = await manifest(source);
		report.frozenSourceUnchanged = JSON.stringify(report.snapshotBefore) === JSON.stringify(report.snapshotAfter);
	}
	report.packagesAfter = await packageInventory();
	report.sharedPackageDrift = JSON.stringify(report.packagesBefore) !== JSON.stringify(report.packagesAfter);
	report.finished = new Date().toISOString();
	await save("evidence.json", report);
	console.log(JSON.stringify({ root, ok: report.ok, failure: report.failure, wasmSha256: report.wasmSha256, environment: report.environment, apiSurfaceExit: report.apiSurface?.code }));
}
