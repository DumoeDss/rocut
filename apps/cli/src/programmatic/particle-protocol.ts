import type {
	ParticleIdentity,
	ParticlePolicy,
	ParticleRequest,
	ParticleResponse,
	ParticleSampleRequest,
	ParticleSurfaceRequestData,
	ParticleSurfaceResult,
} from "./particle-protocol-types";
export type * from "./particle-protocol-types";
import { validateParticlePolicy } from "./particle-policy";
import { ParticleProtocolError } from "./particle-protocol-error";
import { validateParticleMotion } from "./particle-motion-contract";
export { validateParticlePolicy, ParticleProtocolError };

export const PARTICLE_BINDING_NAME = "__rocutParticleSurface";
export const PARTICLE_REPLY_NAME = "__rocutParticleSurfaceReply";
const IDENTITY_KEYS = [
	"sessionId",
	"captureId",
	"frameId",
	"sourceId",
] as const;
const ENVELOPE_KEYS = ["version", "operation", ...IDENTITY_KEYS, "id"];
const U32_MAX = 0xffff_ffff;

function requireValue(condition: unknown, message: string): asserts condition {
	if (!condition) throw new ParticleProtocolError(message);
}

function record(
	value: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): Record<string, unknown> {
	requireValue(
		typeof value === "object" && value !== null && !Array.isArray(value),
		"Expected a JSON object",
	);
	const result = value as Record<string, unknown>;
	requireValue(
		required.every((key) => Object.hasOwn(result, key)) &&
			Object.keys(result).every(
				(key) => required.includes(key) || optional.includes(key),
			),
		"Missing or unknown JSON field",
	);
	return result;
}

function integer(
	value: unknown,
	min: number,
	max: number,
): asserts value is number {
	requireValue(
		typeof value === "number" &&
			Number.isSafeInteger(value) &&
			value >= min &&
			value <= max,
		"Integer is outside the transport range",
	);
}

// Count without allocating a UTF-8 copy; reject lone surrogates instead of
// silently replacing them during a later bridge encoding.
function jsonBytes(value: unknown, limit: number): asserts value is string {
	requireValue(typeof value === "string", "Expected a JSON string");
	requireValue(value.length <= limit, "JSON exceeds its UTF-8 byte limit");
	let bytes = 0;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const low = value.charCodeAt(++index);
			requireValue(low >= 0xdc00 && low <= 0xdfff, "Unpaired UTF-16 surrogate");
			bytes += 4;
		} else {
			requireValue(code < 0xdc00 || code > 0xdfff, "Unpaired UTF-16 surrogate");
			bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
		}
		requireValue(bytes <= limit, "JSON exceeds its UTF-8 byte limit");
	}
}

function parseJson(value: unknown, limit: number): unknown {
	jsonBytes(value, limit);
	try {
		return JSON.parse(value) as unknown;
	} catch {
		throw new ParticleProtocolError("Invalid JSON syntax");
	}
}

function string(value: unknown): asserts value is string {
	requireValue(
		typeof value === "string" && value.length > 0,
		"Expected nonempty string",
	);
	jsonBytes(value, Number.MAX_SAFE_INTEGER);
}

function envelope(
	value: Record<string, unknown>,
	expected: ParticleIdentity,
): void {
	requireValue(value.version === 1, "Unsupported particle protocol version");
	requireValue(
		value.operation === "particleSurface",
		"Unsupported particle operation",
	);
	integer(value.id, 1, Number.MAX_SAFE_INTEGER);
	for (const key of IDENTITY_KEYS) {
		string(expected[key]);
		string(value[key]);
		requireValue(value[key] === expected[key], "Particle identity mismatch");
	}
}

function vector(value: unknown, size: number): void {
	requireValue(
		Array.isArray(value) && value.length === size,
		"Invalid vector shape",
	);
	for (const component of value) {
		requireValue(
			typeof component === "number" && Number.isFinite(component),
			"Expected finite JSON number",
		);
	}
}

function vertices(value: unknown, size: number): void {
	requireValue(
		Array.isArray(value) && value.length === 3,
		"Invalid triangle shape",
	);
	for (const vertex of value) vector(vertex, size);
}

function surfaceRequest(
	json: unknown,
	policy: ParticlePolicy,
): ParticleSurfaceRequestData {
	const value = record(
		parseJson(json, policy.maxRequestJsonBytes),
		["triangles", "count", "seed"],
		["motion"],
	);
	integer(value.count, 1, Math.min(U32_MAX, policy.maxSamples));
	integer(value.seed, 0, U32_MAX);
	if (Object.hasOwn(value, "motion")) validateParticleMotion(value.motion);
	requireValue(Array.isArray(value.triangles), "Expected triangle array");
	integer(value.triangles.length, 1, policy.maxTriangles);
	for (const triangle of value.triangles) {
		const item = record(
			triangle,
			["position", "primitiveIndex"],
			["normal", "uv", "color", "materialIndex"],
		);
		vertices(item.position, 3);
		integer(item.primitiveIndex, 0, U32_MAX);
		for (const [key, size] of [
			["normal", 3],
			["uv", 2],
			["color", 4],
		] as const) {
			// Rust Option fields accept explicit null in request JSON.
			if (item[key] != null) vertices(item[key], size);
		}
		if (item.materialIndex != null) integer(item.materialIndex, 0, U32_MAX);
	}
	return value as ParticleSurfaceRequestData;
}

/** Only ordinary JSON wire data is accepted, never objects/accessors/proxies.
 * Limits include the complete envelope (including escaped nested JSON).
 * Authorization/context ownership, replay and lifetime budgets belong to the broker.
 */
export function parseParticleRequest(
	json: string,
	expected: ParticleIdentity,
	policy: ParticlePolicy,
): ParticleRequest {
	validateParticlePolicy(policy);
	const value = record(
		parseJson(json, policy.maxRequestEnvelopeBytes),
		[...ENVELOPE_KEYS, "kind"],
		["requestJson"],
	);
	envelope(value, expected);
	if (value.kind === "sample") {
		requireValue(
			Object.hasOwn(value, "requestJson"),
			"Missing surface request JSON",
		);
		surfaceRequest(value.requestJson, policy);
	} else {
		requireValue(
			value.kind === "cancel" && !Object.hasOwn(value, "requestJson"),
			"Invalid particle request kind or fields",
		);
	}
	return value as ParticleRequest;
}

/** Wire/schema/correlation checks only: area, color range, normal length,
 * barycentric arithmetic and all other geometry decisions remain Rust-owned.
 */
export function validateParticleSurfaceResponse(
	json: string,
	request: ParticleSampleRequest,
	policy: ParticlePolicy,
): ParticleSurfaceResult {
	validateParticlePolicy(policy);
	const input = surfaceRequest(request.requestJson, policy);
	const value = record(
		parseJson(json, policy.maxResponseJsonBytes),
		["version", "ok"],
		["samples", "error"],
	);
	requireValue(value.version === 1, "Unsupported Rust surface version");
	if (value.ok === false) {
		record(value, ["version", "ok", "error"]);
		const error = record(value.error, ["code", "path", "message"]);
		for (const key of ["code", "path", "message"]) string(error[key]);
	} else {
		requireValue(value.ok === true, "Invalid Rust surface result");
		record(value, ["version", "ok", "samples"]);
		requireValue(
			Array.isArray(value.samples) && value.samples.length === input.count,
			"Surface sample count mismatch",
		);
		for (const sample of value.samples) {
			const item = record(
				sample,
				[
					"position",
					"normal",
					"barycentric",
					"triangleIndex",
					"primitiveIndex",
				],
				["uv", "color", "materialIndex", "motionPosition", "size"],
			);
			requireValue(
				Object.hasOwn(item, "motionPosition") === (input.motion != null) &&
					Object.hasOwn(item, "size") === (input.motion != null),
				"Surface motion attribute presence mismatch",
			);
			if (input.motion != null) {
				vector(item.motionPosition, 3);
				requireValue(
					typeof item.size === "number" &&
						Number.isFinite(item.size) &&
						item.size > 0,
					"Surface motion size must be finite and positive",
				);
			}
			for (const key of ["position", "normal", "barycentric"])
				vector(item[key], 3);
			integer(item.triangleIndex, 0, input.triangles.length - 1);
			integer(item.primitiveIndex, 0, U32_MAX);
			const triangle = input.triangles[item.triangleIndex]!;
			requireValue(
				item.primitiveIndex === triangle.primitiveIndex,
				"Surface primitive identity mismatch",
			);
			for (const [key, size] of [
				["uv", 2],
				["color", 4],
			] as const) {
				requireValue(
					Object.hasOwn(item, key) === (triangle[key] != null),
					"Surface attribute presence mismatch",
				);
				if (Object.hasOwn(item, key)) vector(item[key], size);
			}
			requireValue(
				Object.hasOwn(item, "materialIndex") ===
					(triangle.materialIndex != null),
				"Surface material presence mismatch",
			);
			if (Object.hasOwn(item, "materialIndex")) {
				integer(item.materialIndex, 0, U32_MAX);
				requireValue(
					item.materialIndex === triangle.materialIndex,
					"Surface material identity mismatch",
				);
			}
		}
	}
	return value as ParticleSurfaceResult;
}

/** Validate the bounded outer reply before selecting a pending request by id.
 * Inner Rust data must still pass parseParticleResponse for that exact request.
 */
export function parseParticleReplyEnvelope(
	json: string,
	expected: ParticleIdentity,
	policy: ParticlePolicy,
): ParticleResponse {
	validateParticlePolicy(policy);
	const value = record(
		parseJson(json, policy.maxResponseEnvelopeBytes),
		[...ENVELOPE_KEYS, "ok"],
		["responseJson", "error"],
	);
	envelope(value, expected);
	if (value.ok === true) {
		record(value, [...ENVELOPE_KEYS, "ok", "responseJson"]);
		string(value.responseJson);
	} else {
		requireValue(value.ok === false, "Invalid particle response status");
		record(value, [...ENVELOPE_KEYS, "ok", "error"]);
		const error = record(value.error, ["code", "message"]);
		requireValue(
			["surface", "protocol", "cancelled"].includes(error.code as string),
			"Unsupported particle failure code",
		);
		string(error.message);
	}
	return value as ParticleResponse;
}

export function parseParticleResponse(
	json: string,
	request: ParticleSampleRequest,
	policy: ParticlePolicy,
): ParticleResponse {
	const value = parseParticleReplyEnvelope(json, request, policy);
	requireValue(value.id === request.id, "Particle response id mismatch");
	if (value.ok)
		validateParticleSurfaceResponse(value.responseJson, request, policy);
	return value;
}
