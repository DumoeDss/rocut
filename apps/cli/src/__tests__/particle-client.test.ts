import { expect, test } from "bun:test";
import {
	createParticleClient,
	ParticleSurfaceError,
	type ParticleClientOptions,
} from "../programmatic/particle-client";
import {
	identity,
	policy,
	request,
	response,
	result,
} from "./particle-protocol-test-support";

async function rejected(job: Promise<string>): Promise<Error> {
	try {
		await job;
	} catch (error) {
		if (error instanceof Error) return error;
		throw Error("Expected an Error rejection");
	}
	throw Error("Expected rejection, received successful sampling");
}

function fixture(overrides: Partial<ParticleClientOptions> = {}) {
	const controller = new AbortController();
	const sent: string[] = [];
	const client = createParticleClient({
		identity,
		policy,
		signal: controller.signal,
		requestTimeoutMs: 1000,
		...overrides,
		send(json) {
			sent.push(json);
			return overrides.send?.(json);
		},
	});
	return {
		...client,
		controller,
		sent,
		start: (signal?: AbortSignal) =>
			client.sample(request().requestJson, signal),
		reply: (id = 1, raw = JSON.stringify(result())) =>
			client.receive(JSON.stringify({ ...response(raw), id })),
		cancels: () =>
			sent
				.map((json) => JSON.parse(json))
				.filter((message) => message.kind === "cancel"),
	};
}

test("out-of-order replies correlate requests and preserve original Rust JSON", async () => {
	const f = fixture();
	const first = f.start(),
		second = f.start();
	expect(f.sent.map((json) => JSON.parse(json).id)).toEqual([1, 2]);
	await expect(f.check()).rejects.toThrow("not complete");
	const raw = JSON.stringify(result(), null, 2);
	f.reply(2, raw);
	expect(await second).toBe(raw);
	f.reply(1);
	expect(await first).toBe(JSON.stringify(result()));
	await expect(f.check()).resolves.toBeUndefined();
	f.dispose();
	f.dispose();
	expect(f.cancels()).toHaveLength(0);
});

test("captures snapshot identity and policy; ids are never recycled", async () => {
	const ownIdentity = { ...identity },
		ownPolicy = { ...policy, maxRequestsPerFrame: 2 };
	const f = fixture({ identity: ownIdentity, policy: ownPolicy });
	ownIdentity.sourceId = "changed";
	ownPolicy.maxRequestsPerFrame = 20;
	for (let id = 1; id <= 2; id++) {
		const job = f.start();
		f.reply(id);
		await job;
	}
	await expect(f.start()).rejects.toThrow("limit");
	expect(JSON.parse(f.sent[0]).sourceId).toBe(identity.sourceId);
	expect(f.sent).toHaveLength(2);
	await expect(f.failure).rejects.toThrow("limit");
});

test("pre-aborted requests do not send or consume ids, capture abort closes client", async () => {
	const f = fixture(),
		requestAbort = new AbortController();
	requestAbort.abort();
	await expect(f.start(requestAbort.signal)).rejects.toThrow("already aborted");
	expect(f.sent).toHaveLength(0);
	const job = f.start();
	f.reply();
	await job;
	expect(JSON.parse(f.sent[0]).id).toBe(1);
	f.controller.abort();
	await expect(f.start()).rejects.toThrow("capture aborted");
	expect(f.cancels()).toHaveLength(0);
});

test("aborting one accepted request rejects all and sends one frame cancellation", async () => {
	const f = fixture(),
		requestAbort = new AbortController();
	const first = rejected(f.start(requestAbort.signal));
	const second = rejected(f.start());
	requestAbort.abort();
	expect((await first).message).toContain("request aborted");
	expect((await second).message).toContain("request aborted");
	expect(f.cancels()).toHaveLength(1);
	expect(f.cancels()[0].id).toBe(1);
	f.reply(1);
	f.reply(2);
	f.dispose();
	expect(f.cancels()).toHaveLength(1);
});

test("disposed client clears request listeners and ignores late success", async () => {
	const f = fixture(),
		requestAbort = new AbortController();
	const job = rejected(f.start(requestAbort.signal));
	f.dispose();
	expect((await job).message).toContain("disposed");
	requestAbort.abort();
	f.controller.abort();
	f.reply();
	expect(f.cancels()).toHaveLength(1);
	await expect(f.start()).rejects.toThrow("disposed");
});

test("a response deadline fails and cancels the entire frame", async () => {
	const f = fixture({ requestTimeoutMs: 10 });
	const jobs = [f.start(), f.start()].map(rejected);
	for (const error of await Promise.all(jobs))
		expect(error.message).toContain("timed out");
	expect(f.cancels()).toHaveLength(1);
	f.reply();
	await expect(f.failure).rejects.toThrow("timed out");
});

test("in-flight and request-byte admission failures reject without sending bad input", async () => {
	const f = fixture({ policy: { ...policy, maxInFlight: 1 } });
	const first = rejected(f.start());
	await expect(f.start()).rejects.toThrow("limit");
	expect((await first).message).toContain("limit");
	expect(f.sent.map((raw) => JSON.parse(raw).kind)).toEqual([
		"sample",
		"cancel",
	]);
	const g = fixture();
	await expect(
		g.sample("x".repeat(policy.maxRequestJsonBytes + 1)),
	).rejects.toThrow("byte limit");
	expect(g.sent).toHaveLength(0);
});

test("malformed, cross-frame, replayed, oversized or mismatched replies fail closed", async () => {
	const candidates = [
		"{",
		"x".repeat(policy.maxResponseJsonBytes + 1),
		JSON.stringify({ ...response(), version: 2 }),
		JSON.stringify({ ...response(), operation: "other" }),
		JSON.stringify({ ...response(), frameId: "different" }),
		JSON.stringify({ ...response(), sourceId: "different" }),
		JSON.stringify({ ...response(), id: 999 }),
		JSON.stringify(response(JSON.stringify({ ...result(), samples: [] }))),
		JSON.stringify(
			response(
				JSON.stringify({
					...result(),
					samples: [{ ...result().samples[0], primitiveIndex: 9 }],
				}),
			),
		),
	];
	for (const candidate of candidates) {
		const f = fixture(),
			job = rejected(f.start());
		f.receive(candidate);
		expect(await job).toBeInstanceOf(Error);
		await expect(f.check()).rejects.toThrow();
		expect(f.cancels()).toHaveLength(1);
	}
	const f = fixture();
	const first = f.start();
	f.reply();
	await first;
	const second = rejected(f.start());
	f.reply(1);
	expect((await second).message).toContain("replayed");
	expect(f.cancels()[0].id).toBe(2);
});

test("Rust structured failure remains available verbatim and fails every pending sample", async () => {
	const f = fixture();
	const raw = JSON.stringify(
		{
			version: 1,
			ok: false,
			error: {
				code: "allDegenerate",
				path: "triangles",
				message: "No positive area",
			},
		},
		null,
		2,
	);
	const jobs = [f.start(), f.start()].map(rejected);
	f.reply(1, raw);
	for (const error of await Promise.all(jobs)) {
		expect(error).toBeInstanceOf(ParticleSurfaceError);
		expect((error as ParticleSurfaceError).responseJson).toBe(raw);
	}
	// Rust error and broker failure replies already fail the host frame.
	expect(f.cancels()).toHaveLength(0);
});

test("host failure and synchronous/asynchronous binding failures reject all pending work", async () => {
	const f = fixture(),
		job = rejected(f.start());
	f.receive(
		JSON.stringify({
			...identity,
			version: 1,
			operation: "particleSurface",
			id: 1,
			ok: false,
			error: { code: "cancelled", message: "Host cancelled" },
		}),
	);
	expect((await job).message).toBe("Host cancelled");
	expect(f.cancels()).toHaveLength(0);
	for (const send of [
		() => {
			throw Error("binding failure");
		},
		() => Promise.reject(Error("binding failure")),
	]) {
		const g = fixture({ send });
		await expect(g.start()).rejects.toThrow("binding failure");
		await expect(g.failure).rejects.toThrow("binding failure");
	}
});

test("supports synchronous delivery and removes completed request abort listeners", async () => {
	const f = fixture({
		send: (raw) => {
			const message = JSON.parse(raw);
			if (message.kind === "sample") f.reply(message.id);
		},
	});
	const controller = new AbortController();
	expect(await f.start(controller.signal)).toBe(JSON.stringify(result()));
	controller.abort();
	await expect(f.check()).resolves.toBeUndefined();
	f.dispose();
	expect(f.cancels()).toHaveLength(0);
});

test("validates construction and pre-aborted capture cannot send", async () => {
	for (const requestTimeoutMs of [0, -1, 0.5, 30_001, Infinity])
		expect(() => fixture({ requestTimeoutMs })).toThrow("deadline");
	expect(() => fixture({ identity: { ...identity, sourceId: "" } })).toThrow();
	const controller = new AbortController();
	controller.abort();
	const f = fixture({ signal: controller.signal });
	await expect(f.start()).rejects.toThrow("capture aborted");
	expect(f.sent).toHaveLength(0);
});
