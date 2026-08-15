import { expect, mock, test } from "bun:test";
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
		canvases(time: number) {
			return (async function* () {
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

	test("dispose during initialization cannot repopulate or publish a sink", async () => {
		const pendingTrack = deferred<MockTrack>();
		queuedTracks.push(pendingTrack.promise);
		const cache = new VideoCache();
		const frame = cache.getFrameAt({ mediaId: "same", file: file(), time: 0 });
		expect(inputs).toHaveLength(1);

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
