import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import {
	freezeLiquidWasmSource,
	captureLiquidProbeFiles,
} from "./fixtures/liquid-object-wasm-snapshot.mjs";
import { createLiquidWasmProbeIO } from "./fixtures/liquid-object-wasm-development-support.mjs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkLiquidOwnerWasm } from "./fixtures/liquid-object-wasm-owner-gates.mjs";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [cache, esbuild] = process.argv.slice(2);
assert.equal(
	process.argv.length,
	4,
	"Explicit authorized cache and existing esbuild module required",
);
assert.equal(
	resolve(cache),
	resolve("C:/tmps/object-wasm-development-6jQYhS/target"),
	"Only authorized prior owned cache",
);
const root = await mkdtemp("C:/tmps/liquid-object-wasm-development-");
const snapshot = join(root, "source"),
	pkg = join(root, "pkg");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const report = {
	ok: false,
	root,
	scope:
		"one frozen private development WASM build; Liquid opaque owner and same-child worker only; no GPU",
	started: new Date().toISOString(),
};
const save = async (name, value) =>
	writeFile(join(root, name), JSON.stringify(value, null, 2), { flag: "wx" });
const { free, files, manifest, run } = createLiquidWasmProbeIO({ root });

try {
	report.freeBefore = await free();
	assert(
		report.freeBefore >= 4 * 1024 ** 3,
		"Need 4 GiB free on C before fresh build",
	);
	report.canonicalBefore = await manifest(join(workspace, "rust/wasm/pkg"));
	const { sourcePaths, ...frozen } = await freezeLiquidWasmSource({
		workspace,
		snapshot,
		cache,
		files,
		hash,
		save,
	});
	Object.assign(report, frozen);
	report.probeSha256 = hash(await readFile(fileURLToPath(import.meta.url)));
	report.probeFiles = await captureLiquidProbeFiles({ workspace, hash });
	const env = {
		...process.env,
		CARGO_TARGET_DIR: resolve(cache),
	};
	report.targetCache = {
		path: env.CARGO_TARGET_DIR,
		reused: true,
		source: "explicit root authorization; exact existing 6jQYhS target only",
	};
	delete env.OPENCUT_WASM_ALLOW_UNPINNED;
	for (const key of Object.keys(env))
		if (["NODE_OPTIONS", "BUN_OPTIONS"].includes(key.toUpperCase()))
			delete env[key];
	report.metadata = await run(
		"cargo",
		["metadata", "--format-version", "1", "--no-deps", "--locked", "--offline"],
		snapshot,
		env,
		"metadata.log",
	);
	report.snapshotBuildBefore = await manifest(snapshot);
	report.metadataDrift = report.snapshotBuildBefore.filter(
		(pin, index) => pin.sha256 !== report.sourceBefore[index]?.sha256,
	);
	assert.equal(report.metadata.code, 0, "Private metadata preflight failed");
	assert.equal(report.metadataDrift.length, 0, "Frozen metadata source drift");
	report.formalBuildCalls = 1;
	report.build = await run(
		process.execPath,
		[
			"script/build-wasm.mjs",
			"--out-dir",
			pkg,
			"--no-opt",
			"--",
			"--locked",
			"--offline",
		],
		snapshot,
		env,
		"build.log",
	);
	report.frozenBuildSucceeded = report.build.code === 0;
	report.sourceAfter = await Promise.all(
		(await sourcePaths()).sort().map(async (path) => {
			const bytes = await readFile(path);
			return {
				path: relative(workspace, path),
				bytes: bytes.length,
				sha256: hash(bytes),
			};
		}),
	);
	report.snapshotAfter = await manifest(snapshot);
	await save("package-before-acceptance.json", await manifest(pkg));
	const before = new Map(
		report.sourceBefore.map((pin) => [pin.path, pin.sha256]),
	);
	const after = new Map(
		report.sourceAfter.map((pin) => [pin.path, pin.sha256]),
	);
	report.sourceDrift = [...new Set([...before.keys(), ...after.keys()])]
		.filter((path) => before.get(path) !== after.get(path))
		.map((path) => ({
			path,
			before: before.get(path) ?? null,
			after: after.get(path) ?? null,
		}));
	report.snapshotDrift = report.snapshotAfter.filter(
		(pin, index) => pin.sha256 !== report.snapshotBuildBefore[index]?.sha256,
	);
	assert.equal(
		report.build.code,
		0,
		"Actual formal build failed; see build.log",
	);
	assert.equal(
		report.snapshotDrift.length,
		0,
		"Snapshot drift; see before/after pins",
	);
	report.frozenBuildSucceeded = true;
	report.liveDriftIsNotBuildFailure = true;
	await save("source-after.json", report.sourceAfter);
	await save("snapshot-after.json", report.snapshotAfter);
	report.package = await manifest(pkg);
	const compiled = new WebAssembly.Module(
		await readFile(join(pkg, "opencut_wasm_bg.wasm")),
	);
	report.wasmExports = WebAssembly.Module.exports(compiled);
	const module = await import(
		pathToFileURL(join(pkg, "opencut_wasm_sync.js")).href
	);
	report.jsExports = Object.keys(module).sort();
	report.liquidOwner = checkLiquidOwnerWasm(module);
	report.worker = await run(
		process.execPath,
		[
			join(
				workspace,
				"script/fixtures/liquid-object-worker-wasm-acceptance.mjs",
			),
			pkg,
			esbuild,
		],
		workspace,
		{ ...process.env },
		"worker.log",
	);
	assert.equal(
		report.worker.code,
		0,
		"Actual new WASM same-child worker acceptance failed",
	);
	assert.deepEqual(
		await manifest(pkg),
		report.package,
		"Private package drift",
	);
	report.ok = true;
	report.packageAfter = await manifest(pkg);
	await save("package-after-acceptance.json", report.packageAfter);
} catch (error) {
	report.failure = { name: error.name, message: error.message };
	process.exitCode = 1;
} finally {
	report.canonicalAfter = await manifest(join(workspace, "rust/wasm/pkg"));
	try {
		if (report.canonicalBefore)
			assert.deepEqual(
				report.canonicalAfter,
				report.canonicalBefore,
				"Canonical package drift",
			);
	} catch (error) {
		report.ok = false;
		report.canonicalFailure = error.message;
		process.exitCode = 1;
	}
	report.finished = new Date().toISOString();
	report.freeAfter = await free();
	await save("evidence.json", report);
	console.log(JSON.stringify({ root, ok: report.ok, failure: report.failure }));
}
