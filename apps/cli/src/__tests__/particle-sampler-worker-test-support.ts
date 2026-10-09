import { EventEmitter } from "node:events";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { ChildProcess } from "node:child_process";
import { spawnParticleSamplerProcess } from "../programmatic/particle-sampler-worker-process";
import {
	createParticleSamplerWorkerCore,
	type ParticleSamplerWorkerPolicy,
} from "../programmatic/particle-sampler-worker-core";

export const policy: ParticleSamplerWorkerPolicy = {
	maxRequestJsonBytes: 4096,
	maxResponseJsonBytes: 4096,
	maxRequestEnvelopeBytes: 8192,
	maxResponseEnvelopeBytes: 8192,
	requestTimeoutMs: 15_000,
	maxRequestsPerFrame: 4,
	maxPendingRequests: 2,
	initTimeoutMs: 5000,
	terminationTimeoutMs: 5000,
};
export const requestJson = JSON.stringify({
	triangles: [
		{
			position: [
				[0, 0, 0],
				[1, 0, 0],
				[0, 1, 0],
			],
			primitiveIndex: 7,
		},
	],
	count: 2,
	seed: 42,
});
export function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
export class FakeWorker extends EventEmitter {
	messages: unknown[] = [];
	terminations = 0;
	termination = deferred<number>();
	postMessage(value: unknown) {
		this.messages.push(value);
	}
	terminate() {
		this.terminations++;
		return this.termination.promise;
	}
	ready() {
		this.emit("message", { version: 1, kind: "ready" });
	}
	start(id: number) {
		this.emit("message", { version: 1, kind: "started", id });
	}
	result(id: number, responseJson = "{}") {
		this.emit("message", { version: 1, kind: "result", id, responseJson });
	}
	exit(code = 1) {
		this.emit("exit", code);
		this.termination.resolve(code);
	}
}
export function fake(changes: Partial<ParticleSamplerWorkerPolicy> = {}) {
	const worker = new FakeWorker();
	const handle = createParticleSamplerWorkerCore(
		{ ...policy, ...changes },
		() => worker,
	);
	return { worker, ...handle };
}

// Test-only host injection. Production's public factory cannot accept this path.
export function real(
	modulePath: string,
	changes: Partial<ParticleSamplerWorkerPolicy> = {},
) {
	if (!isAbsolute(modulePath))
		throw Error("Test WASM module must be an absolute host path");
	let worker!: ChildProcess;
	const started = deferred<void>(),
		exited = deferred<number>();
	let didExit = false;
	const handle = createParticleSamplerWorkerCore(
		{ ...policy, maxRequestsPerFrame: 2, maxPendingRequests: 1, ...changes },
		(limits) => {
			const spawned = spawnParticleSamplerProcess(
				pathToFileURL(modulePath).href,
				limits,
			);
			worker = spawned.child;
			worker.on("message", (message: unknown) => {
				if ((message as { kind?: unknown })?.kind === "started")
					started.resolve();
			});
			worker.on("close", (code) => {
				didExit = true;
				exited.resolve(code ?? 1);
			});
			return spawned.port;
		},
	);
	return {
		...handle,
		worker,
		started: started.promise,
		exited: exited.promise,
		didExit: () => didExit,
	};
}
