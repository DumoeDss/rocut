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
} from "../pack-particle-sampler.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const current = process.env.ROCUT_PARTICLE_POLICY_WASM_MODULE;
const old = process.env.ROCUT_PARTICLE_POLICY_OLD_WASM_MODULE;
const tempRoot = process.env.ROCUT_PARTICLE_POLICY_TEST_ROOT;
const execute = promisify(execFile);
const hash = (file) =>
	createHash("sha256").update(readFileSync(file)).digest("hex");
const inventory = (dir) =>
	readdirSync(dir)
		.sort()
		.map((file) => ({ file, sha256: hash(join(dir, file)) }));

test(
	"published particle policy survives standalone packaging and old modules fail closed",
	{
		skip:
			!current || !old || !tempRoot
				? "Explicit current/old WASM module and external test root required"
				: false,
		timeout: 30000,
	},
	async (t) => {
		for (const path of [current, old, tempRoot]) assert.ok(isAbsolute(path));
		const outside = relative(repoRoot, tempRoot);
		assert.ok(
			isAbsolute(outside) || outside === ".." || outside.startsWith(`..${sep}`),
		);
		mkdirSync(tempRoot, { recursive: true });
		const root = mkdtempSync(join(tempRoot, "policy-pack-"));
		t.diagnostic(`Retained artifacts: ${root}`);
		const createCase = (label) => {
			const dir = join(root, label);
			mkdirSync(dir);
			return dir;
		};
		const currentA = createCase("current-a"),
			currentB = createCase("current-b");
		for (const outDir of [currentA, currentB]) {
			const result = await buildParticleSamplerAssets({
				repoRoot,
				outDir,
				wasmSyncEntry: current,
			});
			for (const output of Object.values(result.metafile.outputs)) {
				for (const imported of output.imports) {
					assert.ok(
						imported.external &&
							builtinModules.includes(imported.path.replace(/^node:/, "")),
					);
				}
			}
			copyFileSync(
				join(dirname(current), "opencut_wasm_bg.wasm"),
				join(outDir, "opencut_wasm_bg.wasm"),
				constants.COPYFILE_EXCL,
			);
			copyFileSync(
				join(repoRoot, "script/pack-particle-policy-fixture.mjs"),
				join(outDir, "probe.mjs"),
				constants.COPYFILE_EXCL,
			);
		}
		assert.deepEqual(inventory(currentA), inventory(currentB));
		const rejectedOld = createCase("old-pack-rejected");
		await assert.rejects(
			buildParticleSamplerAssets({
				repoRoot,
				outDir: rejectedOld,
				wasmSyncEntry: old,
			}),
			/transport policy exports/,
		);
		assert.deepEqual(readdirSync(rejectedOld), []);
		const missingGetter = createCase("old-runtime-rejected");
		const bundledOld = await build({
			entryPoints: [old],
			outfile: join(missingGetter, PARTICLE_SAMPLER_WASM_MODULE),
			absWorkingDir: repoRoot,
			bundle: true,
			platform: "node",
			format: "esm",
			target: "es2022",
			write: false,
			logLevel: "silent",
		});
		assert.equal(bundledOld.outputFiles.length, 1);
		writeFileSync(
			join(missingGetter, PARTICLE_SAMPLER_WASM_MODULE),
			bundledOld.outputFiles[0].contents,
			{ flag: "wx" },
		);
		copyFileSync(
			join(dirname(old), "opencut_wasm_bg.wasm"),
			join(missingGetter, "opencut_wasm_bg.wasm"),
			constants.COPYFILE_EXCL,
		);
		copyFileSync(
			join(repoRoot, "script/pack-particle-policy-fixture.mjs"),
			join(missingGetter, "probe.mjs"),
			constants.COPYFILE_EXCL,
		);
		const invoke = (cwd) =>
			execute(process.execPath, [join(cwd, "probe.mjs")], {
				cwd,
				windowsHide: true,
				timeout: 10000,
				maxBuffer: 1024 * 1024,
				env: {
					...process.env,
					NODE_OPTIONS: "",
					NODE_PATH: "",
					TEMP: root,
					TMP: root,
					ROCUT_PARTICLE_POLICY_JSON: JSON.stringify({
						version: 1,
						hostDefaults: {},
					}),
				},
			});
		const passed = await invoke(currentA);
		assert.equal(passed.stderr, "");
		const result = JSON.parse(passed.stdout.trim());
		assert.equal(result.standalone, true);
		await assert.rejects(invoke(missingGetter), (error) => {
			assert.equal(error.code, 1);
			assert.match(
				error.stderr,
				/Particle policy capability unavailable: missing particleTransportPolicyJson/,
			);
			assert.equal(error.stdout, "");
			return true;
		});
		const evidence = {
			current,
			old,
			root,
			currentWasmSha256: hash(join(dirname(current), "opencut_wasm_bg.wasm")),
			oldWasmSha256: hash(join(dirname(old), "opencut_wasm_bg.wasm")),
			artifacts: inventory(currentA),
			deterministic: true,
			oldPackRejectedBeforeWrites: true,
			oldRuntimeRejectedWithoutFallback: true,
			...result,
			runtimeEnforcement: false,
		};
		writeFileSync(
			join(root, "evidence.json"),
			JSON.stringify(evidence, null, 2) + "\n",
			{ flag: "wx" },
		);
		t.diagnostic(
			JSON.stringify({
				policySha256: result.policySha256,
				deterministic: true,
				oldPackRejected: true,
				oldRuntimeRejected: true,
			}),
		);
	},
);
