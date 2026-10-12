import { test, expect } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { importProgrammaticResource } from "../../apps/cli/src/programmatic/resource-import";
import { prepareParticleSurface } from "../../apps/cli/src/programmatic/particle-surface-preparation";
import { parseParticleTransportPolicy } from "../../apps/cli/src/programmatic/particle-policy";
import { getProgrammaticParticleMotionControlCapability } from "../../apps/cli/src/programmatic/particle-motion-control-capability";
import { particlePoseGlb } from "./particle-input-resources";
import { springControl } from "./particle-control-cases";

const toolchain = process.env.ROCUT_TEST_THREE_TOOLCHAIN,
	nativeExe = process.env.ROCUT_TEST_PARTICLE_CONTROL_NATIVE_EXE;
test.skipIf(!toolchain || !nativeExe)(
	"actual Controlled helper/import/Three preparation/native Rust buffers and old core negative",
	async () => {
		const root = await mkdtemp("C:/tmps/rocut-particle-control-transport-"),
			filePath = join(root, "pose.glb");
		await writeFile(filePath, particlePoseGlb(), { flag: "wx" });
		const context = {
			store: new FileProjectStore({
				root: join(root, "project"),
				schemaVersion: 1,
			}),
			projectId: "controlled-transport" as never,
		};
		const model = (
			await importProgrammaticResource({
				...context,
				input: {
					id: "assets/pose.glb",
					kind: "model",
					mimeType: "model/gltf-binary",
					filePath,
				},
			})
		).resource;
		const creator =
			"E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized";
		const { particleControlledThree } = await import(
			pathToFileURL(join(creator, "particle-controlled-object.mjs")).href
		);
		const control = structuredClone(springControl),
			value = particleControlledThree({
				sourceDirectory: root,
				model,
				control,
				inputProps: { count: 2 },
			});
		expect(value.spec.capabilities).toEqual(["particle-surface-v1"]);
		expect(value.spec.files).toEqual(["particle-scene.ts"]);
		expect(value.spec.inputProps.motion.control).toEqual(springControl);
		control.knots[0].position[0] = 999;
		expect(value.spec.inputProps.motion.control).toEqual(springControl);
		const old = await import(
			pathToFileURL("C:/tmps/rocut-svg-wasm-DHuXQ7/pkg/opencut_wasm_sync.js")
				.href
		);
		expect(getProgrammaticParticleMotionControlCapability(old).available).toBe(
			false,
		);
		const THREE = await import(
				pathToFileURL(`${toolchain}/node_modules/three/build/three.module.js`)
					.href
			),
			geometry = new THREE.PlaneGeometry(),
			material = new THREE.MeshBasicMaterial(),
			mesh = new THREE.Mesh(geometry, material);
		try {
			const frame = { seed: 1977, sourceTime: 1000 },
				policy = parseParticleTransportPolicy(
					old.particleTransportPolicyJson(),
				).hostDefaults;
			const prepared = prepareParticleSurface(
				mesh,
				{ count: 2, underflow: "reject", motion: value.spec.inputProps.motion },
				frame,
				policy,
			);
			const request = JSON.parse(prepared.requestJson);
			expect(request.motion.control).toEqual(springControl);
			expect(request.motion.timeTicks).toBe(1000);
			expect(request.seed).toBe(1977);
			value.spec.inputProps.motion.control.knots[0].position[0] = 777;
			expect(JSON.parse(prepared.requestJson).motion.control).toEqual(
				springControl,
			);
			const rejected = JSON.parse(
				old.sampleParticleSurfaceJson(prepared.requestJson),
			);
			expect(rejected.ok).toBe(false);
			expect(rejected.samples).toBeUndefined();
			const child = spawnSync(nativeExe!, [], {
				input: `${prepared.requestJson}\n`,
				encoding: "utf8",
				timeout: 15000,
				windowsHide: true,
			});
			expect(child.status).toBe(0);
			const response = JSON.parse(child.stdout);
			expect(response.ok).toBe(true);
			const packed = prepared.finish(child.stdout.trim());
			expect(packed.buffers.position.length).toBe(6);
			expect(packed.buffers.motionPosition.length).toBe(6);
			expect(packed.buffers.size.length).toBe(2);
			expect([...packed.buffers.motionPosition]).not.toEqual([
				...packed.buffers.position,
			]);
			expect(request.motion.control.knots[0].timeTicks).toBe(0);
			expect(request.motion.control.knots[1].timeTicks).toBe(120000);
			await writeFile(
				join(root, "receipt.json"),
				JSON.stringify(
					{
						ok: true,
						root,
						model,
						request,
						response,
						oldRejected: rejected,
						oldCapability: getProgrammaticParticleMotionControlCapability(old),
						checks: {
							actualImportedHelper: true,
							clonedBeforeAwait: true,
							rustMappedCurrentFrame: true,
							authorKnotTimesPreserved: true,
							actualNativeCpuBuffers: true,
							oldWasmRejects: true,
						},
						scope:
							"actual helper/resource import/pinned Three preparation/public nativeRust/CPU Float32 buffers; no worker/GPU/compiledarchive claim",
					},
					null,
					2,
				),
				{ flag: "wx" },
			);
			console.log(JSON.stringify({ root, ok: true }));
		} finally {
			geometry.dispose();
			material.dispose();
		}
	},
);
