/** Host-only codec: input crosses the trust boundary as bounded JSON text.
 * It never inspects author getters/proxies or accepts serialized Rust state. */
export interface LiquidTransportPolicy {
	version: 1;
	maxControlJsonBytes: number;
	maxVerticesPerRequest: number;
	maxRequestJsonBytes: number;
	maxResponseJsonBytes: number;
	maxRequestEnvelopeBytes: number;
	maxResponseEnvelopeBytes: number;
	maxMeshesPerFrame: number;
	maxVerticesPerFrame: number;
	maxRequestsPerFrame: number;
	maxEncodedBytesPerFrame: number;
	maxRetainedPayloadBytesPerFrame: number;
	maxInFlight: number;
	requestTimeoutMs: number;
	frameTimeoutMs: number;
	cleanupTimeoutMs: number;
	initTimeoutMs: number;
	terminationTimeoutMs: number;
}
export interface LiquidTransportFrame {
	sessionId: string;
	index: number;
	time: number;
	seed: number;
}
export interface LiquidTransportIdentity {
	frame: LiquidTransportFrame;
	requestId: number;
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function record({
	value,
	keys,
}: {
	value: unknown;
	keys: readonly string[];
}): Record<string, unknown> {
	if (
		!isRecord(value) ||
		Object.keys(value).length !== keys.length ||
		keys.some((key) => !Object.hasOwn(value, key))
	)
		throw Error("Invalid Liquid transport object shape");
	return value;
}
export function parseLiquidTransportPolicy(
	json: string,
): Readonly<LiquidTransportPolicy> {
	const policy = record({
		value: JSON.parse(json),
		keys: [
			"version",
			"maxControlJsonBytes",
			"maxVerticesPerRequest",
			"maxRequestJsonBytes",
			"maxResponseJsonBytes",
			"maxRequestEnvelopeBytes",
			"maxResponseEnvelopeBytes",
			"maxMeshesPerFrame",
			"maxVerticesPerFrame",
			"maxRequestsPerFrame",
			"maxEncodedBytesPerFrame",
			"maxRetainedPayloadBytesPerFrame",
			"maxInFlight",
			"requestTimeoutMs",
			"frameTimeoutMs",
			"cleanupTimeoutMs",
			"initTimeoutMs",
			"terminationTimeoutMs",
		],
	});
	if (
		policy.version !== 1 ||
		Object.entries(policy).some(
			([key, value]) =>
				key !== "version" &&
				(typeof value !== "number" ||
					!Number.isSafeInteger(value) ||
					value <= 0),
		)
	)
		throw Error("Invalid Rust Liquid policy publication");
	const number = (key: string): number => {
		const value = policy[key];
		if (typeof value !== "number")
			throw Error("Invalid Rust Liquid policy value");
		return value;
	};
	return Object.freeze({
		version: 1,
		maxControlJsonBytes: number("maxControlJsonBytes"),
		maxVerticesPerRequest: number("maxVerticesPerRequest"),
		maxRequestJsonBytes: number("maxRequestJsonBytes"),
		maxResponseJsonBytes: number("maxResponseJsonBytes"),
		maxRequestEnvelopeBytes: number("maxRequestEnvelopeBytes"),
		maxResponseEnvelopeBytes: number("maxResponseEnvelopeBytes"),
		maxMeshesPerFrame: number("maxMeshesPerFrame"),
		maxVerticesPerFrame: number("maxVerticesPerFrame"),
		maxRequestsPerFrame: number("maxRequestsPerFrame"),
		maxEncodedBytesPerFrame: number("maxEncodedBytesPerFrame"),
		maxRetainedPayloadBytesPerFrame: number("maxRetainedPayloadBytesPerFrame"),
		maxInFlight: number("maxInFlight"),
		requestTimeoutMs: number("requestTimeoutMs"),
		frameTimeoutMs: number("frameTimeoutMs"),
		cleanupTimeoutMs: number("cleanupTimeoutMs"),
		initTimeoutMs: number("initTimeoutMs"),
		terminationTimeoutMs: number("terminationTimeoutMs"),
	});
}
export function utf8Bytes(text: string): number {
	return Buffer.byteLength(text, "utf8");
}
export function boundedText({
	text,
	maximum,
}: {
	text: unknown;
	maximum: number;
}): string {
	if (typeof text !== "string" || utf8Bytes(text) > maximum)
		throw Error("Liquid UTF-8 byte limit exceeded");
	return text;
}
export function parseLiquidTransportFrame({
	frameJson,
	policy,
}: {
	frameJson: string;
	policy: LiquidTransportPolicy;
}): Readonly<LiquidTransportFrame> {
	const frame = record({
		value: JSON.parse(
			boundedText({ text: frameJson, maximum: policy.maxControlJsonBytes }),
		),
		keys: ["sessionId", "index", "time", "seed"],
	});
	const { sessionId, index, time, seed } = frame;
	if (
		typeof sessionId !== "string" ||
		typeof index !== "number" ||
		typeof time !== "number" ||
		typeof seed !== "number"
	)
		throw Error("Invalid Liquid frame publication types");
	return Object.freeze({ sessionId, index, time, seed }); // Numeric/domain and exact identity authority remains in the Rust session.
}
