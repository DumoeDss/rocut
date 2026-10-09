import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as wasm from "opencut-wasm";
import { createParticlePageRuntime } from "../programmatic/particle-browser-runtime";
import { identity, policy } from "./particle-protocol-test-support";
import type { ParticlePageConfig } from "../programmatic/particle-page-contract";

const toolchain = process.env.ROCUT_TEST_THREE_TOOLCHAIN;
const THREE = toolchain
	? await import(
			pathToFileURL(join(toolchain, "node_modules/three/build/three.module.js"))
				.href
		)
	: undefined;
const check = test.skipIf(!THREE);
const config: ParticlePageConfig = {
	version: 1,
	identity,
	policy,
	requestTimeoutMs: policy.requestTimeoutMs,
};
const mapped = () => ({ index: 12, time: 0.48, seed: 42 });
test("page cleanup cannot acknowledge a falsy thrown reason as success", async () => {
	for (const reason of [undefined, null, false, 0, ""]) {
		const runtime = createParticlePageRuntime(config, mapped(), () => {});
		runtime.registerCleanup(() => {
			throw reason;
		});
		let failed = false;
		try {
			await runtime.cleanup();
		} catch (error) {
			failed = true;
			expect(error).toBe(reason);
		}
		expect(failed).toBe(true);
	}
});
function mesh() {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
	);
	return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
}
function fixture(reply = true, frame = mapped()) {
	const requests: Record<string, any>[] = [];
	const runtime = createParticlePageRuntime(config, frame, (wire) => {
		const request = JSON.parse(wire);
		requests.push(request);
		if (reply && request.kind === "sample")
			queueMicrotask(() =>
				runtime.receive(
					JSON.stringify({
						version: 1,
						operation: "particleSurface",
						...identity,
						id: request.id,
						ok: true,
						responseJson: wasm.sampleParticleSurfaceJson(request.requestJson),
					}),
				),
			);
	});
	return { runtime, requests };
}

check(
	"page runtime uses real extractor/Rust/client/packing and snapshots mapped seed/index",
	async () => {
		const original = mapped();
		const { runtime, requests } = fixture(true, original);
		original.index = 99;
		original.seed = 999;
		const object = mesh();
		object.position.x = 7;
		object.updateMatrixWorld(true);
		try {
			await runtime.runPhase(async ({ frame, particles }) => {
				expect(frame.index).toBe(12);
				expect(frame.seed).toBe(42);
				expect(Object.isFrozen(frame)).toBe(true);
				const result = await particles.sampleSurface(object, {
					count: 2,
					underflow: "reject",
				});
				expect(result.buffers.count).toBe(2);
				expect(result.buffers.position).toBeInstanceOf(Float32Array);
				expect(result.buffers.position[0]).toBeGreaterThanOrEqual(7);
				expect(result.buffers.position[0]).toBeLessThanOrEqual(8);
				expect(result.buffers.primitiveIndex[0]).toBe(0);
				expect(result.buffers.materialIndex[0]).toBe(0);
				expect(result.primitives[0].mesh).toBe(object);
				expect(result.materials[0]).toBe(object.material);
			});
			await runtime.check();
			expect(JSON.parse(requests[0].requestJson).seed).toBe(42);
			expect(
				JSON.parse(requests[0].requestJson).triangles[0].position[0][0],
			).toBe(7);
		} finally {
			await runtime.cleanup();
			object.geometry.dispose();
			object.material.dispose();
		}
	},
);

check(
	"forgotten pending sampling rejects phase completion and cancels the real client",
	async () => {
		const { runtime, requests } = fixture(false);
		await expect(
			runtime.runPhase(({ particles }) => {
				void particles.sampleSurface(mesh(), { count: 1, underflow: "reject" });
			}),
		).rejects.toThrow("still pending");
		await expect(runtime.check()).rejects.toThrow("still pending");
		expect(requests.map((request) => request.kind)).toEqual([
			"sample",
			"cancel",
		]);
		await expect(runtime.cleanup()).rejects.toThrow("still pending");
	},
);

check(
	"caught extractor/options/Rust failures remain terminal and cannot admit a frame",
	async () => {
		for (const mode of [
			"underflow",
			"allocation",
			"seed",
			"geometry",
			"rust",
		] as const) {
			const { runtime, requests } = fixture();
			const object =
				mode === "geometry"
					? new THREE.InstancedMesh(
							mesh().geometry,
							new THREE.MeshBasicMaterial(),
							1,
						)
					: mesh();
			if (mode === "rust") object.geometry.attributes.position.array.fill(0);
			await expect(
				runtime.runPhase(async ({ particles }) => {
					try {
						await particles.sampleSurface(
							object,
							mode === "underflow"
								? ({ count: 1 } as any)
								: mode === "allocation"
									? {
											count: 1,
											underflow: "reject",
											maxAllocationBytes: 8388609,
										}
									: mode === "seed"
										? ({ count: 1, underflow: "reject", seed: 999 } as any)
										: { count: 1, underflow: "reject" },
						);
					} catch {
						/* An author catch must not convert failure into readiness. */
					}
				}),
			).rejects.toThrow();
			await expect(runtime.check()).rejects.toThrow();
			if (mode !== "rust") expect(requests).toHaveLength(0);
			await expect(runtime.cleanup()).rejects.toThrow();
		}
	},
);

check(
	"retained sample API fails outside its single explicit phase and cleanup reports the late failure",
	async () => {
		const { runtime, requests } = fixture();
		let retained:
			| Parameters<Parameters<typeof runtime.runPhase>[0]>[0]["particles"]
			| undefined;
		await runtime.runPhase(({ particles }) => {
			retained = particles;
		});
		await runtime.check();
		await expect(
			retained!.sampleSurface(mesh(), { count: 1, underflow: "reject" }),
		).rejects.toThrow("outside particleFrame");
		await expect(runtime.check()).rejects.toThrow("outside particleFrame");
		expect(requests).toHaveLength(0);
		await expect(runtime.cleanup()).rejects.toThrow("outside particleFrame");
	},
);

test("cleanup closes the phase immediately, waits async ownership, and preserves disposal failures", async () => {
	const { runtime } = fixture(false);
	let release!: () => void;
	let calls = 0,
		finished = false;
	runtime.registerCleanup(async () => {
		calls++;
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		throw Error("author dispose failed");
	});
	await runtime.runPhase(() => {});
	const cleanup = runtime.cleanup();
	void cleanup.catch(() => {
		finished = true;
	});
	expect(runtime.cleanup()).toBe(cleanup);
	await Promise.resolve();
	await Promise.resolve();
	expect(calls).toBe(1);
	expect(finished).toBe(false);
	release();
	await expect(cleanup).rejects.toThrow("author dispose failed");
	await expect(runtime.runPhase(() => {})).rejects.toThrow();
});

test("page frame refuses author-chosen or missing integer mapping before constructing client timers", () => {
	for (const frame of [
		{ frameIndex: 1, seed: 42 },
		{ index: -1, seed: 42 },
		{ index: 1, seed: -1 },
		{ index: 1.1, seed: 42 },
	])
		expect(() => createParticlePageRuntime(config, frame, () => {})).toThrow(
			"Rust mapped",
		);
});
