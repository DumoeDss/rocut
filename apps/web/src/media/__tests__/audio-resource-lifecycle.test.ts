import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { RuntimeResourceHost } from "@/editor/ports";

if (process.env.OPENCUT_AUDIO_RESOURCE_TEST_ISOLATED !== "1") {
	test("finite audio resource lifecycle runs in an isolated WASM mock process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_AUDIO_RESOURCE_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated finite audio lifecycle suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	await import("@/editor/session/__tests__/wasm-test-mock");
	const { C6TestAudioBuffer, C6TestAudioContext } =
		await import("@/editor/session/__tests__/c6-test-audio-context");
	const { UNIMPLEMENTED_RUNTIME_GPU } =
		await import("@/editor/ports/gpu-resources");
	const { createSessionResources, SessionResourceReleaseError } =
		await import("@/editor/session/session-resources");
	const { decodeAudioToFloat32 } = await import("../audio");

	class ControlledAudioContext extends C6TestAudioContext {
		decodeCalls = 0;

		constructor(private readonly decode: () => Promise<AudioBuffer>) {
			super();
		}

		// eslint-disable-next-line opencut/prefer-object-params -- implements the Web Audio API
		override async decodeAudioData(
			_audioData: ArrayBuffer,
			_successCallback?: DecodeSuccessCallback | null,
			_errorCallback?: DecodeErrorCallback | null,
		): Promise<AudioBuffer> {
			this.decodeCalls += 1;
			return this.decode();
		}
	}

	class RejectingAudioBlob extends Blob {
		constructor(private readonly failure: unknown) {
			super([Uint8Array.of(1)]);
		}

		override arrayBuffer(): Promise<ArrayBuffer> {
			return Promise.reject(this.failure);
		}
	}

	interface Deferred {
		readonly promise: Promise<void>;
		resolve(): void;
	}

	function deferred(): Deferred {
		let resolve!: () => void;
		const promise = new Promise<void>((done) => {
			resolve = done;
		});
		return { promise, resolve };
	}

	const NO_CLOSE_ERROR = Symbol("no-close-error");

	function createFixture({
		decode,
		closeError = NO_CLOSE_ERROR,
	}: {
		decode: () => Promise<AudioBuffer>;
		closeError?: unknown;
	}) {
		const context = new ControlledAudioContext(decode);
		const closeGate = deferred();
		let closeCalls = 0;
		let closeStarted = false;
		let sequence = 0;
		const runtimeResources: RuntimeResourceHost = {
			createWorker({ request }) {
				return {
					id: request.id,
					resourceId: "unused-worker",
					postMessage() {},
					onMessage: () => () => {},
					onError: () => () => {},
					terminate() {},
				};
			},
			createAudioContext() {
				return {
					resourceId: "finite-audio",
					sampleRate: context.sampleRate,
					get state() {
						const state = context.state;
						if (state === "closed" || state === "suspended") return state;
						return "running";
					},
					context,
					close: async () => {
						closeCalls += 1;
						closeStarted = true;
						await closeGate.promise;
						if (closeError !== NO_CLOSE_ERROR) throw closeError;
						await context.close();
					},
				};
			},
			createObjectUrl() {
				return {
					resourceId: "unused-url",
					url: "blob:unused",
					revoke() {},
				};
			},
		};
		const resources = createSessionResources({
			runtimeResources,
			runtimeGpu: UNIMPLEMENTED_RUNTIME_GPU,
			nextId: ({ scope }) => `${scope}:${++sequence}`,
		});
		return {
			context,
			resources,
			resolveClose: closeGate.resolve,
			closeCalls: () => closeCalls,
			closeStarted: () => closeStarted,
		};
	}

	async function waitForClose(fixture: {
		closeStarted(): boolean;
	}): Promise<void> {
		for (let index = 0; index < 8 && !fixture.closeStarted(); index += 1) {
			await Promise.resolve();
		}
		expect(fixture.closeStarted()).toBe(true);
	}

	function captureFailure(promise: Promise<unknown>) {
		let settled = false;
		const failure = promise.then(
			(value) => value,
			(error: unknown) => error,
		);
		void failure.finally(() => {
			settled = true;
		});
		return { failure, settled: () => settled };
	}

	test("successful finite decode awaits delayed close before publishing its result", async () => {
		const fixture = createFixture({
			decode: async () => new C6TestAudioBuffer(),
		});
		let settled = false;
		const decoding = decodeAudioToFloat32({
			audioBlob: new Blob([Uint8Array.of(1)]),
			resources: fixture.resources,
		}).finally(() => {
			settled = true;
		});

		await waitForClose(fixture);
		expect(settled).toBe(false);
		expect(fixture.context.decodeCalls).toBe(1);
		expect(fixture.context.state).toBe("running");
		expect(fixture.resources.inspect().audioContext).toEqual({
			created: 1,
			released: 0,
		});

		fixture.resolveClose();
		const result = await decoding;
		expect(result.sampleRate).toBe(48_000);
		expect([...result.samples]).toEqual([0]);
		expect(fixture.context.state).toBe("closed");
		expect(fixture.resources.inspect().audioContext).toEqual({
			created: 1,
			released: 1,
		});
		expect(fixture.closeCalls()).toBe(1);
		await fixture.resources.disposeAll();
		expect(fixture.closeCalls()).toBe(1);
	});

	test("arrayBuffer rejection awaits terminal close and records one released context", async () => {
		const readError = new Error("blob read failed");
		const fixture = createFixture({
			decode: async () => new C6TestAudioBuffer(),
		});
		const captured = captureFailure(
			decodeAudioToFloat32({
				audioBlob: new RejectingAudioBlob(readError),
				resources: fixture.resources,
			}),
		);

		await waitForClose(fixture);
		expect(captured.settled()).toBe(false);
		expect(fixture.context.decodeCalls).toBe(0);
		expect(fixture.context.state).toBe("running");
		expect(fixture.resources.inspect().audioContext).toEqual({
			created: 1,
			released: 0,
		});

		fixture.resolveClose();
		expect(await captured.failure).toBe(readError);
		expect(fixture.context.state).toBe("closed");
		expect(fixture.resources.inspect().audioContext).toEqual({
			created: 1,
			released: 1,
		});
		expect(fixture.closeCalls()).toBe(1);
		await fixture.resources.disposeAll();
		expect(fixture.closeCalls()).toBe(1);
	});

	test("arrayBuffer cancellation awaits terminal close and preserves AbortError", async () => {
		const cancellation = new DOMException("blob read cancelled", "AbortError");
		const fixture = createFixture({
			decode: async () => new C6TestAudioBuffer(),
		});
		const captured = captureFailure(
			decodeAudioToFloat32({
				audioBlob: new RejectingAudioBlob(cancellation),
				resources: fixture.resources,
			}),
		);

		await waitForClose(fixture);
		expect(captured.settled()).toBe(false);
		fixture.resolveClose();
		expect(await captured.failure).toBe(cancellation);
		expect(cancellation.name).toBe("AbortError");
		expect(fixture.context.state).toBe("closed");
		expect(fixture.resources.inspect().audioContext).toEqual({
			created: 1,
			released: 1,
		});
	});

	test("decode rejection awaits terminal close and records one released context", async () => {
		const decodeError = new Error("decode failed");
		const fixture = createFixture({
			decode: () => Promise.reject(decodeError),
		});
		const captured = captureFailure(
			decodeAudioToFloat32({
				audioBlob: new Blob([Uint8Array.of(1)]),
				resources: fixture.resources,
			}),
		);

		await waitForClose(fixture);
		expect(captured.settled()).toBe(false);
		expect(fixture.context.decodeCalls).toBe(1);
		expect(fixture.resources.inspect().audioContext).toEqual({
			created: 1,
			released: 0,
		});
		fixture.resolveClose();
		expect(await captured.failure).toBe(decodeError);
		expect(fixture.context.state).toBe("closed");
		expect(fixture.resources.inspect().audioContext).toEqual({
			created: 1,
			released: 1,
		});
	});

	test("operation and close failures preserve both causes in stable order", async () => {
		const operationError = new Error("decode failed");
		const closeError = new Error("close failed");
		const fixture = createFixture({
			decode: () => Promise.reject(operationError),
			closeError,
		});
		const captured = captureFailure(
			decodeAudioToFloat32({
				audioBlob: new Blob([Uint8Array.of(1)]),
				resources: fixture.resources,
			}),
		);

		await waitForClose(fixture);
		fixture.resolveClose();
		const aggregate = await captured.failure;
		expect(aggregate).toBeInstanceOf(AggregateError);
		if (!(aggregate instanceof AggregateError)) {
			throw new Error("Expected operation and close failures to aggregate.");
		}
		const errors = aggregate.errors;
		expect(errors[0]).toBe(operationError);
		expect(errors[1]).toBeInstanceOf(SessionResourceReleaseError);
		const releaseError = errors[1];
		if (!(releaseError instanceof SessionResourceReleaseError)) {
			throw new Error("Expected an attributed context release failure.");
		}
		expect(releaseError.cause).toBe(closeError);
		expect(fixture.context.state).toBe("running");
		expect(fixture.resources.inspect().audioContext).toEqual({
			created: 1,
			released: 0,
		});
		expect(fixture.closeCalls()).toBe(1);
	});
}
