import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	validateParticleMotion,
	validateParticleMotionControl,
} from "../programmatic/particle-motion-contract";
import { prepareParticleSurface } from "../programmatic/particle-surface-preparation";
import { getProgrammaticParticleMotionControlCapability } from "../programmatic/particle-motion-control-capability";
import { PARTICLE_BROWSER_RUNTIME_IIFE } from "../programmatic/particle-browser-bundle.generated";
import { motion } from "./particle-c3-test-support";
import { policy } from "./particle-protocol-test-support";

const control = () => ({
	mode: "spring",
	startTicks: 0,
	durationTicks: 2000,
	knots: [
		{ timeTicks: 0, position: [0, 0, 0] },
		{ timeTicks: 2000, position: [1, 2, 3] },
	],
	restoringForce: 1,
	damping: 0,
	radius: 2,
	strength: 1,
});

test("shipped browser bundle carries the strict control transport", () => {
	expect(PARTICLE_BROWSER_RUNTIME_IIFE).toContain(
		"Particle control requires 2..128 bounded knots",
	);
	expect(PARTICLE_BROWSER_RUNTIME_IIFE).toContain(
		"Particle vortex axis requires a finite vector",
	);
	expect(PARTICLE_BROWSER_RUNTIME_IIFE).toContain("restoringForce");
	expect(PARTICLE_BROWSER_RUNTIME_IIFE).not.toContain("node:");
});

test("optional control admits bounded wire shapes without replacing old motion or Rust range checks", () => {
	expect(() => validateParticleMotion(motion())).not.toThrow();
	expect(() =>
		validateParticleMotion({ ...motion(), control: control() }),
	).not.toThrow();
	expect(() =>
		validateParticleMotionControl({
			...control(),
			mode: "vortex",
			axis: [0, 0, 1],
		}),
	).not.toThrow();
	// Finite semantic range/order admission is exclusively Rust-owned.
	expect(() =>
		validateParticleMotionControl({
			...control(),
			radius: -1,
			restoringForce: 9999,
			knots: [
				{ timeTicks: 9000, position: [0, 0, 0] },
				{ timeTicks: 0, position: [0, 0, 0] },
			],
		}),
	).not.toThrow();
	for (const candidate of [
		null,
		[],
		undefined,
		{ ...control(), mode: "other" },
		{ ...control(), extra: 1 },
		{ ...control(), axis: [0, 0, 1] },
		{ ...control(), mode: "vortex" },
		{ ...control(), durationTicks: 1.5 },
		{ ...control(), radius: Infinity },
		{ ...control(), knots: [control().knots[0]] },
		{
			...control(),
			knots: Array.from({ length: 129 }, () => control().knots[0]),
		},
		{
			...control(),
			knots: [{ timeTicks: 0, position: Array(3) }, control().knots[1]],
		},
		{
			...control(),
			knots: [
				{ timeTicks: 0, position: [0, 0, 0], seed: 1 },
				control().knots[1],
			],
		},
	])
		expect(() =>
			validateParticleMotion({ ...motion(), control: candidate }),
		).toThrow();
});

const toolchain = process.env.ROCUT_TEST_THREE_TOOLCHAIN;
test.skipIf(!toolchain)(
	"preparation snapshots the author schedule but binds only current time to the Rust frame",
	async () => {
		const THREE = await import(
			pathToFileURL(
				join(toolchain!, "node_modules/three/build/three.module.js"),
			).href
		);
		const geometry = new THREE.PlaneGeometry(),
			material = new THREE.MeshBasicMaterial();
		try {
			const { timeTicks: _time, ...options } = motion();
			const schedule = control();
			const mesh = new THREE.Mesh(geometry, material),
				frame = { seed: 42, sourceTime: 1000 };
			const prepared = prepareParticleSurface(
				mesh,
				{
					count: 1,
					underflow: "reject",
					motion: { ...options, control: schedule as any },
				},
				frame,
				policy,
			);
			const request = JSON.parse(prepared.requestJson);
			expect(request.motion.control).toEqual(schedule);
			expect(request.motion.timeTicks).toBe(1000);
			schedule.knots[0].position[0] = 99;
			expect(
				JSON.parse(prepared.requestJson).motion.control.knots[0].position[0],
			).toBe(0);
			expect(() =>
				prepareParticleSurface(
					mesh,
					{
						count: 1,
						underflow: "reject",
						motion: {
							...options,
							control: { ...control(), radius: NaN } as any,
						},
					},
					frame,
					policy,
				),
			).toThrow("finite");
		} finally {
			geometry.dispose();
			material.dispose();
		}
	},
);

test("capability refuses absent, trapped, rejected, malformed or ignored control cores", () => {
	for (const exports of [
		{},
		{
			sampleParticleSurfaceJson: () => {
				throw Error("trap");
			},
		},
		{ sampleParticleSurfaceJson: () => '{"version":1,"ok":false}' },
		{ sampleParticleSurfaceJson: () => "{" },
		{
			sampleParticleSurfaceJson: () =>
				JSON.stringify({
					version: 1,
					ok: true,
					samples: [
						{
							position: [1, 0, 0],
							motionPosition: [1, 0, 0],
							size: 1,
							primitiveIndex: 0,
						},
					],
				}),
		},
	])
		expect(getProgrammaticParticleMotionControlCapability(exports)).toEqual({
			version: 1,
			profile: "explicit-control-v1",
			available: false,
			modes: ["spring", "vortex"],
		});
});

const oldWasm = process.env.ROCUT_PARTICLE_CONTROL_OLD_WASM_MODULE;
test.skipIf(!oldWasm)(
	"actual old WASM cannot advertise support for new control",
	async () => {
		const exports = await import(pathToFileURL(oldWasm!).href);
		expect(
			getProgrammaticParticleMotionControlCapability(exports).available,
		).toBe(false);
	},
);
