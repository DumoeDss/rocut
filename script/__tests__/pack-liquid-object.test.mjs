import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import {
	constants,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { runtimeBundleOptions } from "../pack-runtime.mjs";
import {
	buildLiquidObjectAssets,
	liquidObjectDefine,
	LIQUID_OBJECT_WASM_MODULE,
	LIQUID_OBJECT_WORKER_ENTRY,
} from "../pack-liquid-object.mjs";
import { resolveRuntimeWasmPackage } from "../runtime-wasm-package-closure.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const binary = "opencut_wasm_bg.wasm";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const enabled = process.env.ROCUT_LIQUID_PACK_TEST === "1";

test("production runtime bundle options preserve fixed Liquid define and same-package sync aliases", () => {
	const entry = join(repoRoot, "rust/wasm/pkg/opencut_wasm_sync.js");
	const options = runtimeBundleOptions({
		repoRoot,
		outDir: "C:/tmps/unused-liquid-options",
		wasmSyncEntry: entry,
	});
	assert.equal(options.alias["opencut-wasm"], entry);
	assert.equal(options.alias["opencut-wasm/sync"], entry);
	assert.equal(
		options.define["import.meta.__ROCUT_PACKED_LIQUID_OBJECT_MODULE_V1__"],
		liquidObjectDefine["import.meta.__ROCUT_PACKED_LIQUID_OBJECT_MODULE_V1__"],
	);
	assert.equal(options.splitting, true);
	assert.equal(options.chunkNames, "chunk-[hash]");
	assert.equal(options.platform, "node");
});

test(
	"production-profile Liquid wrapper executes outside checkout with only its generated fixed closure",
	{ skip: !enabled, timeout: 60000 },
	async (t) => {
		const wasmSyncEntry =
			process.env.ROCUT_LIQUID_PACK_WASM_MODULE ??
			resolveRuntimeWasmPackage({ repoRoot }).wasmSyncEntry;
		assert.ok(isAbsolute(wasmSyncEntry));
		const root = mkdtempSync("C:/tmps/liquid-production-pack-");
		const outside = relative(repoRoot, root);
		assert.ok(
			isAbsolute(outside) || outside === ".." || outside.startsWith(`..${sep}`),
		);
		t.diagnostic(`Retained artifacts: ${root}`);
		const buildDir = join(root, "build");
		mkdirSync(buildDir);
		const options = runtimeBundleOptions({
			repoRoot,
			outDir: buildDir,
			wasmSyncEntry,
			entryPoint: join(repoRoot, "script/pack-liquid-object-fixture.mjs"),
		});
		const result = await build({ ...options, write: false });
		assert.ok(
			result.outputFiles.length > 1,
			"Actual production splitting must be exercised",
		);
		const builtins = new Set(
			builtinModules.flatMap((name) => [name, `node:${name}`]),
		);
		for (const output of Object.values(result.metafile.outputs))
			for (const imported of output.imports)
				if (imported.external)
					assert.ok(
						builtins.has(imported.path),
						`Non-builtin runtime dependency: ${imported.path}`,
					);
		for (const file of result.outputFiles) {
			assert.ok(
				!file.text.includes("__ROCUT_PACKED_LIQUID_OBJECT_MODULE_V1__"),
			);
			writeFileSync(
				file.path.endsWith("rocut.js")
					? join(buildDir, "rocut.mjs")
					: file.path,
				file.contents,
				{ flag: "wx" },
			);
		}
		const assets = await buildLiquidObjectAssets({
			repoRoot,
			outDir: buildDir,
			wasmSyncEntry,
		});
		assert.deepEqual(assets.files, [
			LIQUID_OBJECT_WASM_MODULE,
			LIQUID_OBJECT_WORKER_ENTRY,
		]);
		assert.deepEqual(
			readFileSync(join(buildDir, LIQUID_OBJECT_WORKER_ENTRY)),
			readFileSync(
				join(repoRoot, "apps/cli/src/programmatic", LIQUID_OBJECT_WORKER_ENTRY),
			),
		);
		copyFileSync(
			join(dirname(wasmSyncEntry), binary),
			join(buildDir, binary),
			constants.COPYFILE_EXCL,
		);
		const files = readdirSync(buildDir).sort();
		const outcomes = [];
		for (const [name, omit] of [
			["success"],
			["missing-worker", LIQUID_OBJECT_WORKER_ENTRY],
			["missing-module", LIQUID_OBJECT_WASM_MODULE],
			["missing-wasm", binary],
		]) {
			const standalone = join(root, name);
			mkdirSync(standalone);
			for (const file of files)
				if (file !== omit)
					copyFileSync(
						join(buildDir, file),
						join(standalone, file),
						constants.COPYFILE_EXCL,
					);
			const result = spawnSync(
				process.execPath,
				[join(standalone, "rocut.mjs"), omit ? "missing" : "success"],
				{
					cwd: standalone,
					encoding: "utf8",
					windowsHide: true,
					timeout: 15000,
					maxBuffer: 1024 * 1024,
					env: {
						...process.env,
						NODE_OPTIONS: "",
						NODE_PATH: "",
						ROCUT_LIQUID_WASM_MODULE: wasmSyncEntry,
					},
				},
			);
			if (omit === binary) {
				// Production imports the shared WASM at module startup too. Absence
				// must fail before the fixture, never fall back to source/package IO.
				assert.equal(result.status, 1);
				assert.match(result.stderr, /ENOENT.*opencut_wasm_bg\.wasm/);
				outcomes.push({ name, startupRejected: true });
			} else {
				assert.equal(result.status, 0, `${name}: ${result.stderr}`);
				assert.equal(result.stderr, "");
				outcomes.push({ name, ...JSON.parse(result.stdout.trim()) });
			}
		}
		const identity = outcomes[0].identity;
		const invalidDir = join(root, "invalid-literal");
		mkdirSync(invalidDir);
		const invalidBuild = await build({
			...options,
			outdir: invalidDir,
			write: false,
			define: {
				...options.define,
				"import.meta.__ROCUT_PACKED_LIQUID_OBJECT_MODULE_V1__":
					JSON.stringify("../untrusted.mjs"),
			},
		});
		for (const file of invalidBuild.outputFiles)
			writeFileSync(
				file.path.endsWith("rocut.js")
					? join(invalidDir, "rocut.mjs")
					: file.path,
				file.contents,
				{ flag: "wx" },
			);
		for (const file of [
			LIQUID_OBJECT_WASM_MODULE,
			LIQUID_OBJECT_WORKER_ENTRY,
			binary,
		])
			copyFileSync(
				join(buildDir, file),
				join(invalidDir, file),
				constants.COPYFILE_EXCL,
			);
		const invalid = spawnSync(
			process.execPath,
			[join(invalidDir, "rocut.mjs"), "invalid-literal"],
			{
				cwd: invalidDir,
				encoding: "utf8",
				windowsHide: true,
				timeout: 15000,
				env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
			},
		);
		assert.equal(invalid.status, 0, invalid.stderr);
		assert.equal(invalid.stderr, "");
		outcomes.push(JSON.parse(invalid.stdout.trim()));
		assert.ok(
			identity.files.some(
				(file) =>
					file.role === "worker-entry" &&
					file.sha256 ===
						hash(readFileSync(join(buildDir, LIQUID_OBJECT_WORKER_ENTRY))),
			),
		);
		assert.ok(
			identity.files.some(
				(file) =>
					file.role === "wasm" &&
					file.sha256 ===
						hash(readFileSync(join(dirname(wasmSyncEntry), binary))),
			),
		);
		await assert.rejects(
			buildLiquidObjectAssets({ repoRoot, outDir: buildDir, wasmSyncEntry }),
			{ code: "EEXIST" },
		);
		writeFileSync(
			join(root, "evidence.json"),
			JSON.stringify(
				{
					root,
					runtime: process.version,
					productionBundleOptions: true,
					wasmSyncEntry,
					wasmSha256: hash(readFileSync(join(buildDir, binary))),
					files,
					outcomes,
					boundary:
						"Single production-profile wrapper fixture, not full CLI pack or GPU proof",
				},
				null,
				2,
			),
			{ flag: "wx" },
		);
	},
);
