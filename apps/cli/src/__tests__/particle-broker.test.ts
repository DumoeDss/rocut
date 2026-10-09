import { expect, test } from "bun:test";
import {
	PARTICLE_BINDING_NAME,
	PARTICLE_REPLY_NAME,
	parseParticleRequest,
	parseParticleResponse,
	type ParticleSampleRequest,
} from "../programmatic/particle-protocol";
import {
	cancel,
	deferred,
	fixture,
	identity,
	policy,
	requestJson,
	responseJson,
	sample,
} from "./particle-broker-test-support";

test("fake CDP only admits the explicitly authorized context and preserves request/response identity", async () => {
	const f = await fixture();
	try {
		f.emit("{", 18);
		f.emit("{", 17, "other-session");
		f.emit("{", 17, "cdp-session", "other-binding");
		await f.check();
		expect(f.sampled).toHaveLength(0);
		f.emit(sample());
		await f.check();
		expect(f.sampled).toHaveLength(1);
		expect(f.sampled[0].json).toBe(requestJson);
		expect(f.calls[0]).toEqual({
			method: "Runtime.addBinding",
			session: "cdp-session",
			params: { name: PARTICLE_BINDING_NAME, executionContextId: 17 },
		});
		const reply = f.replies()[0];
		expect(reply.params.executionContextId).toBe(17);
		expect(reply.session).toBe("cdp-session");
		expect(reply.params.functionDeclaration).toBe(
			`function(payload) { return globalThis.${PARTICLE_REPLY_NAME}(payload); }`,
		);
		expect(String(reply.params.functionDeclaration)).not.toContain(requestJson);
		const request = parseParticleRequest(
			JSON.stringify(sample()),
			identity,
			policy,
		) as ParticleSampleRequest;
		expect(
			parseParticleResponse(
				(reply.params.arguments as { value: string }[])[0].value,
				request,
				policy,
			),
		).toMatchObject({ ...identity, id: 1, ok: true, responseJson });
	} finally {
		await f.dispose();
	}
	expect(f.listeners.size).toBe(0);
	expect(f.stops()).toBe(1);
});

test("concurrent sampler results retain one-time ids despite reverse completion order", async () => {
	const first = deferred<string>(),
		second = deferred<string>();
	let calls = 0;
	const f = await fixture({
		sampler: async () => (++calls === 1 ? first : second).promise,
	});
	try {
		f.emit(sample(10));
		f.emit(sample(20));
		await Promise.resolve();
		expect(f.sampled).toHaveLength(2);
		second.resolve(responseJson);
		await Promise.resolve();
		await Promise.resolve();
		first.resolve(responseJson);
		await f.check();
		expect(f.replies().map((reply) => reply.reply.id)).toEqual([20, 10]);
		f.emit(sample(10));
		await expect(f.check()).rejects.toThrow("Replayed");
		await expect(f.failure).rejects.toThrow("Replayed");
		expect(f.sampled).toHaveLength(2);
		expect(f.replies()).toHaveLength(2);
	} finally {
		await f.dispose();
	}
});

test("authorized-context identity, malformed schema and unsupported operations fail the whole frame", async () => {
	for (const payload of [
		"{",
		"null",
		sample(0),
		sample(1, { sessionId: "foreign" }),
		sample(1, { captureId: "foreign" }),
		sample(1, { frameId: "foreign" }),
		sample(1, { sourceId: "foreign" }),
		sample(1, { operation: "fetch", url: "file:///private" }),
		sample(1, { method: "Runtime.evaluate", code: "bad()" }),
		sample(1, { requestJson: "{}" }),
		cancel(99),
	]) {
		const f = await fixture();
		try {
			f.emit(payload);
			await expect(f.check()).rejects.toThrow();
			f.emit(sample(2));
			expect(f.sampled).toHaveLength(0);
			expect(f.replies()).toHaveLength(0);
		} finally {
			await f.dispose();
		}
	}
});

test("wire bytes, requested triangles/sample counts and lifetime request count are bounded", async () => {
	for (const payload of [
		sample(1, { requestJson: "界".repeat(2000) }),
		sample(1, {
			requestJson: JSON.stringify({ ...JSON.parse(requestJson), count: 9 }),
		}),
		sample(1, {
			requestJson: JSON.stringify({
				...JSON.parse(requestJson),
				triangles: Array(5).fill(JSON.parse(requestJson).triangles[0]),
			}),
		}),
	]) {
		const f = await fixture();
		try {
			f.emit(payload);
			await expect(f.check()).rejects.toThrow();
			expect(f.sampled).toHaveLength(0);
		} finally {
			await f.dispose();
		}
	}
	const f = await fixture({
		policy: {
			...policy,
			maxRequestsPerFrame: 1,
			maxInFlight: 1,
			process: { ...policy.process, maxPendingRequests: 1 },
		},
	});
	try {
		f.emit(sample(1));
		await f.check();
		f.emit(sample(2));
		await expect(f.check()).rejects.toThrow("count limit");
		expect(f.sampled).toHaveLength(1);
	} finally {
		await f.dispose();
	}
});

test("in-flight overflow aborts admitted work instead of queueing unbounded samples", async () => {
	const f = await fixture({
		policy: { ...policy, maxInFlight: 1 },
		sampler: (_, signal) =>
			new Promise((_, reject) => {
				signal.addEventListener(
					"abort",
					() => reject(Error("worker cancelled")),
					{ once: true },
				);
			}),
	});
	try {
		f.emit(sample(1));
		await Promise.resolve();
		f.emit(sample(2));
		await expect(f.check()).rejects.toThrow("in-flight");
		expect(f.sampled).toHaveLength(1);
		expect(f.sampled[0].signal.aborted).toBe(true);
		expect(f.replies()).toHaveLength(1);
		expect(f.replies()[0].reply).toMatchObject({
			id: 1,
			ok: false,
			error: { code: "protocol" },
		});
	} finally {
		await f.dispose();
	}
});

test("Rust failures preserve original Rust JSON but still fail the entire frame", async () => {
	const failureJson =
		'{"version":1,"ok":false,"error":{"code":"allDegenerate","path":"triangles","message":"no area"}}';
	const f = await fixture({ sampler: async () => failureJson });
	try {
		f.emit(sample());
		await expect(f.check()).rejects.toThrow("Rust particle");
		expect(f.replies()[0].reply).toMatchObject({
			ok: true,
			responseJson: failureJson,
		});
		expect(f.replies()).toHaveLength(1);
	} finally {
		await f.dispose();
	}
});

test("sampler exceptions, malformed results and oversized complete response envelopes cannot commit a frame", async () => {
	for (const sampler of [
		async () => {
			throw Error("sampler fixture failure");
		},
		async () => "{",
		async () => "x".repeat(5000),
		async () => JSON.stringify({ ...JSON.parse(responseJson), samples: [] }),
	]) {
		const f = await fixture({ sampler });
		try {
			f.emit(sample());
			await expect(f.check()).rejects.toThrow();
			expect(f.replies().some((reply) => reply.reply.ok === true)).toBe(false);
		} finally {
			await f.dispose();
		}
	}
	const f = await fixture({
		policy: {
			...policy,
			maxResponseJsonBytes: Buffer.byteLength(responseJson),
			maxResponseEnvelopeBytes: Buffer.byteLength(responseJson),
		},
	});
	try {
		f.emit(sample());
		await expect(f.check()).rejects.toThrow("envelope");
		expect(f.replies()).toHaveLength(0);
	} finally {
		await f.dispose();
	}
});
