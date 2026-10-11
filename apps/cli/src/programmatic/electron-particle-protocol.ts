import { snapshotParticlePolicy, type ParticlePolicy } from "./particle-policy";

export const ELECTRON_PARTICLE_LIMITS = Object.freeze({
	maxControlBodyBytes: 65536,
	maxExpressionRequestBytes: 100663296,
	maxParticleEventOrReplyRawBytes: 16777216,
	maxQueuedEventCount: 8,
	maxQueuedEventRawBytes: 16777216,
	maxTransportRetainedParticlePayloadBytesPerSession: 67108864,
	maxPngBytes: 80000000,
	maxConcurrentEventPollsPerSession: 1,
	eventPollTimeoutMs: 1000,
	sessionTimeoutMs: 45000,
	cleanupTimeoutMs: 5000,
});
export type ElectronParticleLimits = {
	readonly [K in keyof typeof ELECTRON_PARTICLE_LIMITS]: number;
};
export const PARTICLE_SESSION_PATH = "/v2/particle-capture";
export const PARTICLE_EVENT_SEQUENCE = "x-elftia-event-sequence";
export const PARTICLE_EVENT_KIND = "x-elftia-event-kind";
export const PARTICLE_EVENT_CONTEXT = "x-elftia-execution-context-id";

export function particleTransportError(message: string): Error {
	return Error(`Elftia Electron particle ${message}`);
}
export function exactObject(
	value: unknown,
	keys: readonly string[],
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw particleTransportError("protocol requires an object");
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).length !== keys.length ||
		keys.some((key) => !Object.hasOwn(record, key))
	)
		throw particleTransportError("protocol has missing or unknown fields");
	return record;
}
export function positiveInteger(value: unknown): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) < 1)
		throw particleTransportError("protocol requires a positive safe integer");
}
export function headerInteger(value: string | null): number {
	if (!value || !/^[1-9][0-9]*$/.test(value))
		throw particleTransportError("invalid event header");
	const number = Number(value);
	positiveInteger(number);
	return number;
}
export function rootFrame(value: unknown): asserts value is string {
	if (typeof value !== "string" || !value || value.length > 256)
		throw particleTransportError("invalid root frame identity");
}
export function transportLimits(
	value: unknown,
	limits: ElectronParticleLimits = ELECTRON_PARTICLE_LIMITS,
): ElectronParticleLimits {
	const record = exactObject(value, Object.keys(limits));
	for (const [key, expected] of Object.entries(limits))
		if (record[key] !== expected)
			throw particleTransportError("unsupported transport limits");
	return limits;
}
/** Admission only: never replace or silently narrow the archived Rust policy. */
export function assertElectronParticlePolicyFit(
	value: ParticlePolicy,
): ParticlePolicy {
	const policy = snapshotParticlePolicy(value),
		limits = ELECTRON_PARTICLE_LIMITS;
	const transportReservation =
		policy.maxRequestsPerFrame *
		(policy.maxRequestEnvelopeBytes + policy.maxResponseEnvelopeBytes);
	if (
		policy.maxRequestEnvelopeBytes > limits.maxParticleEventOrReplyRawBytes ||
		policy.maxResponseEnvelopeBytes > limits.maxParticleEventOrReplyRawBytes ||
		policy.maxRequestEnvelopeBytes > limits.maxQueuedEventRawBytes ||
		policy.maxRequestsPerFrame > limits.maxQueuedEventCount ||
		policy.maxFrameRetainedPayloadBytes >
			limits.maxTransportRetainedParticlePayloadBytesPerSession ||
		!Number.isSafeInteger(transportReservation) ||
		transportReservation >
			limits.maxTransportRetainedParticlePayloadBytesPerSession ||
		policy.frameTimeoutMs > 30000 ||
		policy.process.initTimeoutMs > 5000 ||
		policy.cleanupTimeoutMs > limits.cleanupTimeoutMs ||
		5000 +
			policy.process.initTimeoutMs +
			policy.frameTimeoutMs +
			policy.cleanupTimeoutMs >
			limits.sessionTimeoutMs
	)
		throw particleTransportError(
			"archived policy does not fit the native transport; explicitly recompile for a supported profile",
		);
	return policy;
}
export async function readParticleBody(
	response: Response,
	maximum: number,
): Promise<Buffer> {
	const declared = response.headers.get("content-length");
	if (
		declared !== null &&
		(!/^(0|[1-9][0-9]*)$/.test(declared) ||
			!Number.isSafeInteger(Number(declared)) ||
			Number(declared) > maximum)
	) {
		await response.body?.cancel().catch(() => {});
		throw particleTransportError("response exceeds its byte limit");
	}
	const reader = response.body?.getReader();
	if (!reader) throw particleTransportError("response body is absent");
	const chunks: Buffer[] = [];
	let length = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > maximum)
				throw particleTransportError("response exceeds its byte limit");
			chunks.push(Buffer.from(value));
		}
		if (declared !== null && length !== Number(declared))
			throw particleTransportError("response was incomplete");
		return Buffer.concat(chunks, length);
	} catch {
		throw particleTransportError("response body failed bounded admission");
	} finally {
		await reader.cancel().catch(() => {});
	}
}
export function strictParticleJson(bytes: Uint8Array): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw particleTransportError("response is not strict UTF-8 JSON");
	}
}
export async function particleControlObject(response: Response) {
	if (
		response.status !== 200 ||
		response.headers.get("content-type") !== "application/json"
	) {
		await response.body?.cancel().catch(() => {});
		throw particleTransportError(`operation failed (HTTP ${response.status})`);
	}
	const value = strictParticleJson(
		await readParticleBody(
			response,
			ELECTRON_PARTICLE_LIMITS.maxControlBodyBytes,
		),
	);
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw particleTransportError("protocol requires an object");
	const record = value as Record<string, unknown>;
	if (record.version !== 2)
		throw particleTransportError("unexpected protocol version");
	return record;
}
export async function particleControl(
	response: Response,
	keys: readonly string[],
) {
	return exactObject(await particleControlObject(response), keys);
}
export async function particleOk(response: Response): Promise<void> {
	const value = await particleControl(response, ["version", "ok"]);
	if (value.ok !== true)
		throw particleTransportError("operation acknowledgement failed");
}
