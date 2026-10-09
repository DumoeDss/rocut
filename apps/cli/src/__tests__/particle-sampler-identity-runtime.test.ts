import { expect, test } from "bun:test";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	particleSamplerSha256,
	snapshotParticleSamplerIdentity,
} from "../programmatic/particle-sampler-identity";

const source = process.env.ROCUT_PARTICLE_WASM_MODULE;
const packed = process.env.ROCUT_PARTICLE_PACKED_MODULE;
const check = test.skipIf(!source || !packed);

check(
	"canonical source and public packed factory execute byte-bound closures in Node and Bun",
	async () => {
		const directory = mkdtempSync(
			join(
				process.env.ROCUT_PARTICLE_TEST_ARTIFACT_ROOT ?? tmpdir(),
				"identity-real-",
			),
		);
		const runner = join(directory, "identity-runtime.mjs");
		const workerEntry = fileURLToPath(
			new URL(
				"../programmatic/particle-sampler-worker-entry.mjs",
				import.meta.url,
			),
		);
		copyFileSync(packed!, join(directory, "particle-sampler-wasm.mjs"));
		copyFileSync(
			join(dirname(packed!), "opencut_wasm_bg.wasm"),
			join(directory, "opencut_wasm_bg.wasm"),
		);
		copyFileSync(
			workerEntry,
			join(directory, "particle-sampler-worker-entry.mjs"),
		);
		await build({
			entryPoints: [
				fileURLToPath(
					new URL("./particle-sampler-identity-runtime.ts", import.meta.url),
				),
			],
			outfile: runner,
			bundle: true,
			platform: "node",
			format: "esm",
			target: "es2022",
			define: {
				"import.meta.__ROCUT_PACKED_PARTICLE_SAMPLER_MODULE_V1__":
					JSON.stringify("./particle-sampler-wasm.mjs"),
			},
		});
		const outcomes = [];
		const wasmSha256 = particleSamplerSha256(
			readFileSync(join(dirname(source!), "opencut_wasm_bg.wasm")),
		);
		for (const runtime of ["node", process.execPath]) {
			for (const mode of ["source", "packed"]) {
				const result = spawnSync(
					runtime,
					[runner, mode, source!, workerEntry],
					{
						cwd: directory,
						windowsHide: true,
						encoding: "utf8",
						timeout: 20_000,
						maxBuffer: 1024 * 1024,
					},
				);
				expect(result.error).toBeUndefined();
				expect(result.status, result.stderr).toBe(0);
				const outcome = JSON.parse(result.stdout);
				expect(outcome.closed).toBe(true);
				expect(outcome.samples).toBe(2);
				const identity = snapshotParticleSamplerIdentity(outcome.identity);
				expect(identity.layout).toBe(
					mode === "source" ? "source-sync" : "packed-sidecar",
				);
				expect(
					identity.files.find((file) => file.role === "wasm")?.sha256,
				).toBe(wasmSha256);
				outcomes.push(outcome);
			}
		}
		const packedFile = join(directory, "particle-sampler-wasm.mjs");
		writeFileSync(
			packedFile,
			readFileSync(packedFile, "utf8") + "\n// closure changed\n",
		);
		for (const runtime of ["node", process.execPath]) {
			const original = outcomes.find(
				(item) =>
					item.mode === "packed" &&
					item.identity.runtime.name === (runtime === "node" ? "node" : "bun"),
			);
			const rejected = spawnSync(
				runtime,
				[
					runner,
					"packed",
					source!,
					workerEntry,
					JSON.stringify(original.identity),
				],
				{
					cwd: directory,
					windowsHide: true,
					encoding: "utf8",
					timeout: 20_000,
					maxBuffer: 1024 * 1024,
				},
			);
			expect(rejected.error).toBeUndefined();
			expect(rejected.status).toBe(1);
			expect(rejected.stderr).toContain("identity changed; recompile");
		}
		writeFileSync(
			join(directory, "identity-evidence.json"),
			JSON.stringify({ directory, outcomes }, null, 2),
		);
	},
	60_000,
);
