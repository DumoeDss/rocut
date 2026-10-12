import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	verifyOldParticleControlRejects,
	verifyParticleControl,
} from "./particle-control-cases";

const oldPkg = "C:/tmps/rocut-svg-wasm-DHuXQ7/pkg",
	root = await mkdtemp("C:/tmps/rocut-particle-control-cpu-");
const oldSha = createHash("sha256")
	.update(await readFile(join(oldPkg, "opencut_wasm_bg.wasm")))
	.digest("hex");
assert.equal(
	oldSha,
	"748c4ff5780b13a95816c6ef7ae36533b807e39952ccd4a108baa29308272363",
);
const old = await import(
		pathToFileURL(join(oldPkg, "opencut_wasm_sync.js")).href
	),
	legacy = (json: string) => old.sampleParticleSurfaceJson(json);
const nativeExe = process.env.ROCUT_TEST_PARTICLE_CONTROL_NATIVE_EXE,
	newPkg = process.env.ROCUT_TEST_PARTICLE_CONTROL_WASM_PACKAGE_DIR;
const report: Record<string, unknown> = {
	ok: false,
	root,
	oldSha,
	oldWasm: verifyOldParticleControlRejects(legacy),
	native: { executed: false },
	newWasm: { executed: false },
	scope:
		"CPU only real old WASM negative; optional genuine native/new WASM independent numerical acceptance; no host/render/GPU/build",
};
try {
	if (nativeExe) {
		const resolver = (json: string) => {
			const child = spawnSync(nativeExe, [], {
				input: `${json}\n`,
				encoding: "utf8",
				timeout: 15000,
				windowsHide: true,
			});
			assert.equal(child.status, 0, child.stderr);
			return child.stdout.trim();
		};
		report.native = {
			executed: true,
			exe: nativeExe,
			sha256: createHash("sha256")
				.update(await readFile(nativeExe))
				.digest("hex"),
			...verifyParticleControl(resolver, legacy),
		};
	}
	if (newPkg) {
		const wasm = await import(
			pathToFileURL(join(newPkg, "opencut_wasm_sync.js")).href
		);
		report.newWasm = {
			executed: true,
			pkg: newPkg,
			sha256: createHash("sha256")
				.update(await readFile(join(newPkg, "opencut_wasm_bg.wasm")))
				.digest("hex"),
			...verifyParticleControl(
				(json: string) => wasm.sampleParticleSurfaceJson(json),
				legacy,
			),
		};
	}
	report.ok = true;
} catch (error) {
	report.error = error instanceof Error ? error.stack : String(error);
	throw error;
} finally {
	await writeFile(join(root, "receipt.json"), JSON.stringify(report, null, 2), {
		flag: "wx",
	});
	console.log(
		JSON.stringify({
			root,
			ok: report.ok,
			nativeExecuted: !!nativeExe,
			newWasmExecuted: !!newPkg,
		}),
	);
}
