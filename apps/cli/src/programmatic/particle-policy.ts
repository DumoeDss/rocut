import type {
	ParticlePolicy,
	ParticlePolicyOverrides,
	ParticleTransportPolicy,
} from "./particle-policy-types";
import { ParticleProtocolError } from "./particle-protocol-error";
export type * from "./particle-policy-types";

const HOST_KEYS = [
	"maxTriangles",
	"maxSamples",
	"maxRequestJsonBytes",
	"maxResponseJsonBytes",
	"maxRequestEnvelopeBytes",
	"maxResponseEnvelopeBytes",
	"maxRequestsPerFrame",
	"maxInFlight",
	"maxFrameRetainedPayloadBytes",
	"requestTimeoutMs",
	"frameTimeoutMs",
	"process",
	"cleanupTimeoutMs",
] as const;
const PROCESS_KEYS = [
	"maxPendingRequests",
	"initTimeoutMs",
	"terminationTimeoutMs",
] as const;
const KERNEL_KEYS = [
	"maxTriangles",
	"maxSamples",
	"maxInputJsonBytes",
	"maxOutputJsonBytes",
	"maxWorkingBytes",
	"maxJsonTokenBytes",
] as const;

function ensure(condition: unknown, message: string): asserts condition {
	if (!condition)
		throw new ParticleProtocolError(
			`Invalid Rust particle transport policy: ${message}`,
		);
}
function object(
	value: unknown,
	keys: readonly string[],
): Record<string, unknown> {
	ensure(
		value !== null && typeof value === "object" && !Array.isArray(value),
		"expected object",
	);
	const result = value as Record<string, unknown>;
	ensure(
		Object.keys(result).length === keys.length &&
			keys.every((key) => Object.hasOwn(result, key)),
		"missing or unknown field",
	);
	return result;
}
function positive(value: unknown): asserts value is number {
	ensure(
		typeof value === "number" && Number.isSafeInteger(value) && value > 0,
		"expected positive safe integer",
	);
}
function safe(value: number): number {
	positive(value);
	return value;
}

export function particleReservationBytes(policy: ParticlePolicy) {
	const perRequest = safe(
		policy.maxRequestJsonBytes +
			policy.maxResponseJsonBytes +
			policy.maxRequestEnvelopeBytes +
			policy.maxResponseEnvelopeBytes,
	);
	const process = safe(
		policy.process.maxPendingRequests * policy.maxRequestJsonBytes +
			policy.maxResponseJsonBytes,
	);
	return Object.freeze({
		perRequest,
		process,
		frame: safe(policy.maxRequestsPerFrame * perRequest + process),
	});
}

export function validateParticlePolicy(policy: ParticlePolicy): void {
	const value = object(policy, HOST_KEYS);
	for (const key of HOST_KEYS) if (key !== "process") positive(value[key]);
	const process = object(value.process, PROCESS_KEYS);
	for (const key of PROCESS_KEYS) positive(process[key]);
	ensure(
		policy.maxSamples <= 0xffff_ffff && policy.maxTriangles <= 0xffff_ffff,
		"geometry exceeds u32",
	);
	ensure(
		policy.maxInFlight <= policy.maxRequestsPerFrame &&
			policy.maxInFlight <= policy.process.maxPendingRequests &&
			policy.process.maxPendingRequests <= policy.maxRequestsPerFrame,
		"in-flight/process/frame counts contradict",
	);
	ensure(
		policy.maxRequestJsonBytes <= policy.maxRequestEnvelopeBytes &&
			policy.maxResponseJsonBytes <= policy.maxResponseEnvelopeBytes,
		"raw bytes exceed envelope budget",
	);
	for (const timeout of [
		policy.requestTimeoutMs,
		policy.frameTimeoutMs,
		policy.cleanupTimeoutMs,
		policy.process.initTimeoutMs,
		policy.process.terminationTimeoutMs,
	])
		ensure(timeout <= 0x7fff_ffff, "timer exceeds host range");
	ensure(
		policy.requestTimeoutMs <= policy.frameTimeoutMs &&
			policy.process.initTimeoutMs <= policy.frameTimeoutMs &&
			policy.process.terminationTimeoutMs <= policy.cleanupTimeoutMs,
		"deadline hierarchy contradicts",
	);
	ensure(
		particleReservationBytes(policy).frame <=
			policy.maxFrameRetainedPayloadBytes,
		"whole-frame retained payload exceeds budget",
	);
}

export function snapshotParticlePolicy(policy: ParticlePolicy): ParticlePolicy {
	validateParticlePolicy(policy);
	return Object.freeze({
		...policy,
		process: Object.freeze({ ...policy.process }),
	});
}

export function parseParticleTransportPolicy(
	json: unknown,
): ParticleTransportPolicy {
	ensure(
		typeof json === "string" && json.length > 0 && json.length <= 65_536,
		"expected bounded policy JSON",
	);
	let decoded: unknown;
	try {
		decoded = JSON.parse(json);
	} catch {
		throw Error("Invalid Rust particle transport policy: malformed JSON");
	}
	const value = object(decoded, [
		"version",
		"operation",
		"surfaceVersion",
		"transportVersion",
		"kernel",
		"hostDefaults",
	]);
	ensure(
		value.version === 1 &&
			value.operation === "particleSurface" &&
			value.surfaceVersion === 1 &&
			value.transportVersion === 1,
		"unsupported version or operation",
	);
	const kernel = object(value.kernel, KERNEL_KEYS);
	for (const key of KERNEL_KEYS) positive(kernel[key]);
	const policy = decoded as ParticleTransportPolicy;
	validateParticlePolicy(policy.hostDefaults);
	const h = policy.hostDefaults,
		k = policy.kernel;
	ensure(
		k.maxSamples <= 0xffff_ffff &&
			k.maxTriangles <= 0xffff_ffff &&
			k.maxJsonTokenBytes <= k.maxInputJsonBytes,
		"kernel limits contradict",
	);
	ensure(
		h.maxTriangles <= k.maxTriangles &&
			h.maxSamples <= k.maxSamples &&
			h.maxRequestJsonBytes <= k.maxInputJsonBytes &&
			h.maxResponseJsonBytes <= k.maxOutputJsonBytes,
		"host profile exceeds kernel limits",
	);
	return Object.freeze({
		...policy,
		kernel: Object.freeze({ ...k }),
		hostDefaults: snapshotParticlePolicy(h),
	});
}

/** Explicitly narrowed host profiles keep the complete published kernel/version identity. */
export function deriveParticleTransportPolicy(
	published: ParticleTransportPolicy,
	overrides: ParticlePolicyOverrides,
): ParticleTransportPolicy {
	const base = parseParticleTransportPolicy(JSON.stringify(published));
	ensure(
		overrides !== null &&
			typeof overrides === "object" &&
			!Array.isArray(overrides),
		"expected host override object",
	);
	ensure(
		Object.keys(overrides).every((key) =>
			HOST_KEYS.includes(key as (typeof HOST_KEYS)[number]),
		),
		"unknown override",
	);
	if (Object.hasOwn(overrides, "process")) {
		ensure(
			overrides.process !== null &&
				typeof overrides.process === "object" &&
				!Array.isArray(overrides.process),
			"expected process override object",
		);
		ensure(
			Object.keys(overrides.process).every((key) =>
				PROCESS_KEYS.includes(key as (typeof PROCESS_KEYS)[number]),
			),
			"unknown process override",
		);
	}
	const host = {
		...base.hostDefaults,
		...overrides,
		process: { ...base.hostDefaults.process, ...overrides.process },
	};
	for (const key of HOST_KEYS)
		if (key !== "process")
			ensure(
				host[key] <= base.hostDefaults[key],
				"host override exceeds published limit",
			);
	for (const key of PROCESS_KEYS)
		ensure(
			host.process[key] <= base.hostDefaults.process[key],
			"process override exceeds published limit",
		);
	return parseParticleTransportPolicy(
		JSON.stringify({ ...base, hostDefaults: host }),
	);
}

/** A frame reserves worst-case payloads on admission and never refunds reply tails. */
export function createParticleFrameReservation(policy: ParticlePolicy) {
	validateParticlePolicy(policy);
	const budget = particleReservationBytes(policy);
	let retained = budget.process,
		accepted = 0,
		closed = false;
	return {
		reserve() {
			ensure(
				!closed && accepted < policy.maxRequestsPerFrame,
				"frame request reservation exhausted",
			);
			const next = safe(retained + budget.perRequest);
			ensure(
				next <= policy.maxFrameRetainedPayloadBytes,
				"frame payload reservation exhausted",
			);
			retained = next;
			accepted++;
		},
		close() {
			closed = true;
			retained = 0;
		},
		get retainedBytes() {
			return retained;
		},
	};
}
