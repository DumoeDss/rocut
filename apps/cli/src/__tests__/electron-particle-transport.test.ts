import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { pinElectronParticleConnection } from "../programmatic/electron-particle-transport";
import {
	assertElectronParticlePolicyFit,
	ELECTRON_PARTICLE_LIMITS,
	readParticleBody,
	transportLimits,
} from "../programmatic/electron-particle-protocol";
import {
	decodeElectronParticleEvent,
	particleCorrelation,
} from "../programmatic/electron-particle-events";
import { identity, policy } from "./particle-broker-test-support";

test("v2 pins one connection, requires probe and exact native ceilings, and rejects policy before open", async () => {
	const root = await mkdtemp("C:/tmps/particle-electron-transport-"),
		path = join(root, "connection.private.json");
	const calls: { url?: string; authorization?: string }[] = [];
	let limits: object = ELECTRON_PARTICLE_LIMITS;
	const server = createServer((request, response) => {
		calls.push({
			url: request.url,
			authorization: request.headers.authorization,
		});
		request.resume();
		response.setHeader("content-type", "application/json");
		if (request.url?.endsWith("capabilities"))
			response.end(
				JSON.stringify({
					version: 2,
					protocol: "particleSurface-v1",
					enabled: true,
					transportLimits: limits,
				}),
			);
		else if (request.url?.endsWith("open"))
			response.end(
				JSON.stringify({
					version: 2,
					sessionId: "a".repeat(32),
					rootFrameId: "root-A",
					transportLimits: limits,
				}),
			);
		else response.end(JSON.stringify({ version: 2, closed: true }));
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/frame`;
	const descriptor = (token: string, grant = true) => ({
		version: 1,
		backend: "elftia-electron",
		endpoint,
		token,
		...(grant
			? {
					capabilities: {
						particleCaptureSession: {
							version: 2,
							protocol: "particleSurface-v1",
							path: "/v2/particle-capture",
						},
					},
				}
			: {}),
	});
	const signal = new AbortController().signal;
	try {
		await writeFile(path, JSON.stringify(descriptor("a".repeat(64), false)));
		await expect(pinElectronParticleConnection(path, signal)).rejects.toThrow(
			"not supported",
		);
		expect(calls.length).toBe(0);
		await writeFile(path, JSON.stringify(descriptor("a".repeat(64))));
		const pinned = await pinElectronParticleConnection(path, signal);
		await writeFile(path, JSON.stringify(descriptor("b".repeat(64))));
		const admitted = await pinned.probe(policy, signal),
			session = await admitted.open(1, 1, signal);
		expect(calls.map((call) => call.authorization)).toEqual([
			`Bearer ${"a".repeat(64)}`,
			`Bearer ${"a".repeat(64)}`,
		]);
		expect(session.sessionId).toBe("a".repeat(32));
		await expect(admitted.open(1, 1, signal)).rejects.toThrow("reopened");
		await expect(pinned.probe(policy, signal)).rejects.toThrow("retried");
		const badPolicy = await pinElectronParticleConnection(path, signal);
		await expect(
			badPolicy.probe(
				{ ...policy, maxFrameRetainedPayloadBytes: 128 * 1024 * 1024 },
				signal,
			),
		).rejects.toThrow("does not fit");
		expect(calls.filter((call) => call.url?.endsWith("/open")).length).toBe(1);
		limits = { ...ELECTRON_PARTICLE_LIMITS, maxQueuedEventCount: 9 };
		await expect(
			(await pinElectronParticleConnection(path, signal)).probe(policy, signal),
		).rejects.toThrow("unsupported transport limits");
		expect(calls.filter((call) => call.url?.endsWith("/open")).length).toBe(1);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((done) => server.close(() => done()));
	}
});

test("native limits reject every altered/missing/extra field without narrowing archived policy", () => {
	expect(assertElectronParticlePolicyFit(policy)).toEqual(policy);
	for (const key of Object.keys(ELECTRON_PARTICLE_LIMITS)) {
		expect(() =>
			transportLimits({ ...ELECTRON_PARTICLE_LIMITS, [key]: 0 }),
		).toThrow();
		const missing = { ...ELECTRON_PARTICLE_LIMITS } as Record<string, number>;
		delete missing[key];
		expect(() => transportLimits(missing)).toThrow();
	}
	expect(() =>
		transportLimits({ ...ELECTRON_PARTICLE_LIMITS, extra: 1 }),
	).toThrow();
});

test("open admission owns a validated session through independent close and preserves teardown failures", async () => {
	const root = await mkdtemp("C:/tmps/particle-electron-open-"),
		path = join(root, "connection.private.json");
	const calls: string[] = [];
	let opened: Record<string, unknown> = {},
		closeFails = false;
	const server = createServer((request, response) => {
		calls.push(request.url!);
		request.resume();
		response.setHeader("content-type", "application/json");
		if (request.url?.endsWith("capabilities"))
			response.end(
				JSON.stringify({
					version: 2,
					protocol: "particleSurface-v1",
					enabled: true,
					transportLimits: ELECTRON_PARTICLE_LIMITS,
				}),
			);
		else if (request.url?.endsWith("open"))
			response.end(JSON.stringify(opened));
		else response.end(JSON.stringify({ version: 2, closed: !closeFails }));
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	await writeFile(
		path,
		JSON.stringify({
			version: 1,
			backend: "elftia-electron",
			endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/frame`,
			token: "a".repeat(64),
			capabilities: {
				particleCaptureSession: {
					version: 2,
					protocol: "particleSurface-v1",
					path: "/v2/particle-capture",
				},
			},
		}),
	);
	const signal = new AbortController().signal;
	const attempt = async () =>
		(
			await (
				await pinElectronParticleConnection(path, signal)
			).probe(policy, signal)
		).open(1, 1, signal);
	const base = {
		version: 2,
		sessionId: "a".repeat(32),
		rootFrameId: "root-A",
		transportLimits: ELECTRON_PARTICLE_LIMITS,
	};
	try {
		for (const invalid of [
			{ ...base, rootFrameId: "" },
			{ ...base, transportLimits: {} },
			{ ...base, unlisted: true },
		]) {
			opened = invalid;
			await expect(attempt()).rejects.toThrow();
			expect(calls.at(-1)).toBe(`/v2/particle-capture/${base.sessionId}/close`);
		}
		opened = { ...base, rootFrameId: "" };
		closeFails = true;
		const failed = await attempt().catch((error: unknown) => error);
		expect(failed).toBeInstanceOf(AggregateError);
		expect((failed as AggregateError).errors[0].message).toContain(
			"root frame identity",
		);
		expect((failed as AggregateError).errors[1].message).toContain(
			"teardown unconfirmed",
		);
		expect((failed as AggregateError).cause).toBe(
			(failed as AggregateError).errors[0],
		);
		opened = { ...base, sessionId: "unsafe/target" };
		const closes = calls.filter((call) => call.endsWith("/close")).length;
		await expect(attempt()).rejects.toThrow("invalid session identity");
		expect(calls.filter((call) => call.endsWith("/close")).length).toBe(closes);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((done) => server.close(() => done()));
	}
});

test("bounded response reader refuses chunk overflow, declared overflow and malformed UTF8 events", async () => {
	await expect(readParticleBody(new Response("12345"), 4)).rejects.toThrow(
		"bounded admission",
	);
	await expect(
		readParticleBody(
			new Response("a", { headers: { "content-length": "5" } }),
			4,
		),
	).rejects.toThrow("byte limit");
	await expect(
		readParticleBody(
			new Response("a", { headers: { "content-length": "2" } }),
			4,
		),
	).rejects.toThrow("bounded admission");
	const response = new Response(new Uint8Array([255]), {
		headers: {
			"content-type": "application/json",
			"x-elftia-event-sequence": "1",
			"x-elftia-event-kind": "context-created",
		},
	});
	await expect(decodeElectronParticleEvent(response, 0, "a")).rejects.toThrow(
		"strict UTF-8",
	);
});

test("event protocol accepts idle and golden root event but rejects replay/unknown fields/context metadata", async () => {
	expect(
		await decodeElectronParticleEvent(
			new Response(null, { status: 204 }),
			4,
			"s",
		),
	).toBeUndefined();
	const event = (
		body: object,
		sequence = "1",
		kind = "context-created",
		extra = {},
	) =>
		new Response(JSON.stringify(body), {
			headers: {
				"content-type": "application/json",
				"x-elftia-event-sequence": sequence,
				"x-elftia-event-kind": kind,
				...extra,
			},
		});
	const body = { version: 2, executionContextId: 7, frameId: "root-A" };
	const golden = await decodeElectronParticleEvent(event(body), 0, "s");
	expect(golden?.event).toEqual({
		sessionId: "s",
		method: "Runtime.executionContextCreated",
		params: {
			context: { id: 7, auxData: { frameId: "root-A", isDefault: true } },
		},
	});
	for (const response of [
		event(body, "2"),
		event(body, "01"),
		event(body, "1", "arbitrary-cdp"),
		event({ ...body, origin: "spoof" }),
		event(body, "1", "context-created", {
			"x-elftia-execution-context-id": "7",
		}),
	])
		await expect(
			decodeElectronParticleEvent(response, 0, "s"),
		).rejects.toThrow();
});

test("correlation checks all identity fields while cancel is not a sample admission", () => {
	const cancel = {
		...identity,
		version: 1,
		operation: "particleSurface",
		kind: "cancel",
		id: 1,
	};
	expect(particleCorrelation(JSON.stringify(cancel), identity, false)).toEqual({
		id: 1,
		kind: "cancel",
	});
	for (const key of [
		"sessionId",
		"captureId",
		"sourceId",
		"frameId",
		"operation",
		"version",
	])
		expect(() =>
			particleCorrelation(
				JSON.stringify({ ...cancel, [key]: "wrong" }),
				identity,
				false,
			),
		).toThrow();
});
