import {
	snapshotParticleWorkerPolicy,
	validParticleText,
	type ParticleSamplerWorkerPolicy,
} from "./particle-sampler-worker-policy";
export type { ParticleSamplerWorkerPolicy } from "./particle-sampler-worker-policy";

/** Internal lifecycle seam. Only trusted host code supplies the worker factory. */
export interface ParticleSamplerWorkerPort {
	postMessage(value: unknown): void;
	on(event: string, listener: (value: unknown) => void): unknown;
	off(event: string, listener: (value: unknown) => void): unknown;
	terminate(): Promise<number>;
}
function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (error: Error) => void;
	const promise = new Promise<T>((a, b) => {
		resolve = a;
		reject = b;
	});
	return { promise, resolve, reject };
}
function error(reason: string) {
	return new Error(`Particle sampler worker: ${reason}`);
}
function aborted() {
	const result = error("capture aborted");
	result.name = "AbortError";
	return result;
}
type Task = ReturnType<typeof deferred<string>> & {
	id: number;
	json: string;
	signal: AbortSignal;
	abort(): void;
	started: boolean;
	timer: ReturnType<typeof setTimeout>;
};

/** One capture, one synchronous WASM execution at a time. Logical retained
 * payload admission is pending * maxRequestJsonBytes + maxResponseJsonBytes. This is
 * not a heap ceiling: IPC-serialized request/response copies, UTF-16,
 * V8 overhead, WASM memory and results retained by callers are outside it.
 */
export function createParticleSamplerWorkerCore(
	policy: ParticleSamplerWorkerPolicy,
	spawn: (
		policy: Readonly<ParticleSamplerWorkerPolicy>,
	) => ParticleSamplerWorkerPort,
) {
	const limits = snapshotParticleWorkerPolicy(policy),
		ready = deferred<void>(),
		failure = deferred<never>();
	void ready.promise.catch(() => {});
	void failure.promise.catch(() => {});
	const pending = new Map<number, Task>(),
		queue: Task[] = [];
	let worker: ParticleSamplerWorkerPort | undefined, active: Task | undefined;
	let terminal: Error | undefined,
		initialized = false,
		exited = false,
		requests = 0;
	let initTimer: ReturnType<typeof setTimeout> | undefined;
	let terminationTimer: ReturnType<typeof setTimeout> | undefined;
	let termination: ReturnType<typeof deferred<void>> | undefined;
	const clearTask = (task: Task) => {
		clearTimeout(task.timer);
		task.signal.removeEventListener("abort", task.abort);
		pending.delete(task.id);
	};
	const fail = (reason: Error) => {
		if (terminal) return;
		terminal = reason;
		failure.reject(reason);
		clearTimeout(initTimer);
		ready.reject(reason);
		for (const task of pending.values()) {
			clearTask(task);
			task.reject(reason);
		}
		queue.length = 0;
		active = undefined;
	};
	const terminate = () => {
		if (termination) return termination.promise;
		termination = deferred<void>();
		void termination.promise.catch(() => {});
		if (exited || !worker) {
			termination.resolve();
			return termination.promise;
		}
		terminationTimer = setTimeout(
			() => termination!.reject(error("termination timed out before exit")),
			limits.terminationTimeoutMs,
		);
		try {
			// A resolved terminate() is not sufficient: only the exit event resolves us.
			void worker.terminate().catch(() => {
				clearTimeout(terminationTimer);
				termination!.reject(error("termination failed before confirmed exit"));
			});
		} catch {
			clearTimeout(terminationTimer);
			termination.reject(error("termination failed before confirmed exit"));
		}
		return termination.promise;
	};
	const stop = (reason: Error) => {
		fail(reason);
		return terminate();
	};
	const pump = () => {
		if (!initialized || terminal || active || !queue.length) return;
		active = queue.shift()!;
		try {
			const message = {
				version: 1,
				operation: "particleSurface",
				id: active.id,
				requestJson: active.json,
			};
			if (
				!validParticleText(
					JSON.stringify(message),
					limits.maxRequestEnvelopeBytes,
				)
			)
				throw error("request envelope exceeds byte limit");
			worker!.postMessage(message);
		} catch {
			void stop(error("request dispatch failed"));
		}
	};
	const message = (value: unknown) => {
		if (terminal) return;
		try {
			if (!value || typeof value !== "object" || Array.isArray(value))
				throw error("invalid worker message");
			const data = value as Record<string, unknown>;
			if (
				!validParticleText(
					JSON.stringify(data),
					limits.maxResponseEnvelopeBytes,
				)
			)
				throw error("response envelope exceeds byte limit");
			const keys =
				data.kind === "ready"
					? ["version", "kind"]
					: data.kind === "failure"
						? ["version", "kind", "code"]
						: data.kind === "started"
							? ["version", "kind", "id"]
							: ["version", "kind", "id", "responseJson"];
			if (
				data.version !== 1 ||
				Object.keys(data).length !== keys.length ||
				keys.some((key) => !Object.hasOwn(data, key))
			)
				throw error("invalid worker message schema");
			if (data.kind === "ready") {
				if (initialized) throw error("duplicate ready message");
				initialized = true;
				clearTimeout(initTimer);
				ready.resolve();
				pump();
				return;
			}
			if (data.kind === "failure")
				throw error("initialization or execution failed");
			if (!initialized || !active || data.id !== active.id)
				throw error("unexpected response identity");
			if (data.kind === "started" && !active.started) {
				active.started = true;
				return;
			}
			if (
				data.kind !== "result" ||
				!active.started ||
				!validParticleText(data.responseJson, limits.maxResponseJsonBytes)
			)
				throw error("invalid or oversized worker response");
			const done = active;
			active = undefined;
			clearTask(done);
			done.resolve(data.responseJson);
			pump();
		} catch (reason) {
			void stop(
				reason instanceof Error ? reason : error("invalid worker message"),
			);
		}
	};
	const crash = () => {
		void stop(error("worker crashed"));
	};
	const exit = () => {
		exited = true;
		clearTimeout(initTimer);
		clearTimeout(terminationTimer);
		if (!terminal) fail(error("worker exited unexpectedly"));
		worker?.off("message", message);
		worker?.off("error", crash);
		worker?.off("exit", exit);
		termination?.resolve();
	};
	try {
		worker = spawn(limits);
		worker.on("message", message);
		worker.on("error", crash);
		worker.on("exit", exit);
		initTimer = setTimeout(() => {
			void stop(error("initialization timed out"));
		}, limits.initTimeoutMs);
	} catch {
		fail(error("worker could not start"));
		if (worker) void terminate();
		else exited = true;
	}

	return {
		ready: ready.promise,
		failure: failure.promise,
		check() {
			if (terminal) throw terminal;
			if (!initialized || pending.size) throw error("sampling is not complete");
		},
		sampler(json: string, signal: AbortSignal): Promise<string> {
			try {
				if (terminal) throw terminal;
				if (signal.aborted) throw aborted();
				if (!validParticleText(json, limits.maxRequestJsonBytes))
					throw error("invalid or oversized UTF-8 request");
				if (requests >= limits.maxRequestsPerFrame)
					throw error("request count limit exceeded");
				if (pending.size >= limits.maxPendingRequests)
					throw error("pending request limit exceeded");
				const task: Task = {
					...deferred<string>(),
					id: ++requests,
					json,
					signal,
					started: false,
					timer: setTimeout(() => {
						void stop(error("request timed out"));
					}, limits.requestTimeoutMs),
					abort: () => {
						void stop(aborted());
					},
				};
				pending.set(task.id, task);
				queue.push(task);
				signal.addEventListener("abort", task.abort, { once: true });
				if (signal.aborted) task.abort();
				else pump();
				return task.promise;
			} catch (reason) {
				return Promise.reject(reason);
			}
		},
		/** Reject/timeout leaves this capture permanently unusable; no restart. */
		terminateSampler: () => stop(error("capture terminated")),
	};
}
export type ParticleSamplerWorker = ReturnType<
	typeof createParticleSamplerWorkerCore
>;
