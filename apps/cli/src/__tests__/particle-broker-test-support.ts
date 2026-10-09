import type { FrameBrowserEvent } from "../programmatic/chromium-process";
import {
	attachParticleBroker,
	type ParticleBrokerOptions,
	type ParticleBrowser,
} from "../programmatic/particle-broker";
import {
	PARTICLE_BINDING_NAME,
	type ParticleIdentity,
	type ParticlePolicy,
} from "../programmatic/particle-protocol";

export const identity: ParticleIdentity = {
	sessionId: "logical-session",
	captureId: "capture-a",
	frameId: "frame-0",
	sourceId: "source-a",
};
export const policy: ParticlePolicy = {
	maxRequestJsonBytes: 4096,
	maxResponseJsonBytes: 4096,
	maxRequestEnvelopeBytes: 8192,
	maxResponseEnvelopeBytes: 8192,
	maxFrameRetainedPayloadBytes: 1024 * 1024,
	requestTimeoutMs: 15_000,
	frameTimeoutMs: 30_000,
	cleanupTimeoutMs: 5000,
	process: {
		maxPendingRequests: 2,
		initTimeoutMs: 5000,
		terminationTimeoutMs: 5000,
	},
	maxRequestsPerFrame: 8,
	maxInFlight: 2,
	maxTriangles: 4,
	maxSamples: 8,
};
export const requestJson = JSON.stringify({
	triangles: [
		{
			position: [
				[0, 0, 0],
				[1, 0, 0],
				[0, 1, 0],
			],
			primitiveIndex: 7,
		},
	],
	count: 1,
	seed: 42,
});
export const responseJson = JSON.stringify({
	version: 1,
	ok: true,
	samples: [
		{
			position: [0.25, 0.25, 0],
			normal: [0, 0, 1],
			barycentric: [0.5, 0.25, 0.25],
			triangleIndex: 0,
			primitiveIndex: 7,
		},
	],
});
export const sample = (id = 1, changes: Record<string, unknown> = {}) => ({
	...identity,
	version: 1,
	operation: "particleSurface",
	kind: "sample",
	id,
	requestJson,
	...changes,
});
export const cancel = (id = 1) => ({
	...identity,
	version: 1,
	operation: "particleSurface",
	kind: "cancel",
	id,
});
export function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (error: unknown) => void;
	const promise = new Promise<T>((a, b) => {
		resolve = a;
		reject = b;
	});
	return { promise, resolve, reject };
}
export function fakeBrowser(send?: ParticleBrowser["send"]) {
	const listeners = new Set<(event: FrameBrowserEvent) => void>();
	const calls: {
		method: string;
		params: Record<string, unknown>;
		session?: string;
	}[] = [];
	const browser: ParticleBrowser = {
		onEvent(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		async send(method, params = {}, session) {
			calls.push({ method, params, session });
			return send ? send(method, params, session) : {};
		},
	};
	const emitEvent = (event: FrameBrowserEvent) => {
		for (const listener of listeners) listener(event);
	};
	const emit = (
		payload: unknown,
		context = 17,
		session = "cdp-session",
		name = PARTICLE_BINDING_NAME,
	) =>
		emitEvent({
			sessionId: session,
			method: "Runtime.bindingCalled",
			params: {
				name,
				executionContextId: context,
				payload:
					typeof payload === "string" ? payload : JSON.stringify(payload),
			},
		});
	const replies = () =>
		calls
			.filter((call) => call.method === "Runtime.callFunctionOn")
			.map((call) => ({
				...call,
				reply: JSON.parse(
					(call.params.arguments as { value: string }[])[0].value,
				),
			}));
	return { browser, calls, listeners, emit, emitEvent, replies };
}
export async function fixture(
	overrides: Partial<ParticleBrokerOptions> = {},
	transport = fakeBrowser(),
) {
	const controller = new AbortController(),
		sampled: { json: string; signal: AbortSignal }[] = [];
	let stops = 0;
	const broker = await attachParticleBroker({
		browser: transport.browser,
		session: "cdp-session",
		executionContextId: 17,
		identity,
		policy,
		signal: controller.signal,
		cleanupTimeoutMs: 100,
		...overrides,
		sampler: async (json, signal) => {
			sampled.push({ json, signal });
			return overrides.sampler ? overrides.sampler(json, signal) : responseJson;
		},
		terminateSampler: async () => {
			stops++;
			await overrides.terminateSampler?.();
		},
	});
	return {
		...transport,
		...broker,
		broker,
		controller,
		sampled,
		stops: () => stops,
	};
}
