import { expect, test } from "bun:test";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnParticleSamplerProcess } from "../programmatic/particle-sampler-worker-process";

const isOption = (key: string) =>
	["NODE_OPTIONS", "BUN_OPTIONS"].includes(key.toUpperCase());

test("byte-bound child drops every casing of Node and Bun startup options", async () => {
	const previous = Object.entries(process.env).filter(([key]) => isOption(key));
	const clear = () => {
		for (const key of Object.keys(process.env))
			if (isOption(key)) delete process.env[key];
	};
	try {
		for (const key of [
			"NODE_OPTIONS",
			"node_options",
			"nOdE_oPtIoNs",
			"BUN_OPTIONS",
			"bun_options",
			"bUn_OpTiOnS",
		]) {
			clear();
			process.env[key] = "--rocut-test-reject-startup-option";
			const spawned = spawnParticleSamplerProcess(
				"data:text/javascript;base64,",
				undefined,
				{
					workerEntrySource: `process.on('message',()=>process.send({kind:'env-probe',keys:Object.keys(process.env).filter(key=>['NODE_OPTIONS','BUN_OPTIONS'].includes(key.toUpperCase()))}));`,
				},
			);
			try {
				const keys = await new Promise<unknown>((resolve, reject) => {
					const timer = setTimeout(
						() => reject(Error("Environment probe timed out")),
						3000,
					);
					spawned.child.once("close", () => {
						clearTimeout(timer);
						reject(Error("Environment probe exited early"));
					});
					spawned.child.on("message", (value: unknown) => {
						const message = value as { kind?: string; keys?: unknown };
						if (message.kind === "env-probe") {
							clearTimeout(timer);
							resolve(message.keys);
						}
					});
				});
				expect(keys).toEqual([]);
			} finally {
				await spawned.port.terminate();
			}
		}
	} finally {
		clear();
		for (const [key, value] of previous) process.env[key] = value;
	}
});

const packed = process.env.ROCUT_PARTICLE_PACKED_MODULE;
test.skipIf(!packed || process.platform !== "win32")(
	"real Windows Node preload stays in parent for uppercase, lowercase and mixed-case keys",
	async () => {
		const directory = mkdtempSync(
			join(
				process.env.ROCUT_PARTICLE_TEST_ARTIFACT_ROOT ?? tmpdir(),
				"identity-env-",
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
		const preload = join(directory, "marker-preload.mjs");
		writeFileSync(
			preload,
			`import {writeFileSync} from 'node:fs';
writeFileSync(new URL('./preload-'+process.pid+'.json',import.meta.url),JSON.stringify({pid:process.pid,ppid:process.ppid}),{flag:'wx'});`,
		);
		const outcomes: {
			key: string;
			pid: number;
			identity: unknown;
			markers: unknown[];
		}[] = [];
		for (const key of ["NODE_OPTIONS", "node_options", "nOdE_oPtIoNs"]) {
			const environment = Object.fromEntries(
				Object.entries(process.env).filter(([name]) => !isOption(name)),
			);
			environment[key] = "--import=" + pathToFileURL(preload).href;
			const result = spawnSync("node", [runner, "packed"], {
				cwd: directory,
				env: environment,
				windowsHide: true,
				encoding: "utf8",
				timeout: 20_000,
				maxBuffer: 1024 * 1024,
			});
			expect(result.error).toBeUndefined();
			expect(result.status, result.stderr).toBe(0);
			const outcome = JSON.parse(result.stdout);
			expect(outcome.samples).toBe(2);
			expect(outcome.closed).toBe(true);
			const markers = readdirSync(directory)
				.filter((name) => /^preload-\d+\.json$/.test(name))
				.map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")))
				.filter(
					(marker) => marker.pid === result.pid || marker.ppid === result.pid,
				);
			expect(markers).toEqual([{ pid: result.pid, ppid: process.pid }]);
			outcomes.push({
				key,
				pid: result.pid,
				identity: outcome.identity,
				markers,
			});
		}
		expect(outcomes[0]!.identity).toEqual(outcomes[1]!.identity);
		expect(outcomes[0]!.identity).toEqual(outcomes[2]!.identity);
		writeFileSync(
			join(directory, "environment-evidence.json"),
			JSON.stringify({ directory, outcomes }, null, 2),
		);
	},
	60_000,
);
