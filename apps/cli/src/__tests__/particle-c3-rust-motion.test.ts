import { expect, test } from "bun:test";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { createThreeParticleBuffers } from "../programmatic/engines/three-particle-buffers";
import {
	assertParticleFrameConstraint,
	snapshotParticleFrameConstraint,
} from "../programmatic/particle-motion-contract";
import { parseParticleTransportPolicy } from "../programmatic/particle-policy";
import {
	parseParticleRequest,
	validateParticleSurfaceResponse,
	type ParticleSurfaceResult,
} from "../programmatic/particle-protocol";
import { motion } from "./particle-c3-test-support";

// Deliberately separate from the C1/C2 variable: an older sampler must never be
// counted as evidence for the new Rust motion implementation.
const moduleFile = process.env.ROCUT_PARTICLE_C3_WASM_MODULE;
if (moduleFile && !isAbsolute(moduleFile))
	throw Error("Expected absolute new C3 WASM module path");
const wasm = moduleFile
	? await import(pathToFileURL(moduleFile).href)
	: undefined;
if (
	wasm &&
	[
		"sampleParticleSurfaceJson",
		"particleTransportPolicyJson",
		"resolveProgrammaticFrameJson",
	].some((name) => typeof wasm[name] !== "function")
)
	throw Error("Explicit C3 WASM module lacks required real Rust exports");
const check = test.skipIf(!moduleFile);
const identity = {
	sessionId: "c3-real-rust",
	captureId: "cpu-boundary",
	sourceId: "two-static-triangles",
	frameId: "mapped-source-ticks",
};
const requestData = () => ({
	triangles: [
		{
			position: [
				[0, 0, 0],
				[1, 0, 0],
				[0, 1, 0],
			],
			uv: [
				[0, 0],
				[1, 0],
				[0, 1],
			],
			color: [
				[1, 0, 0, 1],
				[0, 1, 0, 1],
				[0, 0, 1, 1],
			],
			primitiveIndex: 7,
			materialIndex: 0,
		},
		{
			position: [
				[2, 0, 0],
				[4, 0, 0],
				[2, 2, 0],
			],
			uv: [
				[0, 0],
				[1, 0],
				[0, 1],
			],
			color: [
				[1, 1, 1, 1],
				[0.5, 0.5, 0.5, 1],
				[0.25, 0.25, 0.25, 1],
			],
			primitiveIndex: 19,
			materialIndex: 1,
		},
	],
	count: 32,
	seed: 42,
});
type Success = Extract<ParticleSurfaceResult, { ok: true }>;
function roundTrip(
	timeTicks?: number,
	overrides: Record<string, unknown> = {},
) {
	if (!wasm) throw Error("New Rust motion fixture is not enabled");
	const data = {
		...requestData(),
		...(timeTicks === undefined
			? {}
			: {
					motion: {
						...motion(),
						driftAmplitude: 0,
						size: 2,
						sizeVariance: 0,
						timeTicks,
						...overrides,
					},
				}),
	};
	const policy = parseParticleTransportPolicy(
		wasm.particleTransportPolicyJson(),
	).hostDefaults;
	const request = parseParticleRequest(
		JSON.stringify({
			...identity,
			version: 1,
			operation: "particleSurface",
			id: 1,
			kind: "sample",
			requestJson: JSON.stringify(data),
		}),
		identity,
		policy,
	);
	if (request.kind !== "sample") throw Error("Unexpected cancellation");
	const raw: unknown = wasm.sampleParticleSurfaceJson(request.requestJson);
	if (typeof raw !== "string")
		throw Error("Actual Rust sampler returned non-JSON data");
	const result = validateParticleSurfaceResponse(raw, request, policy);
	if (!result.ok) throw Error(raw);
	const buffers = createThreeParticleBuffers(result.samples, {
		expectedCount: data.count,
		maxAllocationBytes: 8 * 1024 * 1024,
		underflow: "reject",
	});
	return { raw, result, buffers, request };
}
const restSamples = (result: Success) =>
	result.samples.map(({ motionPosition, size, ...rest }) => rest);

check(
	"actual C3 Rust legacy output still passes protocol and packing without motion keys",
	() => {
		const { result, buffers } = roundTrip();
		expect(result.samples).toHaveLength(32);
		expect(
			result.samples.every(
				(sample) =>
					!Object.hasOwn(sample, "motionPosition") &&
					!Object.hasOwn(sample, "size"),
			),
		).toBe(true);
		expect(Object.hasOwn(buffers, "motionPosition")).toBe(false);
		expect(Object.hasOwn(buffers, "size")).toBe(false);
	},
);

check(
	"actual Rust motion preserves the original surface random stream and all associations",
	() => {
		const base = roundTrip();
		for (const ticks of [0, 12_012, 20_020, 36_036, 40_040]) {
			const value = roundTrip(ticks);
			expect(restSamples(value.result)).toEqual(base.result.samples);
			expect(value.buffers.position).toEqual(base.buffers.position);
			expect(value.buffers.barycentric).toEqual(base.buffers.barycentric);
			expect(value.buffers.primitiveIndex).toEqual(base.buffers.primitiveIndex);
			expect(value.buffers.materialIndex).toEqual(base.buffers.materialIndex);
			expect(value.buffers.motionPosition).toBeInstanceOf(Float32Array);
			expect(value.buffers.size).toBeInstanceOf(Float32Array);
			expect(value.buffers.bufferBytes - base.buffers.bufferBytes).toBe(
				16 * 32,
			);
		}
	},
);

check(
	"actual Rust zero-drift motion returns exactly to rest at the end boundary",
	() => {
		for (const ticks of [0, 36_036, 40_040]) {
			const value = roundTrip(ticks);
			expect(
				value.result.samples.every(
					(sample) =>
						JSON.stringify(sample.motionPosition) ===
						JSON.stringify(sample.position),
				),
			).toBe(true);
			expect(value.result.samples.every((sample) => sample.size === 2)).toBe(
				true,
			);
			expect(value.buffers.motionPosition).toEqual(value.buffers.position);
		}
		const middle = roundTrip(12_012);
		expect(
			middle.result.samples.some((sample) =>
				sample.motionPosition?.some(
					(component, index) => component !== sample.position[index],
				),
			),
		).toBe(true);
	},
);

check(
	"actual Rust motion supports repeat and reverse seek without stateful advancement",
	() => {
		const forward = new Map(
			[0, 12_012, 20_020, 40_040].map((ticks) => [
				ticks,
				roundTrip(ticks, { driftAmplitude: 0.25, sizeVariance: 0.2 }).raw,
			]),
		);
		for (const ticks of [40_040, 12_012, 0, 20_020, 12_012])
			expect(
				roundTrip(ticks, { driftAmplitude: 0.25, sizeVariance: 0.2 }).raw,
			).toBe(forward.get(ticks)!);
	},
);

check(
	"actual Rust drift can remain after scatter return while base position stays unchanged",
	() => {
		const value = roundTrip(40_040, { driftAmplitude: 0.25 });
		expect(restSamples(value.result)).toEqual(roundTrip().result.samples);
		expect(
			value.result.samples.some((sample) =>
				sample.motionPosition?.some(
					(component, index) => component !== sample.position[index],
				),
			),
		).toBe(true);
		expect(
			value.result.samples.every(
				(sample) => sample.size! > 0 && Number.isFinite(sample.size),
			),
		).toBe(true);
	},
);

check(
	"actual Rust mapped source ticks, not timeline ticks or floating seconds, bind Host motion",
	() => {
		const mapped = JSON.parse(
			wasm!.resolveProgrammaticFrameJson(
				JSON.stringify({
					source: {
						version: 1,
						runtime: "html-document",
						code: "<div>source</div>",
						width: 64,
						height: 32,
						frameRate: { numerator: 30000, denominator: 1001 },
						durationFrames: 100,
						seed: 42,
					},
					clipStart: 120_000,
					clipDuration: 320_320,
					trimStart: 8008,
					timelineTime: 164_100,
				}),
			),
		);
		expect(mapped.error).toBeUndefined();
		expect(mapped.frame.index).toBe(13);
		expect(mapped.frame.sourceTime).toBe(52_052);
		expect(mapped.frame.seed).toBe(42);
		const frame = snapshotParticleFrameConstraint(mapped.frame);
		const sampled = roundTrip(frame.sourceTime);
		const data = JSON.parse(sampled.request.requestJson);
		expect(() => assertParticleFrameConstraint(data, frame)).not.toThrow();
		expect(() =>
			assertParticleFrameConstraint(
				{
					...data,
					motion: { ...data.motion, timeTicks: mapped.frame.timelineTime },
				},
				frame,
			),
		).toThrow("Rust mapped frame");
		expect(() =>
			assertParticleFrameConstraint({ ...data, seed: frame.seed + 1 }, frame),
		).toThrow("Rust mapped frame");
	},
);
