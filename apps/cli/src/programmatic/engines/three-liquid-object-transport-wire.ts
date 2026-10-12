import {
	boundedText,
	record,
	utf8Bytes,
	type LiquidTransportIdentity,
	type LiquidTransportPolicy,
} from "./three-liquid-object-transport-publication";

function jsonStringBytes(text: string): number {
	let bytes = 2; // Quotes; count JSON escaping without allocating the encoded body.
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code === 34 || code === 92) bytes += 2;
		else if (code < 32) bytes += [8, 9, 10, 12, 13].includes(code) ? 2 : 6;
		else if (
			code >= 0xd800 &&
			code <= 0xdbff &&
			i + 1 < text.length &&
			text.charCodeAt(i + 1) >= 0xdc00 &&
			text.charCodeAt(i + 1) <= 0xdfff
		) {
			bytes += 4;
			i++;
		} else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
		else bytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
	}
	return bytes;
}
export function prepareLiquidTransportRequest({
	requestJson,
	identity,
	policy,
}: {
	requestJson: unknown;
	identity: LiquidTransportIdentity;
	policy: LiquidTransportPolicy;
}) {
	const payloadJson = boundedText({
		text: requestJson,
		maximum: policy.maxRequestJsonBytes,
	});
	const parsed: unknown = JSON.parse(payloadJson);
	const hasDomain = parsed !== null && typeof parsed === "object" && Object.hasOwn(parsed, "domain");
	const request = record({
		value: parsed,
		keys: hasDomain
			? ["version", "params", "positions", "time", "seed", "domain"]
			: ["version", "params", "positions", "time", "seed"],
	});
	if (hasDomain) {
		const domain = record({ value: request.domain, keys: ["min", "max"] });
		if (["min", "max"].some((key) => {
			const values = domain[key];
			return !Array.isArray(values) || values.length !== 3 ||
				values.some((value: unknown) => typeof value !== "number" || !Number.isFinite(value));
		})) throw Error("Invalid Liquid transport domain shape");
	}
	if (
		request.version !== 1 ||
		request.time !== identity.frame.time ||
		request.seed !== identity.frame.seed ||
		!Array.isArray(request.positions) ||
		request.positions.length % 3 !== 0
	)
		throw Error("Liquid request does not match its trusted mapped frame");
	const vertices = request.positions.length / 3;
	if (vertices > policy.maxVerticesPerRequest)
		throw Error("Liquid per-request vertex transport limit exceeded");
	const header = JSON.stringify({ version: 1, identity, payloadJson: "" });
	const envelopeBytes = utf8Bytes(header) - 2 + jsonStringBytes(payloadJson);
	if (envelopeBytes > policy.maxRequestEnvelopeBytes)
		throw Error("Liquid encoded request envelope exceeds policy");
	return {
		vertices,
		requestJsonBytes: utf8Bytes(payloadJson),
		requestEnvelopeBytes: envelopeBytes,
		encode() {
			const envelope = JSON.stringify({ version: 1, identity, payloadJson });
			if (utf8Bytes(envelope) !== envelopeBytes)
				throw Error("Liquid envelope byte accounting mismatch");
			return envelope;
		},
	};
}
export function decodeLiquidTransportResponse({
	response,
	expected,
	policy,
	reserved,
	vertices,
}: {
	response: unknown;
	expected: LiquidTransportIdentity;
	policy: LiquidTransportPolicy;
	reserved: { maxResponseJsonBytes: number; maxResponseEnvelopeBytes: number };
	vertices: number;
}) {
	const envelope = boundedText({
		text: response,
		maximum: Math.min(
			policy.maxResponseEnvelopeBytes,
			reserved.maxResponseEnvelopeBytes,
		),
	});
	const reply = record({
		value: JSON.parse(envelope),
		keys: ["version", "identity", "payloadJson"],
	});
	if (reply.version !== 1) throw Error("Unsupported Liquid reply version");
	const identity = record({
		value: reply.identity,
		keys: ["frame", "requestId"],
	});
	const frame = record({
		value: identity.frame,
		keys: ["sessionId", "index", "time", "seed"],
	});
	if (
		identity.requestId !== expected.requestId ||
		frame.sessionId !== expected.frame.sessionId ||
		frame.index !== expected.frame.index ||
		frame.time !== expected.frame.time ||
		frame.seed !== expected.frame.seed
	)
		throw Error("Liquid reply identity mismatch");
	const payloadJson = boundedText({
		text: reply.payloadJson,
		maximum: Math.min(
			policy.maxResponseJsonBytes,
			reserved.maxResponseJsonBytes,
		),
	});
	const result = JSON.parse(payloadJson);
	if (
		result.version !== 1 ||
		result.ok !== true ||
		!result.frame ||
		typeof result.frame.restore !== "boolean" ||
		!Array.isArray(result.frame.positions) ||
		result.frame.positions.length !== vertices * 3 ||
		result.frame.positions.some(
			(value: unknown) => typeof value !== "number" || !Number.isFinite(value),
		)
	)
		throw Error(
			"Liquid Rust evaluator returned a rejection or malformed geometry",
		);
	return {
		payloadJson,
		responseJsonBytes: utf8Bytes(payloadJson),
		responseEnvelopeBytes: utf8Bytes(envelope),
	};
}
