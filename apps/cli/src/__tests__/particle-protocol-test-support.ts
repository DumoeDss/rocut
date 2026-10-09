import {
	parseParticleRequest,
	parseParticleResponse,
	type ParticleIdentity,
	type ParticlePolicy,
	type ParticleResponse,
	type ParticleSampleRequest,
	type ParticleSurfaceResult,
	type ParticleSurfaceSample,
} from "../programmatic/particle-protocol";

export const identity: ParticleIdentity = {
	sessionId: "session-1",
	captureId: "capture-1",
	frameId: "frame-12",
	sourceId: "sha256:source-1",
};
export const policy: ParticlePolicy = {
	maxRequestJsonBytes: 4096,
	maxResponseJsonBytes: 4096,
	maxRequestEnvelopeBytes: 8192,
	maxResponseEnvelopeBytes: 8192,
	maxFrameRetainedPayloadBytes: 1024 * 1024,
	requestTimeoutMs: 15_000,
	frameTimeoutMs: 30_000,
	cleanupTimeoutMs: 5000,
	process: {
		maxPendingRequests: 2,
		initTimeoutMs: 5000,
		terminationTimeoutMs: 5000,
	},
	maxRequestsPerFrame: 4,
	maxInFlight: 2,
	maxTriangles: 3,
	maxSamples: 3,
};
export const triangle = {
	position: [
		[0, 0, 0],
		[1, 0, 0],
		[0, 1, 0],
	],
	primitiveIndex: 7,
};
export const surface = () => ({
	triangles: [structuredClone(triangle)],
	count: 1,
	seed: 0,
});
export const request = (data: unknown = surface()): ParticleSampleRequest => ({
	version: 1,
	operation: "particleSurface",
	...identity,
	id: 1,
	kind: "sample",
	requestJson: JSON.stringify(data),
});
export const sample = (): ParticleSurfaceSample => ({
	position: [0.2, 0.3, 0],
	normal: [0, 0, 1],
	barycentric: [0.5, 0.2, 0.3],
	triangleIndex: 0,
	primitiveIndex: 7,
});
export const result = (): Extract<ParticleSurfaceResult, { ok: true }> => ({
	version: 1,
	ok: true,
	samples: [sample()],
});
export const response = (
	responseJson = JSON.stringify(result()),
): Extract<ParticleResponse, { ok: true }> => ({
	version: 1,
	operation: "particleSurface",
	...identity,
	id: 1,
	ok: true,
	responseJson,
});
export const parseRequest = (value: unknown, limits = policy) =>
	parseParticleRequest(JSON.stringify(value), identity, limits);
export const parseResponse = (value: unknown, limits = policy) =>
	parseParticleResponse(JSON.stringify(value), request(), limits);
export const bytes = (value: string) =>
	new TextEncoder().encode(value).byteLength;
