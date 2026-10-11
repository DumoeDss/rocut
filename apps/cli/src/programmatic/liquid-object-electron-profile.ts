import type { ElectronScopedProfile } from "./electron-particle-browser";
import { ELECTRON_LIQUID_LIMITS } from "./liquid-object-electron-policy";
import {
	parseLiquidBrokerRequest,
	assertLiquidBrokerFrame,
} from "./liquid-object-broker-codec";
import {
	record,
	boundedText,
	type LiquidTransportFrame,
	type LiquidTransportPolicy,
} from "./engines/three-liquid-object-transport-publication";

export const ELECTRON_LIQUID_CHECK =
	"(() => { if(typeof window.__rocutLiquidObjectCheck!=='function') throw Error('Liquid page check unavailable'); return window.__rocutLiquidObjectCheck(); })()";
export const ELECTRON_LIQUID_CLEANUP =
	"(() => { if(typeof window.__rocutLiquidObjectCleanup!=='function') throw Error('Liquid page cleanup unavailable'); return window.__rocutLiquidObjectCleanup(); })()";

export function createElectronLiquidProfile(
	frame: LiquidTransportFrame,
	policy: LiquidTransportPolicy,
): ElectronScopedProfile {
	let nextRequestId = 1;
	let phase: "initial" | "open" | "closed" = "initial";
	return {
		kind: "liquid-request",
		binding: "__rocutLiquidObjectRequest",
		maxRawBytes: ELECTRON_LIQUID_LIMITS.maxParticleEventOrReplyRawBytes,
		maxRetainedBytes:
			ELECTRON_LIQUID_LIMITS.maxTransportRetainedParticlePayloadBytesPerSession,
		check: ELECTRON_LIQUID_CHECK,
		cleanup: ELECTRON_LIQUID_CLEANUP,
		reply:
			"function(payload) { return globalThis.__rocutLiquidObjectReply(payload); }",
		correlate(payload, reply) {
			if (!reply) {
				const request = parseLiquidBrokerRequest({
					json: payload,
					frame,
					policy,
					nextRequestId,
				});
				if (request.operation === "open") {
					if (phase !== "initial") throw Error("Liquid Electron open replayed");
					phase = "open";
					return { id: 0, kind: "control" };
				}
				if (phase !== "open")
					throw Error("Liquid Electron request outside open phase");
				if (request.operation === "close") {
					phase = "closed";
					return { id: -1, kind: "control" };
				}
				return { id: nextRequestId++, kind: "sample" };
			}
			const value: unknown = JSON.parse(
				boundedText({
					text: payload,
					maximum: policy.maxResponseEnvelopeBytes,
				}),
			);
			if (
				value &&
				typeof value === "object" &&
				Object.hasOwn(value, "operation")
			) {
				const control = record({ value, keys: ["operation", "frame", "ok"] });
				assertLiquidBrokerFrame({ value: control.frame, expected: frame });
				if (
					control.ok !== true ||
					!["open", "close"].includes(String(control.operation))
				)
					throw Error("Invalid Liquid Electron control reply");
				return { id: control.operation === "open" ? 0 : -1 };
			}
			const envelope = record({
				value,
				keys: ["version", "identity", "payloadJson"],
			});
			const identity = record({
				value: envelope.identity,
				keys: ["frame", "requestId"],
			});
			assertLiquidBrokerFrame({ value: identity.frame, expected: frame });
			if (
				envelope.version !== 1 ||
				!Number.isSafeInteger(identity.requestId) ||
				Number(identity.requestId) < 1
			)
				throw Error("Invalid Liquid Electron reply identity");
			boundedText({
				text: envelope.payloadJson,
				maximum: policy.maxResponseJsonBytes,
			});
			return { id: Number(identity.requestId) };
		},
	};
}
