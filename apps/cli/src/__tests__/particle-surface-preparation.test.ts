import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	prepareParticleSurface,
	type ParticleSurfaceOptions,
} from "../programmatic/particle-surface-preparation";
import { policy } from "./particle-protocol-test-support";

const toolchain = process.env.ROCUT_TEST_THREE_TOOLCHAIN;
const THREE = toolchain
	? await import(
			pathToFileURL(join(toolchain, "node_modules/three/build/three.module.js"))
				.href
		)
	: undefined;
const check = test.skipIf(!THREE);
const mapped = { index: 25, sourceTime: 120000, seed: 42 };
const motion = {
	version: 1 as const,
	scatterStartTicks: 0,
	scatterDurationTicks: 120000,
	holdDurationTicks: 120000,
	returnDurationTicks: 120000,
	scatterDistance: 1,
	driftAmplitude: 0,
	driftFrequency: 1,
	size: 2,
	sizeVariance: 0.5,
};
function fixture() {
	const geometry = new THREE.PlaneGeometry(1, 1);
	const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
	return new THREE.Mesh(geometry, material);
}
const sample = {
	position: [0, 0, 0],
	normal: [0, 0, 1],
	barycentric: [1, 0, 0],
	uv: [0, 0],
	triangleIndex: 0,
	primitiveIndex: 0,
	materialIndex: 0,
};

check(
	"preparation rejects invalid explicit caps before JSON can normalize them",
	() => {
		const mesh = fixture();
		for (const maxAllocationBytes of [
			NaN,
			Infinity,
			-Infinity,
			null,
			undefined,
			0,
			-1,
			1.5,
		])
			expect(() =>
				prepareParticleSurface(
					mesh,
					{
						count: 1,
						underflow: "reject",
						maxAllocationBytes,
					} as ParticleSurfaceOptions,
					mapped,
					policy,
				),
			).toThrow("allocation cap");
	},
);
check(
	"preparation binds motion time and keeps author options immutable",
	() => {
		const mesh = fixture();
		const options = { count: 1, underflow: "reject" as const, motion };
		const prepared = prepareParticleSurface(mesh, options, mapped, policy);
		expect(JSON.parse(prepared.requestJson).motion.timeTicks).toBe(120000);
		expect(Object.hasOwn(motion, "timeTicks")).toBe(false);
		for (const timeTicks of [0, undefined, 120000])
			expect(() =>
				prepareParticleSurface(
					mesh,
					{
						...options,
						motion: { ...motion, timeTicks },
					} as ParticleSurfaceOptions,
					mapped,
					policy,
				),
			).toThrow("Rust mapped frame");
	},
);
check(
	"finish observes pre-await option/material snapshots and preserves raw sampled color absence",
	() => {
		const mesh = fixture();
		const options: ParticleSurfaceOptions = {
			count: 1,
			underflow: "reject",
			maxAllocationBytes: 20000,
			material: { mode: "base-color", sampling: "nearest-base-level" },
		};
		const prepared = prepareParticleSurface(mesh, options, mapped, policy);
		mesh.material.color.setHex(0x00ff00);
		options.count = 999;
		options.maxAllocationBytes = 1;
		const result = prepared.finish(JSON.stringify({ samples: [sample] }));
		expect(result.buffers.count).toBe(1);
		expect(result.materialBuffers?.color).toEqual(
			new Float32Array([1, 0, 0, 1]),
		);
		expect(result.buffers.colorPresent[0]).toBe(0);
		expect(result.estimatedAllocationBytes).toBeLessThanOrEqual(20000);
		expect(result.estimatedAllocationBytes).toBeGreaterThan(
			result.buffers.estimatedAllocationBytes,
		);
	},
);
check(
	"material mode is opt-in and combined allocation cannot silently grow",
	() => {
		const mesh = fixture();
		const basic = prepareParticleSurface(
			mesh,
			{ count: 1, underflow: "reject" },
			mapped,
			policy,
		);
		expect(
			basic.finish(JSON.stringify({ samples: [sample] })),
		).not.toHaveProperty("materialBuffers");
		for (const material of [
			null,
			{},
			{ mode: "base-color" },
			{ mode: "base-color", sampling: "linear" },
		])
			expect(() =>
				prepareParticleSurface(
					mesh,
					{ count: 1, underflow: "reject", material } as ParticleSurfaceOptions,
					mapped,
					policy,
				),
			).toThrow("explicit base-color");
		expect(() =>
			prepareParticleSurface(
				mesh,
				{
					count: 1,
					underflow: "reject",
					maxAllocationBytes: 4183,
					material: { mode: "base-color", sampling: "nearest-base-level" },
				},
				mapped,
				policy,
			),
		).toThrow();
	},
);
