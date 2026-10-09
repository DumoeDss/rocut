import { fork, spawn, type ForkOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import {
	deriveParticleTransportPolicy,
	parseParticleTransportPolicy,
	type ParticleTransportPolicy,
} from "./particle-policy";
import type {
	ParticleSamplerWorkerPolicy,
	ParticleSamplerWorkerPort,
} from "./particle-sampler-worker-core";

/** Internal host-only transport. The current trusted runtime executes a fixed
 * entry with no shell, arbitrary args, page-controlled environment or commands.
 * Bun 1.4.2 thread terminate did not confirm exit from a synchronous WASM loop
 * within 5 seconds in the real cancellation test; process isolation is required.
 */
export function spawnParticleSamplerProcess(
	moduleUrl: string,
	policy?: Readonly<ParticleSamplerWorkerPolicy>,
	byteBoundEntry?: Readonly<{ workerEntrySource: string }>,
) {
	// Node forwards fork options to spawn; installed ForkOptions omits this flag.
	const options: ForkOptions & { windowsHide: true } = {
		execPath: process.execPath,
		execArgv: [],
		windowsHide: true,
		stdio: ["ignore", "ignore", "ignore", "ipc"],
		serialization: "json",
	};
	if (
		byteBoundEntry &&
		(!moduleUrl.startsWith("data:text/javascript;base64,") ||
			Buffer.byteLength(byteBoundEntry.workerEntrySource, "utf8") > 8_192)
	)
		throw Error("Invalid byte-bound particle sampler entry");
	// Windows environment names are case-insensitive, including when a parent
	// supplied a mixed-case key through a plain spawn env object.
	const environment = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => !["NODE_OPTIONS", "BUN_OPTIONS"].includes(key.toUpperCase()),
		),
	);
	const child = byteBoundEntry
		? spawn(
				process.execPath,
				["--input-type=module", "--eval", byteBoundEntry.workerEntrySource],
				{
					windowsHide: true,
					stdio: ["ignore", "ignore", "ignore", "ipc"],
					serialization: "json",
					env: environment,
				},
			)
		: fork(
				fileURLToPath(
					new URL("./particle-sampler-worker-entry.mjs", import.meta.url),
				),
				[],
				options,
			);
	const events = new EventEmitter();
	// A failed bootstrap may time out before confirmed close. Late process errors
	// must remain observed even after its lifecycle owner has already rejected.
	const observeLateError = () => {};
	events.on("error", observeLateError);
	let closed = false,
		code = 1;
	let termination: Promise<number> | undefined;
	let publishedJson: string | undefined,
		published: ParticleTransportPolicy | undefined,
		activated = false;
	let resolvePolicy!: (value: {
		policy: ParticleTransportPolicy;
		json: string;
	}) => void;
	let rejectPolicy!: (reason: Error) => void;
	const discovered = new Promise<{
		policy: ParticleTransportPolicy;
		json: string;
	}>((resolve, reject) => {
		resolvePolicy = resolve;
		rejectPolicy = reject;
	});
	void discovered.catch(() => {});
	child.on("message", (value: unknown) => {
		try {
			const message = value as {
				version?: unknown;
				kind?: unknown;
				policyJson?: unknown;
			};
			if (message?.kind === "policy") {
				if (
					published ||
					message.version !== 1 ||
					Object.keys(message).length !== 3 ||
					typeof message.policyJson !== "string"
				)
					throw Error("Invalid worker policy handshake");
				published = parseParticleTransportPolicy(message.policyJson);
				publishedJson = message.policyJson;
				let effective = published;
				if (policy) {
					effective = deriveParticleTransportPolicy(published, {
						maxInFlight: Math.min(
							published.hostDefaults.maxInFlight,
							policy.maxPendingRequests,
						),
						maxRequestJsonBytes: policy.maxRequestJsonBytes,
						maxResponseJsonBytes: policy.maxResponseJsonBytes,
						maxRequestEnvelopeBytes: policy.maxRequestEnvelopeBytes,
						maxResponseEnvelopeBytes: policy.maxResponseEnvelopeBytes,
						maxRequestsPerFrame: policy.maxRequestsPerFrame,
						requestTimeoutMs: policy.requestTimeoutMs,
						process: {
							maxPendingRequests: policy.maxPendingRequests,
							initTimeoutMs: policy.initTimeoutMs,
							terminationTimeoutMs: policy.terminationTimeoutMs,
						},
					});
					activate(effective);
				}
				resolvePolicy({ policy: effective, json: publishedJson });
				return;
			}
			if (message?.kind === "failure")
				rejectPolicy(Error("Particle sampler worker: initialization failed"));
			events.emit("message", value);
		} catch (reason) {
			const error =
				reason instanceof Error ? reason : Error("Invalid worker policy");
			rejectPolicy(error);
			if (!closed) events.emit("error", error);
		}
	});
	child.on("error", (reason) => {
		rejectPolicy(reason);
		if (!closed) events.emit("error", reason);
	});
	// close follows exit and stdio cleanup; never report exit from kill() alone.
	child.on("close", (value) => {
		closed = true;
		code = value ?? 1;
		rejectPolicy(
			Error(
				"Particle sampler worker: process exited during policy initialization",
			),
		);
		events.emit("exit", code);
		events.off("error", observeLateError);
	});
	const port: ParticleSamplerWorkerPort = {
		on: (event, listener) => events.on(event, listener),
		off: (event, listener) => events.off(event, listener),
		postMessage(value) {
			if (!child.connected) throw Error("Particle worker IPC is closed");
			child.send(value as Parameters<typeof child.send>[0], (reason) => {
				if (reason && !closed) events.emit("error", reason);
			});
		},
		terminate() {
			return (termination ??= new Promise<number>((resolve, reject) => {
				if (closed) {
					resolve(code);
					return;
				}
				events.once("exit", resolve);
				if (
					child.exitCode === null &&
					child.signalCode === null &&
					!child.kill("SIGKILL")
				) {
					events.off("exit", resolve);
					reject(Error("Particle worker kill was not accepted"));
				}
			}));
		},
	};
	const activate = (effective: ParticleTransportPolicy) => {
		if (!published || !publishedJson || activated)
			throw Error("Invalid particle activation state");
		const checked = parseParticleTransportPolicy(JSON.stringify(effective));
		if (JSON.stringify(checked.kernel) !== JSON.stringify(published.kernel))
			throw Error("Particle kernel policy identity mismatch");
		const narrowed = deriveParticleTransportPolicy(
			published,
			checked.hostDefaults,
		);
		activated = true;
		port.postMessage({
			version: 1,
			kind: "init",
			publishedPolicyJson: publishedJson,
			policyJson: JSON.stringify(narrowed),
		});
	};
	// Defer initialization until the lifecycle owner has attached its listeners.
	queueMicrotask(() => {
		if (closed || !child.connected) return;
		try {
			port.postMessage({
				version: 1,
				kind: "discover",
				moduleUrl,
			});
		} catch (reason) {
			if (!closed) events.emit("error", reason);
		}
	});
	return { port, child, discovered, activate };
}
