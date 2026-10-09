import { expect, test } from "bun:test";
import { fake } from "./particle-sampler-worker-test-support";

test("worker raw request and escaped IPC envelope limits are independent", async () => {
	const requestJson = '"é😀"';
	const rawBytes = Buffer.byteLength(requestJson);
	const envelopeBytes = Buffer.byteLength(
		JSON.stringify({
			version: 1,
			operation: "particleSurface",
			id: 1,
			requestJson,
		}),
	);
	for (const missing of [0, 1]) {
		const w = fake({
			maxRequestJsonBytes: rawBytes,
			maxRequestEnvelopeBytes: envelopeBytes - missing,
		});
		w.worker.ready();
		await w.ready;
		const pending = w.sampler(requestJson, new AbortController().signal);
		if (missing) {
			await expect(pending).rejects.toThrow("dispatch");
			expect(w.worker.messages).toHaveLength(0);
		} else {
			expect(w.worker.messages).toHaveLength(1);
			w.worker.start(1);
			w.worker.result(1);
			expect(await pending).toBe("{}");
		}
		const stop = w.terminateSampler();
		w.worker.exit();
		await stop;
	}
});

test("worker response envelope limit rejects raw payloads that fit their own cap", async () => {
	const responseJson = '"é😀"';
	const envelopeBytes = Buffer.byteLength(
		JSON.stringify({ version: 1, kind: "result", id: 1, responseJson }),
	);
	const w = fake({
		maxResponseJsonBytes: Buffer.byteLength(responseJson),
		maxResponseEnvelopeBytes: envelopeBytes - 1,
	});
	w.worker.ready();
	await w.ready;
	const pending = w.sampler("{}", new AbortController().signal);
	w.worker.start(1);
	w.worker.result(1, responseJson);
	await expect(pending).rejects.toThrow("response envelope");
	await expect(w.failure).rejects.toThrow("response envelope");
	expect(() => w.check()).toThrow("response envelope");
	const stop = w.terminateSampler();
	w.worker.exit();
	await stop;
});

test("worker host deadline poisons queued and active jobs and cannot be reset by a late result", async () => {
	const w = fake({ requestTimeoutMs: 10 });
	w.worker.ready();
	await w.ready;
	const first = w
		.sampler("{}", new AbortController().signal)
		.catch((error: unknown) => error);
	const second = w
		.sampler("{}", new AbortController().signal)
		.catch((error: unknown) => error);
	await expect(w.failure).rejects.toThrow("request timed out");
	expect(await first).toBeInstanceOf(Error);
	expect(await second).toBeInstanceOf(Error);
	w.worker.start(1);
	w.worker.result(1);
	expect(() => w.check()).toThrow("request timed out");
	expect(w.worker.terminations).toBe(1);
	const stop = w.terminateSampler();
	w.worker.exit();
	await stop;
});
