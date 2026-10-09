import { expect, test } from "bun:test";
import {
	createParticleFrameReservation,
	deriveParticleTransportPolicy,
	parseParticleTransportPolicy,
	particleReservationBytes,
} from "../programmatic/particle-policy";
import { particleTransportPolicyJson } from "./particle-policy-fixture.mjs";

const fixture = () =>
	JSON.parse(particleTransportPolicyJson()) as Record<string, unknown>;
function locate(value: Record<string, unknown>, path: string[]) {
	let result = value;
	for (const key of path) {
		const nested = result[key];
		if (nested === null || typeof nested !== "object" || Array.isArray(nested))
			throw Error("Invalid test fixture path");
		result = nested as Record<string, unknown>;
	}
	return result;
}
test("strict policy parser rejects missing/unknown fields, unsupported versions and unsafe numeric leaves", () => {
	for (const path of [
		[],
		["kernel"],
		["hostDefaults"],
		["hostDefaults", "process"],
	]) {
		const base = fixture();
		const target = locate(base, path);
		for (const key of Object.keys(target)) {
			const missing = fixture();
			delete locate(missing, path)[key];
			expect(() =>
				parseParticleTransportPolicy(JSON.stringify(missing)),
			).toThrow();
			if (typeof target[key] === "number") {
				for (const invalid of [
					0,
					-1,
					1.5,
					null,
					"2",
					Number.MAX_SAFE_INTEGER + 1,
				]) {
					const changed = fixture();
					locate(changed, path)[key] = invalid;
					expect(() =>
						parseParticleTransportPolicy(JSON.stringify(changed)),
					).toThrow();
				}
			}
		}
		target.unknown = 1;
		expect(() => parseParticleTransportPolicy(JSON.stringify(base))).toThrow();
	}
	for (const key of [
		"version",
		"surfaceVersion",
		"transportVersion",
		"operation",
	]) {
		const changed = fixture();
		changed[key] = key === "operation" ? "arbitraryRpc" : 2;
		expect(() =>
			parseParticleTransportPolicy(JSON.stringify(changed)),
		).toThrow();
	}
	for (const invalid of [undefined, {}, "{", "null", "x".repeat(65_537)])
		expect(() => parseParticleTransportPolicy(invalid)).toThrow();
});

test("kernel/host limits and deadline/reservation relationships are checked without fallback", () => {
	for (const change of [
		{ maxTriangles: 262145 },
		{ maxSamples: 65537 },
		{ maxRequestJsonBytes: 67108865, maxRequestEnvelopeBytes: 67108866 },
		{ maxResponseJsonBytes: 67108865, maxResponseEnvelopeBytes: 67108866 },
		{ maxRequestEnvelopeBytes: 1 },
		{ maxResponseEnvelopeBytes: 1 },
		{ maxRequestsPerFrame: 1 },
		{ maxInFlight: 3 },
		{ maxFrameRetainedPayloadBytes: 1 },
		{ frameTimeoutMs: 14_999 },
		{ cleanupTimeoutMs: 4999 },
		{ frameTimeoutMs: 0x8000_0000 },
	]) {
		const changed = fixture();
		Object.assign(locate(changed, ["hostDefaults"]), change);
		expect(() =>
			parseParticleTransportPolicy(JSON.stringify(changed)),
		).toThrow();
	}
});

test("parsed nested policy is frozen and explicit smaller profiles cannot widen or change kernel identity", () => {
	const published = parseParticleTransportPolicy(particleTransportPolicyJson());
	for (const object of [
		published,
		published.kernel,
		published.hostDefaults,
		published.hostDefaults.process,
	])
		expect(Object.isFrozen(object)).toBe(true);
	const small = deriveParticleTransportPolicy(published, {
		maxSamples: 2,
		maxRequestJsonBytes: 4096,
		maxResponseJsonBytes: 4096,
	});
	expect(small.hostDefaults.maxSamples).toBe(2);
	expect(small.kernel).toEqual(published.kernel);
	expect(published.hostDefaults.maxSamples).toBe(4096);
	expect(() =>
		deriveParticleTransportPolicy(published, { maxSamples: 4097 }),
	).toThrow("exceeds");
	expect(() =>
		deriveParticleTransportPolicy(published, {
			process: { maxPendingRequests: 3 },
		}),
	).toThrow("exceeds");
	for (const process of [null, undefined, 1, []]) {
		expect(() =>
			deriveParticleTransportPolicy(published, {
				process,
			} as unknown as Parameters<typeof deriveParticleTransportPolicy>[1]),
		).toThrow("process override");
	}
});

test("frame reservations stay retained after acceptance and cannot recycle after close", () => {
	const policy = parseParticleTransportPolicy(
		particleTransportPolicyJson(),
	).hostDefaults;
	const sizes = particleReservationBytes(policy),
		reservation = createParticleFrameReservation(policy);
	expect(reservation.retainedBytes).toBe(sizes.process);
	for (let count = 1; count <= policy.maxRequestsPerFrame; count++) {
		reservation.reserve();
		expect(reservation.retainedBytes).toBe(
			sizes.process + count * sizes.perRequest,
		);
	}
	expect(() => reservation.reserve()).toThrow();
	expect(reservation.retainedBytes).toBe(sizes.frame);
	reservation.close();
	expect(reservation.retainedBytes).toBe(0);
	expect(() => reservation.reserve()).toThrow();
});
