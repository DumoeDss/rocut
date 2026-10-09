export type ParticlePolicy = Readonly<{
	maxTriangles: number;
	maxSamples: number;
	maxRequestJsonBytes: number;
	maxResponseJsonBytes: number;
	maxRequestEnvelopeBytes: number;
	maxResponseEnvelopeBytes: number;
	maxRequestsPerFrame: number;
	maxInFlight: number;
	maxFrameRetainedPayloadBytes: number;
	requestTimeoutMs: number;
	frameTimeoutMs: number;
	process: Readonly<{
		maxPendingRequests: number;
		initTimeoutMs: number;
		terminationTimeoutMs: number;
	}>;
	cleanupTimeoutMs: number;
}>;

export type ParticleTransportPolicy = Readonly<{
	version: 1;
	operation: "particleSurface";
	surfaceVersion: 1;
	transportVersion: 1;
	kernel: Readonly<{
		maxTriangles: number;
		maxSamples: number;
		maxInputJsonBytes: number;
		maxOutputJsonBytes: number;
		maxWorkingBytes: number;
		maxJsonTokenBytes: number;
	}>;
	hostDefaults: ParticlePolicy;
}>;

export type ParticlePolicyOverrides = Partial<
	Omit<ParticlePolicy, "process">
> & {
	process?: Partial<ParticlePolicy["process"]>;
};
