import { expect, test } from "bun:test";
import {
	attachParticleBroker,
	type ParticleBrowser,
} from "../programmatic/particle-broker";
import { createParticleClient } from "../programmatic/particle-client";
import { PARTICLE_BINDING_NAME } from "../programmatic/particle-protocol";
import {
	identity,
	policy,
	request,
	response,
	result,
	surface,
} from "./particle-protocol-test-support";

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

test("review: a delivered response cannot hide an unsettled asynchronous send", async () => {
	const transport = deferred();
	const controller = new AbortController();
	const client = createParticleClient({
		identity,
		policy,
		signal: controller.signal,
		requestTimeoutMs: 1000,
		send: () => transport.promise,
	});
	let checking: Promise<void> | undefined;
	try {
		const sample = client.sample(request().requestJson);
		client.receive(JSON.stringify(response()));
		await sample;
		// A frame driver checks after author evaluation; transport failure must
		// not become possible only after this successful completion gate.
		let completed = false;
		checking = Promise.resolve().then(() => client.check());
		void checking.then(
			() => {
				completed = true;
			},
			() => {},
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(completed).toBe(false);
	} finally {
		transport.reject(Error("late transport rejection"));
		await expect(client.failure).rejects.toThrow("late transport rejection");
		client.dispose();
		if (checking)
			await expect(checking).rejects.toThrow("late transport rejection");
	}
});

test("review: sequential sampling works while the previous CDP reply acknowledgement is pending", async () => {
	const controller = new AbortController();
	const limits = { ...policy, maxInFlight: 1 };
	let listener: Parameters<ParticleBrowser["onEvent"]>[0] = () => {};
	let client!: ReturnType<typeof createParticleClient>;
	const browser: ParticleBrowser = {
		async send(method, params) {
			if (method === "Runtime.callFunctionOn") {
				const args = params!.arguments as { value: string }[];
				client.receive(args[0]!.value);
				// Browser-side sample continuations can execute before CDP returns
				// the acknowledgement for the host's reply-delivery command.
				await Promise.resolve();
			}
			return {};
		},
		onEvent(callback) {
			listener = callback;
			return () => {};
		},
	};
	const broker = await attachParticleBroker({
		browser,
		session: "review-session",
		executionContextId: 17,
		identity,
		policy: limits,
		signal: controller.signal,
		sampler: async () => JSON.stringify(result()),
		terminateSampler: async () => {},
		cleanupTimeoutMs: 1000,
	});
	client = createParticleClient({
		identity,
		policy: limits,
		signal: controller.signal,
		requestTimeoutMs: 1000,
		send(payload) {
			listener({
				sessionId: "review-session",
				method: "Runtime.bindingCalled",
				params: {
					name: PARTICLE_BINDING_NAME,
					executionContextId: 17,
					payload,
				},
			});
		},
	});
	try {
		expect(
			await Promise.race([
				client.sample(request().requestJson),
				broker.failure,
			]),
		).toBe(JSON.stringify(result()));
		expect(
			await Promise.race([
				client.sample(request().requestJson),
				broker.failure,
			]),
		).toBe(JSON.stringify(result()));
		await broker.check();
		await client.check();
	} finally {
		client.dispose();
		await broker.dispose();
	}
});

test("review: replies validate against their own request shape, not only their ids", async () => {
	const controller = new AbortController();
	const sent: string[] = [];
	const client = createParticleClient({
		identity,
		policy,
		signal: controller.signal,
		requestTimeoutMs: 1000,
		send: (json) => {
			sent.push(json);
		},
	});
	const one = client
		.sample(request().requestJson)
		.catch((error: Error) => error);
	const two = client
		.sample(request({ ...surface(), count: 2 }).requestJson)
		.catch((error: Error) => error);
	client.receive(JSON.stringify({ ...response(), id: 2 }));
	for (const outcome of await Promise.all([one, two])) {
		if (typeof outcome === "string") throw Error("Unexpected sampling success");
		expect(outcome.message).toContain("sample count mismatch");
	}
	expect(sent.map((json) => JSON.parse(json).kind)).toEqual([
		"sample",
		"sample",
		"cancel",
	]);
	client.dispose();
});

test("review: disposal keeps its first failure when outstanding sends reject later", async () => {
	const controller = new AbortController();
	const transport = deferred();
	const sent: string[] = [];
	const client = createParticleClient({
		identity,
		policy,
		signal: controller.signal,
		requestTimeoutMs: 1000,
		send(json) {
			sent.push(json);
			return transport.promise;
		},
	});
	const sampling = client
		.sample(request().requestJson)
		.catch((error: Error) => error);
	client.dispose();
	transport.reject(Error("late send rejection after disposal"));
	await expect(client.failure).rejects.toThrow("disposed");
	const outcome = await sampling;
	if (typeof outcome === "string") throw Error("Unexpected sampling success");
	expect(outcome.message).toContain("disposed");
	await Promise.resolve();
	await expect(Promise.resolve().then(() => client.check())).rejects.toThrow(
		"disposed",
	);
	expect(sent.map((json) => JSON.parse(json).kind)).toEqual([
		"sample",
		"cancel",
	]);
});

test("review: aborting the capture during a reentrant reply preserves terminal failure", async () => {
	const controller = new AbortController();
	const client = createParticleClient({
		identity,
		policy,
		signal: controller.signal,
		requestTimeoutMs: 1000,
		send(json) {
			if (JSON.parse(json).kind === "sample") {
				controller.abort();
				client.receive(JSON.stringify(response()));
			}
		},
	});
	await expect(client.sample(request().requestJson)).rejects.toThrow(
		"capture aborted",
	);
	await expect(client.failure).rejects.toThrow("capture aborted");
	await expect(Promise.resolve().then(() => client.check())).rejects.toThrow(
		"capture aborted",
	);
	client.dispose();
});

test("review: a response does not clear the deadline of a never-settled send", async () => {
	const controller = new AbortController();
	const transport = deferred();
	const client = createParticleClient({
		identity,
		policy,
		signal: controller.signal,
		requestTimeoutMs: 10,
		send: () => transport.promise,
	});
	try {
		const sample = client.sample(request().requestJson);
		client.receive(JSON.stringify(response()));
		expect(await sample).toBe(JSON.stringify(result()));
		await expect(client.check()).rejects.toThrow("acknowledgement timed out");
		await expect(client.failure).rejects.toThrow("acknowledgement timed out");
	} finally {
		transport.resolve();
		client.dispose();
	}
});

test("review: disposing while check awaits delivery cannot report success", async () => {
	const controller = new AbortController();
	const transport = deferred();
	const client = createParticleClient({
		identity,
		policy,
		signal: controller.signal,
		requestTimeoutMs: 1000,
		send: () => transport.promise,
	});
	const sample = client.sample(request().requestJson);
	client.receive(JSON.stringify(response()));
	await sample;
	const checking = client.check();
	client.dispose();
	await expect(checking).rejects.toThrow("disposed");
	transport.reject(Error("late delivery after disposal"));
	client.receive("not JSON, ignored after disposal");
	await expect(client.failure).rejects.toThrow("disposed");
});

test("review: check includes replies and new deliveries admitted while it is awaiting", async () => {
	const controller = new AbortController();
	const firstDelivery = deferred(),
		secondDelivery = deferred();
	const client = createParticleClient({
		identity,
		policy,
		signal: controller.signal,
		requestTimeoutMs: 1000,
		send: (json) =>
			JSON.parse(json).id === 1
				? firstDelivery.promise
				: secondDelivery.promise,
	});
	try {
		const first = client.sample(request().requestJson);
		const checking = client.check();
		const second = client.sample(request().requestJson);
		client.receive(JSON.stringify({ ...response(), id: 2 }));
		client.receive(JSON.stringify(response()));
		await Promise.all([first, second]);
		firstDelivery.resolve();
		let completed = false;
		void checking.then(
			() => {
				completed = true;
			},
			() => {},
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(completed).toBe(false);
		secondDelivery.resolve();
		await checking;
		expect(completed).toBe(true);
	} finally {
		firstDelivery.resolve();
		secondDelivery.resolve();
		client.dispose();
	}
});

test("review: disposal inside synchronous reply delivery also cancels the subsequently returned send promise", async () => {
	const controller = new AbortController();
	const transport = deferred();
	const client = createParticleClient({
		identity,
		policy,
		signal: controller.signal,
		requestTimeoutMs: 10,
		send() {
			client.receive(JSON.stringify(response()));
			client.dispose();
			return transport.promise;
		},
	});
	expect(await client.sample(request().requestJson)).toBe(
		JSON.stringify(result()),
	);
	await expect(client.check()).rejects.toThrow("disposed");
	transport.reject(Error("late reentrant delivery failure"));
	await expect(client.failure).rejects.toThrow("disposed");
});
