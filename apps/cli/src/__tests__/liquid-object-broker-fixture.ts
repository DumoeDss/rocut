import type { FrameBrowserEvent } from "../programmatic/chromium-process";
import type { ParticleBrowser } from "../programmatic/particle-broker";
import { attachLiquidObjectBroker } from "../programmatic/liquid-object-broker";
import { createThreeLiquidObjectTransport } from "../programmatic/engines/three-liquid-object-transport";
import type { LiquidTransportPolicy } from "../programmatic/engines/three-liquid-object-transport-publication";

/** Fake CDP + fake admission/evaluation only; no Rust, WASM or process proof. */
export const policy: LiquidTransportPolicy = {
	version: 1, maxControlJsonBytes: 2048, maxVerticesPerRequest: 20,
	maxRequestJsonBytes: 2048, maxResponseJsonBytes: 2048,
	maxRequestEnvelopeBytes: 4096, maxResponseEnvelopeBytes: 4096,
	maxMeshesPerFrame: 20, maxVerticesPerFrame: 200, maxRequestsPerFrame: 20,
	maxEncodedBytesPerFrame: 20000, maxRetainedPayloadBytesPerFrame: 20000,
	maxInFlight: 1, requestTimeoutMs: 100, frameTimeoutMs: 5000,
	cleanupTimeoutMs: 100, initTimeoutMs: 100, terminationTimeoutMs: 100,
};
export const frame = { sessionId: "liquid-broker-fixture", index: 3, time: 0.5, seed: 9 };
export const payloadJson = JSON.stringify({ version: 1, params: { version: 1 }, positions: [0, 0, 0], time: frame.time, seed: frame.seed });
export const responseJson = JSON.stringify({ version: 1, ok: true, frame: { restore: false, positions: [0, 0, 0] } });
export const control = (operation: string) => JSON.stringify({ operation, frame });
export const envelope = (requestId = 1) => JSON.stringify({ version: 1, identity: { frame, requestId }, payloadJson });
export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
export function replyText(value: unknown): string {
	if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== "object" ||
		Object.keys(value[0]).length !== 1 || typeof value[0].value !== "string")
		throw Error("Invalid fake CDP reply arguments");
	return value[0].value;
}
export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed; });
	return { promise, resolve, reject };
}
export async function fixture(options: {
	evaluate?: (wire: string, signal: AbortSignal) => Promise<string>;
	terminate?: () => Promise<void>;
	send?: (method: string) => Promise<Record<string, unknown>>;
	onReply?: (reply: string) => void;
	limits?: Partial<LiquidTransportPolicy>;
} = {}) {
	const limits = { ...policy, ...options.limits };
	const listeners = new Set<(event: FrameBrowserEvent) => void>();
	const calls: { method: string; params: Record<string, unknown>; session?: string }[] = [];
	const admissions: Record<string, unknown>[] = [], evaluated: string[] = [];
	let terminations = 0;
	const browser: ParticleBrowser = {
		async send(...args: Parameters<ParticleBrowser["send"]>) {
			const [method, params = {}, session] = args;
			calls.push({ method, params, session });
			if (method === "Runtime.callFunctionOn") options.onReply?.(replyText(params.arguments));
			return options.send ? options.send(method) : {};
		},
		onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
	};
	const controller = new AbortController();
	const transport = createThreeLiquidObjectTransport({
		frameJson: JSON.stringify(frame), policyJson: JSON.stringify(limits), signal: controller.signal,
		admission: {
			async command(json) {
				const value = JSON.parse(json); admissions.push(value);
				return JSON.stringify({ version: 1, ok: true, ...(value.operation === "reserve" ? {
					reservation: { requestId: value.identity.requestId, maxResponseJsonBytes: 2048, maxResponseEnvelopeBytes: 4096 },
				} : {}) });
			},
			async terminate() { terminations++; await options.terminate?.(); },
		},
		async evaluate(wire, signal) {
			evaluated.push(wire);
			if (options.evaluate) return options.evaluate(wire, signal);
			return JSON.stringify({ version: 1, identity: JSON.parse(wire).identity, payloadJson: responseJson });
		},
	});
	const broker = await attachLiquidObjectBroker({ browser, session: "root-session", executionContextId: 17, transport, signal: controller.signal });
	const emit = (...args: [payload: unknown, executionContextId?: number, sessionId?: string, name?: string]) => {
		const [payload, executionContextId = 17, sessionId = "root-session", name = "__rocutLiquidObjectRequest"] = args;
		for (const listener of listeners) listener({ method: "Runtime.bindingCalled", sessionId, params: { payload, executionContextId, name } });
	};
	const replies = () => calls.filter((call) => call.method === "Runtime.callFunctionOn");
	const settled = async () => { for (let i = 0; i < 5; i++) await tick(); };
	return { browser, broker, transport, controller, listeners, calls, admissions, evaluated, emit, replies, settled,
		terminations: () => terminations,
		async finish() { try { await broker.dispose(); } catch { /* Tests assert uncertainty separately. */ } },
	};
}
