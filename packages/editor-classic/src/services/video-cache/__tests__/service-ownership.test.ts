import { afterEach, expect, mock, test } from "bun:test";
import type { CanvasSinkOptions } from "mediabunny";
import { fileURLToPath } from "node:url";

if (process.env.OPENCUT_VIDEO_CACHE_TEST_ISOLATED !== "1") {
	test("video cache ownership controls run in an isolated media mock process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_VIDEO_CACHE_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated video cache ownership suite failed:\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	interface Deferred<Value> {
		readonly promise: Promise<Value>;
		resolve(value: Value): void;
	}

	interface MockTrack {
		canDecode(): Promise<boolean>;
		getDecoderConfig?(): Promise<VideoDecoderConfig>;
	}

	function deferred<Value>(): Deferred<Value> {
		let resolve!: (value: Value) => void;
		const promise = new Promise<Value>((done) => {
			resolve = done;
		});
		return { promise, resolve };
	}

	const queuedTracks: Array<Promise<MockTrack>> = [];
	const inputs: MockInput[] = [];
	const sinkOptions: CanvasSinkOptions[] = [];
	const continuousSinks: boolean[] = [];
	const canvasRequests: number[] = [];
	const originalDecoder = Object.getOwnPropertyDescriptor(
		globalThis,
		"VideoDecoder",
	);
	afterEach(() => {
		if (originalDecoder)
			Object.defineProperty(globalThis, "VideoDecoder", originalDecoder);
		else Reflect.deleteProperty(globalThis, "VideoDecoder");
	});

	class MockInput {
		disposeCalls = 0;
		private readonly track: Promise<MockTrack>;

		constructor() {
			this.track =
				queuedTracks.shift() ??
				Promise.resolve({ canDecode: async () => true });
			inputs.push(this);
		}

		getPrimaryVideoTrack(): Promise<MockTrack> {
			return this.track;
		}

		dispose(): void {
			this.disposeCalls += 1;
		}
	}

	class MockCanvasSink {
		private readonly continuous = continuousSinks.shift() ?? false;
		constructor(...args: [MockTrack, CanvasSinkOptions]) {
			sinkOptions.push(args[1]);
		}

		canvases(time: number) {
			canvasRequests.push(time);
			const continuous = this.continuous;
			return (async function* () {
				if (continuous) {
					for (
						let timestamp = Math.floor(time * 4) / 4;
						timestamp < 10;
						timestamp += 0.25
					) {
						yield {
							timestamp,
							duration: 0.25,
							canvas: { width: 1, height: 1 },
						};
					}
					return;
				}
				yield {
					timestamp: time,
					duration: 1,
					canvas: { width: 1, height: 1 },
				};
			})();
		}
	}

	mock.module("mediabunny", () => ({
		Input: MockInput,
		BlobSource: class {},
		CanvasSink: MockCanvasSink,
		ALL_FORMATS: [],
	}));

	const { VideoCache } = await import("../service");
	const file = () => new File([Uint8Array.of(1)], "clip.mp4");

	test("cached forward playback does not reset the decoder after a late frame beyond two seconds", async () => {
		continuousSinks.push(true);
		const cache = new VideoCache();
		const before = canvasRequests.length;
		const source = file();
		try {
			for (let time = 0; time <= 4; time += 0.25) {
				expect(
					(
						await cache.getFrameAt({
							mediaId: "continuous",
							file: source,
							time,
						})
					)?.timestamp,
				).toBe(time);
				await Promise.resolve();
			}
			expect(
				(
					await cache.getFrameAt({
						mediaId: "continuous",
						file: source,
						time: 4.75,
					})
				)?.timestamp,
			).toBe(4.75);
			expect(canvasRequests.slice(before)).toEqual([0]);
		} finally {
			await cache.dispose();
		}
	});

	test("sixteen sequential shots retain at most three idle decoders", async () => {
		const cache = new VideoCache();
		const before = inputs.length;
		try {
			for (let i = 0; i < 16; i++) {
				const mediaId = `shot-${i}`;
				const release = cache.retain({ mediaId });
				expect(
					await cache.getFrameAt({ mediaId, file: file(), time: 0 }),
				).not.toBeNull();
				release();
				release(); // Idempotent consumer cleanup.
				expect(cache.getStats().totalSinks).toBeLessThanOrEqual(3);
			}
			expect(
				inputs.slice(before).filter((input) => input.disposeCalls === 1),
			).toHaveLength(13);
		} finally {
			await cache.dispose();
		}
		expect(
			inputs.slice(before).every((input) => input.disposeCalls === 1),
		).toBe(true);
	});

	test("in-flight canvas consumers are pinned while idle LRU decoders are released", async () => {
		const cache = new VideoCache();
		const releaseHeld = cache.retain({ mediaId: "held" });
		const heldIndex = inputs.length;
		await cache.getFrameAt({ mediaId: "held", file: file(), time: 0 });
		try {
			for (let i = 0; i < 7; i++) {
				const mediaId = `idle-${i}`;
				const release = cache.retain({ mediaId });
				await cache.getFrameAt({ mediaId, file: file(), time: 0 });
				release();
			}
			expect(inputs[heldIndex]!.disposeCalls).toBe(0);
			expect(cache.getStats().totalSinks).toBe(4);
			releaseHeld();
			expect(inputs[heldIndex]!.disposeCalls).toBe(1);
			expect(cache.getStats().totalSinks).toBe(3);
		} finally {
			releaseHeld();
			await cache.dispose();
		}
	});

	test("supported software preference reaches the actual CanvasSink", async () => {
		Object.defineProperty(globalThis, "VideoDecoder", {
			configurable: true,
			value: { isConfigSupported: async () => ({ supported: true }) },
		});
		queuedTracks.push(
			Promise.resolve({
				canDecode: async () => true,
				getDecoderConfig: async () => ({ codec: "avc1.64001f" }),
			}),
		);
		const cache = new VideoCache();
		try {
			expect(
				await cache.getFrameAt({ mediaId: "software", file: file(), time: 0 }),
			).not.toBeNull();
			expect(sinkOptions.at(-1)).toEqual({
				poolSize: 3,
				fit: "contain",
				decoderOptions: { hardwareAcceleration: "prefer-software" },
			});
		} finally {
			await cache.dispose();
		}
	});

	test("disposal during capability probing cannot construct or publish a sink", async () => {
		const started = deferred<void>();
		const supported = deferred<{ supported: boolean }>();
		Object.defineProperty(globalThis, "VideoDecoder", {
			configurable: true,
			value: {
				isConfigSupported: () => {
					started.resolve();
					return supported.promise;
				},
			},
		});
		queuedTracks.push(
			Promise.resolve({
				canDecode: async () => true,
				getDecoderConfig: async () => ({ codec: "avc1.64001f" }),
			}),
		);
		const cache = new VideoCache();
		const before = sinkOptions.length;
		const frame = cache.getFrameAt({
			mediaId: "late-probe",
			file: file(),
			time: 0,
		});
		await started.promise;
		const disposed = cache.dispose();
		supported.resolve({ supported: true });
		expect(await frame).toBeNull();
		await disposed;
		expect(sinkOptions).toHaveLength(before);
		expect(inputs.at(-1)?.disposeCalls).toBe(1);
		expect(cache.getStats().totalSinks).toBe(0);
	});

	test("dispose during initialization cannot repopulate or publish a sink", async () => {
		const pendingTrack = deferred<MockTrack>();
		queuedTracks.push(pendingTrack.promise);
		const cache = new VideoCache();
		const frame = cache.getFrameAt({ mediaId: "same", file: file(), time: 0 });
		expect(inputs.at(-1)?.disposeCalls).toBe(0);

		const disposed = cache.dispose();
		pendingTrack.resolve({ canDecode: async () => true });

		expect(await frame).toBeNull();
		await disposed;
		expect(cache.getStats()).toEqual({
			totalSinks: 0,
			activeSinks: 0,
			cachedFrames: 0,
		});
		expect(inputs.at(-1)?.disposeCalls).toBe(1);
	});

	test("initialization failure disposes its Input and a retry publishes only a fresh sink", async () => {
		queuedTracks.push(
			Promise.resolve({
				canDecode: async () => false,
			}),
		);
		const cache = new VideoCache();
		const before = inputs.length;
		await expect(
			cache.getFrameAt({ mediaId: "retry", file: file(), time: 0 }),
		).rejects.toThrow(/not supported/i);
		const failedInput = inputs[before]!;
		expect(failedInput.disposeCalls).toBe(1);
		expect(cache.getStats()).toEqual({
			totalSinks: 0,
			activeSinks: 0,
			cachedFrames: 0,
		});

		expect(
			await cache.getFrameAt({ mediaId: "retry", file: file(), time: 1 }),
		).not.toBeNull();
		const freshInput = inputs[before + 1]!;
		expect(freshInput).not.toBe(failedInput);
		expect(freshInput.disposeCalls).toBe(0);
		await cache.dispose();
		expect(freshInput.disposeCalls).toBe(1);
	});

	test("project replacement invalidates the old generation and permits a fresh sink", async () => {
		const cache = new VideoCache();
		const before = inputs.length;
		expect(
			await cache.getFrameAt({ mediaId: "replace", file: file(), time: 0 }),
		).not.toBeNull();
		const first = inputs[before]!;

		await cache.clearAll();
		expect(first.disposeCalls).toBe(1);
		expect(
			await cache.getFrameAt({ mediaId: "replace", file: file(), time: 1 }),
		).not.toBeNull();
		const second = inputs[before + 1]!;
		expect(second).not.toBe(first);
		expect(second.disposeCalls).toBe(0);
		expect(cache.getStats().totalSinks).toBe(1);
		await cache.dispose();
		expect(second.disposeCalls).toBe(1);
	});

	test("two owners with an equal media key keep distinct inputs and generations", async () => {
		const cacheA = new VideoCache();
		const cacheB = new VideoCache();
		const before = inputs.length;
		await Promise.all([
			cacheA.getFrameAt({ mediaId: "equal", file: file(), time: 0 }),
			cacheB.getFrameAt({ mediaId: "equal", file: file(), time: 0 }),
		]);
		const inputA = inputs[before]!;
		const inputB = inputs[before + 1]!;
		expect(inputA).not.toBe(inputB);

		await cacheA.dispose();
		expect(inputA.disposeCalls).toBe(1);
		expect(inputB.disposeCalls).toBe(0);
		expect(cacheB.getStats().totalSinks).toBe(1);
		await cacheB.dispose();
		expect(inputB.disposeCalls).toBe(1);
	});
}
