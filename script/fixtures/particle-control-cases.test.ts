import { test, expect } from "bun:test";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
	verifyOldParticleControlRejects,
	verifyParticleControl,
} from "./particle-control-cases";

const oldPkg = "C:/tmps/rocut-svg-wasm-DHuXQ7/pkg",
	nativeExe = process.env.ROCUT_TEST_PARTICLE_CONTROL_NATIVE_EXE,
	newPkg = process.env.ROCUT_TEST_PARTICLE_CONTROL_WASM_PACKAGE_DIR;
const old = await import(pathToFileURL(`${oldPkg}/opencut_wasm_sync.js`).href),
	legacy = (json: string) => old.sampleParticleSurfaceJson(json);
test("actual old748c accepts legacy sampling/motion and rejects new control with no partial samples", () => {
	expect(verifyOldParticleControlRejects(legacy).controlRejected).toBe(true);
});
test.skipIf(!nativeExe)(
	"genuine native Rust passes independent Particle spring/vortex/replay physics expectations",
	() => {
		const resolver = (json: string) => {
			const child = spawnSync(nativeExe!, [], {
				input: `${json}\n`,
				encoding: "utf8",
				timeout: 15000,
				windowsHide: true,
			});
			expect(child.status).toBe(0);
			return child.stdout.trim();
		};
		expect(verifyParticleControl(resolver, legacy).ok).toBe(true);
	},
);
test.skipIf(!newPkg)(
	"genuine new WASM passes the same independent control acceptance",
	async () => {
		const wasm = await import(
			pathToFileURL(`${newPkg}/opencut_wasm_sync.js`).href
		);
		expect(
			verifyParticleControl(
				(json: string) => wasm.sampleParticleSurfaceJson(json),
				legacy,
			).ok,
		).toBe(true);
	},
);
