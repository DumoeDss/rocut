import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ParticlePolicy } from "./particle-policy";
import type { LiquidTransportPolicy } from "./engines/three-liquid-object-transport-publication";
import {
	assertElectronLiquidPolicyFit,
	ELECTRON_LIQUID_LIMITS,
} from "./liquid-object-electron-policy";
import {
	assertElectronParticlePolicyFit,
	ELECTRON_PARTICLE_LIMITS,
	exactObject,
	PARTICLE_EVENT_SEQUENCE,
	PARTICLE_SESSION_PATH,
	particleControl,
	particleControlObject,
	particleTransportError,
	positiveInteger,
	rootFrame,
	strictParticleJson,
	transportLimits,
} from "./electron-particle-protocol";

export type ElectronParticleOperation =
	| "events"
	| "context-enable"
	| "binding"
	| "evaluate"
	| "reply"
	| "check"
	| "layout"
	| "screenshot"
	| "cleanup"
	| "close";
const operations = new Set<string>([
	"events",
	"context-enable",
	"binding",
	"evaluate",
	"reply",
	"check",
	"layout",
	"screenshot",
	"cleanup",
	"close",
]);
export interface ElectronParticleSessionTransport {
	readonly sessionId: string;
	readonly rootFrameId: string;
	readonly openedAt: number;
	request(
		operation: ElectronParticleOperation,
		body: string,
		signal: AbortSignal,
		sequence?: number,
	): Promise<Response>;
}
export interface ElectronParticleConnection {
	probe(
		policy: ParticlePolicy,
		signal: AbortSignal,
	): Promise<{
		open(
			width: number,
			height: number,
			signal: AbortSignal,
		): Promise<ElectronParticleSessionTransport>;
	}>;
}
export interface ElectronLiquidConnection {
	probe(
		policy: LiquidTransportPolicy,
		signal: AbortSignal,
	): ReturnType<ElectronParticleConnection["probe"]>;
}
const unavailable = () =>
	Error(
		"Particle surface capture is not supported by this Electron host; particle session v2 capability unavailable",
	);

/** One bounded read per frame. Credentials remain in this backend-only closure. */
export async function pinElectronParticleConnection(
	connectionFile: string,
	signal: AbortSignal,
): Promise<ElectronParticleConnection> {
	return pinElectronScopedConnection(connectionFile, signal);
}

/** Internal finite profile selection; callers cannot supply endpoint or credentials. */
export async function pinElectronScopedConnection(
	connectionFile: string,
	signal: AbortSignal,
	profile: "particleSurface-v1" | "liquidObject-v1" = "particleSurface-v1",
): Promise<ElectronParticleConnection & ElectronLiquidConnection> {
	if (profile !== "particleSurface-v1" && profile !== "liquidObject-v1")
		throw unavailable();
	const liquid = profile === "liquidObject-v1";
	const limits = liquid ? ELECTRON_LIQUID_LIMITS : ELECTRON_PARTICLE_LIMITS;
	signal.throwIfAborted();
	let endpoint: URL, token: string;
	try {
		if (!isAbsolute(connectionFile)) throw unavailable();
		const file = await open(connectionFile, "r");
		let decoded: unknown;
		try {
			const stat = await file.stat();
			if (!stat.isFile() || stat.size > 4096) throw unavailable();
			const bytes = Buffer.alloc(4097),
				result = await file.read(bytes, 0, bytes.length, 0);
			if (result.bytesRead > 4096) throw unavailable();
			decoded = strictParticleJson(bytes.subarray(0, result.bytesRead));
		} finally {
			await file.close();
		}
		if (!decoded || typeof decoded !== "object") throw unavailable();
		const value = decoded as Record<string, unknown>;
		if (typeof value.endpoint !== "string") throw unavailable();
		endpoint = new URL(value.endpoint);
		if (
			value.version !== 1 ||
			value.backend !== "elftia-electron" ||
			endpoint.protocol !== "http:" ||
			endpoint.hostname !== "127.0.0.1" ||
			!endpoint.port ||
			endpoint.pathname !== "/v1/frame" ||
			endpoint.username ||
			endpoint.password ||
			endpoint.search ||
			endpoint.hash ||
			typeof value.token !== "string" ||
			!/^[a-f0-9]{64}$/.test(value.token)
		)
			throw unavailable();
		const capabilities = value.capabilities as
			| Record<string, unknown>
			| undefined;
		const capability = exactObject(
			capabilities?.[
				liquid ? "liquidObjectCaptureSession" : "particleCaptureSession"
			],
			["version", "protocol", "path"],
		);
		if (
			capability.version !== 2 ||
			capability.protocol !== profile ||
			capability.path !== PARTICLE_SESSION_PATH
		)
			throw unavailable();
		token = value.token;
	} catch {
		throw unavailable();
	}
	signal.throwIfAborted();
	const post = async (
		path: string,
		body: string,
		requestSignal: AbortSignal,
		sequence?: number,
	) => {
		requestSignal.throwIfAborted();
		try {
			return await fetch(
				new URL(PARTICLE_SESSION_PATH + path, endpoint.origin),
				{
					method: "POST",
					redirect: "error",
					signal: requestSignal,
					headers: {
						authorization: `Bearer ${token}`,
						"content-type": "application/json",
						...(sequence === undefined
							? {}
							: { [PARTICLE_EVENT_SEQUENCE]: String(sequence) }),
					},
					body,
				},
			);
		} catch {
			throw particleTransportError(
				requestSignal.aborted
					? "operation cancelled or timed out"
					: "connection failed",
			);
		}
	};
	let probed = false;
	return Object.freeze({
		async probe(
			policy: ParticlePolicy | LiquidTransportPolicy,
			operationSignal: AbortSignal,
		) {
			if (probed)
				throw particleTransportError("connection probe cannot be retried");
			probed = true;
			const probeSignal = AbortSignal.any([
				operationSignal,
				AbortSignal.timeout(5000),
			]);
			const value = await particleControl(
				await post(
					"/capabilities",
					JSON.stringify({ version: 2, ...(liquid ? { profile } : {}) }),
					probeSignal,
				),
				["version", "protocol", "enabled", "transportLimits"],
			);
			if (value.protocol !== profile || value.enabled !== true)
				throw unavailable();
			transportLimits(value.transportLimits, limits);
			if (liquid)
				assertElectronLiquidPolicyFit(policy as LiquidTransportPolicy);
			else assertElectronParticlePolicyFit(policy as ParticlePolicy);
			let opened = false;
			return Object.freeze({
				async open(width: number, height: number, openSignal: AbortSignal) {
					if (opened)
						throw particleTransportError(
							"connection session cannot be reopened",
						);
					opened = true;
					for (const dimension of [width, height]) {
						positiveInteger(dimension);
						if (dimension > 4096)
							throw particleTransportError("invalid capture dimensions");
					}
					const openedAt = performance.now();
					const result = await particleControlObject(
						await post(
							"/open",
							JSON.stringify({
								version: 2,
								width,
								height,
								...(liquid ? { profile } : {}),
							}),
							AbortSignal.any([openSignal, AbortSignal.timeout(5000)]),
						),
					);
					if (
						typeof result.sessionId !== "string" ||
						!/^[a-f0-9]{32}$/.test(result.sessionId)
					)
						throw particleTransportError("invalid session identity");
					try {
						exactObject(result, [
							"version",
							"sessionId",
							"rootFrameId",
							"transportLimits",
						]);
						rootFrame(result.rootFrameId);
						transportLimits(result.transportLimits, limits);
					} catch (error) {
						// A validated session ID transfers teardown ownership even when
						// the rest of /open is invalid. Never reuse the operation signal.
						try {
							const closed = await particleControl(
								await post(
									`/${result.sessionId}/close`,
									JSON.stringify({ version: 2, reason: "failed" }),
									AbortSignal.timeout(
										ELECTRON_PARTICLE_LIMITS.cleanupTimeoutMs,
									),
								),
								["version", "closed"],
							);
							if (closed.closed !== true)
								throw particleTransportError(
									"native window teardown unconfirmed",
								);
						} catch (cleanupError) {
							throw new AggregateError(
								[error, cleanupError],
								"Electron particle open admission and native close failed",
								{ cause: error },
							);
						}
						throw error;
					}
					const sessionId = result.sessionId,
						rootFrameId = result.rootFrameId;
					return Object.freeze({
						sessionId,
						rootFrameId,
						openedAt,
						request(
							operation: ElectronParticleOperation,
							body: string,
							requestSignal: AbortSignal,
							sequence?: number,
						) {
							if (!operations.has(operation) || typeof body !== "string")
								throw particleTransportError("unlisted transport operation");
							const maximum =
								operation === "evaluate"
									? ELECTRON_PARTICLE_LIMITS.maxExpressionRequestBytes
									: operation === "reply"
										? limits.maxParticleEventOrReplyRawBytes
										: ELECTRON_PARTICLE_LIMITS.maxControlBodyBytes;
							if (Buffer.byteLength(body) > maximum)
								throw particleTransportError("request exceeds its byte limit");
							if (operation === "reply") positiveInteger(sequence);
							else if (sequence !== undefined)
								throw particleTransportError("unexpected reply sequence");
							return post(
								`/${sessionId}/${operation}`,
								body,
								requestSignal,
								sequence,
							);
						},
					});
				},
			});
		},
	});
}
