import type { FrameBrowserEvent } from "./chromium-process";
import type { ParticleBrowser } from "./particle-broker";
import {
	PARTICLE_BINDING_NAME,
	PARTICLE_REPLY_NAME,
	type ParticleIdentity,
	type ParticlePolicy,
} from "./particle-protocol";
import {
	PARTICLE_PAGE_CHECK_NAME,
	PARTICLE_PAGE_CLEANUP_NAME,
} from "./particle-page-contract";
import {
	decodeElectronParticleEvent,
	particleCorrelation,
} from "./electron-particle-events";
import {
	ELECTRON_PARTICLE_LIMITS,
	exactObject,
	particleControl,
	particleOk,
	particleTransportError,
	readParticleBody,
} from "./electron-particle-protocol";
import type {
	ElectronParticleOperation,
	ElectronParticleSessionTransport,
} from "./electron-particle-transport";

export const ELECTRON_PARTICLE_CHECK = `(() => { const check = window[${JSON.stringify(PARTICLE_PAGE_CHECK_NAME)}]; if (typeof check !== 'function') throw Error('Particle page check is unavailable'); return check(); })()`;
export const ELECTRON_PARTICLE_CLEANUP = `(() => { const cleanup = window[${JSON.stringify(PARTICLE_PAGE_CLEANUP_NAME)}]; if (typeof cleanup !== 'function') throw Error('Particle page cleanup is unavailable'); return cleanup(); })()`;
export const ELECTRON_PARTICLE_REPLY = `function(payload) { return globalThis.${PARTICLE_REPLY_NAME}(payload); }`;

/** A finite, backend-local adaptation of ParticleBrowser, never wire CDP. */
export class ElectronParticleBrowser implements ParticleBrowser {
	readonly failure: Promise<never>;
	private rejectFailure!: (error: Error) => void;
	private problem?: Error;
	private readonly abort = new AbortController();
	private readonly pollAbort = new AbortController();
	private readonly listeners = new Set<(event: FrameBrowserEvent) => void>();
	private readonly outstanding = new Map<number, number>();
	private readonly seen = new Set<number>();
	private readonly activeSignal: AbortSignal;
	private readonly abortListener: () => void;
	private cleanupSignal?: AbortSignal;
	private pump?: Promise<void>;
	private sequence = 0;
	private retained = 0;
	private context?: number;
	private identity?: ParticleIdentity;
	private expression?: string;
	private enabled = false;
	private bound = false;
	private evaluated = false;
	private evaluationComplete = false;
	private captured = false;
	private closing = false;
	private closePromise?: Promise<void>;
	private readonly timer: ReturnType<typeof setTimeout>;
	constructor(
		readonly transport: ElectronParticleSessionTransport,
		readonly policy: ParticlePolicy,
		readonly signal: AbortSignal,
		private readonly width: number,
		private readonly height: number,
	) {
		this.failure = new Promise<never>((_, reject) => {
			this.rejectFailure = reject;
		});
		void this.failure.catch(() => {});
		this.activeSignal = AbortSignal.any([signal, this.abort.signal]);
		this.abortListener = () =>
			this.fail(particleTransportError("capture aborted"));
		signal.addEventListener("abort", this.abortListener, { once: true });
		const remaining =
			ELECTRON_PARTICLE_LIMITS.sessionTimeoutMs -
			policy.cleanupTimeoutMs -
			(performance.now() - transport.openedAt);
		this.timer = setTimeout(
			() =>
				this.fail(particleTransportError("absolute session deadline exceeded")),
			Math.max(1, remaining),
		);
		if (signal.aborted || remaining <= 0) this.abortListener();
	}
	private fail(error: unknown): Error {
		if (!this.problem) {
			this.problem =
				error instanceof Error
					? error
					: Error("Elftia Electron particle adapter failed", { cause: error });
			this.rejectFailure(this.problem);
			this.abort.abort();
		}
		return this.problem;
	}
	check() {
		if (this.problem) throw this.problem;
		if (this.closing) throw particleTransportError("session is closing");
	}
	setIdentity(identity: ParticleIdentity) {
		this.check();
		if (this.identity || identity.sessionId !== this.transport.sessionId)
			throw this.fail(particleTransportError("identity cannot be rebound"));
		this.identity = Object.freeze({ ...identity });
	}
	freezeExpression(expression: string) {
		this.check();
		if (
			this.expression !== undefined ||
			typeof expression !== "string" ||
			!expression ||
			expression === ELECTRON_PARTICLE_CHECK ||
			expression === ELECTRON_PARTICLE_CLEANUP
		)
			throw this.fail(
				particleTransportError("frame expression cannot be rebound"),
			);
		this.expression = expression;
	}
	beginCleanup() {
		this.cleanupSignal ??= AbortSignal.timeout(
			Math.min(5000, this.policy.cleanupTimeoutMs),
		);
	}
	onEvent(listener: (event: FrameBrowserEvent) => void) {
		if (this.closing || this.listeners.size >= 8)
			throw this.fail(particleTransportError("event listener limit exceeded"));
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	private charge(bytes: number) {
		this.retained += bytes;
		if (
			this.retained >
			ELECTRON_PARTICLE_LIMITS.maxTransportRetainedParticlePayloadBytesPerSession
		)
			throw particleTransportError("retained transport payload limit exceeded");
	}
	private async events() {
		try {
			while (!this.closing && !this.problem) {
				const response = await this.transport.request(
					"events",
					JSON.stringify({ version: 2, afterSequence: this.sequence }),
					AbortSignal.any([this.activeSignal, this.pollAbort.signal]),
				);
				const value = await decodeElectronParticleEvent(
					response,
					this.sequence,
					this.transport.sessionId,
				);
				if (!value) continue;
				this.sequence = value.sequence; // ACK is independent of outstanding reply correlation.
				const event = value.event;
				if (event.method === "Runtime.executionContextCreated") {
					const context = event.params.context as {
						id: number;
						auxData: { frameId: string };
					};
					if (
						this.context !== undefined ||
						context.auxData.frameId !== this.transport.rootFrameId
					)
						throw particleTransportError("root context replaced or mismatched");
					this.context = context.id;
				} else if (event.method === "Runtime.bindingCalled") {
					if (
						!this.identity ||
						!this.bound ||
						!this.evaluated ||
						event.params.executionContextId !== this.context
					)
						throw particleTransportError(
							"particle event is outside its bound context",
						);
					const payload = event.params.payload as string;
					if (value.bytes > this.policy.maxRequestEnvelopeBytes)
						throw particleTransportError(
							"request exceeds archived envelope policy",
						);
					this.charge(value.bytes);
					const correlation = particleCorrelation(
						payload,
						this.identity,
						false,
					);
					if (correlation.kind === "sample") {
						if (
							this.seen.has(correlation.id) ||
							this.seen.size >= this.policy.maxRequestsPerFrame
						)
							throw particleTransportError(
								"replayed or excessive sample request",
							);
						this.seen.add(correlation.id);
						this.outstanding.set(correlation.id, value.sequence);
					}
				}
				for (const listener of [...this.listeners]) listener(event);
				if (value.terminal)
					throw particleTransportError(
						"native context/window became unavailable",
					);
			}
		} catch (error) {
			if (!this.closing) this.fail(error);
		}
	}
	private async ok(
		operation: ElectronParticleOperation,
		body: object,
		cleanup = false,
	) {
		if (cleanup) this.beginCleanup();
		await particleOk(
			await this.transport.request(
				operation,
				JSON.stringify({ version: 2, ...body }),
				cleanup ? this.cleanupSignal! : this.activeSignal,
			),
		);
		return {};
	}
	async send(
		method: string,
		params: Record<string, unknown> = {},
		session?: string,
	): Promise<Record<string, unknown>> {
		try {
			const cleanup =
				method === "Runtime.removeBinding" ||
				(method === "Runtime.evaluate" &&
					params.expression === ELECTRON_PARTICLE_CLEANUP);
			if (!cleanup) this.check();
			if (session !== this.transport.sessionId || this.closing)
				throw particleTransportError("wrong adapter session");
			switch (method) {
				case "Page.getFrameTree":
					exactObject(params, []);
					return { frameTree: { frame: { id: this.transport.rootFrameId } } };
				case "Runtime.enable":
					exactObject(params, []);
					if (this.enabled || !this.listeners.size)
						throw particleTransportError(
							"context enable requires a sole subscribed consumer",
						);
					this.enabled = true;
					this.pump = this.events();
					return await this.ok("context-enable", {});
				case "Runtime.addBinding":
					exactObject(params, ["name", "executionContextId"]);
					if (
						params.name !== PARTICLE_BINDING_NAME ||
						params.executionContextId !== this.context ||
						this.context === undefined ||
						!this.identity ||
						this.bound
					)
						throw particleTransportError("binding admission failed");
					this.bound = true;
					return await this.ok("binding", {
						action: "add",
						executionContextId: this.context,
					});
				case "Runtime.removeBinding":
					exactObject(params, ["name"]);
					if (
						params.name !== PARTICLE_BINDING_NAME ||
						!this.bound ||
						this.context === undefined
					)
						throw particleTransportError("binding removal is not owned");
					return await this.ok(
						"binding",
						{ action: "remove", executionContextId: this.context },
						true,
					);
				case "Runtime.evaluate": {
					exactObject(params, [
						"contextId",
						"expression",
						"awaitPromise",
						"returnByValue",
					]);
					if (
						params.contextId !== this.context ||
						this.context === undefined ||
						params.awaitPromise !== true ||
						params.returnByValue !== true
					)
						throw particleTransportError("invalid evaluation parameters");
					if (
						params.expression === ELECTRON_PARTICLE_CLEANUP ||
						params.expression === ELECTRON_PARTICLE_CHECK
					) {
						if (!this.evaluated)
							throw particleTransportError("page hook before evaluation");
						return await this.ok(cleanup ? "cleanup" : "check", {}, cleanup);
					}
					if (
						!this.bound ||
						this.evaluated ||
						this.expression === undefined ||
						params.expression !== this.expression
					)
						throw particleTransportError("unrecognized frame expression");
					this.evaluated = true;
					const result = await this.ok("evaluate", {
						executionContextId: this.context,
						expression: this.expression,
					});
					this.evaluationComplete = true;
					return result;
				}
				case "Runtime.callFunctionOn": {
					exactObject(params, [
						"executionContextId",
						"functionDeclaration",
						"arguments",
						"returnByValue",
					]);
					if (
						params.executionContextId !== this.context ||
						params.functionDeclaration !== ELECTRON_PARTICLE_REPLY ||
						params.returnByValue !== true ||
						!Array.isArray(params.arguments) ||
						params.arguments.length !== 1 ||
						!this.identity
					)
						throw particleTransportError("unrecognized reply function");
					const argument = exactObject(params.arguments[0], ["value"]);
					if (
						typeof argument.value !== "string" ||
						Buffer.byteLength(argument.value) >
							this.policy.maxResponseEnvelopeBytes
					)
						throw particleTransportError("invalid reply payload");
					const correlation = particleCorrelation(
							argument.value,
							this.identity,
							true,
						),
						sequence = this.outstanding.get(correlation.id);
					if (sequence === undefined)
						throw particleTransportError("unknown, duplicate or late reply");
					this.outstanding.delete(correlation.id); // Consume before HTTP await; new samples may arrive during this ACK tail.
					this.charge(Buffer.byteLength(argument.value));
					await particleOk(
						await this.transport.request(
							"reply",
							argument.value,
							this.activeSignal,
							sequence,
						),
					);
					return {};
				}
				case "Page.getLayoutMetrics":
					exactObject(params, []);
					if (!this.evaluationComplete)
						throw particleTransportError("layout before evaluation");
					return await this.ok("layout", {});
				case "Page.captureScreenshot": {
					exactObject(params, [
						"format",
						"fromSurface",
						"captureBeyondViewport",
					]);
					if (
						!this.evaluationComplete ||
						this.captured ||
						params.format !== "png" ||
						params.fromSurface !== true ||
						params.captureBeyondViewport !== false
					)
						throw particleTransportError("invalid screenshot request");
					this.captured = true;
					const response = await this.transport.request(
						"screenshot",
						JSON.stringify({ version: 2 }),
						this.activeSignal,
					);
					if (
						response.status !== 200 ||
						response.headers.get("content-type") !== "image/png"
					) {
						await response.body?.cancel().catch(() => {});
						throw particleTransportError("screenshot failed");
					}
					const png = await readParticleBody(
						response,
						ELECTRON_PARTICLE_LIMITS.maxPngBytes,
					);
					if (
						png.length < 24 ||
						!png
							.subarray(0, 8)
							.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
						png.toString("ascii", 12, 16) !== "IHDR" ||
						png.readUInt32BE(16) !== this.width ||
						png.readUInt32BE(20) !== this.height
					)
						throw particleTransportError("invalid PNG dimensions or signature");
					return { data: png.toString("base64") };
				}
				default:
					throw particleTransportError("unlisted local browser operation");
			}
		} catch (error) {
			throw this.fail(error);
		}
	}
	close(reason: "complete" | "cancelled" | "failed") {
		return (this.closePromise ??= (async () => {
			this.closing = true;
			clearTimeout(this.timer);
			this.signal.removeEventListener("abort", this.abortListener);
			this.pollAbort.abort();
			try {
				const value = await particleControl(
					await this.transport.request(
						"close",
						JSON.stringify({ version: 2, reason }),
						AbortSignal.timeout(5000),
					),
					["version", "closed"],
				);
				if (value.closed !== true)
					throw particleTransportError("native window teardown unconfirmed");
				await this.pump;
				this.listeners.clear();
				this.outstanding.clear();
				this.seen.clear();
				this.retained = 0;
				if (this.problem) throw this.problem;
			} finally {
				this.abort.abort();
			}
		})());
	}
}
