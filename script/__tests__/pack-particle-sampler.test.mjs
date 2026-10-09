import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	constants,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import {
	buildParticleSamplerAssets,
	PARTICLE_SAMPLER_WASM_MODULE,
	PARTICLE_SAMPLER_WORKER_ENTRY,
	particleSamplerDefine,
} from "../pack-particle-sampler.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const wasmSyncEntry = process.env.ROCUT_PARTICLE_PACK_WASM_MODULE;
const tempRoot = process.env.ROCUT_PARTICLE_PACK_ROOT;
const binaryName = "opencut_wasm_bg.wasm";
const runner = "particle-pack-fixture.mjs";
const run = promisify(execFile);
const sha256 = (path) =>
	createHash("sha256").update(readFileSync(path)).digest("hex");
const inventory = (dir) =>
	readdirSync(dir)
		.sort()
		.map((file) => ({ file, sha256: sha256(join(dir, file)) }));
function assertBuiltinImports(metafile) {
	for (const output of Object.values(metafile.outputs)) {
		for (const imported of output.imports) {
			assert.ok(
				imported.external &&
					builtinModules.includes(imported.path.replace(/^node:/, "")),
				`Unexpected output dependency: ${imported.path}`,
			);
		}
	}
}

test(
	"real esbuild particle package is standalone, deterministic, cancellable and fail-closed",
	{
		skip:
			!wasmSyncEntry || !tempRoot
				? "Set explicit ROCUT_PARTICLE_PACK_WASM_MODULE and ROCUT_PARTICLE_PACK_ROOT"
				: false,
		timeout: 90000,
	},
	async (t) => {
		assert.ok(isAbsolute(wasmSyncEntry));
		assert.ok(isAbsolute(tempRoot));
		const outside = relative(repoRoot, resolve(tempRoot));
		assert.ok(
			isAbsolute(outside) || outside === ".." || outside.startsWith(`..${sep}`),
		);
		mkdirSync(tempRoot, { recursive: true });
		const runDir = mkdtempSync(join(tempRoot, "run-"));
		t.diagnostic(`Retained artifacts: ${runDir}`);
		const sources = [
			"script/pack-runtime.mjs",
			"script/pack-particle-sampler.mjs",
			"script/pack-particle-sampler-fixture.mjs",
			"script/__tests__/pack-particle-sampler.test.mjs",
			"apps/cli/src/programmatic/particle-sampler-worker.ts",
			"apps/cli/src/programmatic/particle-sampler-worker-bootstrap.ts",
			"apps/cli/src/programmatic/particle-sampler-worker-policy.ts",
			"apps/cli/src/programmatic/particle-policy.ts",
			"apps/cli/src/programmatic/particle-sampler-worker-core.ts",
			"apps/cli/src/programmatic/particle-sampler-worker-process.ts",
			"apps/cli/src/programmatic/particle-sampler-worker-entry.mjs",
		].map((file) => ({ file, sha256: sha256(join(repoRoot, file)) }));
		async function buildFixture(label, define = particleSamplerDefine) {
			const outDir = join(runDir, label);
			mkdirSync(outDir);
			const result = await build({
				absWorkingDir: repoRoot,
				entryPoints: [
					join(repoRoot, "script/pack-particle-sampler-fixture.mjs"),
				],
				outfile: join(outDir, runner),
				bundle: true,
				platform: "node",
				format: "esm",
				target: "es2022",
				define,
				write: false,
				metafile: true,
				logLevel: "silent",
			});
			assert.equal(result.outputFiles.length, 1);
			assertBuiltinImports(result.metafile);
			assert.ok(
				!result.outputFiles[0].text.includes(
					"__ROCUT_PACKED_PARTICLE_SAMPLER_MODULE_V1__",
				),
			);
			writeFileSync(join(outDir, runner), result.outputFiles[0].contents, {
				flag: "wx",
			});
			const assets = await buildParticleSamplerAssets({
				repoRoot,
				outDir,
				wasmSyncEntry,
			});
			assertBuiltinImports(assets.metafile);
			assert.deepEqual(assets.files, [
				PARTICLE_SAMPLER_WASM_MODULE,
				PARTICLE_SAMPLER_WORKER_ENTRY,
			]);
			assert.deepEqual(
				readFileSync(join(outDir, PARTICLE_SAMPLER_WORKER_ENTRY)),
				readFileSync(
					join(
						repoRoot,
						"apps/cli/src/programmatic",
						PARTICLE_SAMPLER_WORKER_ENTRY,
					),
				),
			);
			copyFileSync(
				join(dirname(wasmSyncEntry), binaryName),
				join(outDir, binaryName),
				constants.COPYFILE_EXCL,
			);
			return outDir;
		}
		const first = await buildFixture("build-a"),
			second = await buildFixture("build-b");
		const artifacts = inventory(first);
		assert.deepEqual(artifacts, inventory(second));
		assert.deepEqual(
			artifacts.map(({ file }) => file),
			[
				binaryName,
				runner,
				PARTICLE_SAMPLER_WASM_MODULE,
				PARTICLE_SAMPLER_WORKER_ENTRY,
			].sort(),
		);
		await assert.rejects(
			buildParticleSamplerAssets({ repoRoot, outDir: first, wasmSyncEntry }),
			{ code: "EEXIST" },
		);
		assert.deepEqual(
			artifacts,
			inventory(first),
			"Exclusive writes must not overwrite existing output",
		);
		const replaced = join(runDir, "replacement-target"),
			retained = join(runDir, "retained-original");
		mkdirSync(replaced);
		const replacementCheck = assert.rejects(
			buildParticleSamplerAssets({ repoRoot, outDir: replaced, wasmSyncEntry }),
			/identity changed/,
		);
		// Both exact paths are newly owned children of this run; retain the old
		// empty directory instead of deleting it or touching a pre-existing tree.
		renameSync(replaced, retained);
		mkdirSync(replaced);
		await replacementCheck;
		assert.deepEqual(readdirSync(replaced), []);
		assert.deepEqual(readdirSync(retained), []);
		const invalid = await buildFixture("build-invalid-literal", {
			"import.meta.__ROCUT_PACKED_PARTICLE_SAMPLER_MODULE_V1__":
				JSON.stringify("../untrusted.mjs"),
		});
		const outcomes = [];
		for (const [name, mode, omit, corrupt] of [
			["success", "success"],
			["rust-error", "rust-error"],
			["cancel", "cancel"],
			["missing-worker", "missing", PARTICLE_SAMPLER_WORKER_ENTRY],
			["missing-module", "missing", PARTICLE_SAMPLER_WASM_MODULE],
			["missing-wasm", "missing", binaryName],
			["corrupt-wasm", "missing", binaryName, true],
			["invalid-literal", "invalid"],
		]) {
			const standalone = join(runDir, `standalone-${name}`);
			mkdirSync(standalone);
			for (const { file } of artifacts) {
				if (file !== omit)
					copyFileSync(
						join(mode === "invalid" ? invalid : first, file),
						join(standalone, file),
						constants.COPYFILE_EXCL,
					);
			}
			if (corrupt)
				writeFileSync(
					join(standalone, binaryName),
					Buffer.from("invalid-wasm-magic"),
					{ flag: "wx" },
				);
			const result = await run(
				process.execPath,
				[join(standalone, runner), mode],
				{
					cwd: standalone,
					env: {
						...process.env,
						NODE_OPTIONS: "",
						NODE_PATH: "",
						TEMP: runDir,
						TMP: runDir,
						// A valid source module is deliberately offered: production must ignore it.
						ROCUT_PARTICLE_WASM_MODULE: wasmSyncEntry,
					},
					windowsHide: true,
					timeout: 20000,
					maxBuffer: 1024 * 1024,
				},
			);
			assert.equal(result.stderr, "");
			const outcome = JSON.parse(result.stdout.trim());
			assert.equal(outcome.mode, mode);
			assert.equal(outcome.standalone, true);
			assert.equal(outcome.processClosed, mode !== "invalid");
			assert.equal(outcome.processNotStarted, mode === "invalid");
			outcomes.push({ name, ...outcome });
			t.diagnostic(JSON.stringify({ name, ...outcome }));
		}
		writeFileSync(
			join(runDir, "evidence.json"),
			JSON.stringify(
				{
					runtime: process.version,
					runDir,
					wasmSyncEntry,
					wasmSha256: sha256(join(dirname(wasmSyncEntry), binaryName)),
					sources,
					artifacts,
					deterministic: true,
					outputIdentityRechecked: true,
					outcomes,
					boundary:
						"Helper plus public-factory fixture only; full canonical runtime pack was not executed.",
				},
				null,
				2,
			) + "\n",
			{ flag: "wx" },
		);
	},
);
