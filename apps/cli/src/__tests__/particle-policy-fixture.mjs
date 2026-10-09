// Synthetic schema fixture for isolated transport tests; not a published Rust profile.
export function particleTransportPolicyJson() {
	return JSON.stringify({
		version: 1,
		operation: "particleSurface",
		surfaceVersion: 1,
		transportVersion: 1,
		kernel: {
			maxTriangles: 262144,
			maxSamples: 65536,
			maxInputJsonBytes: 67108864,
			maxOutputJsonBytes: 67108864,
			maxWorkingBytes: 201326592,
			maxJsonTokenBytes: 256,
		},
		hostDefaults: {
			maxTriangles: 16384,
			maxSamples: 4096,
			maxRequestJsonBytes: 2097152,
			maxResponseJsonBytes: 4194304,
			maxRequestEnvelopeBytes: 4198400,
			maxResponseEnvelopeBytes: 8392704,
			maxRequestsPerFrame: 4,
			maxInFlight: 2,
			maxFrameRetainedPayloadBytes: 134217728,
			requestTimeoutMs: 15000,
			frameTimeoutMs: 30000,
			process: {
				maxPendingRequests: 2,
				initTimeoutMs: 5000,
				terminationTimeoutMs: 5000,
			},
			cleanupTimeoutMs: 5000,
		},
	});
}
