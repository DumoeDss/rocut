import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import { spawnParticleSamplerProcess } from "../programmatic/particle-sampler-worker-process";
import { bootstrapParticleSamplerProcess } from "../programmatic/particle-sampler-worker-bootstrap";
import { attachParticleBroker } from "../programmatic/particle-broker";
import {
	createParticleClient,
	ParticleSurfaceError,
} from "../programmatic/particle-client";
import { PARTICLE_REPLY_NAME } from "../programmatic/particle-protocol";
import { fakeBrowser, identity } from "./particle-broker-test-support";
import { deferred, requestJson } from "./particle-sampler-worker-test-support";

const wasmPath = process.env.ROCUT_PARTICLE_WASM_MODULE;
const check = test.skipIf(!wasmPath);

async function fixture() {
	const capture = new AbortController();
	const spawned = spawnParticleSamplerProcess(pathToFileURL(wasmPath!).href);
	let didExit = false;
	spawned.child.once("close", () => {
		didExit = true;
	});
	const initialized = await bootstrapParticleSamplerProcess(
		spawned,
		5000,
		undefined,
		capture.signal,
	);
	const worker = {
		...initialized,
		worker: spawned.child,
		didExit: () => didExit,
	};
	await worker.ready;
	const limits = worker.policy;
	const replies: string[] = [],
		rustReplies: string[] = [];
	const acknowledgements: ReturnType<typeof deferred<void>>[] = [];
	let client!: ReturnType<typeof createParticleClient>;
	// Only this CDP transport is fake. Client, broker, process worker and Rust
	// WASM are real; no browser/GPU/Host integration is claimed by this fixture.
	const transport = fakeBrowser(async (method, params) => {
		if (method === "Runtime.callFunctionOn") {
			expect(params?.executionContextId).toBe(17);
			expect(String(params?.functionDeclaration)).toContain(
				PARTICLE_REPLY_NAME,
			);
			const payload = (params?.arguments as { value?: unknown }[])?.[0]?.value;
			if (typeof payload !== "string")
				throw Error("Expected the fixed JSON reply argument");
			replies.push(payload);
			const acknowledgement = deferred<void>();
			acknowledgements.push(acknowledgement);
			client.receive(payload);
			// Simulate a page continuation running before CDP acknowledges reply.
			await acknowledgement.promise;
		}
		return {};
	});
	const broker = await attachParticleBroker({
		browser: transport.browser,
		session: "cdp-session",
		executionContextId: 17,
		identity,
		policy: limits,
		signal: capture.signal,
		cleanupTimeoutMs: 5000,
		async sampler(json, signal) {
			const raw = await worker.sampler(json, signal);
			rustReplies.push(raw);
			return raw;
		},
		terminateSampler: worker.terminateSampler,
	});
	client = createParticleClient({
		identity,
		policy: limits,
		signal: capture.signal,
		requestTimeoutMs: 3000,
		send(json) {
			transport.emit(json);
			return Promise.resolve();
		},
	});
	const release = () => {
		for (const acknowledgement of acknowledgements) acknowledgement.resolve();
	};
	return {
		worker,
		client,
		broker,
		replies,
		rustReplies,
		release,
		async dispose() {
			release();
			client.dispose();
			await broker.dispose();
		},
	};
}

check(
	"real client/broker/process/Rust chain admits sequential requests before CDP reply acknowledgement",
	async () => {
		const f = await fixture();
		try {
			const first = await f.client.sample(requestJson);
			expect(JSON.parse(first).samples).toHaveLength(2);
			expect(f.replies).toHaveLength(1);
			const second = await f.client.sample(
				requestJson.replace('"seed":42', '"seed":43'),
			);
			expect(JSON.parse(second).samples).toHaveLength(2);
			expect(second).not.toBe(first);
			expect(f.replies.map((raw) => JSON.parse(raw).id)).toEqual([1, 2]);
			expect(f.rustReplies).toEqual([first, second]);
			await f.client.check();
			f.release();
			await f.broker.check();
		} finally {
			await f.dispose();
		}
		expect(f.worker.didExit()).toBe(true);
		expect(
			f.worker.worker.exitCode !== null || f.worker.worker.signalCode !== null,
		).toBe(true);
	},
);

check(
	"real Rust structured error remains verbatim through client and fails the broker frame",
	async () => {
		const f = await fixture();
		try {
			const failure: unknown = await f.client
				.sample(requestJson.replace("[1,0,0]", "[0,0,0]"))
				.catch((reason: unknown) => reason);
			expect(failure).toBeInstanceOf(ParticleSurfaceError);
			if (!(failure instanceof ParticleSurfaceError))
				throw Error("Expected real Rust surface rejection");
			expect(failure.responseJson).toBe(f.rustReplies[0]);
			expect(JSON.parse(failure.responseJson)).toMatchObject({
				version: 1,
				ok: false,
				error: { code: "allDegenerate", path: "triangles" },
			});
			const envelope = JSON.parse(f.replies[0]);
			expect(envelope.ok).toBe(true);
			expect(envelope.responseJson).toBe(failure.responseJson);
			await expect(f.client.check()).rejects.toThrow(
				"Rust particle surface sampling failed",
			);
			await expect(f.broker.failure).rejects.toThrow(
				"Rust particle surface sampling failed",
			);
			await expect(f.broker.check()).rejects.toThrow(
				"Rust particle surface sampling failed",
			);
		} finally {
			await f.dispose();
		}
		expect(f.worker.didExit()).toBe(true);
	},
);
