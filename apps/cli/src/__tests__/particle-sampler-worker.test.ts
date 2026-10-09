import { expect, test } from "bun:test";
import { createParticleSamplerWorkerCore } from "../programmatic/particle-sampler-worker-core";
import {
	FakeWorker,
	fake,
	policy,
} from "./particle-sampler-worker-test-support";

test("ready gates serial dispatch and active plus queued admission", async () => {
	const w = fake(),
		a = new AbortController(),
		b = new AbortController();
	const first = w.sampler("{}", a.signal),
		second = w.sampler("[]", b.signal);
	expect(w.worker.messages).toHaveLength(0);
	await expect(w.sampler("{}", new AbortController().signal)).rejects.toThrow(
		"pending",
	);
	w.worker.ready();
	await w.ready;
	expect(w.worker.messages).toHaveLength(1);
	w.worker.start(1);
	w.worker.result(1, '{"ok":false}');
	expect(await first).toBe('{"ok":false}');
	expect(w.worker.messages).toHaveLength(2);
	w.worker.start(2);
	w.worker.result(2, "  {}\n");
	expect(await second).toBe("  {}\n");
	const stop = w.terminateSampler();
	w.worker.exit();
	await stop;
});

test("policy snapshot is frozen and invalid limits never spawn", async () => {
	for (const field of Object.keys(policy)) {
		for (const value of [
			0,
			-1,
			0.5,
			NaN,
			Infinity,
			Number.MAX_SAFE_INTEGER + 1,
		]) {
			expect(() =>
				createParticleSamplerWorkerCore({ ...policy, [field]: value }, () => {
					throw Error("must not spawn");
				}),
			).toThrow("invalid explicit policy");
		}
	}
	for (const changes of [
		{ maxPendingRequests: 5 },
		{ initTimeoutMs: 0x8000_0000 },
		{ terminationTimeoutMs: 0x8000_0000 },
		{ maxRequestJsonBytes: Number.MAX_SAFE_INTEGER },
	]) {
		expect(() =>
			createParticleSamplerWorkerCore({ ...policy, ...changes }, () => {
				throw Error("must not spawn");
			}),
		).toThrow("invalid explicit policy");
	}
	const mutable = { ...policy },
		worker = new FakeWorker();
	const handle = createParticleSamplerWorkerCore(mutable, (snapshot) => {
		expect(Object.isFrozen(snapshot)).toBe(true);
		return worker;
	});
	mutable.maxRequestsPerFrame = 0;
	worker.ready();
	await handle.ready;
	const accepted = handle.sampler("{}", new AbortController().signal);
	worker.start(1);
	worker.result(1);
	expect(await accepted).toBe("{}");
	const stop = handle.terminateSampler();
	worker.exit();
	await stop;
});

test("pre-aborted and oversized/lone-surrogate requests consume no quota", async () => {
	const w = fake({
		maxRequestJsonBytes: 4,
		maxRequestsPerFrame: 1,
		maxPendingRequests: 1,
	});
	w.worker.ready();
	await w.ready;
	const aborted = new AbortController();
	aborted.abort();
	await expect(w.sampler("{}", aborted.signal)).rejects.toThrow("aborted");
	for (const json of ["😀x", "\ud800", "\udc00", "x".repeat(5)]) {
		await expect(w.sampler(json, new AbortController().signal)).rejects.toThrow(
			"UTF-8",
		);
	}
	const work = w.sampler("😀", new AbortController().signal);
	w.worker.start(1);
	w.worker.result(1);
	expect(await work).toBe("{}");
	await expect(w.sampler("{}", new AbortController().signal)).rejects.toThrow(
		"count",
	);
	const stop = w.terminateSampler();
	w.worker.exit();
	await stop;
});

test("any accepted abort rejects all jobs, ignores late results and waits for exit", async () => {
	const w = fake(),
		controller = new AbortController();
	w.worker.ready();
	await w.ready;
	const first = w
		.sampler("{}", new AbortController().signal)
		.catch((e: Error) => e);
	const second = w.sampler("{}", controller.signal).catch((e: Error) => e);
	controller.abort();
	expect(String(await first)).toContain("aborted");
	expect(String(await second)).toContain("aborted");
	expect(w.worker.terminations).toBe(1);
	w.worker.start(1);
	w.worker.result(1);
	await expect(w.sampler("{}", new AbortController().signal)).rejects.toThrow(
		"aborted",
	);
	const stop = w.terminateSampler();
	expect(w.terminateSampler()).toBe(stop);
	let finished = false;
	void stop.then(() => {
		finished = true;
	});
	w.worker.termination.resolve(1);
	await Promise.resolve();
	expect(finished).toBe(false);
	w.worker.exit();
	await stop;
	expect(finished).toBe(true);
});

test("aborting during init and aborting after a settled request have distinct lifetimes", async () => {
	const w = fake(),
		controller = new AbortController();
	const work = w.sampler("{}", controller.signal).catch((e: Error) => e);
	controller.abort();
	await expect(w.ready).rejects.toThrow("aborted");
	expect(await work).toBeInstanceOf(Error);
	const stop = w.terminateSampler();
	w.worker.exit();
	await stop;
	const healthy = fake(),
		done = new AbortController();
	healthy.worker.ready();
	await healthy.ready;
	const result = healthy.sampler("{}", done.signal);
	healthy.worker.start(1);
	healthy.worker.result(1);
	await result;
	done.abort();
	expect(healthy.worker.terminations).toBe(0);
	const closed = healthy.terminateSampler();
	healthy.worker.exit();
	await closed;
});

test("init failure, crash and unexpected clean exit settle pending and ready", async () => {
	for (const failure of ["init", "crash", "exit"]) {
		const w = fake();
		const work = w
			.sampler("{}", new AbortController().signal)
			.catch((e: Error) => e);
		if (failure === "init")
			w.worker.emit("message", { version: 1, kind: "failure", code: "init" });
		if (failure === "crash") w.worker.emit("error", Error("crash"));
		if (failure === "exit") w.worker.exit(0);
		await expect(w.ready).rejects.toThrow();
		expect(await work).toBeInstanceOf(Error);
		const stop = w.terminateSampler();
		if (failure !== "exit") w.worker.exit();
		await stop;
	}
	const failed = createParticleSamplerWorkerCore(policy, () => {
		throw Error("spawn");
	});
	await expect(failed.ready).rejects.toThrow("could not start");
	await failed.terminateSampler();
});

test("malformed, mismatched, oversized and duplicate messages poison the capture", async () => {
	for (const patch of [
		{ id: 2 },
		{ responseJson: "x".repeat(5) },
		{ responseJson: "\ud800" },
		{ version: 2 },
		{ module: "file:///untrusted" },
	]) {
		const w = fake({ maxResponseJsonBytes: 4 });
		w.worker.ready();
		await w.ready;
		const work = w
			.sampler("{}", new AbortController().signal)
			.catch((e: Error) => e);
		w.worker.start(1);
		w.worker.emit("message", {
			version: 1,
			kind: "result",
			id: 1,
			responseJson: "{}",
			...patch,
		});
		expect(await work).toBeInstanceOf(Error);
		const stop = w.terminateSampler();
		w.worker.exit();
		await stop;
	}
	const w = fake();
	w.worker.ready();
	await w.ready;
	w.worker.ready();
	await expect(w.sampler("{}", new AbortController().signal)).rejects.toThrow(
		"duplicate ready",
	);
	const stop = w.terminateSampler();
	w.worker.exit();
	await stop;
});

test("init and termination deadlines reject without making uncertain workers reusable", async () => {
	const w = fake({ initTimeoutMs: 5, terminationTimeoutMs: 5 });
	await expect(w.ready).rejects.toThrow("initialization timed out");
	const stop = w.terminateSampler();
	await expect(stop).rejects.toThrow("before exit");
	expect(w.terminateSampler()).toBe(stop);
	w.worker.exit();
	await expect(w.terminateSampler()).rejects.toThrow("before exit");
	await expect(w.sampler("{}", new AbortController().signal)).rejects.toThrow(
		"initialization timed out",
	);
});

test("dispatch and terminate failures cannot release or revive the capture", async () => {
	const w = fake();
	w.worker.ready();
	await w.ready;
	w.worker.postMessage = () => {
		throw Error("dispatch");
	};
	w.worker.terminate = () => Promise.reject(Error("runtime terminate failed"));
	await expect(w.sampler("{}", new AbortController().signal)).rejects.toThrow(
		"dispatch",
	);
	await expect(w.terminateSampler()).rejects.toThrow("termination failed");
	w.worker.exit();
	await expect(w.terminateSampler()).rejects.toThrow("termination failed");
	await expect(w.sampler("{}", new AbortController().signal)).rejects.toThrow(
		"dispatch",
	);
});
