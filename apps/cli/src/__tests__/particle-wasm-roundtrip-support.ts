import { test } from "bun:test";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createThreeParticleBuffers } from "../programmatic/engines/three-particle-buffers";
import { extractThreeSurface } from "../programmatic/engines/three-surface-extract";
import {
	parseParticleRequest,
	parseParticleResponse,
	validateParticleSurfaceResponse,
	type ParticlePolicy,
	type ParticleSampleRequest,
	type ParticleSurfaceRequestData,
} from "../programmatic/particle-protocol";

const wasmFile = process.env.ROCUT_PARTICLE_WASM_MODULE;
const toolchain = process.env.ROCUT_TEST_THREE_TOOLCHAIN;
const enabled = Boolean(wasmFile || toolchain);
if (
	enabled &&
	(!wasmFile || !toolchain || !isAbsolute(wasmFile) || !isAbsolute(toolchain))
) {
	throw new Error(
		"Set both ROCUT_PARTICLE_WASM_MODULE and ROCUT_TEST_THREE_TOOLCHAIN to absolute paths",
	);
}
// Opt-in only: never fall back to the repository's potentially older WASM.
export const check = test.skipIf(!enabled);
export const THREE = enabled
	? await import(
			pathToFileURL(
				join(toolchain!, "node_modules/three/build/three.module.js"),
			).href
		)
	: undefined;
const wasm = enabled ? await import(pathToFileURL(wasmFile!).href) : undefined;
const exportValue: unknown = wasm?.sampleParticleSurfaceJson;
if (enabled && typeof exportValue !== "function") {
	throw new Error(
		"Explicit WASM module does not export sampleParticleSurfaceJson",
	);
}
export const threeVersion: unknown = enabled
	? (
			JSON.parse(
				await readFile(
					join(toolchain!, "node_modules/three/package.json"),
					"utf8",
				),
			) as { version?: unknown }
		).version
	: undefined;

export function rustSample(json: string): string {
	if (typeof exportValue !== "function")
		throw new Error("WASM fixture is not enabled");
	const result: unknown = exportValue(json);
	if (typeof result !== "string")
		throw new Error("WASM returned a non-JSON wire value");
	return result;
}

// Test-only transport limits intentionally allow count 65537 to reach Rust's
// independent admission policy. These are not application defaults/Rust caps.
const policy: ParticlePolicy = {
	maxRequestJsonBytes: 64 * 1024,
	maxResponseJsonBytes: 4 * 1024 * 1024,
	maxRequestEnvelopeBytes: 128 * 1024,
	maxResponseEnvelopeBytes: 8 * 1024 * 1024,
	maxFrameRetainedPayloadBytes: 128 * 1024 * 1024,
	requestTimeoutMs: 15_000,
	frameTimeoutMs: 30_000,
	cleanupTimeoutMs: 5000,
	process: {
		maxPendingRequests: 2,
		initTimeoutMs: 5000,
		terminationTimeoutMs: 5000,
	},
	maxRequestsPerFrame: 8,
	maxInFlight: 1,
	maxTriangles: 32,
	maxSamples: 70_000,
};
const identity = {
	sessionId: "wasm-roundtrip",
	captureId: "cpu-only",
	frameId: "frame-0",
	sourceId: "fixture-local-mesh",
};
export function roundTrip(data: ParticleSurfaceRequestData) {
	const candidate: ParticleSampleRequest = {
		version: 1,
		operation: "particleSurface",
		...identity,
		id: 1,
		kind: "sample",
		requestJson: JSON.stringify(data),
	};
	const request = parseParticleRequest(
		JSON.stringify(candidate),
		identity,
		policy,
	);
	if (request.kind !== "sample")
		throw new Error("Unexpected cancellation fixture");
	const raw = rustSample(request.requestJson);
	const result = validateParticleSurfaceResponse(raw, request, policy);
	const wire = parseParticleResponse(
		JSON.stringify({
			version: 1,
			operation: "particleSurface",
			...identity,
			id: 1,
			ok: true,
			responseJson: raw,
		}),
		request,
		policy,
	);
	const buffers = result.ok
		? createThreeParticleBuffers(result.samples, {
				expectedCount: data.count,
				maxAllocationBytes: 8 * 1024 * 1024,
				underflow: "reject",
			})
		: null;
	return { raw, result, wire, buffers };
}

export function success(data: ParticleSurfaceRequestData) {
	const evidence = roundTrip(data);
	if (!evidence.result.ok || !evidence.buffers) throw new Error(evidence.raw);
	return {
		...evidence,
		samples: evidence.result.samples,
		buffers: evidence.buffers,
	};
}

export function mesh(positions = [0, 0, 0, 1, 0, 0, 0, 1, 0], indexed = false) {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.BufferAttribute(new Float64Array(positions), 3),
	);
	if (indexed) geometry.setIndex([0, 1, 2]);
	return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
}
export const requestData = (
	object: Parameters<typeof extractThreeSurface>[0],
	count = 32,
	seed = 123,
): ParticleSurfaceRequestData => ({
	triangles: extractThreeSurface(object).triangles,
	count,
	seed,
});
