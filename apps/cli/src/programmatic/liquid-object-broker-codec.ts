import {
	boundedText,
	record,
	type LiquidTransportFrame,
	type LiquidTransportPolicy,
} from "./engines/three-liquid-object-transport-publication";

export function assertLiquidBrokerFrame({
	value,
	expected,
}: {
	value: unknown;
	expected: LiquidTransportFrame;
}) {
	const frame = record({ value, keys: ["sessionId", "index", "time", "seed"] });
	if (Object.entries(expected).some(([key, entry]) => frame[key] !== entry))
		throw Error("Liquid page request changed the trusted mapped frame");
}

export function parseLiquidBrokerRequest(options: {
	json: unknown;
	frame: LiquidTransportFrame;
	policy: LiquidTransportPolicy;
	nextRequestId: number;
}) {
	const { frame, policy } = options;
	const text = boundedText({
		text: options.json,
		maximum: policy.maxRequestEnvelopeBytes,
	});
	const input: unknown = JSON.parse(text);
	if (input && typeof input === "object" && Object.hasOwn(input, "operation")) {
		boundedText({ text, maximum: policy.maxControlJsonBytes });
		const command = record({ value: input, keys: ["operation", "frame"] });
		assertLiquidBrokerFrame({ value: command.frame, expected: frame });
		if (command.operation !== "open" && command.operation !== "close")
			throw Error("Unsupported Liquid browser control operation");
		return { operation: command.operation } as const;
	}
	const envelope = record({
		value: input,
		keys: ["version", "identity", "payloadJson"],
	});
	const identity = record({
		value: envelope.identity,
		keys: ["frame", "requestId"],
	});
	assertLiquidBrokerFrame({ value: identity.frame, expected: frame });
	if (envelope.version !== 1 || identity.requestId !== options.nextRequestId)
		throw Error("Replayed or invalid Liquid page request identity");
	const payloadJson = boundedText({
		text: envelope.payloadJson,
		maximum: policy.maxRequestJsonBytes,
	});
	// Only canonical envelopes are admitted: the Rust reservation accounts these
	// exact bytes across page, Host and worker, without a second wrapper payload.
	const canonical = JSON.stringify({
		version: 1,
		identity: { frame, requestId: options.nextRequestId },
		payloadJson,
	});
	if (text !== canonical) throw Error("Liquid page envelope is not canonical");
	return {
		operation: "evaluate" as const,
		payloadJson,
		requestId: options.nextRequestId,
	};
}
