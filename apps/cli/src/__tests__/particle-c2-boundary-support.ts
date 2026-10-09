import { test } from "bun:test";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import {
	attachParticleBroker,
	type ParticleBrowser,
} from "../programmatic/particle-broker";
import { createParticleCaptureIdentity } from "../programmatic/particle-capture";
import { enableParticleRootContext } from "../programmatic/particle-capture-context";
import { captureHtmlBrowserFrame } from "../programmatic/particle-capture-frame";
import { parseParticleTransportPolicy } from "../programmatic/particle-policy";
import { fakeBrowser, requestJson } from "./particle-broker-test-support";

const wasmFile = process.env.ROCUT_PARTICLE_WASM_MODULE;
if (wasmFile && !isAbsolute(wasmFile))
	throw Error(
		"ROCUT_PARTICLE_WASM_MODULE must name an absolute real WASM module",
	);
const wasm = wasmFile ? await import(pathToFileURL(wasmFile).href) : undefined;
if (
	wasmFile &&
	(typeof wasm?.sampleParticleSurfaceJson !== "function" ||
		typeof wasm?.particleTransportPolicyJson !== "function")
)
	throw Error(
		"C2 boundary tests require the actual particle sampler and policy exports",
	);
export const check = test.skipIf(!wasmFile);
export const session = "c2-cdp-session";
export const rootContextId = 17;
export const pngBytes = Buffer.from("transport-only-png-sentinel");
export const mappedFrame = {
	index: 0,
	localTime: 0,
	seed: 42,
	width: 320,
	height: 180,
};

/** Only the CDP/delivery scheduling is synthetic. Geometry and policy are Rust.
 * This fixture does not claim private-worker termination or GPU acceptance. */
export async function boundaryFixture(
	options: {
		send?: ParticleBrowser["send"];
		deliver?: Promise<void>;
		terminate?: () => Promise<void>;
		transport?: ReturnType<typeof fakeBrowser>;
	} = {},
) {
	if (!wasm) throw Error("Real WASM boundary fixture is not enabled");
	const controller = new AbortController();
	const transport =
		options.transport ??
		fakeBrowser(async (method, params, cdpSession) => {
			if (method === "Page.getFrameTree")
				return { frameTree: { frame: { id: "root-frame" } } };
			if (method === "Runtime.enable") {
				for (const [id, frameId, isDefault, eventSession] of [
					[9, "child-frame", true, session],
					[22, "root-frame", false, session],
					[31, "root-frame", true, "other-session"],
					[rootContextId, "root-frame", true, session],
				] as const)
					transport.emitEvent({
						method: "Runtime.executionContextCreated",
						sessionId: eventSession,
						params: { context: { id, auxData: { frameId, isDefault } } },
					});
			}
			if (options.send) return options.send(method, params, cdpSession);
			if (method === "Page.captureScreenshot")
				return { data: pngBytes.toString("base64") };
			return {};
		});
	const context = await enableParticleRootContext({
		browser: transport.browser,
		session,
		signal: controller.signal,
		timeoutMs: 1000,
	});
	const identity = createParticleCaptureIdentity({
		session: "c2-logical-session",
		code: "export async function setup() {}",
		resources: [],
		archiveIdentityHash: "a".repeat(64),
		frame: mappedFrame,
	});
	const policy = parseParticleTransportPolicy(
		wasm.particleTransportPolicyJson(),
	).hostDefaults;
	const sampled: { json: string; result: string; signal: AbortSignal }[] = [];
	let stops = 0;
	const broker = await attachParticleBroker({
		browser: transport.browser,
		session,
		executionContextId: context.executionContextId,
		identity,
		policy,
		signal: controller.signal,
		cleanupTimeoutMs: Math.min(1000, policy.cleanupTimeoutMs),
		sampler: async (json, signal) => {
			const result: unknown = wasm.sampleParticleSurfaceJson(json);
			if (typeof result !== "string")
				throw Error("Rust sampler returned non-JSON data");
			sampled.push({ json, result, signal });
			await options.deliver;
			return result;
		},
		terminateSampler: async () => {
			stops++;
			await options.terminate?.();
		},
	});
	const sample = (id = 1, changes: Record<string, unknown> = {}) => ({
		...identity,
		version: 1,
		operation: "particleSurface",
		kind: "sample",
		id,
		requestJson,
		...changes,
	});
	return {
		...transport,
		controller,
		context,
		identity,
		policy,
		broker,
		sampled,
		sample,
		stops: () => stops,
		emit(
			payload: unknown,
			contextId = rootContextId,
			cdpSession = session,
			name?: string,
		) {
			transport.emit(payload, contextId, cdpSession, name);
		},
		capture() {
			return captureHtmlBrowserFrame({
				send: (method, params) =>
					transport.browser.send(method, params, session),
				expression: "controlled-page-fixture",
				executionContextId: context.executionContextId,
				signal: controller.signal,
				failures: [context.failure, broker.failure],
				check: async () => {
					context.check();
					await broker.check();
				},
				beforeEvaluate() {},
			});
		},
		async dispose() {
			try {
				await broker.dispose();
			} finally {
				context.dispose();
			}
		},
	};
}

export async function tick() {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
