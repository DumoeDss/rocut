import type { FrameBrowserEvent } from "./chromium-process";
import {
	PARTICLE_BINDING_NAME,
	type ParticleIdentity,
} from "./particle-protocol";
import {
	ELECTRON_PARTICLE_LIMITS,
	exactObject,
	headerInteger,
	PARTICLE_EVENT_CONTEXT,
	PARTICLE_EVENT_KIND,
	PARTICLE_EVENT_SEQUENCE,
	particleTransportError,
	positiveInteger,
	readParticleBody,
	rootFrame,
	strictParticleJson,
} from "./electron-particle-protocol";

export interface ElectronParticleEvent {
	sequence: number;
	event: FrameBrowserEvent;
	bytes: number;
	terminal: boolean;
}
export async function decodeElectronParticleEvent(
	response: Response,
	after: number,
	session: string,
): Promise<ElectronParticleEvent | undefined> {
	if (response.status === 204) {
		if (
			response.headers.has(PARTICLE_EVENT_SEQUENCE) ||
			response.headers.has(PARTICLE_EVENT_KIND) ||
			response.headers.has(PARTICLE_EVENT_CONTEXT) ||
			response.body
		)
			throw particleTransportError(
				"idle event response contains metadata or data",
			);
		return;
	}
	if (
		response.status !== 200 ||
		response.headers.get("content-type") !== "application/json"
	) {
		await response.body?.cancel().catch(() => {});
		throw particleTransportError(`event poll failed (HTTP ${response.status})`);
	}
	const sequence = headerInteger(response.headers.get(PARTICLE_EVENT_SEQUENCE));
	if (sequence !== after + 1) {
		await response.body?.cancel().catch(() => {});
		throw particleTransportError("event sequence skipped or replayed");
	}
	const kind = response.headers.get(PARTICLE_EVENT_KIND);
	if (kind === "particle-request") {
		const context = headerInteger(response.headers.get(PARTICLE_EVENT_CONTEXT));
		const bytes = await readParticleBody(
			response,
			ELECTRON_PARTICLE_LIMITS.maxParticleEventOrReplyRawBytes,
		);
		let payload: string;
		try {
			payload = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch {
			throw particleTransportError("event is not strict UTF-8");
		}
		return {
			sequence,
			bytes: bytes.length,
			terminal: false,
			event: {
				sessionId: session,
				method: "Runtime.bindingCalled",
				params: {
					name: PARTICLE_BINDING_NAME,
					executionContextId: context,
					payload,
				},
			},
		};
	}
	const keys: Record<string, string[]> = {
		"context-created": ["version", "executionContextId", "frameId"],
		"context-destroyed": ["version", "executionContextId"],
		"contexts-cleared": ["version"],
		"root-navigated": ["version", "frameId"],
		detached: ["version"],
		"window-gone": ["version"],
	};
	if (
		!kind ||
		!Object.hasOwn(keys, kind) ||
		response.headers.has(PARTICLE_EVENT_CONTEXT)
	) {
		await response.body?.cancel().catch(() => {});
		throw particleTransportError("unknown event kind or metadata");
	}
	const bytes = await readParticleBody(
		response,
		ELECTRON_PARTICLE_LIMITS.maxControlBodyBytes,
	);
	const value = exactObject(strictParticleJson(bytes), keys[kind]);
	if (value.version !== 2)
		throw particleTransportError("event version mismatch");
	if (Object.hasOwn(value, "executionContextId"))
		positiveInteger(value.executionContextId);
	if (Object.hasOwn(value, "frameId")) rootFrame(value.frameId);
	let method: string,
		params: Record<string, unknown> = {};
	switch (kind) {
		case "context-created":
			method = "Runtime.executionContextCreated";
			params = {
				context: {
					id: value.executionContextId,
					auxData: { frameId: value.frameId, isDefault: true },
				},
			};
			break;
		case "context-destroyed":
			method = "Runtime.executionContextDestroyed";
			params = { executionContextId: value.executionContextId };
			break;
		case "contexts-cleared":
			method = "Runtime.executionContextsCleared";
			break;
		case "root-navigated":
			method = "Page.frameNavigated";
			params = { frame: { id: value.frameId } };
			break;
		default:
			method = "Inspector.detached";
	}
	return {
		sequence,
		bytes: bytes.length,
		terminal: kind !== "context-created",
		event: { sessionId: session, method, params },
	};
}

/** Transport correlation only. Geometry and inner Rust output stay in the broker. */
export function particleCorrelation(
	payload: string,
	identity: ParticleIdentity,
	reply: boolean,
) {
	let decoded: unknown;
	try {
		decoded = JSON.parse(payload);
	} catch {
		throw particleTransportError("invalid particle envelope");
	}
	if (!decoded || typeof decoded !== "object")
		throw particleTransportError("invalid particle envelope");
	const input = decoded as Record<string, unknown>;
	const keys = [
		"version",
		"operation",
		"id",
		"sessionId",
		"captureId",
		"sourceId",
		"frameId",
	];
	if (reply) {
		if (input.ok !== true && input.ok !== false)
			throw particleTransportError("invalid reply envelope");
		keys.push("ok", input.ok ? "responseJson" : "error");
	} else {
		if (input.kind !== "sample" && input.kind !== "cancel")
			throw particleTransportError("invalid request envelope");
		keys.push("kind");
		if (input.kind === "sample") keys.push("requestJson");
	}
	const value = exactObject(input, keys);
	positiveInteger(value.id);
	if (
		value.version !== 1 ||
		value.operation !== "particleSurface" ||
		Object.entries(identity).some(([key, expected]) => value[key] !== expected)
	)
		throw particleTransportError("particle correlation mismatch");
	if (
		(value.kind === "sample" && typeof value.requestJson !== "string") ||
		(value.ok === true && typeof value.responseJson !== "string")
	)
		throw particleTransportError("particle JSON string missing");
	if (value.ok === false) {
		const error = exactObject(value.error, ["code", "message"]);
		if (
			!["surface", "protocol", "cancelled"].includes(error.code as string) ||
			typeof error.message !== "string" ||
			error.message.length > 1200
		)
			throw particleTransportError("invalid reply failure envelope");
	}
	return { id: value.id, kind: value.kind };
}
