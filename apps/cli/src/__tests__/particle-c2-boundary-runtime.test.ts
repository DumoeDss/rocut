import { expect, test } from "bun:test";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createParticlePageRuntime } from "../programmatic/particle-browser-runtime";
import { captureHtmlBrowserFrame } from "../programmatic/particle-capture-frame";
import type { ThreeParticleBuffers } from "../programmatic/engines/three-particle-buffers";
import { deferred } from "./particle-broker-test-support";
import {
	boundaryFixture,
	mappedFrame,
	pngBytes,
	session,
	tick,
} from "./particle-c2-boundary-support";

const toolchain = process.env.ROCUT_TEST_THREE_TOOLCHAIN;
if (toolchain && !isAbsolute(toolchain))
	throw Error("Expected absolute real Three toolchain path");
const THREE = toolchain
	? await import(
			pathToFileURL(join(toolchain, "node_modules/three/build/three.module.js"))
				.href
		)
	: undefined;
const check = test.skipIf(
	!toolchain || !process.env.ROCUT_PARTICLE_WASM_MODULE,
);

/** Executes the production page/client/extractor/buffer and Host broker/capture
 * functions. Only the CDP messages and screenshot bytes are transport fixtures. */
async function runtimeFixture(
	options: {
		replyAck?: Promise<Record<string, unknown>>;
		latePageFailure?: boolean;
	} = {},
) {
	if (!THREE) throw Error("Real Three fixture is not enabled");
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.BufferAttribute(new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
	);
	const material = new THREE.MeshBasicMaterial();
	const root = new THREE.Mesh(geometry, material);
	let page!: ReturnType<typeof createParticlePageRuntime>;
	let buffers: ThreeParticleBuffers | undefined;
	let lateSample: () => Promise<unknown> = async () => {};
	let phaseSettled = false;
	let started = false;
	const f = await boundaryFixture({
		send: async (method, params) => {
			if (method === "Runtime.callFunctionOn") {
				page.receive((params!.arguments as { value: string }[])[0].value);
				return options.replyAck ?? {};
			}
			if (method === "Runtime.evaluate") {
				await page.runPhase(async ({ particles }) => {
					lateSample = () =>
						particles.sampleSurface(root, { count: 4, underflow: "reject" });
					buffers = (
						await particles.sampleSurface(root, {
							count: 4,
							underflow: "reject",
						})
					).buffers;
				});
				phaseSettled = true;
			}
			if (method === "Page.captureScreenshot") {
				if (options.latePageFailure) await lateSample().catch(() => {});
				return { data: pngBytes.toString("base64") };
			}
			return {};
		},
	});
	page = createParticlePageRuntime(
		{
			version: 1,
			identity: f.identity,
			policy: f.policy,
			requestTimeoutMs: f.policy.requestTimeoutMs,
		},
		mappedFrame,
		(json) => f.emit(json),
	);
	return {
		...f,
		page,
		buffers: () => buffers,
		phaseSettled: () => phaseSettled,
		capture() {
			return captureHtmlBrowserFrame({
				send: (method, params) => f.browser.send(method, params, session),
				expression: "production-page-runtime-transport-fixture",
				executionContextId: f.context.executionContextId,
				signal: f.controller.signal,
				// Match production: page-only failure is discovered by page.check,
				// not an extra runtime.failure race unavailable to the real Host.
				failures: [f.context.failure, f.broker.failure],
				beforeEvaluate() {
					started = true;
				},
				async check() {
					f.context.check();
					if (started) await page.check();
					await f.broker.check();
				},
			});
		},
		async dispose() {
			try {
				await page.cleanup();
			} finally {
				await f.dispose();
				geometry.dispose();
				material.dispose();
			}
		},
	};
}

check(
	"real page-to-Rust-to-buffer completion does not bypass the Host reply-ack barrier",
	async () => {
		const ack = deferred<Record<string, unknown>>();
		const f = await runtimeFixture({ replyAck: ack.promise });
		const frame = f.capture();
		try {
			await tick();
			expect(f.phaseSettled()).toBe(true);
			expect(f.buffers()?.count).toBe(4);
			expect(f.buffers()?.position).toBeInstanceOf(Float32Array);
			expect(f.sampled).toHaveLength(1);
			expect(JSON.parse(f.sampled[0].json).seed).toBe(mappedFrame.seed);
			expect(
				f.calls.some((call) => call.method === "Page.captureScreenshot"),
			).toBe(false);
			ack.resolve({});
			expect(await frame).toEqual(pngBytes);
		} finally {
			ack.resolve({});
			await f.dispose();
		}
	},
);

check(
	"a caught page-only late sample failure rejects the PNG even with a healthy Host broker",
	async () => {
		const f = await runtimeFixture({ latePageFailure: true });
		try {
			await expect(f.capture()).rejects.toThrow(
				"Particle sampling is outside particleFrame",
			);
			await f.broker.check();
			expect(f.sampled).toHaveLength(1);
			expect(f.phaseSettled()).toBe(true);
			expect(
				f.calls.filter((call) => call.method === "Page.captureScreenshot"),
			).toHaveLength(1);
			await expect(f.page.check()).rejects.toThrow(
				"Particle sampling is outside particleFrame",
			);
		} finally {
			await expect(f.dispose()).rejects.toThrow(
				"Particle sampling is outside particleFrame",
			);
		}
		expect(f.listeners.size).toBe(0);
	},
);
