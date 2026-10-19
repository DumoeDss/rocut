import { describe, expect, spyOn, test } from "bun:test";

import { buildSourceWaveformSummary } from "../../../media/waveform-summary";
import { WaveformCache as BrowserWaveformCache } from "../service";

// Ownership tests inject a codec because their one-byte sources are deliberately not valid media.
class WaveformCache extends BrowserWaveformCache {
	constructor(
		resources: ConstructorParameters<
			typeof BrowserWaveformCache
		>[0]["resources"],
	) {
		super({
			resources,
			options: {
				contentCache: false,
				decodeSource: async ({ sourceKey, file }) => {
					const bytes = await file.arrayBuffer();
					const handle = resources.createAudioContext({});
					try {
						if (!handle.context)
							throw new Error(
								"Audio waveform decoding is unavailable on this Host.",
							);
						return buildSourceWaveformSummary({
							sourceKey,
							buffer: await handle.context.decodeAudioData(bytes),
						});
					} finally {
						await handle.close();
					}
				},
			},
		});
	}
}

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
	test("rejected URL entries leave the pending index and can retry", async () => {
		let fetches = 0;
		const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
			async () => {
				fetches += 1;
				return new Response(Uint8Array.of(1), {
					status: fetches === 1 ? 500 : 200,
				});
			},
		);
		const fixture = createResources([]);
		const cache = new WaveformCache(fixture.resources);
		try {
			const failed = cache.getSourceSummary({
				sourceKey: "same",
				audioUrl: "url",
			});
			await expect(failed).rejects.toThrow(
				"Failed to fetch waveform source: 500",
			);
			const retry = cache.getSourceSummary({
				sourceKey: "same",
				audioUrl: "url",
			});
			expect(retry).not.toBe(failed);
			await retry;
			expect(
				cache.getSourceSummary({ sourceKey: "same", audioUrl: "url" }),
			).toBe(retry);
			expect(fetches).toBe(2);
		} finally {
			await cache.dispose();
			fetchMock.mockRestore();
		}
	});

	test("URL ready LRU is bounded without evicting pending work or revoking consumers", async () => {
		const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
			async () => new Response(Uint8Array.of(1)),
		);
		const decode = deferred<AudioBuffer>();
		const fixture = createResources([decode.promise]);
		const cache = new WaveformCache(fixture.resources);
		try {
			const pending = cache.getSourceSummary({
				sourceKey: "same",
				audioUrl: "pending",
			});
			for (
				let attempts = 0;
				attempts < 100 && fixture.contextCalls() < 1;
				attempts += 1
			) {
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
			}
			expect(fixture.contextCalls()).toBe(1);
			const completed: Array<Promise<unknown>> = [];
			for (let index = 0; index < 12; index += 1) {
				const result = cache.getSourceSummary({
					sourceKey: "same",
					audioUrl: `url:${index}`,
				});
				completed.push(result);
				await result;
			}
			expect(
				cache.getSourceSummary({ sourceKey: "same", audioUrl: "pending" }),
			).toBe(pending);
			expect(
				cache.getSourceSummary({ sourceKey: "same", audioUrl: "url:11" }),
			).toBe(completed[11]);
			const evicted = cache.getSourceSummary({
				sourceKey: "same",
				audioUrl: "url:0",
			});
			expect(evicted).not.toBe(completed[0]);
			await evicted;
			await expect(completed[0]).resolves.toBeDefined();
			decode.resolve(audioBuffer(0.4));
			expect((await pending).amplitudes[0]).toBeCloseTo(0.4);
			expect(fixture.contextCalls()).toBe(14);
		} finally {
			decode.resolve(audioBuffer(0.4));
			await cache.dispose();
			fetchMock.mockRestore();
		}
	});

	test("cleared URL work cannot publish into the replacement generation", async () => {
		const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
			async () => new Response(Uint8Array.of(1)),
		);
		const decode = deferred<AudioBuffer>();
		const fixture = createResources([decode.promise]);
		const cache = new WaveformCache(fixture.resources);
		try {
			const old = cache.getSourceSummary({
				sourceKey: "same",
				audioUrl: "url",
			});
			for (
				let attempts = 0;
				attempts < 100 && fixture.contextCalls() < 1;
				attempts += 1
			) {
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
			}
			expect(fixture.contextCalls()).toBe(1);
			const cleared = cache.clearSource({ sourceKey: "same" });
			const fresh = cache.getSourceSummary({
				sourceKey: "same",
				audioUrl: "url",
			});
			await fresh;
			decode.resolve(audioBuffer(0.2));
			await expect(old).rejects.toThrow(/invalidated/i);
			await cleared;
			expect(
				cache.getSourceSummary({ sourceKey: "same", audioUrl: "url" }),
			).toBe(fresh);
			expect(fixture.contextCalls()).toBe(2);
		} finally {
			decode.resolve(audioBuffer(0.2));
			await cache.dispose();
			fetchMock.mockRestore();
		}
	});

	test("same key keeps pending and ready File identities isolated and shared", async () => {
		const decodeA = deferred<AudioBuffer>();
		const decodeB = deferred<AudioBuffer>();
		const fixture = createResources([decodeA.promise, decodeB.promise]);
		const cache = new WaveformCache(fixture.resources);
		const fileA = sourceFile();
		const fileB = sourceFile();
		const a = cache.getSourceSummary({ sourceKey: "same", sourceFile: fileA });
		const b = cache.getSourceSummary({ sourceKey: "same", sourceFile: fileB });
		expect(b).not.toBe(a);
		expect(
			cache.getSourceSummary({
				sourceKey: "same",
				sourceFile: fileB,
				audioUrl: "blob:new",
			}),
		).toBe(b);
		decodeB.resolve(audioBuffer(0.8));
		expect((await b).amplitudes[0]).toBeCloseTo(0.8);
		decodeA.resolve(audioBuffer(0.2));
		expect((await a).amplitudes[0]).toBeCloseTo(0.2);
		expect(
			cache.getSourceSummary({ sourceKey: "same", sourceFile: fileB }),
		).toBe(b);
		expect(
			cache.getSourceSummary({ sourceKey: "same", sourceFile: fileA }),
		).toBe(a);
		expect(fixture.contextCalls()).toBe(2);
		await cache.dispose();
	});

	test("a ready File summary does not mask a later replacement with the same key", async () => {
		const fixture = createResources([
			Promise.resolve(audioBuffer(0.2)),
			Promise.resolve(audioBuffer(0.8)),
		]);
		const cache = new WaveformCache(fixture.resources);
		const a = cache.getSourceSummary({
			sourceKey: "same",
			sourceFile: sourceFile(),
		});
		await a;
		const fileB = sourceFile();
		const b = cache.getSourceSummary({ sourceKey: "same", sourceFile: fileB });
		expect(b).not.toBe(a);
		expect((await b).amplitudes[0]).toBeCloseTo(0.8);
		expect(
			cache.getSourceSummary({ sourceKey: "same", sourceFile: fileB }),
		).toBe(b);
		expect(fixture.contextCalls()).toBe(2);
		await cache.dispose();
	});

	test("late old-source failure cannot evict a replacement's successful result", async () => {
		const decodeA = deferred<AudioBuffer>();
		const fixture = createResources([
			decodeA.promise,
			Promise.resolve(audioBuffer(0.7)),
		]);
		const cache = new WaveformCache(fixture.resources);
		const fileB = sourceFile();
		const a = cache.getSourceSummary({
			sourceKey: "same",
			sourceFile: sourceFile(),
		});
		for (
			let attempts = 0;
			attempts < 100 && fixture.contextCalls() < 1;
			attempts += 1
		) {
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
		}
		expect(fixture.contextCalls()).toBe(1);
		const b = cache.getSourceSummary({ sourceKey: "same", sourceFile: fileB });
		await b;
		decodeA.reject(new Error("old source failed"));
		await expect(a).rejects.toThrow("old source failed");
		expect(
			cache.getSourceSummary({ sourceKey: "same", sourceFile: fileB }),
		).toBe(b);
		expect(fixture.contextCalls()).toBe(2);
		await cache.dispose();
	});

	test("ready AudioBuffer replacements use buffer identity ahead of File and URL", async () => {
		const fixture = createResources([]);
		const cache = new WaveformCache(fixture.resources);
		const bufferA = audioBuffer(0.1);
		const bufferB = audioBuffer(0.9);
		const a = cache.getSourceSummary({
			sourceKey: "same",
			audioBuffer: bufferA,
		});
		await a;
		const b = cache.getSourceSummary({
			sourceKey: "same",
			audioBuffer: bufferB,
		});
		expect((await b).amplitudes[0]).toBeCloseTo(0.9);
		expect(
			cache.getSourceSummary({
				sourceKey: "same",
				audioBuffer: bufferB,
				sourceFile: sourceFile(),
				audioUrl: "ignored",
			}),
		).toBe(b);
		expect(fixture.contextCalls()).toBe(0);
		await cache.dispose();
	});

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
