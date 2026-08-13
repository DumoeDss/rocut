import { describe, expect, test } from "bun:test";

import { WaveformCache } from "../service";

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	resolve(value: Value): void;
	reject(reason: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
	let resolve!: (value: Value) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<Value>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

class FakeAudioBuffer implements AudioBuffer {
	readonly duration = 1;
	readonly length = 4;
	readonly numberOfChannels = 1;
	readonly sampleRate = 4;
	private readonly data = new Float32Array(new ArrayBuffer(16));

	constructor(value: number) {
		this.data[0] = value;
	}

	// eslint-disable-next-line opencut/prefer-object-params -- implements the platform AudioBuffer API
	copyFromChannel(
		destination: Float32Array,
		_channelNumber: number,
		bufferOffset = 0,
	): void {
		destination.set(this.data.subarray(bufferOffset));
	}

	// eslint-disable-next-line opencut/prefer-object-params -- implements the platform AudioBuffer API
	copyToChannel(
		source: Float32Array,
		_channelNumber: number,
		bufferOffset = 0,
	): void {
		this.data.set(source, bufferOffset);
	}

	getChannelData(_channel: number): Float32Array<ArrayBuffer> {
		return this.data;
	}
}

function audioBuffer(value: number): AudioBuffer {
	return new FakeAudioBuffer(value);
}

function createResources(decodes: Array<Promise<AudioBuffer>>) {
	let closeCalls = 0;
	let contextCalls = 0;
	let activityGeneration = 0;
	let activityAdmitted = true;
	const resources = {
		getActivityGeneration: () => activityGeneration,
		assertActivityGeneration({ generation }: { generation: number }) {
			if (!activityAdmitted || generation !== activityGeneration) {
				throw new Error("stale activity generation");
			}
		},
		createAudioContext() {
			const decode = decodes[contextCalls++] ?? Promise.resolve(audioBuffer(1));
			return {
				context: {
					decodeAudioData: (_audioData: ArrayBuffer) => decode,
				},
				close: async () => {
					closeCalls += 1;
				},
			};
		},
	};
	return {
		resources,
		closeCalls: () => closeCalls,
		contextCalls: () => contextCalls,
		suspend: () => {
			activityAdmitted = false;
			activityGeneration += 1;
		},
		resume: () => {
			activityAdmitted = true;
		},
	};
}

const sourceFile = () => new File([Uint8Array.of(1)], "audio.wav");

describe("WaveformCache ownership", () => {
	test("project replacement invalidates and awaits pending decoding before a fresh generation", async () => {
		const staleDecode = deferred<AudioBuffer>();
		const replacementDecode = deferred<AudioBuffer>();
		const fixture = createResources([
			staleDecode.promise,
			replacementDecode.promise,
		]);
		const cache = new WaveformCache(fixture.resources);

		const stale = cache.getSourceSummary({
			sourceKey: "same",
			sourceFile: sourceFile(),
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(fixture.contextCalls()).toBe(1);

		const cleared = cache.clearAll();
		staleDecode.resolve(audioBuffer(0.25));
		await expect(stale).rejects.toThrow(/invalidated/i);
		await cleared;
		expect(fixture.closeCalls()).toBe(1);

		const replacement = cache.getSourceSummary({
			sourceKey: "same",
			sourceFile: sourceFile(),
		});
		replacementDecode.resolve(audioBuffer(0.75));
		expect((await replacement).amplitudes[0]).toBe(0.75);
		expect(fixture.closeCalls()).toBe(2);
	});

	test("two owners with an equal source key keep distinct decode generations", async () => {
		const decodeA = deferred<AudioBuffer>();
		const decodeB = deferred<AudioBuffer>();
		const fixtureA = createResources([decodeA.promise]);
		const fixtureB = createResources([decodeB.promise]);
		const cacheA = new WaveformCache(fixtureA.resources);
		const cacheB = new WaveformCache(fixtureB.resources);

		const summaryA = cacheA.getSourceSummary({
			sourceKey: "equal",
			sourceFile: sourceFile(),
		});
		const summaryB = cacheB.getSourceSummary({
			sourceKey: "equal",
			sourceFile: sourceFile(),
		});
		await Promise.resolve();
		await Promise.resolve();
		const clearedA = cacheA.clearAll();
		decodeA.resolve(audioBuffer(0.1));
		decodeB.resolve(audioBuffer(0.9));

		await expect(summaryA).rejects.toThrow(/invalidated/i);
		expect((await summaryB).amplitudes[0]).toBeCloseTo(0.9);
		await clearedA;
		expect(fixtureA.closeCalls()).toBe(1);
		expect(fixtureB.closeCalls()).toBe(1);
		await cacheB.clearAll();
	});

	test("suspend rejects a delayed decode publication and resume decodes a fresh generation", async () => {
		const staleDecode = deferred<AudioBuffer>();
		const freshDecode = deferred<AudioBuffer>();
		const fixture = createResources([staleDecode.promise, freshDecode.promise]);
		const cache = new WaveformCache(fixture.resources);

		const stale = cache.getSourceSummary({
			sourceKey: "suspend-source",
			sourceFile: sourceFile(),
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(fixture.contextCalls()).toBe(1);
		fixture.suspend();
		staleDecode.resolve(audioBuffer(0.2));
		await expect(stale).rejects.toThrow(/invalidated/i);
		expect(fixture.closeCalls()).toBe(1);

		fixture.resume();
		const fresh = cache.getSourceSummary({
			sourceKey: "suspend-source",
			sourceFile: sourceFile(),
		});
		freshDecode.resolve(audioBuffer(0.8));
		expect((await fresh).amplitudes[0]).toBeCloseTo(0.8);
		expect(fixture.closeCalls()).toBe(2);
		await cache.dispose();
	});

	test("decode failure closes its context, clears the failed entry, and retries freshly", async () => {
		const failedDecode = deferred<AudioBuffer>();
		const retryDecode = deferred<AudioBuffer>();
		const fixture = createResources([
			failedDecode.promise,
			retryDecode.promise,
		]);
		const cache = new WaveformCache(fixture.resources);
		const failure = cache.getSourceSummary({
			sourceKey: "decode-retry",
			sourceFile: sourceFile(),
		});
		await Promise.resolve();
		await Promise.resolve();
		const decodeError = new Error("waveform decode failed");
		failedDecode.reject(decodeError);
		await expect(failure).rejects.toBe(decodeError);
		expect(fixture.closeCalls()).toBe(1);

		const retry = cache.getSourceSummary({
			sourceKey: "decode-retry",
			sourceFile: sourceFile(),
		});
		retryDecode.resolve(audioBuffer(0.6));
		expect((await retry).amplitudes[0]).toBeCloseTo(0.6);
		expect(fixture.contextCalls()).toBe(2);
		expect(fixture.closeCalls()).toBe(2);
		await cache.dispose();
	});
});
