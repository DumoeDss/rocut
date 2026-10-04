/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- focused platform fixture supplies only AudioManager collaborators. */
import { expect, mock, spyOn, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.OPENCUT_AUDIO_CLOCK_TEST_ISOLATED !== "1") {
	test("audio startup clock suite runs in an isolated process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: { ...process.env, OPENCUT_AUDIO_CLOCK_TEST_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw new Error(result.stdout.toString() + result.stderr.toString());
	});
} else {
	await import("../../../editor/session/__tests__/wasm-test-mock");
	const collections: Array<ReturnType<typeof deferred<unknown[]>>> = [];
	mock.module("../../../media/audio", () => ({
		collectAudioClips: () => {
			const collection = collections.shift();
			if (!collection) throw new Error("Missing audio collection fixture");
			return collection.promise;
		},
	}));
	const { AudioManager } = await import("../audio-manager");

	function deferred<T>() {
		let resolve!: (value: T) => void;
		let reject!: (error: Error) => void;
		const promise = new Promise<T>((done, fail) => {
			resolve = done;
			reject = fail;
		});
		return { promise, resolve, reject };
	}

	async function settle() {
		for (let i = 0; i < 8; i++) await Promise.resolve();
	}

	function fixture({ suspended = false } = {}) {
		const previousWindow = Object.getOwnPropertyDescriptor(
			globalThis,
			"window",
		);
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: {},
		});
		collections.length = 0;
		const listeners = new Set<() => void>();
		const seeks = new Set<(time: number) => void>();
		let playing = false;
		let time = 0;
		const resume = deferred<void>();
		const node = () => ({ gain: { value: 1 }, connect() {} });
		const context = {
			currentTime: 0,
			state: suspended ? "suspended" : "running",
			destination: {},
			resume: () =>
				resume.promise.then(() => {
					context.state = "running";
				}),
			createGain: node,
			createDynamicsCompressor: () => ({
				connect() {},
				threshold: {},
				knee: {},
				ratio: {},
				attack: {},
				release: {},
			}),
		};
		const close = mock(async () => {
			context.state = "closed";
		});
		const subscribe = (fn: () => void) => {
			listeners.add(fn);
			return () => listeners.delete(fn);
		};
		const editor = {
			resources: {
				createAudioContext: () => ({ context, close }),
				setInterval: () => ({ cancel() {} }),
			},
			playback: {
				getVolume: () => 1,
				getIsPlaying: () => playing,
				getCurrentTime: () => time,
				getIsScrubbing: () => false,
				subscribe,
				onSeek: (fn: (time: number) => void) => {
					seeks.add(fn);
					return () => seeks.delete(fn);
				},
				pause: () => {
					playing = false;
					for (const fn of listeners) fn();
				},
			},
			timeline: {
				subscribe: () => () => {},
				getTotalDuration: () => 24_000_000,
			},
			media: { subscribe: () => () => {}, getAssets: () => [] },
			scenes: { getActiveScene: () => ({ tracks: {} }) },
		};
		const manager = new AudioManager(editor as never);
		return {
			manager,
			context,
			resume,
			close,
			collect() {
				const pending = deferred<unknown[]>();
				collections.push(pending);
				return pending;
			},
			play(seconds = 0) {
				time = seconds * 120_000;
				playing = true;
				for (const fn of listeners) fn();
			},
			pause: editor.playback.pause,
			seek(seconds: number) {
				time = seconds * 120_000;
				for (const fn of seeks) fn(time);
			},
			isPlaying: () => playing,
			async dispose() {
				await manager.dispose();
				if (previousWindow)
					Object.defineProperty(globalThis, "window", previousWindow);
				else Reflect.deleteProperty(globalThis, "window");
			},
		};
	}

	// A later audible clip requires an audio clock but doesn't enter decoding
	// during these startup tests. Real decoded output is covered by host E2E.
	const futureClip = {
		id: "future",
		startTime: 100,
		duration: 2,
		muted: false,
	};

	test("pending collection holds the seek position, then follows the native clock", async () => {
		const f = fixture();
		try {
			const collection = f.collect();
			f.play(3);
			expect(f.manager.getPlaybackClockTime()).toBe(3);
			f.context.currentTime = 2;
			expect(f.manager.getPlaybackClockTime()).toBe(3);
			collection.resolve([futureClip]);
			await settle();
			expect(f.manager.getPlaybackClockTime()).toBe(3);
			f.context.currentTime = 2.5;
			expect(f.manager.getPlaybackClockTime()).toBe(3.5);
			f.pause();
			expect(f.manager.getPlaybackClockTime()).toBeNull();
		} finally {
			await f.dispose();
		}
	});

	test("empty and muted-only timelines release the audio clock", async () => {
		for (const clips of [[], [{ ...futureClip, muted: true }]]) {
			const f = fixture();
			try {
				const collection = f.collect();
				f.play();
				collection.resolve(clips);
				await settle();
				expect(f.manager.getPlaybackClockTime()).toBeNull();
				expect(f.isPlaying()).toBe(true);
			} finally {
				await f.dispose();
			}
		}
	});

	test("a cancelled resume cannot start or replace a newer playback clock", async () => {
		const f = fixture({ suspended: true });
		try {
			f.play(2);
			expect(f.manager.getPlaybackClockTime()).toBe(2);
			f.pause();
			expect(f.manager.getPlaybackClockTime()).toBeNull();
			f.resume.resolve();
			await settle();
			expect(f.manager.getPlaybackClockTime()).toBeNull();
		} finally {
			await f.dispose();
		}
	});

	test("stale collection completion cannot override the latest seek", async () => {
		const f = fixture();
		try {
			const oldCollection = f.collect();
			f.play(1);
			const newCollection = f.collect();
			f.seek(5);
			newCollection.resolve([futureClip]);
			await settle();
			oldCollection.resolve([]);
			await settle();
			f.context.currentTime = 0.25;
			expect(f.manager.getPlaybackClockTime()).toBe(5.25);
		} finally {
			await f.dispose();
		}
	});

	test("failed startup pauses and releases the clock instead of freezing playback", async () => {
		const f = fixture();
		const log = spyOn(console, "error").mockImplementation(() => {});
		try {
			const collection = f.collect();
			f.play();
			collection.reject(new Error("fixture decode failed"));
			await settle();
			expect(f.isPlaying()).toBe(false);
			expect(f.manager.getPlaybackClockTime()).toBeNull();
			expect(log).toHaveBeenCalledTimes(1);
		} finally {
			log.mockRestore();
			await f.dispose();
		}
	});

	test("dispose cancels a pending collection and closes the owned context once", async () => {
		const f = fixture();
		const collection = f.collect();
		f.play();
		await f.dispose();
		collection.resolve([futureClip]);
		await settle();
		expect(f.manager.getPlaybackClockTime()).toBeNull();
		expect(f.close).toHaveBeenCalledTimes(1);
	});
}
